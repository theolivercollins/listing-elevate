#!/usr/bin/env -S npx tsx
// One-off: replicates api/admin/prompt-lab/mine.ts using service-role.
// Trigger 2026-04-28 to mine 60 days of latent ratings into proposals.

import * as fs from "fs";
import * as path from "path";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

import Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "../../lib/client.js";
import { DIRECTOR_SYSTEM } from "../../lib/prompts/director.js";
import { isNonProdEnv } from "../../lib/env.js";
import { DIRECTOR_PATCH_SYSTEM } from "../../lib/prompts/director-patch.js";
import { computeClaudeCost } from "../../lib/utils/claude-cost.js";

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

async function main() {
  const days = Number(process.env.MINE_DAYS ?? 60);
  const supabase = getSupabase();
  const sinceIso = new Date(Date.now() - days * 86400000).toISOString();

  const { data: rows, error } = await supabase
    .from("prompt_lab_iterations_complete")
    .select("id, rating, tags, user_comment, refinement_instruction, refiner_rationale, clip_url, provider, analysis_json, director_output_json, created_at")
    .gte("created_at", sinceIso)
    .not("rating", "is", null);
  if (error) throw new Error(`select failed: ${error.message}`);
  const iterations = (rows ?? []) as IterationRow[];
  console.log(`[mine] pulled ${iterations.length} rated iterations from last ${days} days`);

  if (iterations.length < 3) {
    throw new Error(`not enough rated iterations (need >=3, got ${iterations.length})`);
  }

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
  console.log(`[mine] qualifying buckets (n>=3): ${evidence.length}`);

  if (evidence.length === 0) throw new Error("no buckets had >=3 rated samples");

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

  console.log(`[mine] payload size: userMessage=${userMessage.length} chars, system=${DIRECTOR_PATCH_SYSTEM.length} chars`);
  if (process.env.MINE_DRY_RUN === "1") {
    console.log("[mine] DRY RUN — exiting before Claude call");
    return;
  }
  const MINE_MODEL = "claude-sonnet-4-6";
  const MINE_MAX_TOKENS = Number(process.env.MINE_MAX_TOKENS ?? 32768);
  const client = new Anthropic({ timeout: 600_000, maxRetries: 2 });
  console.log(`[mine] calling Claude ${MINE_MODEL} via stream (max_tokens=${MINE_MAX_TOKENS})...`);
  let text = "";
  let usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } | null = null;
  const stream = client.messages.stream({
    model: MINE_MODEL,
    max_tokens: MINE_MAX_TOKENS,
    system: DIRECTOR_PATCH_SYSTEM,
    messages: [{ role: "user", content: userMessage }],
  });
  let lastTick = Date.now();
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
      text += ev.delta.text;
      if (Date.now() - lastTick > 5000) {
        process.stdout.write(`\r[mine] streaming... ${text.length} chars`);
        lastTick = Date.now();
      }
    } else if (ev.type === "message_delta" && ev.usage) {
      usage = { ...(usage ?? { input_tokens: 0, output_tokens: 0 }), ...ev.usage } as typeof usage;
    } else if (ev.type === "message_start" && ev.message.usage) {
      usage = ev.message.usage;
    }
  }
  process.stdout.write(`\n`);
  const finalMessage = await stream.finalMessage();
  if (!usage) usage = finalMessage.usage;
  const response = { usage } as { usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } };
  fs.writeFileSync("/tmp/mine-last-response.txt", text);
  console.log(`[mine] full raw response written to /tmp/mine-last-response.txt (${text.length} chars)`);
  const finalStop = (finalMessage as { stop_reason?: string }).stop_reason;
  console.log(`[mine] stop_reason=${finalStop}`);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("[mine] raw text head:", text.slice(0, 500));
    console.error("[mine] raw text tail:", text.slice(-500));
    throw new Error("patch model returned no JSON");
  }
  const parsed = JSON.parse(jsonMatch[0]) as {
    proposed_body: string;
    proposed_diff: string;
    rationale: string;
    changes: Array<{ change_id: string; intent: string; evidence_iteration_ids: string[]; evidence_summary: string }>;
  };

  const cost = computeClaudeCost(response.usage as never, MINE_MODEL);
  console.log(`[mine] cost: ${cost.totalTokens} tokens, $${(cost.costCents / 100).toFixed(4)}`);

  const { error: costErr } = await supabase.from("cost_events").insert({
    property_id: null,
    scene_id: null,
    stage: "rule_mining",
    provider: "anthropic",
    units_consumed: cost.totalTokens,
    unit_type: "tokens",
    cost_cents: Math.round(cost.costCents),
    metadata: { scope: "lab_rule_mining_oneoff", model: MINE_MODEL, iterations_count: iterations.length, days },
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
  if (pErr) throw new Error(`proposal insert failed: ${pErr.message}`);

  console.log(`[mine] proposal inserted: id=${proposal.id} status=${proposal.status} changes=${parsed.changes?.length ?? 0}`);
  console.log("[mine] rationale:", parsed.rationale);
  if (parsed.changes?.length) {
    console.log("[mine] proposed changes:");
    for (const c of parsed.changes) {
      console.log(`  - ${c.change_id}: ${c.intent}`);
      console.log(`    evidence: ${c.evidence_iteration_ids.length} iterations`);
      console.log(`    summary:  ${c.evidence_summary}`);
    }
  }
}

main().catch((e) => {
  console.error("[mine] failed:", e);
  process.exit(1);
});
