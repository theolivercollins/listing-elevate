import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getProperty, getSupabase, log, updatePropertyStatus } from '../../../lib/db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const id = req.query.id as string;
    await getProperty(id); // verify exists

    // Mark the boundary between attempts in the preserved log history.
    // Full run_id versioning will eventually replace this tombstone approach.
    await log(id, 'intake', 'info', 'Rerun initiated — prior attempt logs retained (scene links cleared)');

    // Wipe previous generation artifacts so a rerun is a clean slate.
    // The actual pipeline is launched by the client hitting /api/pipeline/[id]
    // exactly once after this endpoint returns.
    const supabase = getSupabase();

    // PRESERVE pipeline_logs — owners need failure history across reruns.
    // pipeline_logs.scene_id is a nullable FK to scenes; clear it first so the
    // subsequent scenes delete cannot be blocked (RESTRICT) or cascade-delete
    // the logs (CASCADE). The NULL-first recipe is safe under any FK constraint.
    const { error: nullErr } = await supabase
      .from('pipeline_logs')
      .update({ scene_id: null })
      .eq('property_id', id);
    // Guard: if the null-update fails we must NOT proceed to scenes.delete(),
    // because an ON DELETE CASCADE constraint would then wipe the very logs we
    // are trying to preserve. Throw here so the outer catch surfaces the error.
    if (nullErr) throw nullErr;

    // Delete scenes for regeneration (rerun still produces a fresh video).
    await supabase.from('scenes').delete().eq('property_id', id);

    await supabase
      .from('properties')
      .update({
        total_cost_cents: 0,
        processing_time_ms: 0,
        selected_photo_count: 0,
        thumbnail_url: null,
        horizontal_video_url: null,
        vertical_video_url: null,
      })
      .eq('id', id);
    await updatePropertyStatus(id, 'queued');

    return res.status(200).json({ message: 'Pipeline reset', status: 'queued' });
  } catch (e) {
    console.error('[rerun] failed for property', req.query.id, e);
    return res.status(500).json({ error: 'Failed to rerun' });
  }
}
