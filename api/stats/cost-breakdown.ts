import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../lib/auth.js";
import { getSupabase } from "../../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  // Query windows: today (UTC), last 7d, last 30d
  const now = new Date();
  const sevenAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const thirtyAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const supabase = getSupabase();
  const { data: events } = await supabase
    .from("cost_events")
    .select("provider, stage, cost_cents, metadata, created_at")
    .eq("is_test", false)
    .gte("created_at", thirtyAgo.toISOString())
    .limit(50000);

  interface Bucket { events: number; cents: number; }
  const byProvider = new Map<string, { today: Bucket; week: Bucket; month: Bucket }>();
  const byModel = new Map<string, { today: Bucket; week: Bucket; month: Bucket }>();
  const byScope = new Map<string, { today: Bucket; week: Bucket; month: Bucket }>();
  const byStage = new Map<string, { today: Bucket; week: Bucket; month: Bucket }>();

  function ensure<K>(m: Map<K, { today: Bucket; week: Bucket; month: Bucket }>, k: K) {
    if (!m.has(k)) m.set(k, { today: { events: 0, cents: 0 }, week: { events: 0, cents: 0 }, month: { events: 0, cents: 0 } });
    return m.get(k)!;
  }

  for (const e of events ?? []) {
    const createdAt = new Date(e.created_at);
    const inMonth = createdAt >= thirtyAgo;
    const inWeek = createdAt >= sevenAgo;
    const inToday = createdAt >= todayStart;
    const cents = e.cost_cents ?? 0;
    const model = (e.metadata as { model?: string } | null)?.model ?? "—";
    const scope = (e.metadata as { scope?: string } | null)?.scope ?? e.stage ?? "—";
    const stage = e.stage ?? "—";

    for (const [key, map] of [
      [e.provider, byProvider] as const,
      [model, byModel] as const,
      [scope, byScope] as const,
      [stage, byStage] as const,
    ]) {
      const b = ensure(map, key);
      if (inMonth) { b.month.events += 1; b.month.cents += cents; }
      if (inWeek) { b.week.events += 1; b.week.cents += cents; }
      if (inToday) { b.today.events += 1; b.today.cents += cents; }
    }
  }

  function toArr<K extends string>(m: Map<K, { today: Bucket; week: Bucket; month: Bucket }>) {
    return [...m.entries()]
      .map(([k, v]) => ({ key: k, ...v }))
      .sort((a, b) => b.month.cents - a.month.cents);
  }

  return res.status(200).json({
    byProvider: toArr(byProvider),
    byModel: toArr(byModel),
    byScope: toArr(byScope),
    byStage: toArr(byStage),
  });
}
