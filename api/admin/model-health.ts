import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../lib/auth.js";
import { getSupabase } from "../../lib/client.js";

// GET /api/admin/model-health
//
// Per-provider health metrics for the last 24 h, derived from cost_events.
//
// cost_events has no native `status` or `duration_ms` columns. We proxy:
//   - latency  → metadata->>'duration_ms'  (numeric ms, nullable — only
//                 callsites that explicitly record it will produce data)
//   - failure  → metadata->>'error' IS NOT NULL  (any row that recorded an
//                 error key is counted as a failure)
//
// Columns returned per provider:
//   provider, calls_24h, failures_24h, p50_ms, p95_ms, last_at

export interface ModelHealthRow {
  provider: string;
  calls_24h: number;
  failures_24h: number;
  p50_ms: number | null;
  p95_ms: number | null;
  last_at: string | null;
}

export interface ModelHealthResponse {
  rows: ModelHealthRow[];
  generated_at: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = getSupabase();
  const since = new Date(Date.now() - 86_400_000).toISOString();

  const { data: events, error } = await supabase
    .from("cost_events")
    .select("provider, created_at, metadata")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(50_000);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Group by provider
  const map = new Map<
    string,
    {
      calls: number;
      failures: number;
      durations: number[];
      last_at: string | null;
    }
  >();

  for (const ev of events ?? []) {
    const provider = (ev.provider as string) ?? "unknown";
    const cur = map.get(provider) ?? {
      calls: 0,
      failures: 0,
      durations: [],
      last_at: null,
    };

    cur.calls += 1;

    // Failure proxy: any row where metadata.error is a non-null string
    const meta = ev.metadata as Record<string, unknown> | null;
    if (meta && typeof meta["error"] === "string" && meta["error"]) {
      cur.failures += 1;
    }

    // Latency: metadata.duration_ms (numeric ms)
    const rawDur = meta?.["duration_ms"];
    if (typeof rawDur === "number" && rawDur > 0) {
      cur.durations.push(rawDur);
    } else if (typeof rawDur === "string") {
      const parsed = parseFloat(rawDur);
      if (!Number.isNaN(parsed) && parsed > 0) cur.durations.push(parsed);
    }

    // Last call
    const ts = ev.created_at as string;
    if (!cur.last_at || ts > cur.last_at) cur.last_at = ts;

    map.set(provider, cur);
  }

  function percentile(sorted: number[], p: number): number | null {
    if (sorted.length === 0) return null;
    const idx = Math.floor(p * (sorted.length - 1));
    return Math.round(sorted[idx]);
  }

  const rows: ModelHealthRow[] = [...map.entries()]
    .map(([provider, v]) => {
      const sorted = [...v.durations].sort((a, b) => a - b);
      return {
        provider,
        calls_24h: v.calls,
        failures_24h: v.failures,
        p50_ms: percentile(sorted, 0.5),
        p95_ms: percentile(sorted, 0.95),
        last_at: v.last_at,
      };
    })
    .sort((a, b) => b.calls_24h - a.calls_24h);

  return res.status(200).json({ rows, generated_at: new Date().toISOString() } satisfies ModelHealthResponse);
}
