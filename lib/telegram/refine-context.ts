/**
 * lib/telegram/refine-context.ts
 *
 * Gathers everything the Telegram refine planner needs to decide + validate
 * (buildRefineContext), plus the shared validation/classification logic used
 * by BOTH the planner (refine-agent.ts, validating the model's raw tool
 * output) and the executor (refine-execute.ts, re-validating immediately
 * before mutating anything). One implementation, two call sites — never
 * trust either layer alone (defense in depth against a stale plan / a
 * TOCTOU gap between planning and execution).
 */

import { getSupabase } from '../client.js';
import { getRun, getVariantsForRun, getEventsForRun } from '../delivery/runs.js';
import { applySceneOrder } from '../delivery/assemble.js';
import { isDeliveryStage, type DeliveryStage } from '../delivery/state.js';
import { moodForPackage } from '../assembly/music.js';
import { VOICES } from '../voiceover/voices.js';
import type { MlEventRow, SceneVariantRow } from '../types/operator-studio.js';
import type {
  RefineAction,
  RefineContext,
  RefineSceneSummary,
  RefineSessionUsage,
  RefineTrackSummary,
  RefineVoiceSummary,
} from './refine-types.js';

// ── buildRefineContext ───────────────────────────────────────────────────────

/**
 * Gather the full planner/validator context for a delivery run: stage, scene
 * order + per-scene room type/winner, current music/voice/script, listing
 * details, pause state, the run mood's available music tracks, the voice
 * catalog (+ the client's cloned voice, if any), and this run's cumulative
 * telegram-refine usage against the per-session caps.
 *
 * Throws if the run doesn't exist — callers (planner, executor) can't
 * meaningfully proceed without a real run either way.
 */
export async function buildRefineContext(runId: string): Promise<RefineContext> {
  const run = await getRun(runId);
  if (!run) throw new Error(`buildRefineContext: delivery run not found — id=${runId}`);
  if (!isDeliveryStage(run.stage)) {
    throw new Error(`buildRefineContext: run ${runId} has an unrecognized stage '${run.stage}'`);
  }

  const supabase = getSupabase();

  const [variants, events, sceneRowsResult] = await Promise.all([
    getVariantsForRun(runId),
    getEventsForRun(runId),
    supabase
      .from('scenes')
      .select('id, scene_number, photo_id')
      .eq('property_id', run.property_id)
      .order('scene_number', { ascending: true }),
  ]);

  // A query error must never be silently read as "zero scenes" — that would
  // hand the planner an empty allowlist and make every scene-referencing
  // action look invalid instead of surfacing the real (transient DB) problem.
  if (sceneRowsResult.error) {
    throw new Error(`buildRefineContext: scenes lookup failed: ${sceneRowsResult.error.message}`);
  }
  const scenes = (sceneRowsResult.data ?? []) as Array<{ id: string; scene_number: number; photo_id: string }>;

  const photoIds = Array.from(new Set(scenes.map((s) => s.photo_id).filter(Boolean)));
  let roomTypeByPhotoId = new Map<string, string>();
  if (photoIds.length > 0) {
    const { data: photoRows } = await supabase.from('photos').select('id, room_type').in('id', photoIds);
    roomTypeByPhotoId = new Map(
      (photoRows ?? []).map((p: { id: string; room_type: string | null }) => [p.id, p.room_type ?? 'other']),
    );
  }

  const winnerByScene = computeSceneWinners(variants);

  // Normalize order: applySceneOrder folds in `run.scene_order` when present
  // and deterministically appends anything missing from it, so the returned
  // scene_order is ALWAYS the same id set as `scenes`, just possibly reordered.
  const orderedScenes = applySceneOrder(scenes, run.scene_order ?? null);
  const sceneSummaries: RefineSceneSummary[] = orderedScenes.map((s) => ({
    id: s.id,
    room_type: roomTypeByPhotoId.get(s.photo_id) ?? 'other',
    winner: winnerByScene.get(s.id) ?? null,
  }));

  const mood = moodForPackage(run.video_type);
  const { data: trackRows } = await supabase
    .from('music_tracks')
    .select('id, name, mood_tag, genre')
    .eq('mood_tag', mood)
    .eq('active', true);
  const availableTracks: RefineTrackSummary[] = (trackRows ?? []).map(
    (t: { id: string; name: string; mood_tag: string; genre: string | null }) => ({
      id: t.id,
      name: t.name,
      mood: t.mood_tag,
      genre: t.genre ?? null,
    }),
  );

  const availableVoices: RefineVoiceSummary[] = VOICES.map((v) => ({
    id: v.id,
    name: v.name,
    isClientVoice: false,
  }));
  if (run.client_id) {
    const { data: clientRow } = await supabase
      .from('clients')
      .select('id, name, voice_id')
      .eq('id', run.client_id)
      .maybeSingle();
    const client = clientRow as { id: string; name: string; voice_id: string | null } | null;
    if (client?.voice_id && !availableVoices.some((v) => v.id === client.voice_id)) {
      availableVoices.push({ id: client.voice_id, name: `${client.name} (client voice)`, isClientVoice: true });
    }
  }

  return {
    runId: run.id,
    propertyId: run.property_id,
    stage: run.stage as DeliveryStage,
    video_type: run.video_type,
    duration_seconds: run.duration_seconds,
    scene_order: orderedScenes.map((s) => s.id),
    scenes: sceneSummaries,
    music_track_id: run.music_track_id,
    voiceover_voice_id: run.voiceover_voice_id,
    voiceover_script: run.voiceover_script,
    listing_details: run.listing_details ?? {},
    paused_reason: run.paused_reason,
    availableTracks,
    availableVoices,
    usage: computeSessionUsage(events),
  };
}

// ── Pure helpers (exported for direct unit testing) ─────────────────────────

/** Which variant currently wins each scene, derived from scene_variants.winner. */
export function computeSceneWinners(variants: SceneVariantRow[]): Map<string, 'A' | 'B'> {
  const map = new Map<string, 'A' | 'B'>();
  for (const v of variants) {
    if (v.winner) map.set(v.scene_id, v.variant);
  }
  return map;
}

/**
 * Derive this run's cumulative telegram-refine usage from its ml_events.
 * "Session" == this delivery run (a drive_intake maps 1:1 to one
 * delivery_run for its whole conversation lifetime), so run-scoped counts
 * are exactly session-scoped counts — no new table needed. Only counts
 * events tagged `source: 'telegram_refine'` by this module's own executor;
 * operator-studio-originated events (source absent/'operator'/etc) never
 * count against the Telegram session caps.
 */
export function computeSessionUsage(events: MlEventRow[]): RefineSessionUsage {
  let regenerateClipCount = 0;
  let generateMusicCount = 0;
  let rerenderCount = 0;

  for (const e of events) {
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    if (payload.source !== 'telegram_refine') continue;

    if (e.event_type === 'regenerate') {
      regenerateClipCount++;
    } else if (e.event_type === 'music_choice' && payload.subtype === 'generate_music') {
      generateMusicCount++;
    } else if (e.event_type === 'auto_advance' && payload.action === 'batch_rerender') {
      rerenderCount++;
    }
  }

  return { regenerateClipCount, generateMusicCount, rerenderCount };
}

// ── Action classification (shared by planner + executor) ───────────────────

/** Actions whose effect is only visible in the final video once a re-render
 *  (runAssembleStage) runs. Determined against the ACTUAL delivery pipeline:
 *  scene_order and winner clips feed the timeline builder directly (see
 *  lib/pipeline.ts's operator-order lookup + lib/delivery/assemble.ts);
 *  set_voice/set_script/generate_script alone only stage state for a FUTURE
 *  generate_audio call (assemble only pulls in voiceover_audio_url when it's
 *  already set) so they are NOT in this set; edit_details doesn't reach the
 *  video's pixels at all (no price/beds/baths/sqft placeholder exists in the
 *  current Creatomate templates — see assemble.ts's own comment).
 *
 *  regenerate_clip is deliberately EXCLUDED (P1-3): it only SUBMITS an async
 *  provider job that lands later via the poll cron — the batch's own winner
 *  clip is still the OLD one at the moment this batch would render, so
 *  treating it as render-affecting would immediate-render a stale clip and
 *  waste a re-render. It stays in MONEY_OR_TIME_KINDS below (still needs
 *  confirm — it does spend money), just never triggers an immediate render
 *  on its own.
 *
 *  music_feedback is deliberately EXCLUDED (L5): recording a thumbs up/down
 *  on a music track is a free, instant DB write and must never trigger a
 *  re-render by itself. */
const RENDER_AFFECTING_KINDS = new Set<string>([
  'reorder', 'flip_winner', 'set_music', 'generate_music', 'generate_audio',
]);

export function isRenderAffecting(kind: string): boolean {
  return RENDER_AFFECTING_KINDS.has(kind);
}

/** Actions that spend real money/time even when they don't by themselves
 *  require a re-render (generate_script is a paid Claude call; regenerate_all
 *  is destructive+slow). Combined with isRenderAffecting for needsConfirm. */
const MONEY_OR_TIME_KINDS = new Set<string>([
  'generate_music', 'regenerate_clip', 'generate_script', 'generate_audio', 'regenerate_all',
]);

/** True whenever ANY action in the plan spends money/time or would trigger a
 *  re-render — the planner's needsConfirm gate. Computed in code, never
 *  trusted from the model (prompts request, validators enforce). */
export function needsConfirmFor(actions: RefineAction[]): boolean {
  return actions.some((a) => MONEY_OR_TIME_KINDS.has(a.kind) || RENDER_AFFECTING_KINDS.has(a.kind));
}

// ── Validation — the whitelist enforcement ──────────────────────────────────

export interface DroppedAction {
  /** Best-effort kind of the input that was dropped ('unknown' if the input
   *  didn't even have a recognizable `kind`). Used by the executor to decide
   *  whether an invalid action was render-affecting (abort-worthy) or not
   *  (skip-and-report). */
  kind: string;
  reason: string;
}

export interface ValidateActionsResult {
  actions: RefineAction[];
  dropped: DroppedAction[];
}

/** Defensive caps beyond what lib/delivery/details.ts's validateListingDetails
 *  enforces (it only rejects negatives — no upper bound). "Hard bans enforced
 *  in code" per operating rules; the exact bounds are given in the task spec. */
const EDIT_DETAILS_BOUNDS = { price: 100_000_000, beds: 50, baths: 50, sqft: 100_000 } as const;
const DESCRIPTION_MAX_CHARS = 2000;
/** Not spec-mandated but added defensively: music_feedback.comment and
 *  generate_script.note both eventually feed future generation prompts
 *  (buildFeedbackBlock / buildScriptUserMessage) — cap them so a pasted
 *  wall of text can't become an outsized/adversarial prompt addition. */
const FREE_NOTE_MAX_CHARS = 500;
const SET_SCRIPT_MAX_CHARS = 3000;

/**
 * Re-validate a raw (untrusted) actions array against a RefineContext.
 * Shared by refine-agent.ts (validating the model's raw tool_use.input right
 * after the call) and refine-execute.ts (re-validating immediately before
 * executing, against a FRESHLY built context, since time may have passed
 * since planning). Anything structurally invalid, referencing an id that
 * isn't in `ctx`, or out of bounds is dropped and named — never silently
 * coerced, never trusted as-is.
 */
export function validateRefineActions(raw: unknown[], ctx: RefineContext): ValidateActionsResult {
  const validSceneIds = new Set(ctx.scenes.map((s) => s.id));
  const currentOrderKey = [...ctx.scene_order].sort().join(' ');
  const validTrackIds = new Set(ctx.availableTracks.map((t) => t.id));
  const validVoiceIds = new Set(ctx.availableVoices.map((v) => v.id));

  const actions: RefineAction[] = [];
  const dropped: DroppedAction[] = [];
  const drop = (kind: string, reason: string) => dropped.push({ kind, reason });

  for (const item of raw) {
    if (item == null || typeof item !== 'object') {
      drop('unknown', 'malformed action (not an object)');
      continue;
    }
    const a = item as Record<string, unknown>;
    const kind = typeof a.kind === 'string' ? a.kind : null;
    if (!kind) {
      drop('unknown', 'action missing a kind');
      continue;
    }

    switch (kind) {
      case 'set_music': {
        const id = typeof a.music_track_id === 'string' ? a.music_track_id : '';
        if (!id || !validTrackIds.has(id)) { drop(kind, `set_music: unknown music_track_id '${id}'`); break; }
        actions.push({ kind: 'set_music', music_track_id: id });
        break;
      }

      case 'generate_music': {
        actions.push({ kind: 'generate_music' });
        break;
      }

      case 'music_feedback': {
        const trackId = typeof a.track_id === 'string' ? a.track_id.trim() : '';
        const verdict = a.verdict === 'up' || a.verdict === 'down' ? a.verdict : null;
        if (!trackId || !verdict) { drop(kind, 'music_feedback: missing track_id or a valid verdict'); break; }
        let comment: string | undefined;
        if (typeof a.comment === 'string' && a.comment.trim()) {
          comment = a.comment.trim().slice(0, FREE_NOTE_MAX_CHARS);
        }
        actions.push({ kind: 'music_feedback', track_id: trackId, verdict, ...(comment ? { comment } : {}) });
        break;
      }

      case 'reorder': {
        if (!Array.isArray(a.scene_order)) { drop(kind, 'reorder: scene_order must be an array'); break; }
        const order = (a.scene_order as unknown[]).filter((id): id is string => typeof id === 'string');
        const orderKey = [...order].sort().join(' ');
        if (order.length !== ctx.scenes.length || orderKey !== currentOrderKey) {
          drop(kind, 'reorder: scene_order is not an exact permutation of the current scenes');
          break;
        }
        actions.push({ kind: 'reorder', scene_order: order });
        break;
      }

      case 'regenerate_clip': {
        const sceneId = typeof a.sceneId === 'string' ? a.sceneId : '';
        if (!sceneId || !validSceneIds.has(sceneId)) { drop(kind, `regenerate_clip: unknown sceneId '${sceneId}'`); break; }
        let model: 'kling-v3-pro' | 'seedance-pair' | undefined;
        if (a.model !== undefined) {
          if (a.model === 'kling-v3-pro' || a.model === 'seedance-pair') {
            model = a.model;
          } else {
            drop(kind, `regenerate_clip: unsupported model '${String(a.model)}'`);
            break;
          }
        }
        actions.push({ kind: 'regenerate_clip', sceneId, ...(model ? { model } : {}) });
        break;
      }

      case 'flip_winner': {
        const sceneId = typeof a.sceneId === 'string' ? a.sceneId : '';
        if (!sceneId || !validSceneIds.has(sceneId)) { drop(kind, `flip_winner: unknown sceneId '${sceneId}'`); break; }
        actions.push({ kind: 'flip_winner', sceneId });
        break;
      }

      case 'set_voice': {
        const voiceId = typeof a.voice_id === 'string' ? a.voice_id : '';
        if (!voiceId || !validVoiceIds.has(voiceId)) { drop(kind, `set_voice: unknown voice_id '${voiceId}'`); break; }
        actions.push({ kind: 'set_voice', voice_id: voiceId });
        break;
      }

      case 'generate_script': {
        let note: string | undefined;
        if (typeof a.note === 'string' && a.note.trim()) note = a.note.trim().slice(0, FREE_NOTE_MAX_CHARS);
        actions.push({ kind: 'generate_script', ...(note ? { note } : {}) });
        break;
      }

      case 'set_script': {
        const text = typeof a.text === 'string' ? a.text.trim() : '';
        if (!text) { drop(kind, 'set_script: text is required'); break; }
        if (text.length > SET_SCRIPT_MAX_CHARS) { drop(kind, `set_script: text exceeds ${SET_SCRIPT_MAX_CHARS} characters`); break; }
        actions.push({ kind: 'set_script', text });
        break;
      }

      case 'generate_audio': {
        actions.push({ kind: 'generate_audio' });
        break;
      }

      case 'edit_details': {
        const out: { kind: 'edit_details'; price?: number; beds?: number; baths?: number; sqft?: number; description?: string } = { kind: 'edit_details' };
        let bad: string | null = null;

        const checkNum = (field: 'price' | 'beds' | 'baths' | 'sqft', max: number) => {
          if (bad || a[field] === undefined) return;
          const v = a[field];
          if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) {
            bad = `edit_details: ${field} out of bounds (0..${max})`;
            return;
          }
          out[field] = v;
        };
        checkNum('price', EDIT_DETAILS_BOUNDS.price);
        checkNum('beds', EDIT_DETAILS_BOUNDS.beds);
        checkNum('baths', EDIT_DETAILS_BOUNDS.baths);
        checkNum('sqft', EDIT_DETAILS_BOUNDS.sqft);

        if (!bad && a.description !== undefined) {
          if (typeof a.description !== 'string' || a.description.length > DESCRIPTION_MAX_CHARS) {
            bad = `edit_details: description must be a string of at most ${DESCRIPTION_MAX_CHARS} characters`;
          } else {
            out.description = a.description;
          }
        }

        if (bad) { drop(kind, bad); break; }
        if (out.price === undefined && out.beds === undefined && out.baths === undefined && out.sqft === undefined && out.description === undefined) {
          drop(kind, 'edit_details: no valid fields provided');
          break;
        }
        actions.push(out);
        break;
      }

      case 'resume': {
        actions.push({ kind: 'resume' });
        break;
      }

      case 'regenerate_all': {
        actions.push({ kind: 'regenerate_all' });
        break;
      }

      default:
        drop(kind, `unknown action kind '${kind}'`);
    }
  }

  return { actions, dropped };
}
