import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getProperty, getScenesForProperty, getSupabase } from '../../../lib/db.js';

const ALLOWED_PATCH_STATUSES = new Set([
  'delivered',
  'archived',
  'complete',
  'needs_review',
  'failed',
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'PATCH') {
    try {
      const id = req.query.id as string;
      const { status } = req.body as { status?: string };

      if (!status || !ALLOWED_PATCH_STATUSES.has(status)) {
        return res.status(400).json({
          error: `Invalid status. Allowed values: ${[...ALLOWED_PATCH_STATUSES].join(', ')}`,
        });
      }

      await getProperty(id); // 404 if not found

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
