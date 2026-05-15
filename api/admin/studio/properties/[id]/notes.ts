import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../../lib/auth';
import { getSupabase } from '../../../../../lib/client';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const id = String(req.query.id);
  const body = String(req.body?.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'body required' });
  const { error } = await getSupabase().from('property_revision_notes').insert({ property_id: id, source: 'operator', body });
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ ok: true });
}
