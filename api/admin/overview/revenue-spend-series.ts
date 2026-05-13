import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

// GET /api/admin/overview/revenue-spend-series?period=30d
//
// Daily series for the Overview revenue/spend dual-area chart.
// Revenue from revenue_entries (manual entries — Stripe-derived or hand-typed).
// Spend from cost_events.cost_cents.

const PERIOD_MS: Record<string, number> = {
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
};

function dateKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

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

  // Note: revenue_entries date column is `received_at` (not `occurred_at`).
  const [revRes, spendRes] = await Promise.all([
    supabase
      .from("revenue_entries")
      .select("amount_cents, received_at")
      .gte("received_at", since)
      .limit(10000),
    supabase
      .from("cost_events")
      .select("cost_cents, created_at")
      .gte("created_at", since)
      .limit(10000),
  ]);
  if (revRes.error) return res.status(500).json({ error: revRes.error.message });
  if (spendRes.error) return res.status(500).json({ error: spendRes.error.message });

  // Build a date-keyed map covering every day in the period
  const series = new Map<string, { revenue_cents: number; spend_cents: number }>();
  const startMs = Date.now() - periodMs;
  const days = Math.ceil(periodMs / 86_400_000);
  for (let i = 0; i < days; i++) {
    const d = new Date(startMs + i * 86_400_000);
    series.set(dateKey(d.toISOString()), { revenue_cents: 0, spend_cents: 0 });
  }

  for (const row of revRes.data ?? []) {
    const k = dateKey(row.received_at as string);
    const bucket = series.get(k);
    if (bucket) bucket.revenue_cents += (row.amount_cents as number) ?? 0;
  }

  for (const row of spendRes.data ?? []) {
    const k = dateKey(row.created_at as string);
    const bucket = series.get(k);
    if (bucket) bucket.spend_cents += (row.cost_cents as number) ?? 0;
  }

  const points = Array.from(series.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return res.status(200).json({ points, period });
}
