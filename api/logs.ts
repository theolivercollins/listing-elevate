import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../lib/db.js';
import { requireAdmin } from '../lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Guard: pipeline_logs contains cross-tenant addresses and internal pipeline
  // detail. Only admins (operators) may read this endpoint.
  const auth = await requireAdmin(req, res);
  if (!auth) return; // requireAdmin already sent 401/403

  try {
    const page = parseInt((req.query.page as string) ?? '1', 10);
    const limit = parseInt((req.query.limit as string) ?? '50', 10);
    const stage = req.query.stage as string | undefined;
    const level = req.query.level as string | undefined;
    const propertyId = req.query.property_id as string | undefined;
    const offset = (page - 1) * limit;

    let query = getSupabase()
      .from('pipeline_logs')
      .select('*, properties(address)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (stage) query = query.eq('stage', stage);
    if (level) query = query.eq('level', level);
    if (propertyId) query = query.eq('property_id', propertyId);

    const { data, count, error } = await query;
    if (error) throw error;

    return res.status(200).json({
      logs: data,
      total: count,
      page,
      totalPages: Math.ceil((count ?? 0) / limit),
    });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch logs' });
  }
}
