import type { VercelRequest, VercelResponse } from '@vercel/node';

export const maxDuration = 300;

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
    const { getSupabase, updatePropertyStatus, recordCostEvent, log } = await import('../../lib/db.js');
    const { selectProvider } = await import('../../lib/providers/router.js');
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
      .select('id, property_id, photo_id, scene_number, provider, provider_task_id, duration_seconds, attempt_count, submitted_at, prompt, camera_movement, room_type')
      .not('provider_task_id', 'is', null)
      .is('clip_url', null)
      .order('submitted_at', { ascending: true })
      .limit(30);

    if (pendingErr) throw pendingErr;
    if (!pending || pending.length === 0) {
      return res.status(200).json({ polled: 0, completed: 0, failed: 0, processing: 0 });
    }

    let completedCount = 0;
    let failedCount = 0;
    let processingCount = 0;
    const affectedProperties = new Set<string>();

    for (const scene of pending) {
      affectedProperties.add(scene.property_id);
      try {
        // Reconstruct provider instance. Pass empty room type + no preference —
        // selectProvider will return an instance of whatever scene.provider is
        // if it's still enabled. We don't need the routing logic here, just an
        // IVideoProvider matching scene.provider.
        if (!scene.provider) {
          failedCount++;
          continue;
        }
        // We use selectProvider to reconstruct a provider instance by name.
        // Passing the provider name as preference guarantees we get that exact
        // one (or fall through if disabled). selectProvider is the backward-
        // compat wrapper that returns IVideoProvider directly.
        const provider = selectProvider('other', null, scene.provider as any, []);
        if (provider.name !== scene.provider) {
          // Provider was disabled between submission and polling. Mark stuck.
          await supabase.from('scenes').update({ status: 'needs_review' }).eq('id', scene.id);
          await log(scene.property_id, 'generation', 'error',
            `Scene ${scene.scene_number}: provider ${scene.provider} no longer available for polling`, undefined, scene.id);
          failedCount++;
          continue;
        }

        const status = await provider.checkStatus(scene.provider_task_id as string);

        if (status.status === 'processing') {
          processingCount++;
          continue;
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
          continue;
        }

        // Complete — download + store. (No speed-ramp; see comment block above.)
        const clipBuffer = await provider.downloadClip(status.videoUrl);

        const clipPath = `${scene.property_id}/clips/scene_${scene.scene_number}_v${scene.attempt_count ?? 1}.mp4`;
        const { error: uploadErr } = await supabase.storage
          .from('property-videos')
          .upload(clipPath, clipBuffer, { contentType: 'video/mp4', upsert: true });
        if (uploadErr) throw uploadErr;

        const { data: urlData } = supabase.storage.from('property-videos').getPublicUrl(clipPath);

        // Fallback cost estimate when the provider doesn't return credit
        // usage in its task response. Runway gen4_turbo is ~5 credits/sec;
        // Kling v2-master is 10 units/clip (5s) regardless of duration.
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
        const judged = await judgeProductionScene({
          clipUrl: urlData.publicUrl,
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
            continue;
          }

          // Resubmit failed — fall back to needs_review so the property surfaces
          // for review rather than dangling. Never let this kill the cron loop.
          await supabase.from('scenes').update({
            status: 'needs_review',
            clip_url: urlData.publicUrl,
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
          continue;
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
          clip_url: urlData.publicUrl,
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
      const finalStatus = needsReview > 0 && passed < 6 ? 'needs_review' : 'complete';

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
