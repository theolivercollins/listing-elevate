import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../lib/auth.js";
import { getSupabase } from "../../lib/client.js";

// GET /api/admin/system-status
//
// One-shot endpoint that powers the System Status dashboard. Pulls from:
//   - cost_events         (per-API-call ledger — Gemini, Claude, Atlas, Kling,
//                          Runway, OpenAI embeddings all flow through here)
//   - prompt_lab_iterations (judge queue depth, render pipeline state)
//   - sku_motion_affinity_refresh_log (latest template-regression alerts)
//
// Returns the shape systemStatusApi.ts expects. All-or-nothing; if any
// sub-query fails we surface a 500 with the error so the dashboard can show
// a clear failure state instead of partial data.

const SINCE_24H = () => new Date(Date.now() - 86_400_000).toISOString();
const SINCE_7D  = () => new Date(Date.now() - 7  * 86_400_000).toISOString();
const SINCE_30D = () => new Date(Date.now() - 30 * 86_400_000).toISOString();
const SINCE_30M = () => new Date(Date.now() - 30 * 60_000).toISOString();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = getSupabase();

  try {
    // 1) Recent API-call events (last 100, newest first).
    const { data: events, error: eErr } = await supabase
      .from("cost_events")
      .select("id, created_at, stage, provider, units_consumed, unit_type, cost_cents, metadata")
      .order("created_at", { ascending: false })
      .limit(100);
    if (eErr) throw eErr;

    // 2) Per-(provider, stage) aggregates for 24h and 7d + running mean.
    //    Do this in JS from a 7d pull — cheap at current volumes.
    const { data: events7d, error: e7Err } = await supabase
      .from("cost_events")
      .select("provider, stage, cost_cents, created_at")
      .gte("created_at", SINCE_7D());
    if (e7Err) throw e7Err;

    const summaryMap = new Map<string, {
      provider: string;
      stage: string;
      count_24h: number;
      cost_cents_24h: number;
      cost_cents_7d: number;
      sum_cost_cents: number;
      count_total: number;
      last_at: string | null;
    }>();
    const t24h = Date.now() - 86_400_000;
    for (const row of events7d ?? []) {
      const key = `${row.provider}|${row.stage}`;
      const cur = summaryMap.get(key) ?? {
        provider: row.provider as string,
        stage: row.stage as string,
        count_24h: 0,
        cost_cents_24h: 0,
        cost_cents_7d: 0,
        sum_cost_cents: 0,
        count_total: 0,
        last_at: null,
      };
      const cents = typeof row.cost_cents === "number" ? row.cost_cents : 0;
      const ts = row.created_at as string;
      cur.cost_cents_7d += cents;
      cur.sum_cost_cents += cents;
      cur.count_total += 1;
      if (new Date(ts).getTime() >= t24h) {
        cur.count_24h += 1;
        cur.cost_cents_24h += cents;
      }
      if (!cur.last_at || ts > cur.last_at) cur.last_at = ts;
      summaryMap.set(key, cur);
    }
    const provider_summary = [...summaryMap.values()]
      .map(({ sum_cost_cents, count_total, ...rest }) => ({
        ...rest,
        mean_cost_cents: count_total > 0 ? Math.round(sum_cost_cents / count_total) : 0,
      }))
      .sort((a, b) => b.cost_cents_7d - a.cost_cents_7d);

    // 3) Queue health — judge pending, judge errors, render orphans.
    const [
      { count: judgePending, error: jpErr },
      { count: judgeErrors24h, error: jeErr },
      { count: rendersPending, error: rpErr },
      { count: renderOrphans, error: roErr },
    ] = await Promise.all([
      supabase
        .from("prompt_lab_iterations")
        .select("id", { count: "exact", head: true })
        .not("clip_url", "is", null)
        .is("judge_rated_at", null),
      supabase
        .from("prompt_lab_iterations")
        .select("id", { count: "exact", head: true })
        .not("judge_error", "is", null)
        .gte("created_at", SINCE_24H()),
      supabase
        .from("prompt_lab_iterations")
        .select("id", { count: "exact", head: true })
        .not("provider_task_id", "is", null)
        .is("clip_url", null)
        .is("render_error", null),
      supabase
        .from("prompt_lab_iterations")
        .select("id", { count: "exact", head: true })
        .not("provider_task_id", "is", null)
        .is("clip_url", null)
        .is("render_error", null)
        .lt("render_submitted_at", SINCE_30M()),
    ]);
    if (jpErr) throw jpErr;
    if (jeErr) throw jeErr;
    if (rpErr) throw rpErr;
    if (roErr) throw roErr;

    const queues = {
      judge_pending: judgePending ?? 0,
      judge_errors_24h: judgeErrors24h ?? 0,
      renders_pending: rendersPending ?? 0,
      renders_orphan_over_30m: renderOrphans ?? 0,
    };

    // 4) Latest template-regression alerts from the affinity refresh log.
    const { data: latestLog } = await supabase
      .from("sku_motion_affinity_refresh_log")
      .select("template_regressions, ran_at")
      .order("ran_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const recent_regressions = (latestLog?.template_regressions as Array<{
      pattern: string;
      count: number;
      example_iteration_id: string | null;
      example_prompt: string | null;
    }> | null) ?? [];

    // 5) Budget totals.
    const [today0 , ] = [new Date(new Date().toDateString()).toISOString()];
    const [{ data: todayRows }, { data: rows7d }, { data: rows30d }] = await Promise.all([
      supabase.from("cost_events").select("cost_cents").eq("is_test", false).gte("created_at", today0),
      supabase.from("cost_events").select("cost_cents").eq("is_test", false).gte("created_at", SINCE_7D()),
      supabase.from("cost_events").select("cost_cents").eq("is_test", false).gte("created_at", SINCE_30D()),
    ]);
    const sumCents = (rows?: Array<{ cost_cents: number | null }> | null) =>
      (rows ?? []).reduce((s, r) => s + (typeof r.cost_cents === "number" ? r.cost_cents : 0), 0);

    // 6) Feedback log — line-by-line timeline of every iteration that has any
    // operator feedback (rating, tags, comment, refinement_instruction).
    // Gives the operator a "did my ratings save?" audit view without SQL.
    const { data: feedbackRows } = await supabase
      .from("prompt_lab_iterations")
      .select("id, order_id, created_at, rating, tags, user_comment, refinement_instruction, session_id, model_used")
      .or("rating.not.is.null,tags.not.is.null,user_comment.not.is.null,refinement_instruction.not.is.null")
      .order("created_at", { ascending: false })
      .limit(100);
    const feedback_log = (feedbackRows ?? []).map((r) => ({
      iteration_id: r.id as string,
      order_id: (r.order_id as string | null) ?? null,
      created_at: r.created_at as string,
      rating: (r.rating as number | null) ?? null,
      tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
      user_comment: (r.user_comment as string | null) ?? null,
      refinement_instruction: (r.refinement_instruction as string | null) ?? null,
      session_id: (r.session_id as string | null) ?? null,
      model_used: (r.model_used as string | null) ?? null,
    }));

    // 7) System flags state — exposes kill-switches so the UI can render a
    // toggle.
    const { data: flagRows } = await supabase
      .from("system_flags")
      .select("name, value, reason, set_at");
    const system_flags = (flagRows ?? []).map((r) => ({
      name: r.name as string,
      value: !!r.value,
      reason: (r.reason as string | null) ?? null,
      set_at: r.set_at as string,
    }));

    return res.status(200).json({
      generated_at: new Date().toISOString(),
      events: events ?? [],
      provider_summary,
      queues,
      recent_regressions,
      budget: {
        today_cents: sumCents(todayRows),
        last_7d_cents: sumCents(rows7d),
        last_30d_cents: sumCents(rows30d),
      },
      feedback_log,
      system_flags,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
}
