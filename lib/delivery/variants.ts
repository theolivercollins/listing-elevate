import { getSupabase } from '../client.js';
import { recordCostEvent, log } from '../db.js';
import {
  selectProviderForScene,
  buildProviderFromDecision,
  selectProvider,
  forceSeedancePushInPrompt,
} from '../providers/router.js';
import { atlasClipCostCents, V1_DEFAULT_SKU } from '../providers/atlas.js';
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
    const { data: photo } = await supabase.from('photos').select('file_url, room_type').eq('id', scene.photo_id).single();
    try {
      if (!photo) throw new Error('source photo not found');
      const decision = selectProviderForScene(
        {
          endPhotoId: (scene as { end_photo_id?: string | null }).end_photo_id ?? null,
          movement: (scene.camera_movement as CameraMovement | null) ?? null,
          roomType: ((photo as { room_type?: string }).room_type as RoomType) ?? 'other',
          preference: (scene.provider as VideoProvider | null) ?? null,
        },
        [],
        pipelineMode,
      );
      const provider = buildProviderFromDecision(decision);
      // Same render-time prompt convention as runGenerationSubmit: the Seedance
      // push-in SKU gets the movement-stripped directive; scene.prompt in the DB
      // is never mutated.
      const renderPrompt = decision.modelKey === 'seedance-pro-pushin'
        ? forceSeedancePushInPrompt(scene.prompt as string)
        : (scene.prompt as string);
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
      await log(propertyId, 'generation', 'info',
        `Scene ${scene.scene_number}: variant B submitted to ${provider.name}`,
        { jobId: genJob.jobId, delivery_run_id: runId }, scene.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabase.from('scene_variants').upsert({
        delivery_run_id: runId, scene_id: scene.id, variant: 'B',
        error: msg, degraded: true,
      }, { onConflict: 'delivery_run_id,scene_id,variant' });
      await log(propertyId, 'generation', 'warn',
        `Scene ${scene.scene_number}: variant B submit failed (degrading to single clip): ${msg}`,
        { delivery_run_id: runId }, scene.id);
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
      const clipPath = `${scene.property_id}/variants/scene_${scene.scene_number}_${v.variant}.mp4`;
      const { error: upErr } = await supabase.storage
        .from('property-videos').upload(clipPath, clipBuffer, { contentType: 'video/mp4', upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('property-videos').getPublicUrl(clipPath);

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
        .update({ clip_url: urlData.publicUrl, cost_cents: costCents, updated_at: new Date().toISOString() })
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

/**
 * Re-render one variant: reset its scene_variants row and submit a fresh provider run.
 * Storage path: {property_id}/variants/scene_{n}_{variant}.mp4 (upsert:true overwrites).
 */
export async function regenerateVariant(runId: string, sceneId: string, variant: 'A' | 'B'): Promise<void> {
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

  const decision = selectProviderForScene(
    {
      endPhotoId: (scene as { end_photo_id?: string | null }).end_photo_id ?? null,
      movement: (scene.camera_movement as CameraMovement | null) ?? null,
      roomType: ((photo as { room_type?: string }).room_type as RoomType) ?? 'other',
      preference: (scene.provider as VideoProvider | null) ?? null,
    },
    [],
    ((prop?.pipeline_mode as PipelineMode | null) ?? 'v1'),
  );
  const provider = buildProviderFromDecision(decision);

  // Apply the Seedance push-in prompt directive if applicable.
  const renderPrompt = decision.modelKey === 'seedance-pro-pushin'
    ? forceSeedancePushInPrompt(scene.prompt as string)
    : (scene.prompt as string);

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
}
