import { getSupabase } from '../client.js';
import { recordCostEvent, log } from '../db.js';
import { hostVideoOnBunny, isBunnyConfigured, bunnyStreamCostCents, deleteBunnyVideo, validateBunnyMp4Url } from '../providers/bunny-stream.js';
import {
  selectProviderForScene,
  buildProviderFromDecision,
  selectProvider,
  forceSeedancePushInPrompt,
  getEnabledProviders,
} from '../providers/router.js';
import { classifyProviderError } from '../providers/errors.js';
import { atlasClipCostCents, V1_DEFAULT_SKU, AtlasInsufficientBalanceError } from '../providers/atlas.js';
import type { SceneVariantRow } from '../types/operator-studio.js';
import type { RoomType, CameraMovement, VideoProvider, PipelineMode } from '../types.js';

type PairStatus = 'pending' | 'ready' | 'degraded' | 'failed';

/** In flight = task submitted, no clip yet, no terminal error. */
function inFlight(v: SceneVariantRow | null): boolean {
  return Boolean(v && v.provider_task_id && !v.clip_url && !v.error);
}
function landed(v: SceneVariantRow | null): boolean {
  return Boolean(v && v.clip_url);
}

/** Pure pair classifier — drives the judge gate + the degraded flag. */
export function variantPairStatus(a: SceneVariantRow | null, b: SceneVariantRow | null): PairStatus {
  if (inFlight(a) || inFlight(b)) return 'pending';
  if (landed(a) && landed(b)) return 'ready';
  if (landed(a) || landed(b)) return 'degraded';
  return 'failed';
}

/**
 * Called from runGenerationSubmit AFTER the variant-A (scenes-table) submits.
 * Inserts an 'A' row mirroring each submitted scene, then submits ONE extra
 * provider run per scene as variant 'B' (same prompt — Kling output variance
 * differentiates). A B-submit failure degrades that scene to single-clip
 * (degraded=true on the B row); it never blocks the run.
 */
export async function submitVariantsForProperty(propertyId: string, runId: string): Promise<void> {
  const supabase = getSupabase();
  const { data: scenes } = await supabase
    .from('scenes')
    .select('id, scene_number, photo_id, prompt, duration_seconds, camera_movement, provider, provider_task_id, end_photo_id, end_image_url')
    .eq('property_id', propertyId)
    .not('provider_task_id', 'is', null);

  let pipelineMode: PipelineMode = 'v1';
  const { data: prop } = await supabase.from('properties').select('pipeline_mode').eq('id', propertyId).maybeSingle();
  pipelineMode = ((prop?.pipeline_mode as PipelineMode | null) ?? 'v1');

  for (const scene of scenes ?? []) {
    // Variant A mirrors the scene's own submission; clip syncs in the judge pass.
    await supabase.from('scene_variants').upsert({
      delivery_run_id: runId, scene_id: scene.id, variant: 'A',
      provider: scene.provider, provider_task_id: scene.provider_task_id,
    }, { onConflict: 'delivery_run_id,scene_id,variant' });

    // Variant B: an independent second render of the same prompt.
    // Mirrors runGenerationSubmit's failover loop — on a permanent provider
    // error, append to excluded and retry the next decision. Degrade only
    // when all decisions are exhausted (same cap as the A path).
    const { data: photo } = await supabase.from('photos').select('file_url, room_type').eq('id', scene.photo_id).single();
    {
      const excluded: VideoProvider[] = [];
      const maxFailovers = Math.max(getEnabledProviders().length - 1, 1);
      let bSubmitted = false;
      let lastErrMsg = 'unknown';

      if (!photo) {
        lastErrMsg = 'source photo not found';
      } else {
        for (let attempt = 0; attempt <= maxFailovers; attempt++) {
          const decision = selectProviderForScene(
            {
              endPhotoId: (scene as { end_photo_id?: string | null }).end_photo_id ?? null,
              movement: (scene.camera_movement as CameraMovement | null) ?? null,
              roomType: ((photo as { room_type?: string }).room_type as RoomType) ?? 'other',
              preference: (scene.provider as VideoProvider | null) ?? null,
            },
            excluded,
            pipelineMode,
          );
          const provider = buildProviderFromDecision(decision);
          // Same render-time prompt convention as runGenerationSubmit: the Seedance
          // push-in SKU gets the movement-stripped directive; scene.prompt in the DB
          // is never mutated. Re-apply per attempt because modelKey changes on failover.
          const renderPrompt = decision.modelKey === 'seedance-pro-pushin'
            ? forceSeedancePushInPrompt(scene.prompt as string)
            : (scene.prompt as string);
          try {
            const genJob = await provider.generateClip({
              sourceImage: Buffer.alloc(0),
              sourceImageUrl: (photo as { file_url: string }).file_url,
              prompt: renderPrompt,
              durationSeconds: scene.duration_seconds,
              aspectRatio: '16:9',
              endImageUrl: (scene as { end_image_url?: string | null }).end_image_url ?? undefined,
              modelOverride: decision.modelKey,
            });
            await supabase.from('scene_variants').upsert({
              delivery_run_id: runId, scene_id: scene.id, variant: 'B',
              provider: provider.name, provider_task_id: genJob.jobId,
            }, { onConflict: 'delivery_run_id,scene_id,variant' });
            const modelNote = decision.modelKey ? ` model=${decision.modelKey}` : '';
            await log(propertyId, 'generation', 'info',
              `Scene ${scene.scene_number}: variant B submitted to ${provider.name}${modelNote}${attempt > 0 ? ` (failover ${attempt})` : ''}`,
              { jobId: genJob.jobId, delivery_run_id: runId, modelKey: decision.modelKey }, scene.id);
            bSubmitted = true;
            break;
          } catch (err) {
            // Atlas 402 insufficient-balance: permanent billing failure.
            // Do NOT failover to another provider (that would silently degrade
            // quality and hide the account problem from the operator). Surface
            // it loudly and degrade this variant immediately.
            if (err instanceof AtlasInsufficientBalanceError) {
              lastErrMsg = err.message;
              console.error(
                `[atlas] insufficient balance — render NOT silently degraded; scene ${scene.scene_number} variant B: ${err.message}`,
              );
              await log(propertyId, 'generation', 'error',
                `[atlas] insufficient balance — scene ${scene.scene_number} variant B NOT submitted; operator action required: ${err.message}`,
                { delivery_run_id: runId, modelKey: decision.modelKey }, scene.id);
              break;
            }
            const classified = classifyProviderError(err);
            lastErrMsg = classified.message;
            if (!classified.shouldFailover) {
              // Capacity / transient: don't burn this provider; degrade and let
              // the cron retry path handle it (same convention as the A path).
              await log(propertyId, 'generation', 'warn',
                `Scene ${scene.scene_number}: variant B ${provider.name} ${classified.kind} error (degrading): ${classified.message}`,
                { delivery_run_id: runId, kind: classified.kind }, scene.id);
              break;
            }
            // Permanent error: exclude and try the next decision.
            excluded.push(provider.name as VideoProvider);
            await log(propertyId, 'generation', 'warn',
              `Scene ${scene.scene_number}: variant B: failover ${attempt + 1} to next provider (${provider.name} permanent error): ${classified.message}`,
              { delivery_run_id: runId, excluded, modelKey: decision.modelKey }, scene.id);
          }
        }
      }

      if (!bSubmitted) {
        await supabase.from('scene_variants').upsert({
          delivery_run_id: runId, scene_id: scene.id, variant: 'B',
          error: lastErrMsg, degraded: true,
        }, { onConflict: 'delivery_run_id,scene_id,variant' });
        await log(propertyId, 'generation', 'warn',
          `Scene ${scene.scene_number}: variant B submit failed after ${excluded.length + 1} attempt(s) (degrading to single clip): ${lastErrMsg}`,
          { delivery_run_id: runId }, scene.id);
      }
    }
  }
}

/**
 * Cron tick: poll pending variant tasks (B variants and regenerated A variants),
 * download finished clips into property-videos storage, record generation
 * cost_events with the run id. Mirrors api/cron/poll-scenes.ts's per-scene
 * path (provider reconstructed by name via selectProvider).
 *
 * Safety note — who owns which rows:
 *   • Original A rows: submitVariantsForProperty mirrors the scene's own
 *     provider_task_id onto the A row. The judge pass (runJudgePass) syncs
 *     the clip from scenes.clip_url once the scene settles — it never needs
 *     to call the provider. This poller must NOT collect original A rows
 *     (would double-attribute cost and race the judge sync).
 *   • Regenerated A rows: regenerateVariant fires a fresh generateClip() and
 *     writes a NEW provider_task_id that differs from scenes.provider_task_id.
 *     The judge sync only reads scenes.clip_url (the old clip) — it can never
 *     land the regenerated clip. This poller MUST collect them or the operator
 *     sees "rendering…" forever.
 *   • B rows: always owned by this poller (the judge sync never touches them).
 *
 * Discriminator: for each A row fetched, check whether its provider_task_id
 * matches the scene's provider_task_id. A match → original row → skip (judge
 * owns it). A mismatch → regeneration → collect it here.
 *
 * The partial index idx_scene_variants_pending (migration 080) is already
 * variant-agnostic (task id + no clip + no error), so it covers both B rows
 * and regenerated A rows without any schema change.
 */
export async function pollPendingVariants(limit = 15): Promise<{ polled: number; completed: number; failed: number }> {
  const supabase = getSupabase();
  // Fetch all pending rows (B and potentially regenerated A). The variant='B'
  // filter is intentionally absent — see safety note above.
  const { data: pending } = await supabase
    .from('scene_variants')
    .select('id, delivery_run_id, scene_id, variant, provider, provider_task_id, created_at')
    .not('provider_task_id', 'is', null)
    .is('clip_url', null)
    .is('error', null)
    .order('created_at', { ascending: true })
    .limit(limit);

  let completed = 0, failed = 0;
  for (const v of pending ?? []) {
    const { data: scene } = await supabase
      .from('scenes').select('property_id, scene_number, duration_seconds, provider_task_id').eq('id', v.scene_id).single();
    // Skip original A rows — the judge pass owns syncing their clip from
    // scenes.clip_url. A regenerated A row has a different provider_task_id.
    if (v.variant === 'A' && scene?.provider_task_id === v.provider_task_id) continue;
    if (!scene || !v.provider) continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provider = selectProvider('other', null, v.provider as any, []);
      if (provider.name !== v.provider) {
        await supabase.from('scene_variants')
          .update({ error: `provider ${v.provider} no longer available`, degraded: true, updated_at: new Date().toISOString() })
          .eq('id', v.id);
        failed++;
        continue;
      }
      const status = await provider.checkStatus(v.provider_task_id as string);
      if (status.status === 'processing') continue;
      if (status.status === 'failed' || !status.videoUrl) {
        await supabase.from('scene_variants')
          .update({ error: status.error ?? 'render failed', degraded: true, updated_at: new Date().toISOString() })
          .eq('id', v.id);
        // CI.4 convention (mirrors poll-scenes failed-render path): over-attribute
        // rather than under-attribute. Kling pre-paid credits are likely refunded
        // on failure → 0¢.
        const isKlingFailed = v.provider === 'kling';
        await recordCostEvent({
          propertyId: scene.property_id, sceneId: v.scene_id, stage: 'generation',
          provider: v.provider as Parameters<typeof recordCostEvent>[0]['provider'],
          unitsConsumed: 1,
          unitType: isKlingFailed ? 'kling_units' : null,
          costCents: isKlingFailed ? 0 : (status.costCents ?? 0),
          metadata: {
            delivery_run_id: v.delivery_run_id, variant: v.variant, render_outcome: 'failed',
            ...(isKlingFailed ? { billing: 'prepaid_credits_failed_refunded' } : {}),
            source: 'cron',
          },
        }).catch((e) => console.error('[delivery/variants] cost_event failed:', e));
        failed++;
        continue;
      }
      const clipBuffer = await provider.downloadClip(status.videoUrl);
      // Host the new variant clip on Bunny Stream (going-forward video hosting
      // target; replaced the Supabase Storage property-videos mirror 2026-06-12).
      // The old clipPath string is reused as the Bunny title — it uniquely
      // identifies the clip. A Bunny outage or misconfig must NEVER break this
      // autonomous delivery poll (zero-HITL): on unconfigured/failure we fall back
      // to the provider videoUrl and continue. Replaces the prior `throw upErr`.
      const clipPath = `${scene.property_id}/variants/scene_${scene.scene_number}_${v.variant}.mp4`;
      let clipUrl = status.videoUrl;
      if (isBunnyConfigured()) {
        try {
          const hosted = await hostVideoOnBunny(clipPath, clipBuffer);
          // HEAD-validate before persisting — sends the Referer header required
          // by Bunny library 679131's referrer allow-listing (server-side fetches
          // have no Referer by default → 403). Also guards against MP4 Fallback
          // being disabled (Bunny returns FINISHED but URL 404s). bunny_hosted
          // reflects the actual result — never hardcoded true (that is how
          // dead URLs were persisted before this fix).
          const mp4Valid = await validateBunnyMp4Url(hosted.mp4Url);
          if (mp4Valid) {
            clipUrl = hosted.mp4Url;
          } else {
            console.warn(`[delivery/variants] bunny mp4Url HEAD failed for ${clipPath} — keeping provider URL`);
            // Clean up the orphaned Bunny object (upload succeeded but URL inaccessible).
            deleteBunnyVideo(hosted.guid).catch(() => {});
          }
          // Cost row regardless of HEAD result — Bunny was called either way.
          // Wrapped in .catch so a cost-row failure never breaks the run.
          recordCostEvent({
            propertyId: scene.property_id, sceneId: v.scene_id, stage: 'generation',
            provider: 'bunny', unitsConsumed: 1, unitType: 'renders',
            costCents: bunnyStreamCostCents(clipBuffer.byteLength),
            metadata: { bunny_hosted: mp4Valid, clip_path: clipPath, source: 'delivery' },
          }).catch((e) => console.error('[delivery/variants] bunny cost_event failed:', e));
        } catch (bunnyErr) {
          console.warn(
            `[delivery/variants] bunny host failed for ${clipPath} — keeping provider URL:`,
            bunnyErr instanceof Error ? bunnyErr.message : String(bunnyErr),
          );
        }
      } else {
        console.warn(`[delivery/variants] bunny not configured — keeping provider URL for ${clipPath}`);
      }

      // Fallback cost estimate when the provider doesn't return credit
      // usage in its task response. Runway gen4_turbo is ~5 credits/sec;
      // Kling v2-master is 10 units/clip (5s) regardless of duration.
      // Atlas: use atlasClipCostCents(V1_DEFAULT_SKU, durationSeconds) — the
      // model key isn't stored on scene_variants, so we use the established
      // per-second price map (atlas.ts:atlasClipCostCents) with the current
      // default SKU. If status.costCents is already populated by AtlasProvider
      // (it returns this.model.priceCentsPerClip on success), this branch is a
      // safety net for any edge case where that field is null.
      // keep in sync with api/cron/poll-scenes.ts cost fallback
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
          console.warn('[cost] atlas render missing costCents — SKU not stored on scene_variants; using V1_DEFAULT_SKU fallback');
        }
      }

      const costCents = status.costCents ?? fallbackCents;
      const providerUnits = status.providerUnits ?? fallbackUnits;
      const providerUnitType = status.providerUnitType ?? fallbackUnitType ?? null;

      await supabase.from('scene_variants')
        .update({ clip_url: clipUrl, cost_cents: costCents, updated_at: new Date().toISOString() })
        .eq('id', v.id);
      await recordCostEvent({
        propertyId: scene.property_id, sceneId: v.scene_id, stage: 'generation',
        provider: v.provider as Parameters<typeof recordCostEvent>[0]['provider'],
        unitsConsumed: providerUnits, unitType: providerUnitType,
        costCents,
        metadata: { delivery_run_id: v.delivery_run_id, variant: v.variant, duration_seconds: scene.duration_seconds, source: 'cron' },
      }).catch((e) => console.error('[delivery/variants] cost_event failed:', e));
      // Mirror poll-scenes.ts "recovered by cron" convention so B completions
      // are visible in the property timeline (same log() table + stage).
      await log(scene.property_id, 'generation', 'info',
        `Scene ${scene.scene_number}: variant ${v.variant} clip collected from ${v.provider}`,
        { costCents, delivery_run_id: v.delivery_run_id }, v.scene_id);
      completed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await log(scene.property_id, 'generation', 'warn',
        `Variant ${v.variant} poll failed for scene ${scene.scene_number}: ${msg}`, { delivery_run_id: v.delivery_run_id }, v.scene_id);
    }
  }
  return { polled: (pending ?? []).length, completed, failed };
}

/** Atlas SKUs an operator may explicitly pick for a paired-scene regenerate.
 *  kling-v3-pro is the DQ.3 default; seedance-pair is the opt-in Seedance 2.0
 *  start+end-frame mode. Enforced (with a 400) in the delivery [runId] API. */
export type PairedRegenModel = 'kling-v3-pro' | 'seedance-pair';

/**
 * Re-render one variant: reset its scene_variants row and submit a fresh provider run.
 * Storage path: {property_id}/variants/scene_{n}_{variant}.mp4 (upsert:true overwrites).
 *
 * options.modelOverride — explicit operator model choice (Checkpoint A
 * regenerate picker). When set, it REPLACES the selectProviderForScene
 * decision with a fixed atlas+modelOverride decision and disables provider
 * failover: the operator asked for THIS model, silently landing on another
 * one would betray the choice. Errors propagate to the caller instead.
 */
export async function regenerateVariant(
  runId: string,
  sceneId: string,
  variant: 'A' | 'B',
  options?: { modelOverride?: PairedRegenModel },
): Promise<void> {
  const supabase = getSupabase();

  const { data: scene } = await supabase
    .from('scenes')
    .select('id, property_id, scene_number, photo_id, prompt, duration_seconds, camera_movement, provider, end_photo_id, end_image_url')
    .eq('id', sceneId)
    .single();
  if (!scene) throw new Error('regenerateVariant: scene not found');

  const { data: photo } = await supabase
    .from('photos')
    .select('file_url, room_type')
    .eq('id', scene.photo_id)
    .single();
  if (!photo) throw new Error('regenerateVariant: source photo not found');

  const { data: prop } = await supabase
    .from('properties')
    .select('pipeline_mode')
    .eq('id', scene.property_id)
    .maybeSingle();

  const pipelineMode = ((prop?.pipeline_mode as PipelineMode | null) ?? 'v1');

  // Failover loop — mirrors runGenerationSubmit's A-path: on a permanent
  // provider error, append to excluded and retry the next decision. Throws
  // only when all providers are exhausted (the caller marks the row degraded).
  // With an explicit modelOverride there is exactly ONE attempt (no failover
  // — see docblock above).
  const excluded: VideoProvider[] = [];
  const maxFailovers = options?.modelOverride
    ? 0
    : Math.max(getEnabledProviders().length - 1, 1);
  let lastError: Error | unknown = null;

  for (let attempt = 0; attempt <= maxFailovers; attempt++) {
    const decision = options?.modelOverride
      ? { provider: 'atlas' as VideoProvider, modelKey: options.modelOverride, fallback: undefined }
      : selectProviderForScene(
          {
            endPhotoId: (scene as { end_photo_id?: string | null }).end_photo_id ?? null,
            movement: (scene.camera_movement as CameraMovement | null) ?? null,
            roomType: ((photo as { room_type?: string }).room_type as RoomType) ?? 'other',
            preference: (scene.provider as VideoProvider | null) ?? null,
          },
          excluded,
          pipelineMode,
        );
    const provider = buildProviderFromDecision(decision);

    // Apply the Seedance push-in prompt directive if applicable.
    // Re-applied per attempt because modelKey changes across failovers.
    const renderPrompt = decision.modelKey === 'seedance-pro-pushin'
      ? forceSeedancePushInPrompt(scene.prompt as string)
      : (scene.prompt as string);

    try {
      const genJob = await provider.generateClip({
        sourceImage: Buffer.alloc(0),
        sourceImageUrl: (photo as { file_url: string }).file_url,
        prompt: renderPrompt,
        durationSeconds: scene.duration_seconds,
        aspectRatio: '16:9',
        endImageUrl: (scene as { end_image_url?: string | null }).end_image_url ?? undefined,
        modelOverride: decision.modelKey,
      });

      // Upsert resets the row — clip_url/costs/scores cleared, new task in flight.
      await supabase.from('scene_variants').upsert(
        {
          delivery_run_id: runId,
          scene_id: sceneId,
          variant,
          provider: provider.name,
          provider_task_id: genJob.jobId,
          clip_url: null,
          cost_cents: null,
          gemini_scores: null,
          winner: false,
          winner_source: null,
          degraded: false,
          error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'delivery_run_id,scene_id,variant' },
      );
      const modelNote = decision.modelKey ? ` model=${decision.modelKey}` : '';
      await log(scene.property_id, 'generation', 'info',
        `Scene ${scene.scene_number}: variant ${variant} regenerated via ${provider.name}${modelNote}${attempt > 0 ? ` (failover ${attempt})` : ''}`,
        { jobId: genJob.jobId, delivery_run_id: runId, modelKey: decision.modelKey }, sceneId);
      return;
    } catch (err) {
      const classified = classifyProviderError(err);
      lastError = err;
      if (!classified.shouldFailover) {
        // Capacity / transient: re-throw so the caller handles it.
        throw err;
      }
      // Permanent error: exclude and try the next decision.
      excluded.push(provider.name as VideoProvider);
      await log(scene.property_id, 'generation', 'warn',
        `Scene ${scene.scene_number}: variant ${variant}: failover ${attempt + 1} to next provider (${provider.name} permanent error): ${classified.message}`,
        { delivery_run_id: runId, excluded, modelKey: decision.modelKey }, sceneId);
    }
  }

  // All providers exhausted — re-throw so the caller can degrade the row.
  throw lastError ?? new Error(`regenerateVariant: all providers exhausted for scene ${sceneId}`);
}
