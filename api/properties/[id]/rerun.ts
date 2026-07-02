import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getProperty, getSupabase, log, updatePropertyStatus } from '../../../lib/db.js';
import { verifyAuth, setNoStore } from '../../../lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Cache-safety (§8): verifyAuth is called directly here (not via
  // requireAuth), so set no-store/Vary up front on every response path.
  setNoStore(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Auth gate (F3 fix): caller must be authenticated before any read or write.
    // verifyAuth is used directly (not requireAuth) so we control the 401 path here.
    const auth = await verifyAuth(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    const id = req.query.id as string;

    // Fetch property for existence check AND ownership gate — single call, reused below.
    let property;
    try {
      property = await getProperty(id);
    } catch {
      return res.status(404).json({ error: 'Property not found' });
    }

    // Owner-or-admin gate: anonymous or third-party callers cannot wipe customer videos.
    const isOwner = property.submitted_by === auth.user.id;
    const isAdmin = auth.profile.role === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

    // ENV write-guard: prevent destructive mutations outside production unless
    // LE_ALLOW_NONPROD_WRITES is explicitly armed (e.g. in integration tests).
    // Ref: api/cron/post-subscription-charges.ts:29
    if (
      process.env.VERCEL_ENV !== 'production' &&
      process.env.LE_ALLOW_NONPROD_WRITES !== 'true'
    ) {
      return res.status(200).json({ ok: true, skipped: 'non-prod' });
    }

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
    // Error is checked: a silent failure here would leave stale scenes in the DB
    // (with old clip_url / provider_task_id) while the property is reset to
    // 'queued', causing the next pipeline run to operate against stale data.
    const { error: scenesErr } = await supabase.from('scenes').delete().eq('property_id', id);
    if (scenesErr) throw scenesErr;

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
