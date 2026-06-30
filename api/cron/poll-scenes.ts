import type { VercelRequest, VercelResponse } from '@vercel/node';
import { reapStuckScenes, reapStuckDeliveryRuns, reapStuckGeneratingProperties, reapStuckGeneratingDeliveryRuns } from '../../lib/pipeline/stuck-reaper.js';

export const maxDuration = 300;

/**
 * passingThreshold — minimum number of qc_pass scenes required for a property
 * to proceed to assembly (rather than being flagged needs_review).
 *
 * Uses ceil(totalScenes * 0.8) so short videos (e.g. 4-scene 15s clips) are
 * not wrongly penalised by a hardcoded scene count that was tuned for longer
 * videos. Examples: 4 scenes → 4, 5 scenes → 4, 6 scenes → 5, 8 scenes → 7.
 *
 * Pure; no I/O.
 */
export function passingThreshold(totalScenes: number): number {
  return Math.ceil(totalScenes * 0.8);
}

/**
 * buildCorrectiveSuffix — turn a judge's hallucination_flags into corrective
 * render guidance appended to the prompt on a QC re-render. Pure; no I/O.
 *
 * Always emits the standing grounding directive (keep the camera inside the
 * room; do not invent geometry/walls/viewpoints not in the source photo). When
 * flags are present it prepends an "Avoid these defects:" list naming each one.
 */
export function buildCorrectiveSuffix(flags: string[]): string {
  const standing =
    "Keep the camera inside the room at all times; do not invent geometry, walls, doorways, or viewpoints that are not present in the source photo. Stay faithful to the photographed space.";
  const cleaned = (flags ?? []).map((f) => String(f).trim()).filter((f) => f.length > 0);
  if (cleaned.length === 0) return standing;
  return `Avoid these defects: ${cleaned.join(", ")}. ${standing}`;
}

// Backstop poller for scenes that were submitted to a provider but never
// had their completed clip collected (e.g. because the pipeline function
// hit maxDuration mid-poll). Runs on a Vercel Cron every minute. Each
// call picks up scenes that have provider_task_id set and clip_url still
// null, polls the provider for each, downloads completed clips, and
// flips the owning property to complete / needs_review when all scenes
// have settled.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Allow manual invocation for debugging; Vercel Cron sends GET by default.
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Reap stuck rows before the main polling work.
    // Each reaper catches its own errors internally; the outer try/catch here is
    // a final backstop so a reaper throw never breaks the cron body.
    try {
      const { getSupabase: getDb } = await import('../../lib/db.js');
      const db = getDb();
      await reapStuckScenes(db);
      await reapStuckDeliveryRuns(db);
      await reapStuckGeneratingProperties(db);
      await reapStuckGeneratingDeliveryRuns(db);
    } catch (reaperErr) {
      console.error('[poll-scenes] reaper threw unexpectedly:', reaperErr);
    }

    const { getSupabase, updatePropertyStatus, recordCostEvent, log } = await import('../../lib/db.js');
    const { selectProvider, buildProviderFromDecision } = await import('../../lib/providers/router.js');
    const { hostVideoOnBunny, isBunnyConfigured, bunnyStreamCostCents, deleteBunnyVideo, validateBunnyMp4Url } = await import('../../lib/providers/bunny-stream.js');
    const { judgeProductionScene } = await import('../../lib/qc/judge-scene.js');
    const { resubmitScene } = await import('../../lib/pipeline.js');

    // Cap on TOTAL render attempts per scene (gate is `attempt_count < cap`,
    // and attempt_count starts at 1 from the original submit). So the default
    // of 2 allows the original render + ONE judge-driven corrective re-render,
    // after which a still-hallucinated scene is surfaced as needs_review. Set
    // MAX_QC_RERENDERS=3 for two corrective re-renders. NOTE on v1.1: a re-render
    // reuses the same Seedance push-in SKU + source frame and only appends
    // corrective grounding text, so the loop is a safety net that surfaces bad
    // clips for review — the actual hallucination prevention is the analyzer
    // headroom gate + director push-in coercion, which run BEFORE the render.
    // Dormant until JUDGE_ENABLED (judgeProductionScene returns judgeRan:false /
    // verdict:qc_pass when disabled).
    const MAX_QC_RERENDERS = Number(process.env.MAX_QC_RERENDERS ?? 2);
    // Speed-ramp removed 2026-05-27 — see api/admin/prompt-lab/assemble.ts.
    // No more ffmpeg in this cron, so no dynamic import + no pipeline_mode
    // dispatch needed (we used to only ramp v1.1 clips). Every clip is
    // stored as the provider returned it.

    const supabase = getSupabase();

    // Pick up any scene that's been submitted to a provider but doesn't
    // yet have a stored clip. Limit batch size to avoid function timeout.
    const { data: pending, error: pendingErr } = await supabase
      .from('scenes')
      .select('id, property_id, photo_id, scene_number, provider, provider_task_id, duration_seconds, attempt_count, submitted_at, prompt, camera_movement, room_type, atlas_model_sku')
      .not('provider_task_id', 'is', null)
      .is('clip_url', null)
      .order('submitted_at', { ascending: true })
      .limit(30);

    if (pendingErr) throw pendingErr;
    if (!pending || pending.length === 0) {
      // Operator delivery: B-variant renders can outlive the scenes queue
      // (all A clips collected while B is still rendering), so poll them
      // even when no scenes are pending — otherwise a delivery run would
      // stall in 'generating' forever. No-op when none exist.
      let variants: { polled: number; completed: number; failed: number } | null = null;
      try {
        const { pollPendingVariants } = await import('../../lib/delivery/variants.js');
        variants = await pollPendingVariants();
      } catch (err) {
        console.error('[poll-scenes] variant polling failed:', err);
      }
      // Re-attempt judge passes for delivery runs whose B variants just
      // settled — the finalize loop below never fires once a property has
      // no pending scenes, so this sweep is what un-stalls 'generating'.
      let judgeSweep: { swept: number; advanced: number } | null = null;
      try {
        const { sweepActiveJudgePasses } = await import('../../lib/delivery/judge.js');
        judgeSweep = await sweepActiveJudgePasses();
      } catch (err) {
        console.error('[poll-scenes] delivery judge sweep failed:', err);
      }
      return res.status(200).json({ polled: 0, completed: 0, failed: 0, processing: 0, variants, judgeSweep });
    }

    let completedCount = 0;
    let failedCount = 0;
    let processingCount = 0;
    const affectedProperties = new Set<string>();

    // Pull-based bounded-concurrency worker pool — mirrors runGenerationSubmit in
    // lib/pipeline.ts. Up to POLL_CONCURRENCY scenes are polled concurrently;
    // each worker owns a distinct scene.id so concurrency is safe. Shared counters
    // (completedCount / failedCount / processingCount) and affectedProperties are
    // mutated between await points in JS's single-threaded event loop — no races.
    const POLL_CONCURRENCY = Number(process.env.POLL_CONCURRENCY ?? 6);
    const processPendingScene = async (scene: NonNullable<typeof pending>[number]) => {
      affectedProperties.add(scene.property_id);
      try {
        // Reconstruct provider instance. Pass empty room type + no preference —
        // selectProvider will return an instance of whatever scene.provider is
        // if it's still enabled. We don't need the routing logic here, just an
        // IVideoProvider matching scene.provider.
        if (!scene.provider) {
          failedCount++;
          return;
        }
        // Reconstruct provider for cost-accurate polling.
        // For Atlas scenes with a stored SKU, use buildProviderFromDecision so
        // AtlasProvider is initialized with the ACTUAL rendered model —
        // this.model.priceCentsPerClip then reflects the true per-clip cost.
        // Legacy rows with null atlas_model_sku fall back to selectProvider
        // (today's behavior — acceptable for rows that predate migration 091).
        const atlasModelSku = (scene as unknown as { atlas_model_sku?: string | null }).atlas_model_sku;
        const provider = (scene.provider === 'atlas' && atlasModelSku)
          ? buildProviderFromDecision({ provider: 'atlas', modelKey: atlasModelSku, fallback: undefined })
          : selectProvider('other', null, scene.provider as any, []);
        if (provider.name !== scene.provider) {
          // Provider was disabled between submission and polling. Mark stuck.
          await supabase.from('scenes').update({ status: 'needs_review' }).eq('id', scene.id);
          await log(scene.property_id, 'generation', 'error',
            `Scene ${scene.scene_number}: provider ${scene.provider} no longer available for polling`, undefined, scene.id);
          failedCount++;
          return;
        }

        const status = await provider.checkStatus(scene.provider_task_id as string);

        if (status.status === 'processing') {
          processingCount++;
          return;
        }

        if (status.status === 'failed' || !status.videoUrl) {
          await supabase.from('scenes').update({ status: 'needs_review' }).eq('id', scene.id);
          await log(scene.property_id, 'generation', 'error',
            `Scene ${scene.scene_number}: ${scene.provider} task ${scene.provider_task_id} failed: ${status.error ?? 'unknown'}`, undefined, scene.id);

          // CI.4: Record cost for failed renders — over-attribute rather than
          // under-attribute until provider invoices confirm failure policy.
          // Kling pre-paid credits are likely refunded on failure → 0¢.
          const isKlingFailed = scene.provider === 'kling';
          const failedCostCents = isKlingFailed ? 0 : (status.costCents ?? 0);
          try {
            await recordCostEvent({
              propertyId: scene.property_id,
              sceneId: scene.id,
              stage: 'generation',
              provider: scene.provider as Parameters<typeof recordCostEvent>[0]['provider'],
              unitsConsumed: 1,
              unitType: isKlingFailed ? 'kling_units' : null,
              costCents: failedCostCents,
              metadata: {
                scene_number: scene.scene_number,
                duration_seconds: scene.duration_seconds,
                render_outcome: 'failed',
                ...(isKlingFailed ? { billing: 'prepaid_credits_failed_refunded' } : {}),
                source: 'cron',
              },
            });
          } catch (costErr) {
            const costMsg = costErr instanceof Error ? costErr.message : String(costErr);
            await log(scene.property_id, 'generation', 'warn',
              `Scene ${scene.scene_number}: failed cost_events insert: ${costMsg}`, undefined, scene.id);
          }
          failedCount++;
          return;
        }

        // Complete — download + host on Bunny Stream. (No speed-ramp; see comment block above.)
        const clipBuffer = await provider.downloadClip(status.videoUrl);

        // Host the new clip on Bunny Stream (going-forward video hosting target;
        // replaced the Supabase Storage property-videos mirror 2026-06-12). The
        // old clipPath string is reused as the Bunny title — it uniquely
        // identifies the clip. A Bunny outage or misconfig must NEVER break this
        // autonomous cron (zero-HITL): on unconfigured/failure we fall back to the
        // provider videoUrl and continue. Replaces the prior `throw uploadErr`.
        const clipPath = `${scene.property_id}/clips/scene_${scene.scene_number}_v${scene.attempt_count ?? 1}.mp4`;
        let clipUrl = status.videoUrl;
        if (isBunnyConfigured()) {
          try {
            const hosted = await hostVideoOnBunny(clipPath, clipBuffer);
            // HEAD-validate before persisting — sends the Referer header required
            // by Bunny library 679131's referrer allow-listing (server-side fetches
            // have no Referer by default → 403). If MP4 Fallback is also disabled,
            // Bunny returns FINISHED but the URL 404s — either way a bad URL must
            // never reach the DB or the Gemini judge (zero-HITL).
            const mp4Valid = await validateBunnyMp4Url(hosted.mp4Url);
            if (!mp4Valid) {
              console.warn(`[poll-scenes] bunny mp4Url HEAD failed for ${clipPath} — keeping provider URL`);
              // Clean up the orphaned Bunny object (upload succeeded but URL inaccessible).
              deleteBunnyVideo(hosted.guid).catch(() => {});
            }
            if (mp4Valid) {
              clipUrl = hosted.mp4Url;
            }
            // Cost row regardless of HEAD result — Bunny was called either way.
            // Wrapped in .catch so a cost-row failure never breaks the run.
            recordCostEvent({
              propertyId: scene.property_id,
              sceneId: scene.id,
              stage: 'generation',
              provider: 'bunny',
              unitsConsumed: 1,
              unitType: 'renders',
              costCents: bunnyStreamCostCents(clipBuffer.byteLength),
              metadata: { bunny_hosted: mp4Valid, clip_path: clipPath, source: 'cron' },
            }).catch((e) => console.error('[poll-scenes] bunny cost_event failed:', e));
          } catch (bunnyErr) {
            console.warn(
              `[poll-scenes] bunny host failed for ${clipPath} — keeping provider URL:`,
              bunnyErr instanceof Error ? bunnyErr.message : String(bunnyErr),
            );
          }
        } else {
          console.warn(`[poll-scenes] bunny not configured — keeping provider URL for ${clipPath}`);
        }

        // Fallback cost estimate when the provider doesn't return credit
        // usage in its task response. Runway gen4_turbo is ~5 credits/sec;
        // Kling v2-master is 10 units/clip (5s) regardless of duration.
        // Atlas: use atlasClipCostCents(V1_DEFAULT_SKU, durationSeconds) — the
        // model key isn't stored on scenes at poll time, so we use the
        // established per-second price map with the current default SKU.
        // If status.costCents is already populated by AtlasProvider
        // (it returns this.model.priceCentsPerClip on success), this branch
        // is a safety net for any edge case where that field is null.
        // keep in sync with lib/delivery/variants.ts cost fallback
        const { atlasClipCostCents, V1_DEFAULT_SKU } = await import('../../lib/providers/atlas.js');
        const durationSeconds = scene.duration_seconds ?? 5;
        let fallbackUnits: number | undefined;
        let fallbackUnitType: 'credits' | 'kling_units' | undefined;
        let fallbackCents = 0;
        if (provider.name === 'runway') {
          fallbackUnits = Math.round(5 * durationSeconds);
          fallbackUnitType = 'credits';
          fallbackCents = Math.round(fallbackUnits * parseFloat(process.env.RUNWAY_CENTS_PER_CREDIT ?? '1'));
        } else if (provider.name === 'kling') {
          fallbackUnits = 10;
          fallbackUnitType = 'kling_units';
          fallbackCents = Math.round(fallbackUnits * parseFloat(process.env.KLING_CENTS_PER_UNIT ?? '0'));
        } else if (provider.name === 'atlas') {
          fallbackCents = atlasClipCostCents(V1_DEFAULT_SKU, durationSeconds);
          if (fallbackCents === 0) {
            await log(scene.property_id, 'generation', 'warn',
              `[cost] atlas render missing costCents for scene ${scene.scene_number} — using V1_DEFAULT_SKU fallback`,
              undefined, scene.id);
          }
        }

        const costCents = status.costCents ?? fallbackCents;
        const providerUnits = status.providerUnits ?? fallbackUnits;
        const providerUnitType = status.providerUnitType ?? fallbackUnitType ?? null;
        const genTimeMs = scene.submitted_at ? Date.now() - new Date(scene.submitted_at).getTime() : null;

        // Fetch source photo URL for judge grounding (non-fatal if missing).
        let sourcePhotoUrl: string | null = null;
        if (scene.photo_id) {
          const { data: photoRow } = await supabase
            .from('photos')
            .select('id, file_url')
            .eq('id', scene.photo_id);
          sourcePhotoUrl = (photoRow as Array<{ id: string; file_url: string | null }> | null)?.[0]?.file_url ?? null;
        }

        // Run Gemini judge against the completed clip.
        // IMPORTANT: Pass the PROVIDER url (status.videoUrl), not the Bunny CDN
        // clipUrl. Gemini's fetchers send no Referer and would 403 against the
        // Bunny CDN referrer allow-list. The provider URL (still alive at judge
        // time) is what the judge must receive.
        const judged = await judgeProductionScene({
          clipUrl: status.videoUrl,
          sceneId: scene.id,
          directorPrompt: (scene as unknown as { prompt?: string }).prompt ?? '',
          cameraMovement: (scene as unknown as { camera_movement?: string }).camera_movement ?? 'unknown',
          roomType: (scene as unknown as { room_type?: string }).room_type ?? 'other',
          sourcePhotoUrl,
        });

        // QC re-render loop: when the judge hard-rejects a hallucinated clip
        // and we're still under the per-scene cap, feed the hallucination_flags
        // back as corrective guidance and re-submit the scene to a provider.
        // resubmitScene resets the scene to status:'generating' with a fresh
        // provider_task_id, so the next cron tick re-polls and re-judges it.
        //
        // We DON'T write qc_hard_reject in this branch (the scene is back in
        // flight). We DO record the cost of the failed render below before
        // resubmitting — the clip was generated and billed even though it's
        // being discarded — so accounting stays accurate.
        const currentAttempt = (scene.attempt_count ?? 1);
        if (judged.judgeRan && judged.shouldRerender && currentAttempt < MAX_QC_RERENDERS) {
          // Record the cost of this (failed/discarded) render before re-submitting.
          try {
            await recordCostEvent({
              propertyId: scene.property_id,
              sceneId: scene.id,
              stage: 'generation',
              provider: provider.name,
              unitsConsumed: providerUnits,
              unitType: providerUnitType,
              costCents,
              metadata: {
                scene_number: scene.scene_number,
                duration_seconds: scene.duration_seconds,
                generation_time_ms: genTimeMs,
                render_outcome: 'qc_rerender_discarded',
                source: 'cron',
              },
            });
          } catch (costErr) {
            const costMsg = costErr instanceof Error ? costErr.message : String(costErr);
            await log(scene.property_id, 'generation', 'warn',
              `Scene ${scene.scene_number}: failed cost_events insert before re-render: ${costMsg}`, undefined, scene.id);
          }

          const flags = (judged.rubric?.hallucination_flags as string[] | undefined) ?? [];
          const promptSuffix = buildCorrectiveSuffix(flags);

          await log(scene.property_id, 'qc', 'info',
            `Scene ${scene.scene_number}: re-rendering after judge hard-reject (attempt ${currentAttempt}/${MAX_QC_RERENDERS}) — ${judged.reason}`,
            { verdict: judged.verdict, attempt: currentAttempt, flags }, scene.id);

          const resubmit = await resubmitScene(scene.id, { promptSuffix });
          if (resubmit.ok) {
            // Scene is back in flight (status:'generating', fresh task_id) and
            // will be re-polled + re-judged next tick. Don't write any QC status.
            completedCount++;
            return;
          }

          // Resubmit failed — fall back to needs_review so the property surfaces
          // for review rather than dangling. Never let this kill the cron loop.
          await supabase.from('scenes').update({
            status: 'needs_review',
            clip_url: clipUrl,
            generation_cost_cents: costCents,
            generation_time_ms: genTimeMs,
            qc_verdict: judged.verdict,
            qc_confidence: judged.rubric ? judged.rubric.overall / 5 : 1.0,
            qc_issues: flags.length ? { issues: flags } : null,
          }).eq('id', scene.id);
          await log(scene.property_id, 'qc', 'warn',
            `Scene ${scene.scene_number}: QC re-render submit failed (${resubmit.error ?? 'unknown'}); marking needs_review`,
            { error: resubmit.error }, scene.id);
          failedCount++;
          return;
        }

        const newStatus =
          judged.verdict === 'qc_pass' ? 'qc_pass'
          : judged.verdict === 'qc_soft_reject' ? 'needs_review'
          : judged.judgeRan && judged.shouldRerender ? 'needs_review' // cap reached → review, not dangling hard-reject
          : 'qc_hard_reject';

        // Shape matches the dashboard consumer (Pipeline.tsx reads
        // `qc_issues.issues` as string[]). null when there are no flags.
        const qcIssues = judged.rubric?.hallucination_flags?.length
          ? { issues: judged.rubric.hallucination_flags as string[] }
          : null;

        await supabase.from('scenes').update({
          status: newStatus,
          clip_url: clipUrl,
          generation_cost_cents: costCents,
          generation_time_ms: genTimeMs,
          qc_verdict: judged.judgeRan ? judged.verdict : 'auto_pass',
          qc_confidence: judged.rubric ? judged.rubric.overall / 5 : 1.0,
          qc_issues: qcIssues,
        }).eq('id', scene.id);

        if (judged.judgeRan) {
          await log(scene.property_id, 'qc', 'info',
            `Scene ${scene.scene_number}: judge verdict=${judged.verdict} — ${judged.reason}`,
            { verdict: judged.verdict, judgeRan: judged.judgeRan },
            scene.id);
        }

        await recordCostEvent({
          propertyId: scene.property_id,
          sceneId: scene.id,
          stage: 'generation',
          provider: provider.name,
          unitsConsumed: providerUnits,
          unitType: providerUnitType,
          costCents,
          metadata: {
            scene_number: scene.scene_number,
            duration_seconds: scene.duration_seconds,
            generation_time_ms: genTimeMs,
            source: 'cron',
          },
        });
        await log(scene.property_id, 'generation', 'info',
          `Scene ${scene.scene_number}: recovered by cron from ${scene.provider}`, { costCents, providerUnits: status.providerUnits }, scene.id);

        completedCount++;
      } catch (err) {
        failedCount++;
        const msg = err instanceof Error ? err.message : String(err);
        await log(scene.property_id, 'generation', 'warn',
          `Cron poll failed for scene ${scene.scene_number}: ${msg}`, undefined, scene.id);
      }
    };

    const pollQueue = [...pending];
    const pollWorker = async () => {
      while (pollQueue.length) {
        const scene = pollQueue.shift();
        if (!scene) return;
        await processPendingScene(scene);
      }
    };
    await Promise.all(Array.from({ length: Math.min(POLL_CONCURRENCY, pending.length) }, () => pollWorker()));

    // Operator delivery: poll pending B-variant renders (no-op when none exist).
    try {
      const { pollPendingVariants } = await import('../../lib/delivery/variants.js');
      await pollPendingVariants();
    } catch (err) {
      console.error('[poll-scenes] variant polling failed:', err);
    }
    // Operator delivery: re-attempt judge passes for runs stuck in
    // generating/judging whose pairs may have settled via the variant poll
    // above (their properties no longer appear in affectedProperties once
    // every A clip is collected). No-op when no active delivery runs exist.
    try {
      const { sweepActiveJudgePasses } = await import('../../lib/delivery/judge.js');
      await sweepActiveJudgePasses();
    } catch (err) {
      console.error('[poll-scenes] delivery judge sweep failed:', err);
    }

    // For every property we touched, check if all its scenes have settled
    // (either passed or needs_review with no pending task). If so, finalize.
    for (const propertyId of affectedProperties) {
      const { data: scenes } = await supabase
        .from('scenes')
        .select('status, clip_url, provider_task_id')
        .eq('property_id', propertyId);

      if (!scenes) continue;

      // A scene is "still pending" if it has a task_id in flight (waiting
      // on the provider) OR if it's still in 'pending' status without a
      // task_id at all (pipeline submit failed to dispatch it). In either
      // case we must NOT finalize the property.
      const stillPendingTasks = scenes.some(
        s => s.provider_task_id && !s.clip_url && s.status !== 'needs_review',
      );
      const neverSubmitted = scenes.some(
        s => !s.provider_task_id && s.status === 'pending',
      );
      if (stillPendingTasks || neverSubmitted) continue;

      const passed = scenes.filter(s => s.status === 'qc_pass').length;
      const needsReview = scenes.filter(s => s.status === 'needs_review').length;
      // Threshold is scene-count-aware: pass when passed >= ceil(totalScenes * 0.8).
      // A hardcoded 6 was wrong for short (15s / ~4-scene) videos — any needs_review
      // scene would wrongly force the whole property to needs_review even when all
      // 4 scenes passed. passingThreshold() derives the minimum from the actual count.
      const finalStatus = needsReview > 0 && passed < passingThreshold(scenes.length) ? 'needs_review' : 'complete';

      // Only flip if the property is still in a non-terminal state — don't
      // clobber an already-completed property. 'assembling' is also skipped
      // because a prior cron tick already kicked off runAssembly (which
      // takes 60–180s for both 16:9 + 9:16 renders); next tick should not
      // race a second assembly job.
      const { data: prop } = await supabase
        .from('properties')
        .select('status, created_at, pipeline_started_at')
        .eq('id', propertyId)
        .single();
      if (!prop) continue;
      const terminal = prop.status === 'complete'
        || prop.status === 'failed'
        || prop.status === 'assembling';
      if (terminal) continue;

      // Processing time measures THIS RUN, not the property's original
      // creation date. pipeline_started_at is stamped at the top of
      // runPipeline by lib/pipeline.ts. Fall back to created_at only if
      // it's missing (legacy properties from before this column existed).
      const startTs = (prop as { pipeline_started_at?: string | null }).pipeline_started_at
        ?? prop.created_at;
      const processingTimeMs = Date.now() - new Date(startTs).getTime();

      // Operator delivery: a property with an ACTIVE delivery run never
      // auto-assembles. Judge the A/B pairs instead; the operator drives the
      // rest via checkpoints. Run lookup matches lib/pipeline.ts's variant
      // gate: most-recent run whose stage <> 'delivered' (the partial unique
      // index on (property_id, video_type) allows multiple rows, and a
      // delivered run must never re-capture its property).
      const { data: deliveryRun } = await supabase
        .from('delivery_runs')
        .select('id, stage')
        .eq('property_id', propertyId)
        .neq('stage', 'delivered')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (deliveryRun) {
        try {
          const { runJudgePass } = await import('../../lib/delivery/judge.js');
          const { ready } = await runJudgePass(deliveryRun.id as string);
          if (ready) {
            await updatePropertyStatus(propertyId, 'needs_review', {
              processing_time_ms: processingTimeMs,
              thumbnail_url: scenes.find(s => s.clip_url)?.clip_url ?? null,
            });
          }
        } catch (err) {
          console.error('[poll-scenes] delivery judge pass failed:', err);
        }
        continue; // never falls through to runAssembly
      }

      if (finalStatus === 'complete') {
        // All scenes passed QC — hand off to runAssembly. runAssembly
        // owns the 'assembling' → 'complete' status transition, records
        // shotstack/creatomate cost_events, sets horizontal/vertical
        // video URLs, and falls back to clip-only delivery if no
        // assembly provider is configured.
        await log(propertyId, 'delivery', 'info',
          `All ${passed}/${scenes.length} scenes settled; invoking assembly`);
        try {
          const { runAssembly } = await import('../../lib/pipeline.js');
          await runAssembly(propertyId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await log(propertyId, 'assembly', 'error',
            `runAssembly threw from cron: ${msg}`);
          await updatePropertyStatus(propertyId, 'failed', { processing_time_ms: processingTimeMs });
        }
      } else {
        // needs_review path — at least one scene failed QC. Don't
        // assemble; surface for operator review.
        await updatePropertyStatus(propertyId, finalStatus, {
          processing_time_ms: processingTimeMs,
          thumbnail_url: scenes.find(s => s.clip_url)?.clip_url ?? null,
        });
        await log(propertyId, 'delivery', 'info',
          `Pipeline finalized by cron (needs review): ${passed}/${scenes.length} clips ready`);
      }
    }

    return res.status(200).json({
      polled: pending.length,
      completed: completedCount,
      failed: failedCount,
      processing: processingCount,
      propertiesChecked: affectedProperties.size,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: 'Cron failed', detail: msg });
  }
}
