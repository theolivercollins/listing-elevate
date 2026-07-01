/**
 * lib/telegram/refine-types.ts
 *
 * Shared types for the Telegram conversational refine agent (planner +
 * executor). RefineAction is the SECURITY ALLOWLIST: a closed discriminated
 * union. The planner (refine-agent.ts) can only ever produce one of these
 * 13 kinds via a forced tool call, and the executor (refine-execute.ts) only
 * ever dispatches on these kinds. Neither trusts free text from the model or
 * the user beyond what's captured here — prompts request, validators enforce
 * (see refine-context.ts's validateRefineActions).
 *
 * Ported from the stale `feat/listing-autopilot` design
 * (lib/autopilot/refine-agent.ts / refine-execute.ts) — same discipline
 * (Haiku forced tool-call; re-validate against caller-supplied context;
 * dependency-injected executor; batch multiple actions into one re-render) —
 * rewritten action set + current lib/delivery/* call signatures. See
 * docs/specs/2026-07-01-telegram-conversational-refine.md for the full
 * design (Plan B, 15 locked decisions).
 *
 * This file is pure types — zero runtime imports, zero side effects. Safe to
 * import from anywhere (webhook, cron, tests) without pulling in Supabase/
 * Anthropic clients.
 */

import type { DeliveryStage } from '../delivery/state.js';
import type { ListingDetails, DeliveryVideoType } from '../types/operator-studio.js';
import type { getVariantsForRun, updateRun, advanceRun, revertRun, recordMlEvent, setListingDetails } from '../delivery/runs.js';
import type { regenerateVariant } from '../delivery/variants.js';
import type { generateDeliveryScript } from '../delivery/voiceover-script.js';
import type { runDeliveryAudio } from '../delivery/audio.js';
import type { runAssembleStage } from '../delivery/assemble.js';
import type { validateListingDetails } from '../delivery/details.js';
import type { generateMusicVariantsForRun, recordMusicTrackFeedback } from '../delivery/music-gen.js';
import type { getSupabase } from '../client.js';

// ── RefineAction — the allowlist ─────────────────────────────────────────────
// Field names deliberately mirror the DB columns / existing operator route
// body shape they map to (snake_case) so the Claude tool schema, the
// validator, and the real lib/delivery/* calls all share one vocabulary.
// `sceneId` stays camelCase — it's a synthetic id reference, not a wire-copy
// of a DB column, matching the task spec's own casing exactly.
//
// v1 deliberately excludes: any vertical/orientation action, drop_photo.

export type RegenerateClipModel = 'kling-v3-pro' | 'seedance-pair';

export type RefineAction =
  | { kind: 'set_music'; music_track_id: string }
  | { kind: 'generate_music' }
  | { kind: 'music_feedback'; track_id: string; verdict: 'up' | 'down'; comment?: string }
  | { kind: 'reorder'; scene_order: string[] }
  | { kind: 'regenerate_clip'; sceneId: string; model?: RegenerateClipModel }
  | { kind: 'flip_winner'; sceneId: string }
  | { kind: 'set_voice'; voice_id: string }
  | { kind: 'generate_script'; note?: string }
  | { kind: 'set_script'; text: string }
  | { kind: 'generate_audio' }
  | { kind: 'edit_details'; price?: number; beds?: number; baths?: number; sqft?: number; description?: string }
  | { kind: 'resume' }
  | { kind: 'regenerate_all' };

export type RefineActionKind = RefineAction['kind'];

export const ALL_REFINE_ACTION_KINDS: readonly RefineActionKind[] = [
  'set_music', 'generate_music', 'music_feedback', 'reorder', 'regenerate_clip',
  'flip_winner', 'set_voice', 'generate_script', 'set_script', 'generate_audio',
  'edit_details', 'resume', 'regenerate_all',
];

// ── Chat history — the shape fed to the planner across turns ────────────────

export interface RefineChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ── RefineContext — the planner's world + the validation whitelist ─────────

export interface RefineSceneSummary {
  id: string;
  room_type: string;
  /** Which variant currently wins this scene, or null if unjudged/unknown. */
  winner: 'A' | 'B' | null;
}

export interface RefineTrackSummary {
  id: string;
  name: string;
  mood: string;
  genre: string | null;
}

export interface RefineVoiceSummary {
  id: string;
  name: string;
  isClientVoice: boolean;
}

/**
 * Cumulative telegram-refine usage for THIS delivery run. One drive_intake
 * maps 1:1 to one delivery_run for the whole conversation lifetime (Plan B
 * point 3/12), so run-scoped ml_events counts ARE session-scoped counts —
 * derived with zero new tables/columns. See refine-context.ts
 * computeSessionUsage().
 */
export interface RefineSessionUsage {
  regenerateClipCount: number;
  generateMusicCount: number;
  rerenderCount: number;
}

/** Per-session spend/thrash caps (Plan B point 8). Exceeding a cap skips the
 *  offending action(s)/render and reports it in ExecuteResult — never throws. */
export const REFINE_CAPS = {
  regenerateClip: 10,
  generateMusic: 3,
  rerender: 10,
} as const;

export interface RefineContext {
  runId: string;
  propertyId: string;
  stage: DeliveryStage;
  video_type: DeliveryVideoType;
  duration_seconds: number | null;
  /** Normalized full scene order (always the same id set as `scenes`, just as
   *  an ordered array) — derived via lib/delivery/assemble.ts applySceneOrder,
   *  so it's never out of sync with the live scenes table. */
  scene_order: string[];
  scenes: RefineSceneSummary[];
  music_track_id: string | null;
  voiceover_voice_id: string | null;
  voiceover_script: string | null;
  listing_details: ListingDetails;
  paused_reason: string | null;
  availableTracks: RefineTrackSummary[];
  availableVoices: RefineVoiceSummary[];
  usage: RefineSessionUsage;
}

// ── RefinePlan — planner output ─────────────────────────────────────────────

export interface RefinePlan {
  actions: RefineAction[];
  /** Short "here's what I'll do" recap — for logs / a future confirm card. */
  summary: string;
  /** The conversational reply to actually send the user. */
  reply: string;
  /** True whenever ANY action spends money/time or would trigger a re-render. */
  needsConfirm: boolean;
  /**
   * FIX 3 (Plan B decision 9) — true when the user's message is an explicit
   * commit/go signal ("go", "apply it", "do it", "send it", "render it",
   * "that's all", "looks good", "ship it", or a clear equivalent) rather
   * than an ordinary change request or an info-only question. Drives the
   * accumulate-then-commit flow in refine-conversation.ts: a commit:false
   * turn piles its (re-validated) actions into the pending accumulation
   * without executing anything; a commit:true turn stages the WHOLE
   * accumulated batch as ONE plan and shows ONE confirm card. Set primarily
   * by the model via the plan_refinement tool schema, backed by a
   * lowercase-keyword fallback in refine-agent.ts (matchesCommitKeyword) so
   * an operator's unambiguous "go" can never silently strand in the
   * accumulation just because the model forgot to set this field.
   */
  commit: boolean;
  /** Present when part of the request couldn't be mapped to a supported action
   *  (the model's own explanation, plus anything the validator dropped). */
  unsupported?: string;
}

// ── Executor ─────────────────────────────────────────────────────────────────

export interface RefineStepResult {
  /** Best-effort action kind for observability; not a security boundary
   *  (that's RefineAction itself) so this stays a plain string. */
  action: string;
  ok: boolean;
  error?: string;
}

export interface ExecuteResult {
  steps: RefineStepResult[];
  rerendering: boolean;
  summary: string;
}

/**
 * Dependency-injection surface for executeRefinement. Every field is
 * optional and defaults to the real lib/delivery/* implementation — tests
 * inject mocks, production code calls executeRefinement(runId, actions)
 * with no third argument.
 *
 * NOTE on locking: the run-level lock (CAS `paused_reason='refining'` so the
 * auto-run cron sweep skips this run during a refine) is applied by the
 * WEBHOOK caller (Wave C), not here. executeRefinement is safe to call while
 * that lock is held — it never reads or depends on paused_reason being any
 * particular value except for the `resume` action, which explicitly clears
 * whatever paused_reason currently holds and is deliberately executed LAST
 * (see refine-execute.ts) so it never races the caller's own lock-release.
 */
export interface ExecuteDeps {
  getVariantsForRun?: typeof getVariantsForRun;
  updateRun?: typeof updateRun;
  advanceRun?: typeof advanceRun;
  revertRun?: typeof revertRun;
  recordMlEvent?: typeof recordMlEvent;
  setListingDetails?: typeof setListingDetails;
  validateListingDetails?: typeof validateListingDetails;
  regenerateVariant?: typeof regenerateVariant;
  generateDeliveryScript?: typeof generateDeliveryScript;
  runDeliveryAudio?: typeof runDeliveryAudio;
  runAssembleStage?: typeof runAssembleStage;
  generateMusicVariantsForRun?: typeof generateMusicVariantsForRun;
  recordMusicTrackFeedback?: typeof recordMusicTrackFeedback;
  getSupabase?: typeof getSupabase;
  /** Rebuilds context immediately before executing, for re-validation against
   *  fresh state (scenes/tracks/voices/stage may have changed since the plan
   *  was made). Defaults to the real buildRefineContext; tests inject a stub
   *  so they never hit Supabase. Declared as a plain function type (not
   *  `typeof buildRefineContext`) to avoid a type-only circular import with
   *  refine-context.ts, which imports RefineContext from this file. */
  buildRefineContext?: (runId: string) => Promise<RefineContext>;
}
