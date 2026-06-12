import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../lib/auth.js';
import { getSupabase } from '../../../lib/client.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const { data, error } = await getSupabase()
    .from('properties')
    .select('id, address, status, total_cost_cents, created_at, client:client_id(id, name, brand_primary_hex)')
    .eq('order_mode', 'operator')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });

  const buckets: Record<'inbox' | 'rendering' | 'needs_review' | 'delivered', unknown[]> = {
    inbox: [], rendering: [], needs_review: [], delivered: [],
  };
  for (const row of (data ?? []) as Array<{ status: string }>) {
    if (['queued', 'analyzing', 'scripting', 'generating', 'assembling'].includes(row.status)) buckets.rendering.push(row);
    else if (row.status === 'qc' || row.status === 'needs_review') buckets.needs_review.push(row);
    else if (row.status === 'complete') buckets.delivered.push(row);
    else buckets.inbox.push(row);
  }
  return res.status(200).json({ buckets });
}
