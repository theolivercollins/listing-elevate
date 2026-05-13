import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

// GET /api/admin/overview/cost-by-provider?period=30d
//
// Period-aware rollup of cost_events.cost_cents grouped by provider.
// Returns rows sorted by cost_cents desc, plus pct of total per row.

const PERIOD_MS: Record<string, number> = {
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const period = (req.query.period as string) ?? "30d";
  const periodMs = PERIOD_MS[period];
  if (!periodMs) return res.status(400).json({ error: `unknown period '${period}'` });

  const since = new Date(Date.now() - periodMs).toISOString();
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("cost_events")
    .select("provider, cost_cents")
    .gte("created_at", since)
    .limit(10000);
  if (error) return res.status(500).json({ error: error.message });

  const byProvider = new Map<string, number>();
  for (const row of data ?? []) {
    const p = (row.provider as string) ?? "unknown";
    byProvider.set(p, (byProvider.get(p) ?? 0) + ((row.cost_cents as number) ?? 0));
  }

  const total = Array.from(byProvider.values()).reduce((a, b) => a + b, 0);
  const rows = Array.from(byProvider.entries())
    .map(([provider, cost_cents]) => ({
      provider,
      cost_cents,
      pct: total === 0 ? 0 : (cost_cents / total) * 100,
    }))
    .sort((a, b) => b.cost_cents - a.cost_cents);

  return res.status(200).json({ rows, total_cents: total, period });
}
