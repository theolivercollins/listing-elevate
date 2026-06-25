/**
 * Autopilot auto-resolver core — lib/delivery/auto-run.ts
 *
 * Single entry point: resolveGate(run) decides what to do at each human-gated
 * pipeline stage when auto_run is enabled. Guards short-circuit before any I/O.
 * Per-gate resolvers are stubs in T2; T3 fills the bodies.
 *
 * Write guard: mutating paths require prod env or LE_ALLOW_NONPROD_WRITES=true
 * (same rule as the rest of the delivery pipeline).
 */

import { getSupabase } from '../client.js';
// advanceRun is the CAS-guarded stage transition used by all resolvers; imported
// here so T3 resolver bodies can call it without adding new imports.
import { advanceRun as _advanceRun } from './runs.js'; // eslint-disable-line @typescript-eslint/no-unused-vars
import type { DeliveryRunRow } from '../types/operator-studio.js';

// Re-export so callers (cron sweep, inline kicks) share the same ref.
export { advanceRun } from './runs.js';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// All tunable autopilot thresholds live here — never scatter magic numbers into
// resolver bodies. Import from this file to override in tests or future admin UI.

/** Minimum judge score margin (winnerScore − loserScore) required for autopilot
 *  to accept a winner at checkpoint_a. Below this threshold the gate pauses. */
export const AUTO_JUDGE_MARGIN = 0.15;

/** Minimum heuristic quality score (0–1) at checkpoint_b to auto-deliver.
 *  Runs scoring below this are paused for human review before delivery. */
export const AUTO_DELIVER_THRESHOLD = 0.7;

// ─── TYPES ───────────────────────────────────────────────────────────────────

export type GateOutcome =
  | { action: 'advanced'; to: string }
  | { action: 'paused'; reason: string }
  | { action: 'noop'; reason?: string };

// ─── GATE STAGES ─────────────────────────────────────────────────────────────

/** The five stages where a human (or autopilot) makes a decision.
 *  Auto-stages (intake/scraping/generating/judging/assembling) advance via
 *  existing cron/poll paths and are never dispatched to resolvers here. */
const GATE_STAGES = [
  'checkpoint_a',
  'details',
  'voiceover',
  'music',
  'checkpoint_b',
] as const;

type GateStage = (typeof GATE_STAGES)[number];

function isGateStage(s: string): s is GateStage {
  return (GATE_STAGES as readonly string[]).includes(s);
}

// ─── WRITE GUARD ─────────────────────────────────────────────────────────────

/** True only when it is safe to perform provider writes / DB mutations.
 *  Exported so tests can assert the guard in isolation without touching Supabase. */
export function canWrite(): boolean {
  return (
    process.env.VERCEL_ENV === 'production' ||
    process.env.LE_ALLOW_NONPROD_WRITES === 'true'
  );
}

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────

/** Evaluate the current gate for an auto-run delivery run and take action.
 *  All four guards return noop before any I/O so double-fires are safe and cheap.
 *  The CAS guard inside advanceRun prevents double-advance even if two callers
 *  (cron sweep + inline kick) both pass all guards simultaneously. */
export async function resolveGate(run: DeliveryRunRow): Promise<GateOutcome> {
  // Guard 1: autopilot is disabled for this run (kill-switch off or never enabled)
  if (run.auto_run !== true) {
    return { action: 'noop', reason: 'auto_run off' };
  }

  // Guard 2: already paused waiting for human — don't re-fire until resumed
  if (run.paused_reason != null) {
    return { action: 'noop', reason: 'paused' };
  }

  // Guard 3: not at a gate stage — auto-stages advance via their own cron paths
  if (!isGateStage(run.stage)) {
    return { action: 'noop', reason: 'not a gate stage' };
  }

  // Guard 4: write guard — no mutations outside prod unless explicitly unlocked
  if (!canWrite()) {
    return { action: 'noop', reason: 'write guard: non-prod' };
  }

  // Dispatch to the per-gate resolver.
  // TypeScript exhaustiveness: the switch covers every GateStage value; if a new
  // gate stage is added to GATE_STAGES without a case, the compiler will error here.
  switch (run.stage satisfies GateStage) {
    case 'checkpoint_a': return resolveCheckpointA(run);
    case 'details':      return resolveDetails(run);
    case 'voiceover':    return resolveVoiceover(run);
    case 'music':        return resolveMusic(run);
    case 'checkpoint_b': return resolveCheckpointB(run);
  }
}

// ─── PER-GATE RESOLVER STUBS ─────────────────────────────────────────────────
// Exported individually so T3 (ai-engineer) can import and replace each body,
// and so unit tests can call them in isolation.
// Every stub carries a TODO(T3) comment that is the full implementation contract.

/**
 * checkpoint_a — Judge-winner confirmation gate.
 *
 * TODO(T3): Load SceneVariantRows for this run via getVariantsForRun(run.id).
 * For each scene pair, compute margin = abs(scoreA − scoreB) using gemini_scores.
 * If ALL scenes have a winner with margin ≥ AUTO_JUDGE_MARGIN:
 *   - Accept the existing winners (no variant_override needed — judge already set them).
 *   - Log ml_events { event_type: 'variant_override', payload: { source:'auto', confidence, margins } }.
 *   - Call advanceRun(run.id, 'details').
 *   - Return { action:'advanced', to:'details' }.
 * If any scene's margin is below AUTO_JUDGE_MARGIN (tie/low-confidence):
 *   - Call pauseForHuman(run.id, `low judge margin on scene ${sceneId}: ${margin}`).
 *   - Return { action:'paused', reason }.
 */
export async function resolveCheckpointA(run: DeliveryRunRow): Promise<GateOutcome> {
  // TODO(T3): implement per spec §4 table row "checkpoint_a"
  void run;
  return { action: 'noop', reason: 'TODO: checkpoint_a resolver not implemented' };
}

/**
 * details — Scraped listing-data completeness gate.
 *
 * TODO(T3): Inspect run.listing_details for the three required fields: price, beds, baths.
 * If all three are present and non-null/non-zero:
 *   - Log ml_events { event_type: 'details_edit', payload: { source:'auto', confidence:1 } }.
 *   - Call advanceRun(run.id, 'voiceover').
 *   - Return { action:'advanced', to:'voiceover' }.
 * If any required field is missing/null/zero:
 *   - Call pauseForHuman(run.id, `missing listing field: ${field}`).
 *   - Return { action:'paused', reason }.
 */
export async function resolveDetails(run: DeliveryRunRow): Promise<GateOutcome> {
  // TODO(T3): implement per spec §4 table row "details"
  void run;
  return { action: 'noop', reason: 'TODO: details resolver not implemented' };
}

/**
 * voiceover — Script generation + voice-tone selection gate.
 *
 * TODO(T3):
 *   1. If run.voiceover_script is empty/null, call generate_script to populate it.
 *   2. Make a small LLM call (Haiku-tier) to pick voice tone from listing context.
 *      Write a cost_events row for the LLM call.
 *   3. Select voiceover_voice_id from the tone pick and call generate_audio.
 *      Write a cost_events row for audio synthesis.
 *   4. If audio URL returned:
 *      - Set voiceover_audio_url + voiceover_voice_id on the run (updateRun patch).
 *      - Log ml_events { event_type: 'voice_choice', payload: { source:'auto', voice_id, tone, confidence } }.
 *      - Call advanceRun(run.id, 'music').
 *      - Return { action:'advanced', to:'music' }.
 *   5. On empty script or synth failure:
 *      - Call pauseForHuman(run.id, `voiceover: ${reason}`).
 *      - Return { action:'paused', reason }.
 */
export async function resolveVoiceover(run: DeliveryRunRow): Promise<GateOutcome> {
  // TODO(T3): implement per spec §4 table row "voiceover"
  void run;
  return { action: 'noop', reason: 'TODO: voiceover resolver not implemented' };
}

/**
 * music — Mood-based track selection gate.
 *
 * TODO(T3):
 *   1. Make a small LLM call (Haiku-tier) to determine listing mood from listing_details
 *      (e.g. "upbeat", "luxury", "family", "cozy"). Write a cost_events row.
 *   2. Query the track library + music_track_feedback for the highest-rated track
 *      that matches the mood tag.
 *   3. If a matching track is found:
 *      - Set music_track_id on the run (updateRun patch).
 *      - Log ml_events { event_type: 'music_choice', payload: { source:'auto', track_id, mood, confidence } }.
 *      - Call advanceRun(run.id, 'assembling').
 *      - Return { action:'advanced', to:'assembling' }.
 *   4. If no track matches the mood:
 *      - Call pauseForHuman(run.id, `music: no track for mood ${mood}`).
 *      - Return { action:'paused', reason }.
 */
export async function resolveMusic(run: DeliveryRunRow): Promise<GateOutcome> {
  // TODO(T3): implement per spec §4 table row "music"
  void run;
  return { action: 'noop', reason: 'TODO: music resolver not implemented' };
}

/**
 * checkpoint_b — Final quality check gate before delivery.
 *
 * TODO(T3): Compute a heuristic quality score (0–1) using existing signals:
 *   - Variant winner margins (from SceneVariantRows via getVariantsForRun).
 *   - Count of degraded=true variants (subtract from score).
 *   - Presence of any uncleared run.error (fail fast).
 *   - Listing completeness from run.listing_details.
 *   - Voiceover + music set (expected at this stage).
 * If score ≥ AUTO_DELIVER_THRESHOLD:
 *   - Log ml_events { event_type: 'rating', payload: { source:'auto', score, confidence } }.
 *   - Call advanceRun(run.id, 'delivered').
 *   - Return { action:'advanced', to:'delivered' }.
 * If below threshold:
 *   - Call pauseForHuman(run.id, `quality below threshold: ${score.toFixed(2)}`).
 *   - Return { action:'paused', reason }.
 */
export async function resolveCheckpointB(run: DeliveryRunRow): Promise<GateOutcome> {
  // TODO(T3): implement per spec §4 table row "checkpoint_b"
  void run;
  return { action: 'noop', reason: 'TODO: checkpoint_b resolver not implemented' };
}

// ─── PAUSE HELPER ─────────────────────────────────────────────────────────────

/**
 * Pause the run and notify autopilot watchers.
 *
 * Sets paused_reason + auto_paused_at on delivery_runs and inserts an ml_events
 * audit row. A paused run is skipped by the cron sweep (Guard 2) and the inline
 * kick until a human resolves the gate and calls resume_autopilot to clear it.
 *
 * NOTE: event_type 'auto_pause' requires DB migration T1 to add it to the CHECK
 * constraint on ml_events.event_type before this path is exercised in production.
 */
export async function pauseForHuman(runId: string, reason: string): Promise<void> {
  const db = getSupabase();

  // Mark the run paused. Uses the same updated_at pattern as updateRun in runs.ts.
  const { error: updateError } = await db
    .from('delivery_runs')
    .update({
      paused_reason: reason,
      auto_paused_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId);
  if (updateError) {
    throw new Error(`pauseForHuman: update failed: ${updateError.message}`);
  }

  // Audit row — matches the ml_events insert shape in lib/delivery/runs.ts line 175.
  const { error: eventError } = await db.from('ml_events').insert({
    run_id: runId,
    event_type: 'auto_pause',
    payload: { source: 'auto', reason },
  });
  if (eventError) {
    throw new Error(`pauseForHuman: ml_events insert failed: ${eventError.message}`);
  }
}
