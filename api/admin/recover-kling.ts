import type { VercelRequest, VercelResponse } from '@vercel/node';

export const maxDuration = 300;

// One-shot recovery endpoint for Kling tasks that were accepted + paid for
// but never collected (e.g. the pipeline function hit maxDuration before
// poll completion). Given a propertyId and a list of Kling task IDs, this
// calls Kling checkStatus, downloads the completed clip, uploads to
// Supabase Storage, and inserts a scene row so the clip appears in the
// property's deliverables view.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body as { propertyId?: string; taskIds?: string[] };
  const propertyId = body.propertyId;
  const taskIds = body.taskIds;
  if (!propertyId || !Array.isArray(taskIds) || taskIds.length === 0) {
    return res.status(400).json({ error: 'Require { propertyId, taskIds: string[] }' });
  }

  try {
    const { KlingProvider } = await import('../../lib/providers/kling.js');
    const { getSupabase, recordCostEvent } = await import('../../lib/db.js');
    const { hostVideoOnBunny, isBunnyConfigured, bunnyStreamCostCents, deleteBunnyVideo } = await import('../../lib/providers/bunny-stream.js');
    const kling = new KlingProvider();
    const supabase = getSupabase();

    // Need a placeholder photo_id since scenes.photo_id is NOT NULL. Use any
    // selected photo for this property. The clip content is what matters for
    // recovery; the photo linkage is best-effort.
    const { data: photos } = await supabase
      .from('photos')
      .select('id')
      .eq('property_id', propertyId)
      .eq('selected', true)
      .limit(1);
    const placeholderPhotoId = photos?.[0]?.id;
    if (!placeholderPhotoId) {
      return res.status(400).json({ error: 'No selected photos found for property' });
    }

    // Next scene_number — start from max(existing) + 1, but push to 100+ so
    // recovered scenes are clearly distinct from the original shot plan.
    const { data: maxRow } = await supabase
      .from('scenes')
      .select('scene_number')
      .eq('property_id', propertyId)
      .order('scene_number', { ascending: false })
      .limit(1);
    let nextSceneNum = Math.max(((maxRow?.[0]?.scene_number as number) ?? 0) + 1, 100);

    const results: Array<{ taskId: string; ok: boolean; scene_number?: number; clip_url?: string; reason?: string }> = [];

    for (const taskId of taskIds) {
      try {
        const status = await kling.checkStatus(taskId);
        if (status.status !== 'complete' || !status.videoUrl) {
          results.push({ taskId, ok: false, reason: status.error ?? `status=${status.status}` });
          continue;
        }

        const clipBuffer = await kling.downloadClip(status.videoUrl);

        // Host the recovered clip on Bunny Stream (going-forward video hosting
        // target; replaced the Supabase Storage property-videos mirror 2026-06-12).
        // The old clipPath string is reused as the Bunny title — it uniquely
        // identifies the clip. A Bunny outage or misconfig must NEVER break
        // recovery (zero-HITL): on unconfigured/failure we fall back to the Kling
        // videoUrl and continue. Replaces the prior `throw uploadErr`.
        const clipPath = `${propertyId}/clips/recovered_kling_${taskId}.mp4`;
        let clipUrl = status.videoUrl;
        if (isBunnyConfigured()) {
          try {
            const hosted = await hostVideoOnBunny(clipPath, clipBuffer);
            // HEAD-validate before persisting — if MP4 Fallback is disabled on the
            // library, Bunny returns FINISHED but the rendition URL 404s. A 404
            // clip_url would break the Gemini judge and SPA player (zero-HITL).
            let mp4Valid = false;
            try {
              const headRes = await fetch(hosted.mp4Url, { method: 'HEAD' });
              mp4Valid = headRes.ok;
              if (!mp4Valid) {
                console.warn(`[recover-kling] bunny mp4Url HEAD ${headRes.status} for ${clipPath} — keeping provider URL`);
                // Clean up the orphaned Bunny object (upload succeeded but URL inaccessible).
                deleteBunnyVideo(hosted.guid).catch(() => {});
              }
            } catch (headErr) {
              console.warn(`[recover-kling] bunny mp4Url HEAD threw for ${clipPath} — keeping provider URL:`,
                headErr instanceof Error ? headErr.message : String(headErr));
              // Clean up the orphaned Bunny object (upload succeeded but HEAD threw).
              deleteBunnyVideo(hosted.guid).catch(() => {});
            }
            if (mp4Valid) {
              clipUrl = hosted.mp4Url;
            }
            // Cost row regardless of HEAD result — Bunny was called either way.
            recordCostEvent({
              propertyId,
              sceneId: null,
              stage: 'generation',
              provider: 'bunny',
              unitsConsumed: 1,
              unitType: 'renders',
              costCents: bunnyStreamCostCents(clipBuffer.byteLength),
              metadata: { bunny_hosted: mp4Valid, clip_path: clipPath, source: 'recover' },
            }).catch((e) => console.error('[recover-kling] bunny cost_event failed:', e));
          } catch (bunnyErr) {
            console.warn(
              `[recover-kling] bunny host failed for ${clipPath} — keeping provider URL:`,
              bunnyErr instanceof Error ? bunnyErr.message : String(bunnyErr),
            );
          }
        } else {
          console.warn(`[recover-kling] bunny not configured — keeping provider URL for ${clipPath}`);
        }

        const sceneNum = nextSceneNum++;
        const { error: insertErr } = await supabase.from('scenes').insert({
          property_id: propertyId,
          photo_id: placeholderPhotoId,
          scene_number: sceneNum,
          camera_movement: 'slow_pan',
          prompt: `[Recovered] Kling task ${taskId}`,
          duration_seconds: 5,
          status: 'qc_pass',
          provider: 'kling',
          clip_url: clipUrl,
          attempt_count: 1,
          qc_verdict: 'auto_pass',
          qc_confidence: 1.0,
        });
        if (insertErr) throw insertErr;

        results.push({ taskId, ok: true, scene_number: sceneNum, clip_url: clipUrl });
      } catch (err) {
        results.push({ taskId, ok: false, reason: err instanceof Error ? err.message : String(err) });
      }
    }

    return res.status(200).json({ propertyId, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: 'Recovery failed', detail: msg });
  }
}
