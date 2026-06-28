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
    const days = parseInt((req.query.days as string) ?? '30', 10);
    const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

    const { data, error } = await getSupabase()
      .from('daily_stats')
      .select()
      .gte('date', startDate)
      .order('date', { ascending: true });

    if (error) throw error;
    return res.status(200).json({ stats: data });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch daily stats' });
  }
}
