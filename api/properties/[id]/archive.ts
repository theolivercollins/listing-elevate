import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getProperty, getSupabase } from '../../../lib/db.js';
import { verifyAuth } from '../../../lib/auth.js';

/**
 * POST /api/properties/:id/archive
 *
 * Soft-archives a property by setting status = 'archived'.
 * Does NOT touch scenes, cost_events, or any dependent rows —
 * purely a status flag so it can be un-archived later.
 *
 * Auth: caller must be the property owner (submitted_by) or an admin.
 * Env guard: non-prod writes are skipped unless LE_ALLOW_NONPROD_WRITES=true.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth gate — must have a valid session before any DB work.
  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const id = req.query.id as string;

  let property;
  try {
    property = await getProperty(id);
  } catch {
    // getProperty throws (Supabase single()) when no row matches — return 404.
    return res.status(404).json({ error: 'Property not found' });
  }

  // Only the property owner (submitted_by) or an admin may archive.
  const isOwner = property.submitted_by === auth.user.id;
  const isAdmin = auth.profile.role === 'admin';
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Env write-guard: skip mutation on non-prod unless explicitly unlocked.
  if (
    process.env.VERCEL_ENV !== 'production' &&
    process.env.LE_ALLOW_NONPROD_WRITES !== 'true'
  ) {
    return res.status(200).json({ ok: true, skipped: 'non-prod' });
  }

  try {
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
