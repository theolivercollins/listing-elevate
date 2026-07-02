import type { VercelRequest, VercelResponse } from "@vercel/node";

export const maxDuration = 120;

import Anthropic from "@anthropic-ai/sdk";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";
import { DIRECTOR_SYSTEM } from "../../../lib/prompts/director.js";
import { DIRECTOR_PATCH_SYSTEM } from "../../../lib/prompts/director-patch.js";
import { computeClaudeCost } from "../../../lib/utils/claude-cost.js";
import { isNonProdEnv } from "../../../lib/env.js";

// POST /api/admin/prompt-lab/mine
//   body: { days?: number }
// Aggregates Lab iteration ratings in the last N days, asks Claude to propose
// a DIRECTOR_SYSTEM patch, inserts a prompt_lab_proposals row in status=pending.

function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

interface IterationRow {
  id: string;
  rating: number | null;
  tags: string[] | null;
  user_comment: string | null;
  refinement_instruction: string | null;
  refiner_rationale: string | null;
  clip_url: string | null;
  provider: string | null;
  analysis_json: { room_type?: string; depth_rating?: string; key_features?: string[]; composition?: string } | null;
  director_output_json: { camera_movement?: string; prompt?: string } | null;
  created_at: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const { days = 60 } = (req.body ?? {}) as { days?: number };
  const supabase = getSupabase();
  const sinceIso = new Date(Date.now() - days * 86400000).toISOString();

  // Mine from the `_complete` view (migration 015) so half-built
  // iterations — rating without an analysis or director output — don't
  // contaminate the bucket averages.
  const { data: rows, error } = await supabase
    .from("prompt_lab_iterations_complete")
    .select("id, rating, tags, user_comment, refinement_instruction, refiner_rationale, clip_url, provider, analysis_json, director_output_json, created_at")
    .gte("created_at", sinceIso)
    .not("rating", "is", null);
  if (error) return res.status(500).json({ error: error.message });
  const iterations = (rows ?? []) as IterationRow[];

  if (iterations.length < 3) {
    return res.status(400).json({ error: "not enough rated iterations to mine (need ≥3)", count: iterations.length });
  }

  // Group by (room_type × camera_movement × provider) bucket
  type Bucket = {
    key: string;
    room: string;
    movement: string;
    provider: string;
    winners: IterationRow[];
    losers: IterationRow[];
    allRatings: number[];
  };
  const buckets = new Map<string, Bucket>();
  for (const it of iterations) {
    const room = it.analysis_json?.room_type ?? "other";
    const movement = it.director_output_json?.camera_movement ?? "unknown";
    const provider = it.provider ?? "unknown";
    const key = `${room}|${movement}|${provider}`;
    const b = buckets.get(key) ?? { key, room, movement, provider, winners: [], losers: [], allRatings: [] };
    b.allRatings.push(it.rating ?? 0);
    if ((it.rating ?? 0) >= 4) b.winners.push(it);
    else if ((it.rating ?? 0) <= 2) b.losers.push(it);
    buckets.set(key, b);
  }

  const evidence = Array.from(buckets.values())
    .filter((b) => b.allRatings.length >= 3)
    .map((b) => ({
      bucket: { room: b.room, camera_movement: b.movement, provider: b.provider },
      sample_size: b.allRatings.length,
      avg_rating: b.allRatings.reduce((s, n) => s + n, 0) / b.allRatings.length,
      // Evidence split: user_comment is admin feedback,
      // refiner_rationale is Claude's own self-explanation. Keeping
      // them separate prevents the rule miner from treating Claude's
      // rationale as authoritative admin intent.
      winners: b.winners.slice(0, 5).map((w) => ({
        iteration_id: w.id,
        rating: w.rating,
        prompt: w.director_output_json?.prompt ?? "",
        tags: w.tags ?? [],
        admin_comment: w.user_comment,
        admin_refinement: w.refinement_instruction,
        refiner_rationale: w.refiner_rationale,
      })),
      losers: b.losers.slice(0, 5).map((l) => ({
        iteration_id: l.id,
        rating: l.rating,
        prompt: l.director_output_json?.prompt ?? "",
        tags: l.tags ?? [],
        admin_comment: l.user_comment,
        admin_refinement: l.refinement_instruction,
        refiner_rationale: l.refiner_rationale,
      })),
    }));

  if (evidence.length === 0) {
    return res.status(400).json({ error: "no buckets had ≥3 rated samples" });
  }

  // Resolve current base body (active lab override or main DIRECTOR_SYSTEM)
  const { data: override } = await supabase
    .from("lab_prompt_overrides")
    .select("body, body_hash")
    .eq("prompt_name", "director")
    .eq("is_active", true)
    .maybeSingle();
  const baseBody: string = override?.body ?? DIRECTOR_SYSTEM;
  const baseBodyHash: string = override?.body_hash ?? hash32(DIRECTOR_SYSTEM);

  const userMessage = `CURRENT DIRECTOR_SYSTEM BODY:
\`\`\`
${baseBody}
\`\`\`

EVIDENCE (${evidence.length} buckets, ${iterations.length} rated iterations over last ${days} days):
${JSON.stringify(evidence, null, 2)}

Produce the JSON object per your instructions.`;

  const MINE_MODEL = "claude-sonnet-4-6";
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MINE_MODEL,
      max_tokens: 8192,
      system: DIRECTOR_PATCH_SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(502).json({ error: "patch model returned no JSON" });
    const parsed = JSON.parse(jsonMatch[0]) as {
      proposed_body: string;
      proposed_diff: string;
      rationale: string;
      changes: Array<{ change_id: string; intent: string; evidence_iteration_ids: string[]; evidence_summary: string }>;
    };

    // Record token cost for rule mining (Sonnet 4.6). Supabase JS does not
    // throw on insert failure — surface the {error} return explicitly so a
    // schema or RLS regression can't silently zero out cost telemetry.
    const cost = computeClaudeCost(response.usage as never, MINE_MODEL);
    const { error: costErr } = await supabase.from("cost_events").insert({
      property_id: null,
      scene_id: null,
      stage: "rule_mining",
      provider: "anthropic",
      units_consumed: cost.totalTokens,
      unit_type: "tokens",
      cost_cents: Math.round(cost.costCents),
      metadata: { scope: "lab_rule_mining", model: MINE_MODEL, iterations_count: iterations.length, days },
      is_test: isNonProdEnv(),
    });
    if (costErr) console.error("[mine] cost_events insert failed:", costErr);

    const { data: proposal, error: pErr } = await supabase
      .from("lab_prompt_proposals")
      .insert({
        prompt_name: "director",
        base_body_hash: baseBodyHash,
        proposed_diff: parsed.proposed_diff ?? "",
        proposed_body: parsed.proposed_body ?? baseBody,
        evidence: { buckets: evidence, changes: parsed.changes ?? [], iterations_count: iterations.length, days },
        rationale: parsed.rationale ?? null,
        status: parsed.changes?.length ? "pending" : "rejected",
      })
      .select()
      .single();
    if (pErr) return res.status(500).json({ error: pErr.message });

    return res.status(201).json(proposal);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "mine failed", detail: msg });
  }
}
