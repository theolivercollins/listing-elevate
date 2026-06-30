import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../lib/auth.js';
import { getSupabase } from '../../lib/db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  try {
    const supabase = getSupabase();
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

    const [
      { count: completedToday },
      { count: submittedToday },
      { count: inPipeline },
      { count: needsReview },
      { data: completedData },
      { count: totalCompleted },
      { count: totalFailed },
    ] = await Promise.all([
      supabase.from('properties').select('*', { count: 'exact', head: true })
        .eq('status', 'complete').gte('updated_at', `${today}T00:00:00`),
      supabase.from('properties').select('*', { count: 'exact', head: true })
        .gte('created_at', `${today}T00:00:00`),
      supabase.from('properties').select('*', { count: 'exact', head: true })
        .in('status', ['queued', 'analyzing', 'scripting', 'generating', 'qc', 'assembling']),
      supabase.from('properties').select('*', { count: 'exact', head: true })
        .eq('status', 'needs_review'),
      supabase.from('properties').select('processing_time_ms, total_cost_cents')
        .eq('status', 'complete').gte('updated_at', `${today}T00:00:00`),
      supabase.from('properties').select('*', { count: 'exact', head: true })
        .eq('status', 'complete').gte('created_at', `${weekAgo}T00:00:00`),
      supabase.from('properties').select('*', { count: 'exact', head: true })
        .in('status', ['failed', 'needs_review']).gte('created_at', `${weekAgo}T00:00:00`),
    ]);

    // Cost breakdown: fetch last 7 days of cost_events for in-memory aggregation
    const { data: costEvents } = await supabase
      .from('cost_events')
      .select('provider, stage, cost_cents, metadata, created_at')
      .gte('created_at', `${weekAgo}T00:00:00`)
      .limit(10000);

    // Aggregate by provider, scope, and stage
    const byProviderMap = new Map<string, { cents: number; events: number }>();
    const byScopeMap = new Map<string, { cents: number; events: number }>();
    const byStageMap = new Map<string, { cents: number; events: number }>();

    let totalCostThisWeekCents = 0;

    for (const e of costEvents ?? []) {
      const cents = e.cost_cents ?? 0;
      totalCostThisWeekCents += cents;

      // byProvider
      const prov = e.provider ?? 'unknown';
      const provBucket = byProviderMap.get(prov) ?? { cents: 0, events: 0 };
      provBucket.cents += cents;
      provBucket.events += 1;
      byProviderMap.set(prov, provBucket);

      // byScope (metadata.scope, fall back to stage, then 'unscoped')
      const scope = (e.metadata as { scope?: string } | null)?.scope ?? e.stage ?? 'unscoped';
      const scopeBucket = byScopeMap.get(scope) ?? { cents: 0, events: 0 };
      scopeBucket.cents += cents;
      scopeBucket.events += 1;
      byScopeMap.set(scope, scopeBucket);

      // byStage (stage column)
      const stage = e.stage ?? 'unknown';
      const stageBucket = byStageMap.get(stage) ?? { cents: 0, events: 0 };
      stageBucket.cents += cents;
      stageBucket.events += 1;
      byStageMap.set(stage, stageBucket);
    }

    function sortedEntries(m: Map<string, { cents: number; events: number }>) {
      return [...m.entries()].sort((a, b) => b[1].cents - a[1].cents);
    }

    const avgProcessingMs = completedData?.length
      ? completedData.reduce((s: number, p: any) => s + (p.processing_time_ms ?? 0), 0) / completedData.length
      : 0;
    const totalCostToday = completedData?.reduce((s: number, p: any) => s + (p.total_cost_cents ?? 0), 0) ?? 0;
    const avgCost = completedData?.length ? totalCostToday / completedData.length : 0;
    const total = (totalCompleted ?? 0) + (totalFailed ?? 0);
    const successRate = total > 0 ? ((totalCompleted ?? 0) / total) * 100 : 100;

    return res.status(200).json({
      completedToday: completedToday ?? 0,
      submittedToday: submittedToday ?? 0,
      inPipeline: inPipeline ?? 0,
      needsReview: needsReview ?? 0,
      avgProcessingMs: Math.round(avgProcessingMs),
      totalCostTodayCents: totalCostToday,
      totalCostThisWeekCents,
      avgCostPerVideoCents: Math.round(avgCost),
      successRate: Math.round(successRate * 10) / 10,
      costBreakdown: {
        byProvider: sortedEntries(byProviderMap).map(([provider, v]) => ({ provider, ...v })),
        byScope: sortedEntries(byScopeMap).map(([scope, v]) => ({ scope, ...v })),
        byStage: sortedEntries(byStageMap).map(([stage, v]) => ({ stage, ...v })),
      },
    });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
}
