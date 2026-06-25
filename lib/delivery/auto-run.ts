/**
 * Autopilot auto-resolver core — lib/delivery/auto-run.ts
 *
 * Single entry point: resolveGate(run) decides what to do at each human-gated
 * pipeline stage when auto_run is enabled. Guards short-circuit before any I/O.
 * Per-gate resolvers implement the full confidence-gated logic.
 *
 * Write guard: mutating paths require prod env or LE_ALLOW_NONPROD_WRITES=true
 * (same rule as the rest of the delivery pipeline).
 */

import Anthropic from '@anthropic-ai/sdk';
import { getSupabase } from '../client.js';
import { advanceRun as _advanceRun, getVariantsForRun, updateRun, recordMlEvent } from './runs.js';
import { generateDeliveryScript } from './voiceover-script.js';
import { scoreTotal } from './judge.js';
import type { VariantScores } from './judge.js';
import { generateVoiceoverAudio } from '../voiceover/generate-audio.js';
import { VOICES, defaultVoiceId } from '../voiceover/voices.js';
import { moodForPackage } from '../assembly/music.js';
import type { MoodTag } from '../assembly/music.js';
import { computeClaudeCost } from '../utils/claude-cost.js';
import type { ClaudeUsage } from '../utils/claude-cost.js';
import { recordCostEvent } from '../db.js';
import type { DeliveryRunRow, SceneVariantRow } from '../types/operator-studio.js';

// Re-export so callers (cron sweep, inline kicks) share the same ref.
export { advanceRun } from './runs.js';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// All tunable autopilot thresholds live here — never scatter magic numbers into
// resolver bodies. Import from this file to override in tests or future admin UI.

/** Minimum judge score margin (winnerScore − loserScore) / 20 required for
 *  autopilot to accept a winner at checkpoint_a. Below this threshold the gate pauses. */
export const AUTO_JUDGE_MARGIN = 0.15;

/** Minimum heuristic quality score (0–1) at checkpoint_b to auto-deliver.
 *  Runs scoring below this are paused for human review before delivery. */
export const AUTO_DELIVER_THRESHOLD = 0.7;

/** Haiku-tier model for cheap subjective picks (voice tone, music mood). */
const PICK_MODEL = 'claude-haiku-4-5';

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

// ─── PER-GATE RESOLVERS ───────────────────────────────────────────────────────

/**
 * checkpoint_a — Judge-winner confirmation gate.
 *
 * For each scene pair, compute margin = abs(scoreA − scoreB) / 20.
 * Degraded pairs (winner_source='default', no real judge scores) are
 * auto-accepted — there's no meaningful choice to re-examine.
 * If ALL real-judged scenes have a margin ≥ AUTO_JUDGE_MARGIN, advance.
 * If any scene's margin is below the threshold, pause.
 */
export async function resolveCheckpointA(run: DeliveryRunRow): Promise<GateOutcome> {
  const variants = await getVariantsForRun(run.id);

  // Build per-scene map: scene_id → { a, b }
  const byScene = new Map<string, { a: SceneVariantRow | undefined; b: SceneVariantRow | undefined }>();
  for (const v of variants) {
    const entry = byScene.get(v.scene_id) ?? { a: undefined, b: undefined };
    if (v.variant === 'A') entry.a = v;
    else if (v.variant === 'B') entry.b = v;
    byScene.set(v.scene_id, entry);
  }

  const margins: Array<{ sceneId: string; margin: number }> = [];

  for (const [sceneId, { a, b }] of byScene) {
    // Find winner row to inspect winner_source.
    const winnerRow = a?.winner ? a : (b?.winner ? b : undefined);

    // Degraded/unjudged pair (winner_source='default') — auto-accept, skip margin check.
    if (!winnerRow || winnerRow.winner_source === 'default') {
      continue;
    }

    // Real gemini-judged pair — both rows carry their actual scores.
    const aScores = a?.gemini_scores as (VariantScores & { judge_error?: string }) | null | undefined;
    const bScores = b?.gemini_scores as (VariantScores & { judge_error?: string }) | null | undefined;

    // Missing or error scores — treat as degraded, accept.
    if (!aScores || !bScores || 'judge_error' in aScores || 'judge_error' in bScores) {
      continue;
    }

    const margin = Math.abs(scoreTotal(aScores) - scoreTotal(bScores)) / 20;
    margins.push({ sceneId, margin });

    if (margin < AUTO_JUDGE_MARGIN) {
      const reason = `low judge margin on scene ${sceneId}: ${margin.toFixed(3)}`;
      await pauseForHuman(run.id, reason);
      return { action: 'paused', reason };
    }
  }

  const avgConfidence =
    margins.length > 0
      ? margins.reduce((sum, m) => sum + m.margin, 0) / margins.length
      : 1; // all degraded → still confident (no contested choice)

  await recordMlEvent(run.id, 'auto_advance', {
    source: 'auto',
    gate: 'checkpoint_a',
    confidence: avgConfidence,
    margins: margins.map(m => ({ sceneId: m.sceneId, margin: m.margin })),
  });
  await _advanceRun(run.id, 'details');
  return { action: 'advanced', to: 'details' };
}

/**
 * details — Scraped listing-data completeness gate.
 *
 * All three required fields (price, beds, baths) must be present and non-zero.
 * If complete: advance to voiceover.
 * If any field is missing: pause with the field name in the reason.
 */
export async function resolveDetails(run: DeliveryRunRow): Promise<GateOutcome> {
  const d = run.listing_details;
  const required = ['price', 'beds', 'baths'] as const;
  const missing = required.find(field => !d[field]);

  if (missing) {
    const reason = `missing listing field: ${missing}`;
    await pauseForHuman(run.id, reason);
    return { action: 'paused', reason };
  }

  await recordMlEvent(run.id, 'auto_advance', {
    source: 'auto',
    gate: 'details',
    confidence: 1,
    fields_present: required as unknown as string[],
  });
  await _advanceRun(run.id, 'voiceover');
  return { action: 'advanced', to: 'voiceover' };
}

/**
 * voiceover — Script generation + voice-tone selection gate.
 *
 * 1. Generate script if absent (reuses generateDeliveryScript — records its own cost_events).
 * 2. Make a small Haiku LLM call to pick voice tone from listing context (records cost_events).
 * 3. Select voiceover_voice_id from the tone pick; call generateVoiceoverAudio (records its own cost_events).
 * 4. On success: patch run (voice_id + audio_url), log auto_advance, advance to 'music'.
 * 5. On script empty or synth failure: pause with reason.
 */
export async function resolveVoiceover(run: DeliveryRunRow): Promise<GateOutcome> {
  const db = getSupabase();

  // Need address for script generation.
  const { data: prop } = await db
    .from('properties')
    .select('address')
    .eq('id', run.property_id)
    .maybeSingle();

  if (!prop?.address) {
    const reason = 'voiceover: property address not found';
    await pauseForHuman(run.id, reason);
    return { action: 'paused', reason };
  }

  // 1. Generate script if not already set.
  let script = run.voiceover_script;
  if (!script) {
    try {
      const result = await generateDeliveryScript({
        runId: run.id,
        propertyId: run.property_id,
        address: prop.address as string,
        videoType: run.video_type,
        durationSec: run.duration_seconds ?? 30,
        details: run.listing_details,
      });
      script = result.script;
      await updateRun(run.id, { voiceover_script: script } as Partial<DeliveryRunRow>);
    } catch (err) {
      const reason = `voiceover: script generation failed — ${err instanceof Error ? err.message : String(err)}`;
      await pauseForHuman(run.id, reason);
      return { action: 'paused', reason };
    }
  }

  if (!script) {
    const reason = 'voiceover: script is empty after generation';
    await pauseForHuman(run.id, reason);
    return { action: 'paused', reason };
  }

  // 2. Pick voice tone via Haiku.
  const client = new Anthropic();
  const voiceLines = VOICES.map(v => `- ${v.name} (${v.gender}, ${v.description})`).join('\n');

  const voicePickPrompt = [
    'You are selecting a real-estate video voiceover voice.',
    '',
    `Listing: ${run.video_type.replace(/_/g, ' ')}`,
    run.listing_details.price ? `Price: $${run.listing_details.price.toLocaleString('en-US')}` : '',
    run.listing_details.beds ? `Beds: ${run.listing_details.beds}` : '',
    run.listing_details.baths ? `Baths: ${run.listing_details.baths}` : '',
    '',
    'Available voices:',
    voiceLines,
    '',
    'Reply with ONLY the voice name (e.g. Amanda).',
  ].filter(Boolean).join('\n');

  const voiceResponse = await client.messages.create({
    model: PICK_MODEL,
    max_tokens: 10,
    messages: [{ role: 'user', content: voicePickPrompt }],
  });

  // Record cost — never silent.
  const voiceCost = computeClaudeCost(voiceResponse.usage as ClaudeUsage, PICK_MODEL);
  await recordCostEvent({
    propertyId: run.property_id,
    stage: 'assembly',
    provider: 'anthropic',
    unitsConsumed: voiceCost.totalTokens,
    unitType: 'tokens',
    costCents: voiceCost.costCents,
    metadata: {
      delivery_run_id: run.id,
      subtype: 'auto_voice_pick',
      model: PICK_MODEL,
      input_tokens: voiceResponse.usage.input_tokens,
      output_tokens: voiceResponse.usage.output_tokens,
    },
  });

  const tonePick =
    voiceResponse.content[0]?.type === 'text' ? voiceResponse.content[0].text.trim() : '';

  // Map picked name → voice ID; fall back to default.
  const voiceNameMap: Record<string, string> = Object.fromEntries(
    VOICES.map(v => [v.name.toLowerCase(), v.id]),
  );
  const voiceId = voiceNameMap[tonePick.toLowerCase()] ?? defaultVoiceId();

  // 3. Synthesize audio (generateVoiceoverAudio records its own cost_events).
  let audioUrl: string;
  try {
    const result = await generateVoiceoverAudio({
      script,
      voiceId,
      propertyId: run.property_id,
      deliveryRunId: run.id,
    });
    audioUrl = result.audioUrl;
  } catch (err) {
    const reason = `voiceover: audio synthesis failed — ${err instanceof Error ? err.message : String(err)}`;
    await pauseForHuman(run.id, reason);
    return { action: 'paused', reason };
  }

  // 4. Patch run + log + advance.
  await updateRun(run.id, {
    voiceover_voice_id: voiceId,
    voiceover_audio_url: audioUrl,
  } as Partial<DeliveryRunRow>);

  await recordMlEvent(run.id, 'auto_advance', {
    source: 'auto',
    gate: 'voiceover',
    confidence: 0.9,
    voice_id: voiceId,
    tone_pick: tonePick,
  });
  await _advanceRun(run.id, 'music');
  return { action: 'advanced', to: 'music' };
}

/**
 * music — Mood-based track selection gate.
 *
 * 1. Make a small Haiku LLM call to determine mood from listing context (records cost_events).
 * 2. Query music_tracks for active tracks matching the mood; prefer those with net positive
 *    feedback (music_track_feedback verdict 'up' > 'down').
 * 3. On match: patch run (music_track_id), log auto_advance, advance to 'assembling'.
 * 4. No track found: pause.
 */
export async function resolveMusic(run: DeliveryRunRow): Promise<GateOutcome> {
  // 1. Mood pick via Haiku.
  const client = new Anthropic();
  const VALID_MOODS: MoodTag[] = ['upbeat', 'warm', 'celebratory', 'cinematic', 'neutral'];

  const moodPrompt = [
    'You are selecting music mood for a real-estate video.',
    '',
    `Video type: ${run.video_type.replace(/_/g, ' ')}`,
    run.listing_details.price ? `Price: $${run.listing_details.price.toLocaleString('en-US')}` : '',
    run.listing_details.beds ? `Beds: ${run.listing_details.beds}` : '',
    run.listing_details.baths ? `Baths: ${run.listing_details.baths}` : '',
    '',
    'Mood options: upbeat, warm, celebratory, cinematic, neutral',
    'Guidelines: just_listed→upbeat; just_pended→cinematic; just_closed→celebratory; luxury (>$1M)→cinematic or warm.',
    '',
    'Reply with ONLY one mood.',
  ].filter(Boolean).join('\n');

  const moodResponse = await client.messages.create({
    model: PICK_MODEL,
    max_tokens: 10,
    messages: [{ role: 'user', content: moodPrompt }],
  });

  // Record cost — never silent.
  const moodCost = computeClaudeCost(moodResponse.usage as ClaudeUsage, PICK_MODEL);
  await recordCostEvent({
    propertyId: run.property_id,
    stage: 'assembly',
    provider: 'anthropic',
    unitsConsumed: moodCost.totalTokens,
    unitType: 'tokens',
    costCents: moodCost.costCents,
    metadata: {
      delivery_run_id: run.id,
      subtype: 'auto_mood_pick',
      model: PICK_MODEL,
      input_tokens: moodResponse.usage.input_tokens,
      output_tokens: moodResponse.usage.output_tokens,
    },
  });

  const moodRaw =
    moodResponse.content[0]?.type === 'text' ? moodResponse.content[0].text.trim().toLowerCase() : '';
  const mood: MoodTag = VALID_MOODS.includes(moodRaw as MoodTag)
    ? (moodRaw as MoodTag)
    : moodForPackage(run.video_type);

  // 2. Query tracks for this mood, prefer highest net-positive feedback.
  const db = getSupabase();

  type TrackRow = { id: string };
  type FeedbackRow = { track_id: string; verdict: string };

  const { data: moodTracks } = await db
    .from('music_tracks')
    .select('id')
    .eq('mood_tag', mood)
    .eq('active', true);

  let trackId: string | null = null;

  if (moodTracks && moodTracks.length > 0) {
    const moodTrackIds = new Set((moodTracks as TrackRow[]).map(t => t.id));

    // Fetch feedback verdicts for these tracks (up/down votes).
    const { data: feedback } = await db
      .from('music_track_feedback')
      .select('track_id, verdict')
      .in('track_id', [...moodTrackIds]);

    if (feedback && feedback.length > 0) {
      // Compute net score (up=+1, down=-1) per track.
      const netScore = new Map<string, number>();
      for (const f of feedback as FeedbackRow[]) {
        const cur = netScore.get(f.track_id) ?? 0;
        netScore.set(f.track_id, cur + (f.verdict === 'up' ? 1 : -1));
      }

      // Pick track with highest net score; ties resolved by first encountered.
      let bestId = (moodTracks as TrackRow[])[0]!.id;
      let bestNet = netScore.get(bestId) ?? 0;
      for (const { id } of moodTracks as TrackRow[]) {
        const net = netScore.get(id) ?? 0;
        if (net > bestNet) {
          bestNet = net;
          bestId = id;
        }
      }
      trackId = bestId;
    } else {
      // No feedback yet — pick first active track in mood.
      trackId = (moodTracks as TrackRow[])[0]!.id;
    }
  }

  // Fallback: any active neutral track.
  if (!trackId) {
    const { data: neutral } = await db
      .from('music_tracks')
      .select('id')
      .eq('mood_tag', 'neutral')
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    trackId = (neutral as TrackRow | null)?.id ?? null;
  }

  if (!trackId) {
    const reason = `music: no track for mood ${mood}`;
    await pauseForHuman(run.id, reason);
    return { action: 'paused', reason };
  }

  await updateRun(run.id, { music_track_id: trackId } as Partial<DeliveryRunRow>);
  await recordMlEvent(run.id, 'auto_advance', {
    source: 'auto',
    gate: 'music',
    confidence: 0.9,
    music_track_id: trackId,
    mood,
  });
  await _advanceRun(run.id, 'assembling');
  return { action: 'advanced', to: 'assembling' };
}

/**
 * checkpoint_b — Final quality check gate before delivery.
 *
 * Heuristic quality score (0–1):
 *   - Base score: 0.5
 *   - Per gemini-judged scene with margin ≥ AUTO_JUDGE_MARGIN: +0.1 (cap at +0.2)
 *   - Each degraded/default variant: −0.1 (floored at 0)
 *   - listing_details has price+beds+baths: +0.1
 *   - voiceover_audio_url present: +0.1
 *   - music_track_id present: +0.1
 *   - run.error set: clamp score to 0 immediately
 *
 * If score ≥ AUTO_DELIVER_THRESHOLD: submit auto-ratings, log auto_advance, advance to 'delivered'.
 * If below: pause.
 */
export async function resolveCheckpointB(run: DeliveryRunRow): Promise<GateOutcome> {
  // Fail fast on any uncleared error.
  if (run.error) {
    const reason = `quality below threshold: run has error — ${run.error}`;
    await pauseForHuman(run.id, reason);
    return { action: 'paused', reason };
  }

  const variants = await getVariantsForRun(run.id);
  const byScene = new Map<string, { a: SceneVariantRow | undefined; b: SceneVariantRow | undefined }>();
  for (const v of variants) {
    const entry = byScene.get(v.scene_id) ?? { a: undefined, b: undefined };
    if (v.variant === 'A') entry.a = v;
    else if (v.variant === 'B') entry.b = v;
    byScene.set(v.scene_id, entry);
  }

  let score = 0.5;
  let confidentScenes = 0;
  let degradedCount = 0;

  for (const [, { a, b }] of byScene) {
    const winnerRow = a?.winner ? a : (b?.winner ? b : undefined);

    if (!winnerRow || winnerRow.winner_source === 'default') {
      degradedCount++;
      continue;
    }

    const aScores = a?.gemini_scores as (VariantScores & { judge_error?: string }) | null | undefined;
    const bScores = b?.gemini_scores as (VariantScores & { judge_error?: string }) | null | undefined;
    if (!aScores || !bScores || 'judge_error' in aScores || 'judge_error' in bScores) {
      degradedCount++;
      continue;
    }

    const margin = Math.abs(scoreTotal(aScores) - scoreTotal(bScores)) / 20;
    if (margin >= AUTO_JUDGE_MARGIN) confidentScenes++;
  }

  // Confident scenes bonus (cap at +0.2 regardless of scene count).
  score += Math.min(confidentScenes * 0.1, 0.2);
  // Degraded scene penalty.
  score -= degradedCount * 0.1;

  // Listing completeness.
  const d = run.listing_details;
  if (d.price && d.beds && d.baths) score += 0.1;

  // Audio and music present.
  if (run.voiceover_audio_url) score += 0.1;
  if (run.music_track_id) score += 0.1;

  // Clamp to [0, 1].
  score = Math.max(0, Math.min(1, score));

  if (score < AUTO_DELIVER_THRESHOLD) {
    const reason = `quality below threshold: ${score.toFixed(2)} < ${AUTO_DELIVER_THRESHOLD}`;
    await pauseForHuman(run.id, reason);
    return { action: 'paused', reason };
  }

  // Submit auto-ratings and deliver.
  await recordMlEvent(run.id, 'rating', {
    source: 'auto',
    score,
    confidence: score,
    confident_scenes: confidentScenes,
    degraded_scenes: degradedCount,
  });
  await recordMlEvent(run.id, 'auto_advance', {
    source: 'auto',
    gate: 'checkpoint_b',
    confidence: score,
    score,
    confident_scenes: confidentScenes,
    degraded_scenes: degradedCount,
  });
  await _advanceRun(run.id, 'delivered');
  return { action: 'advanced', to: 'delivered' };
}

// ─── PAUSE HELPER ─────────────────────────────────────────────────────────────

/**
 * Pause the run and notify autopilot watchers.
 *
 * Sets paused_reason + auto_paused_at on delivery_runs and inserts an ml_events
 * audit row. A paused run is skipped by the cron sweep (Guard 2) and the inline
 * kick until a human resolves the gate and calls resume_autopilot to clear it.
 *
 * NOTE: event_type 'auto_pause' requires DB migration 090 to add it to the CHECK
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
