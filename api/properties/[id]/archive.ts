import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getProperty, getSupabase } from '../../../lib/db.js';

/**
 * POST /api/properties/:id/archive
 *
 * Soft-archives a property by setting status = 'archived'.
 * Does NOT touch scenes, cost_events, or any dependent rows —
 * purely a status flag so it can be un-archived later.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const id = req.query.id as string;
    await getProperty(id); // verify exists + 404 if not

    const { error } = await getSupabase()
      .from('properties')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;

    return res.status(200).json({ message: 'Property archived', status: 'archived' });
  } catch {
    return res.status(500).json({ error: 'Failed to archive property' });
  }
}
