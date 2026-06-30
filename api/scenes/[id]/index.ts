import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getProperty, getSupabase } from '../../../lib/db.js';
import { verifyAuth } from '../../../lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth gate — scene data (including director prompts) is tenant-private.
  // An unauthenticated or cross-tenant caller must not receive any scene fields.
  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const id = req.query.id as string;
    const supabase = getSupabase();

    const { data: scene, error } = await supabase
      .from('scenes')
      .select('*, photos(*)')
      .eq('id', id)
      .single();

    if (error || !scene) {
      return res.status(404).json({ error: 'Scene not found' });
    }

    // Resolve the owning property so we can enforce the owner-or-admin gate.
    // property_id is always set on persisted scenes; treat absence as 404 to
    // avoid leaking data for orphaned rows.
    const propertyId = (scene as { property_id?: string }).property_id;
    if (!propertyId) {
      return res.status(404).json({ error: 'Scene not found' });
    }

    let property;
    try {
      property = await getProperty(propertyId);
    } catch {
      // Property row missing (orphaned scene) — caller must not see data.
      return res.status(404).json({ error: 'Scene not found' });
    }

    const isOwner = property.submitted_by === auth.user.id;
    const isAdmin = auth.profile.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { data: logs } = await supabase
      .from('pipeline_logs')
      .select()
      .eq('scene_id', id)
      .order('created_at', { ascending: true });

    return res.status(200).json({ ...scene, logs: logs ?? [] });
  } catch {
    return res.status(404).json({ error: 'Scene not found' });
  }
}
