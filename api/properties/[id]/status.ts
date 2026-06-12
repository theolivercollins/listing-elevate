import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getProperty, getScenesForProperty, getSupabase } from '../../../lib/db.js';
import { verifyAuth } from '../../../lib/auth.js';

const ALLOWED_PATCH_STATUSES = new Set([
  'delivered',
  'archived',
  'complete',
  'needs_review',
  'failed',
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'PATCH') {
    // Auth gate: caller must have a valid session AND be the property owner or admin.
    // verifyAuth is used directly (not requireAuth) so we can distinguish 401 from 403.
    const auth = await verifyAuth(req);
    if (!auth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const id = req.query.id as string;
      const { status } = req.body as { status?: string };

      if (!status || !ALLOWED_PATCH_STATUSES.has(status)) {
        return res.status(400).json({
          error: `Invalid status. Allowed values: ${[...ALLOWED_PATCH_STATUSES].join(', ')}`,
        });
      }

      let property;
      try {
        property = await getProperty(id);
      } catch {
        // getProperty throws (Supabase single()) when no row matches — return 404.
        return res.status(404).json({ error: 'Property not found' });
      }

      // Only the property owner (submitted_by) or an admin may mutate status.
      const isOwner = property.submitted_by === auth.user.id;
      const isAdmin = auth.profile.role === 'admin';
      if (!isOwner && !isAdmin) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { error } = await getSupabase()
        .from('properties')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      return res.status(200).json({ id, status });
    } catch {
      return res.status(500).json({ error: 'Failed to update status' });
    }
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const id = req.query.id as string;
    const property = await getProperty(id);
    const scenes = await getScenesForProperty(id);

    const stages = ['queued', 'analyzing', 'scripting', 'generating', 'qc', 'assembling', 'complete'];
    const currentStageIndex = stages.indexOf(property.status);
    const completedClips = scenes.filter((s: any) => s.status === 'qc_pass').length;

    return res.status(200).json({
      id: property.id,
      address: property.address,
      status: property.status,
      currentStage: currentStageIndex,
      totalStages: stages.length,
      clipsCompleted: completedClips,
      clipsTotal: scenes.length,
      horizontalVideoUrl: property.horizontal_video_url,
      verticalVideoUrl: property.vertical_video_url,
      createdAt: property.created_at,
      processingTimeMs: property.processing_time_ms,
    });
  } catch {
    return res.status(404).json({ error: 'Property not found' });
  }
}
