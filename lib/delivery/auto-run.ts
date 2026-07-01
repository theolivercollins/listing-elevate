/**
 * Autopilot auto-resolver core — lib/delivery/auto-run.ts
 *
 * Single entry point: resolveGate(run) decides what to do at each human-gated
 * pipeline stage when auto_run is enabled. Guards short-circuit before any I/O.
 * Per-gate resolvers implement the full confidence-gated logic.
 *
 * Write guard: mutating paths require prod env or LE_ALLOW_NONPROD_WRITES=true
 * (same rule as the rest of the delivery pipeline).
 *
 * Concurrency with the Telegram conversational-refine executor
 * (lib/telegram/refine-conversation.ts): that executor CAS-locks a run for the
 * duration of a refine by setting delivery_runs.paused_reason='refining'. Two
 * protections against it here:
 *   1. Fresh-read guard — resolveGate/resolveAssembling re-read paused_reason
 *      directly from the DB right before claiming the resolving_at lease, so
 *      a lock acquired AFTER the cron sweep's batch SELECT (but before this
 *      run was reached) is still honored — closes a stale-in-memory-read
 *      double-submit window. See the guard just above the lease claim in each.
 *   2. reclaimStrandedRefiningLocks() — a separate cron-invoked reaper that
 *      autonomously clears a 'refining' lock abandoned by a killed refine
 *      executor (no dependency on a new Telegram message). See its own
 *      section below for the full scenario.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getSupabase } from '../client.js';
import { advanceRun as _advanceRun, getRun, getVariantsForRun, updateRun, recordMlEvent } from './runs.js';
import { claimResolveLease, releaseResolveLease } from './resolve-lease.js';
import { generateDeliveryScript } from './voiceover-script.js';
import { scoreTotal } from './judge.js';
import type { VariantScores } from './judge.js';
import { VOICES, defaultVoiceId } from '../voiceover/voices.js';
import { moodForPackage } from '../assembly/music.js';
import type { MoodTag } from '../assembly/music.js';
import { computeClaudeCost } from '../utils/claude-cost.js';
import type { ClaudeUsage } from '../utils/claude-cost.js';
import { recordCostEvent } from '../db.js';
import { emitBunnyFinalizeCostEvent } from '../assembly/bunny-finalize-cost.js';
import { runDeliveryAudio } from './audio.js';
import { getPhotoSelectionForRun, applyPhotoSelectionForRun } from './photo-selection.js';
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

/** Minimum number of AI-recommended photos required for autopilot to auto-approve
 *  the photo_selection gate. Below this threshold (roughly half of TARGET_SCENE_COUNT=12)
 *  the selection is considered thin coverage and a human should verify. */
export const AUTO_PHOTO_MIN_SELECTED = 6;

/** Haiku-tier model for cheap subjective picks (voice tone, music mood). */
const PICK_MODEL = 'claude-haiku-4-5';

// ─── TYPES ───────────────────────────────────────────────────────────────────

export type GateOutcome =
  | { action: 'advanced'; to: string }
  | { action: 'paused'; reason: string }
  | { action: 'noop'; reason?: string };

// ─── GATE STAGES ─────────────────────────────────────────────────────────────

/** The stages where a human (or autopilot) makes a decision.
 *  Auto-stages (intake/scraping/generating/judging/assembling) advance via
 *  existing cron/poll paths and are never dispatched to resolvers here.
 *  Exported so the cron sweep imports the single source of truth (no drift). */
export const GATE_STAGES = [
  'photo_selection',
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

// ─── RESOLVE LEASE ───────────────────────────────────────────────────────────
// Primary overlap guard against double-spend. advanceRun's CAS dedups the stage
// *advance*, not the provider *spend* — two concurrent resolvers (overlapping
// cron sweeps, or a sweep racing the inline kick) can both pass all four guards
// and both pay ElevenLabs/Haiku/Creatomate. The lease serializes them: exactly
// one resolver claims delivery_runs.resolving_at and proceeds; the other no-ops.
//
// claimResolveLease / releaseResolveLease now live in the shared
// ./resolve-lease.js module so the operator "Resume generation" rerun action
// reuses the SAME CAS (see api/admin/studio/delivery/[runId].ts via
// withResolveLease). Behavior here is unchanged.

// ─── FRESH-READ GUARD (P1-1: double-submit / double-spend) ──────────────────
// The cron sweep SELECTs its whole run batch ONCE, then iterates, calling
// resolveGate/resolveAssembling on each row AS READ. If a Telegram refine
// executor (lib/telegram/refine-conversation.ts) CAS-sets
// delivery_runs.paused_reason='refining' AFTER that SELECT but BEFORE this
// resolver reaches the run, the resolver would otherwise still see the STALE
// in-memory `paused_reason: null` from the batch read and proceed — at
// stage='assembling' there is no advanceRun CAS to catch this (runAssembleStage
// submits the render BEFORE any stage transition), so the executor and the
// sweep could both submit a Creatomate render for the same run: a double
// charge. Re-reading paused_reason fresh, immediately before the resolving_at
// lease claim, closes that window. This is additive IN FRONT OF the lease —
// the lease itself and advanceRun's CAS are untouched.

/** True iff a fresh DB read shows this run is now paused (or gone). Logged at
 *  debug — this is an expected, non-error outcome under normal concurrency. */
async function isPausedFresh(runId: string, caller: 'resolveGate' | 'resolveAssembling'): Promise<boolean> {
  const fresh = await getRun(runId);
  const paused = !fresh || fresh.paused_reason != null;
  if (paused) {
    console.debug(
      `[auto-run] ${caller}: fresh-read guard — run ${runId} ${
        fresh ? `now paused_reason=${JSON.stringify(fresh.paused_reason)}` : 'no longer exists'
      }; skipping this tick (stale in-memory read)`,
    );
  }
  return paused;
}

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────

/** Evaluate the current gate for an auto-run delivery run and take action.
 *  All four guards return noop before any I/O so double-fires are safe and cheap.
 *  After the guards a per-run lease (delivery_runs.resolving_at) is CAS-claimed
 *  so two concurrent resolvers can never both spend on the same run; the loser
 *  no-ops. advanceRun's own CAS still backstops the stage advance. */
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

  // Fresh-read guard (P1-1 double-submit fix): re-check paused_reason straight
  // from the DB, not the in-memory `run` this call was handed — see the
  // FRESH-READ GUARD section above for the full race this closes.
  if (await isPausedFresh(run.id, 'resolveGate')) {
    return { action: 'noop', reason: 'paused_reason changed since read (fresh-read guard)' };
  }

  // Lease guard: claim exclusive right to resolve this run before any spend.
  if (!(await claimResolveLease(run.id))) {
    return { action: 'noop', reason: 'resolve lease held by concurrent actor' };
  }

  try {
    // Dispatch to the per-gate resolver.
    // TypeScript exhaustiveness: the switch covers every GateStage value; if a new
    // gate stage is added to GATE_STAGES without a case, the compiler will error here.
    switch (run.stage satisfies GateStage) {
      case 'photo_selection': return await resolvePhotoSelection(run);
      case 'checkpoint_a':    return await resolveCheckpointA(run);
      case 'details':         return await resolveDetails(run);
      case 'voiceover':       return await resolveVoiceover(run);
      case 'music':           return await resolveMusic(run);
      case 'checkpoint_b':    return await resolveCheckpointB(run);
    }
  } finally {
    // Always release — a `return` inside the try still runs this.
    await releaseResolveLease(run.id);
  }
}

// ─── ASSEMBLING REAPER ────────────────────────────────────────────────────────

/**
 * Resume or advance a run stranded at the 'assembling' stage.
 *
 * The autopilot sweep cron also selects runs with stage='assembling' (not a gate
 * stage, but can strand when the Vercel function is killed mid-poll). Three paths:
 *
 * 1. Video URLs already exist (render completed before a prior function kill) →
 *    advance to checkpoint_b without any re-spend (idempotent fast-path).
 * 2. Render job IDs persisted on the run (in-flight when prior function was killed)
 *    → resume polling with remaining budget. complete → finalize + advance;
 *    'Assembly render timed out' → noop (stored job ID survives, resumes next tick);
 *    true provider failure → pauseForHuman.
 * 3. No job IDs and no URLs → call runAssembleStage (first-time or crash-before-submit).
 *
 * `budgetMs` is the sweep's remaining wall-clock budget; passed to pollAssemblyJob
 * to prevent this cron function from being killed by Vercel between ticks.
 */
export async function resolveAssembling(run: DeliveryRunRow, budgetMs?: number): Promise<GateOutcome> {
  if (run.auto_run !== true) return { action: 'noop', reason: 'auto_run off' };
  if (run.paused_reason != null) return { action: 'noop', reason: 'paused' };
  if (run.stage !== 'assembling') return { action: 'noop', reason: 'not assembling stage' };
  if (!canWrite()) return { action: 'noop', reason: 'write guard: non-prod' };

  // Fresh-read guard (P1-1) — identical rationale to resolveGate's guard above.
  if (await isPausedFresh(run.id, 'resolveAssembling')) {
    return { action: 'noop', reason: 'paused_reason changed since read (fresh-read guard)' };
  }

  if (!(await claimResolveLease(run.id))) {
    return { action: 'noop', reason: 'resolve lease held by concurrent actor' };
  }

  try {
    const db = getSupabase();

    // Path 1: property URL completeness check (idempotent fast-path).
    // Handles: render completed but the Vercel function was killed before
    // advanceRun('checkpoint_b') was called.
    const { data: prop } = await db
      .from('properties')
      .select('horizontal_video_url, vertical_video_url, selected_orientation')
      .eq('id', run.property_id)
      .maybeSingle();

    if (!prop) {
      const reason = 'assembling: property not found';
      await pauseForHuman(run.id, reason);
      return { action: 'paused', reason };
    }

    const orientation = (prop as { selected_orientation?: string | null }).selected_orientation ?? 'horizontal';
    const wantH = orientation !== 'vertical';
    const wantV = orientation === 'vertical' || orientation === 'both';
    const hUrl = (prop as { horizontal_video_url?: string | null }).horizontal_video_url;
    const vUrl = (prop as { vertical_video_url?: string | null }).vertical_video_url;
    const hDone = !wantH || Boolean(hUrl);
    const vDone = !wantV || Boolean(vUrl);

    if (hDone && vDone) {
      // All renders complete — advance to checkpoint_b. The normal sweep picks up
      // checkpoint_b on the next tick (no inline kick needed here).
      await _advanceRun(run.id, 'checkpoint_b');
      return { action: 'advanced', to: 'checkpoint_b' };
    }

    // Path 2: resume polling persisted in-flight job IDs without re-submitting.
    // Check for the job columns — this read also surfaces migration-092-missing (42703).
    const { data: jobRow, error: jobColErr } = await db
      .from('delivery_runs')
      .select('assembly_h_job, assembly_v_job')
      .eq('id', run.id)
      .maybeSingle();
    if (jobColErr) {
      // 42703 = undefined_column: migration 092 (assembly_*_job columns) not applied.
      // Throw so the sweep's catch increments leaseError and the operator sees it.
      // Also short-circuits Path 3, preventing a silent re-submit (re-spend risk).
      throw new Error(
        `resolveAssembling: job column read failed [${(jobColErr as { code?: string }).code ?? 'DB_ERR'}]: ${jobColErr.message}`
      );
    }

    type JobShape = { jobId: string; environment: 'stage' | 'v1'; expectedDurationSeconds?: number };
    const hJob = (jobRow as { assembly_h_job?: JobShape | null } | null)?.assembly_h_job ?? null;
    const vJob = (jobRow as { assembly_v_job?: JobShape | null } | null)?.assembly_v_job ?? null;

    if ((wantH && !hDone && hJob) || (wantV && !vDone && vJob)) {
      // Track wall-clock start so the V poll can subtract H's elapsed time.
      const pStart = Date.now();
      const hTimeout = budgetMs ? Math.max(10_000, budgetMs - 5_000) : 200_000;

      const { selectAssemblyProvider, pollAssemblyJob: poll, assemblyProviderCostCents } = await import('../providers/assembly-router.js');
      let provider;
      try {
        provider = selectAssemblyProvider();
      } catch {
        return { action: 'noop', reason: 'assembling: no assembly provider configured' };
      }

      let allDone = true;

      if (wantH && !hDone && hJob) {
        const hResult = await poll(provider, hJob, hTimeout);
        if (hResult.status === 'complete' && hResult.videoUrl) {
          const { finalizeAssemblyRender } = await import('../assembly/finalize.js');
          // Resolve duration: provider value → job token fallback → run fallback → hard floor.
          // NEVER pass 0 — silent $0 cost rows are P0 cost-tracking holes.
          const hDurFallback = hJob.expectedDurationSeconds ?? (run as { duration_seconds?: number }).duration_seconds ?? 30;
          const hDurationSeconds = hResult.durationSeconds ?? hDurFallback;
          const hDurationSource = hResult.durationSeconds != null ? undefined : 'fallback';
          if (hDurationSource) {
            console.warn('[resolveAssembling] H render: provider returned no durationSeconds; using fallback', {
              runId: run.id,
              fallback: hDurationSeconds,
              source: hJob.expectedDurationSeconds != null ? 'expectedDurationSeconds' : 'run.duration_seconds_or_floor',
            });
          }
          const hFinalize = await finalizeAssemblyRender({
            propertyId: run.property_id,
            aspectRatio: '16:9',
            providerUrl: hResult.videoUrl,
            durationSeconds: hDurationSeconds,
            version: 1,
          });
          await db.from('properties').update({
            horizontal_video_url: hFinalize.url,
            // Bunny HLS playlist + poster (migration 102). mp4 + hls + poster are
            // ONE coupled encode: write all three together and CLEAR hls/poster to
            // null on any fallback (hlsUrl/posterUrl null) so a stale playlist from
            // a previous successful render can never outlive the mp4 it describes.
            horizontal_hls_url: hFinalize.hlsUrl ?? null,
            horizontal_poster_url: hFinalize.posterUrl ?? null,
          }).eq('id', run.property_id);
          // Clear persisted job token — render is done.
          void db.from('delivery_runs').update({ assembly_h_job: null }).eq('id', run.id);
          // Emit cost rows — same shape the pipeline emits in runAssemblyStep.
          // Both calls are best-effort (errors must not block delivery advance).
          await emitBunnyFinalizeCostEvent({
            propertyId: run.property_id,
            aspectRatio: '16:9',
            bunnyWasCalled: hFinalize.bunnyWasCalled,
            outputBytes: hFinalize.outputBytes,
            bitrateKbps: hFinalize.bitrateKbps,
          });
          const hCostCents = assemblyProviderCostCents(provider.name, hDurationSeconds, '16:9');
          await recordCostEvent({
            propertyId: run.property_id,
            stage: 'assembly',
            provider: provider.name as Parameters<typeof recordCostEvent>[0]['provider'],
            unitsConsumed: 1,
            unitType: 'renders',
            costCents: hCostCents,
            metadata: {
              aspect_ratio: '16:9',
              output_duration_seconds: hDurationSeconds,
              job_id: hJob.jobId,
              reason: 'autopilot_resume',
              delivered_bitrate_kbps: hFinalize.bitrateKbps,
              output_bytes: hFinalize.outputBytes,
              ...(hDurationSource ? { duration_source: hDurationSource } : {}),
            },
          });
        } else if (hResult.status === 'failed') {
          if (hResult.error === 'Assembly render timed out') {
            // Still in-flight at budget end — stored job ID survives; next tick resumes.
            allDone = false;
          } else {
            const reason = `assembling: horizontal render failed — ${hResult.error ?? 'unknown'}`;
            await pauseForHuman(run.id, reason);
            return { action: 'paused', reason };
          }
        } else {
          allDone = false; // still processing
        }
      }

      if (wantV && !vDone && vJob) {
        // Recompute remaining budget after H poll consumed time. Check the raw
        // remaining time BEFORE the floor so the guard fires correctly.
        // If budget is nearly exhausted skip V poll entirely — job token survives,
        // next tick resumes with a fresh budget.
        const vBudgetRaw = budgetMs ? budgetMs - (Date.now() - pStart) - 5_000 : Number.MAX_SAFE_INTEGER;
        if (budgetMs && vBudgetRaw < 10_000) {
          // Not enough budget left for V poll — leave allDone=false so we return noop.
          allDone = false;
        } else {
          const vTimeout = Math.max(10_000, vBudgetRaw);
          const vResult = await poll(provider, vJob, vTimeout);
          if (vResult.status === 'complete' && vResult.videoUrl) {
            const { finalizeAssemblyRender } = await import('../assembly/finalize.js');
            // Resolve duration: provider value → job token fallback → run fallback → hard floor.
            const vDurFallback = vJob.expectedDurationSeconds ?? (run as { duration_seconds?: number }).duration_seconds ?? 30;
            const vDurationSeconds = vResult.durationSeconds ?? vDurFallback;
            const vDurationSource = vResult.durationSeconds != null ? undefined : 'fallback';
            if (vDurationSource) {
              console.warn('[resolveAssembling] V render: provider returned no durationSeconds; using fallback', {
                runId: run.id,
                fallback: vDurationSeconds,
                source: vJob.expectedDurationSeconds != null ? 'expectedDurationSeconds' : 'run.duration_seconds_or_floor',
              });
            }
            const vFinalize = await finalizeAssemblyRender({
              propertyId: run.property_id,
              aspectRatio: '9:16',
              providerUrl: vResult.videoUrl,
              durationSeconds: vDurationSeconds,
              version: 1,
            });
            await db.from('properties').update({
              vertical_video_url: vFinalize.url,
              // Bunny HLS playlist + poster (migration 102). mp4 + hls + poster are
              // ONE coupled encode: write all three together and CLEAR hls/poster to
              // null on any fallback (hlsUrl/posterUrl null) so a stale playlist from
              // a previous successful render can never outlive the mp4 it describes.
              vertical_hls_url: vFinalize.hlsUrl ?? null,
              vertical_poster_url: vFinalize.posterUrl ?? null,
            }).eq('id', run.property_id);
            void db.from('delivery_runs').update({ assembly_v_job: null }).eq('id', run.id);
            // Emit cost rows for the vertical render.
            await emitBunnyFinalizeCostEvent({
              propertyId: run.property_id,
              aspectRatio: '9:16',
              bunnyWasCalled: vFinalize.bunnyWasCalled,
              outputBytes: vFinalize.outputBytes,
              bitrateKbps: vFinalize.bitrateKbps,
            });
            const vCostCents = assemblyProviderCostCents(provider.name, vDurationSeconds, '9:16');
            await recordCostEvent({
              propertyId: run.property_id,
              stage: 'assembly',
              provider: provider.name as Parameters<typeof recordCostEvent>[0]['provider'],
              unitsConsumed: 1,
              unitType: 'renders',
              costCents: vCostCents,
              metadata: {
                aspect_ratio: '9:16',
                output_duration_seconds: vDurationSeconds,
                job_id: vJob.jobId,
                reason: 'autopilot_resume',
                delivered_bitrate_kbps: vFinalize.bitrateKbps,
                output_bytes: vFinalize.outputBytes,
                ...(vDurationSource ? { duration_source: vDurationSource } : {}),
              },
            });
          } else if (vResult.status === 'failed') {
            if (vResult.error === 'Assembly render timed out') {
              allDone = false;
            } else {
              const reason = `assembling: vertical render failed — ${vResult.error ?? 'unknown'}`;
              await pauseForHuman(run.id, reason);
              return { action: 'paused', reason };
            }
          } else {
            allDone = false;
          }
        }
      }

      if (!allDone) {
        return { action: 'noop', reason: 'assembling: renders still in-flight, will resume next tick' };
      }

      // All requested renders finalized — advance to checkpoint_b.
      await _advanceRun(run.id, 'checkpoint_b');
      return { action: 'advanced', to: 'checkpoint_b' };
    }

    // Path 3: no job IDs and no URLs → first-time assembly (or crash-before-submit).
    // runAssembleStage submits, polls, finalizes, and advances to checkpoint_b.
    try {
      const { runAssembleStage } = await import('./assemble.js');
      await runAssembleStage(run.id);
    } catch (err) {
      const isTimeout = Boolean((err as { isAssemblyTimeout?: unknown }).isAssemblyTimeout);
      if (isTimeout) {
        return { action: 'noop', reason: 'assembly in progress: render timed out, will resume next tick' };
      }
      const reason = `assembly failed: ${err instanceof Error ? err.message : String(err)}`;
      await pauseForHuman(run.id, reason);
      return { action: 'paused', reason };
    }
    return { action: 'advanced', to: 'checkpoint_b' };

  } finally {
    await releaseResolveLease(run.id);
  }
}

// ─── STRANDED REFINE-LOCK RECLAIM ────────────────────────────────────────────
//
// A Telegram "refine" executor (lib/telegram/refine-conversation.ts) CAS-locks
// a run for the duration of a conversational refine by setting
// delivery_runs.paused_reason='refining' (from NULL), bumping updated_at at
// acquisition, holding it through its mutations plus a fire-and-forget render,
// then clearing it back to NULL on completion (see that file's
// acquireRefiningLock/releaseRefiningLock). The refine runs as a dangling
// promise AFTER the Telegram webhook has already returned 200 — if the Vercel
// instance running it is frozen/killed mid-render, nothing ever clears
// paused_reason, and the run is invisible FOREVER to the normal sweep pass
// above (its SELECT filters `.is('paused_reason', null)`) — no existing reaper
// covers this, because the run is (falsely) "paused for a human".
//
// The executor's OWN acquireRefiningLock can also reclaim a stale 'refining'
// lock past this same TTL, but only when a NEW Telegram message triggers a
// fresh acquire attempt. If the conversation goes silent, nothing ever fires
// that path — so this pass is the autonomous backstop: it runs on every sweep
// tick with no dependency on new inbound Telegram traffic.
//
// Re-poll-without-re-spend after reclaim: once paused_reason is cleared here,
// the run is picked up by THIS SAME tick's normal SELECT (the sweep runs this
// pass first) and — if wedged at stage='assembling' — resolveAssembling's
// Path 2 above resumes polling the ALREADY-SUBMITTED render via the persisted
// assembly_h_job / assembly_v_job job token; it only falls through to Path 3
// (runAssembleStage, which actually submits a NEW render) when no job token
// AND no output URL exist. No re-spend on a reclaimed run.

/** Reclaim TTL for a stranded 'refining' lock — matches the 10-minute TTL the
 *  executor-side lock (lib/telegram/refine-conversation.ts's own private
 *  REFINING_LOCK_TTL_MS) uses for its own same-conversation reclaim, so a run
 *  is never "stranded" by one side while still considered "live" by the other. */
export const STRANDED_REFINING_LOCK_TTL_MS = 10 * 60 * 1000;

export type ReclaimOutcome = { reclaimed: number };

/**
 * Clear any delivery_runs row stuck at paused_reason='refining' for longer
 * than STRANDED_REFINING_LOCK_TTL_MS. ONLY the exact sentinel 'refining' is
 * ever selected — a genuinely human-paused run (any other paused_reason
 * string, e.g. "missing listing field: price") never matches this query,
 * regardless of age. Behind the same write guard as every other mutating path
 * in this file. Never throws (fail-open, matching buildOrderedRoomSequence's
 * style) so a hiccup here can never abort the sweep tick that calls it.
 */
export async function reclaimStrandedRefiningLocks(): Promise<ReclaimOutcome> {
  if (!canWrite()) return { reclaimed: 0 };

  try {
    const db = getSupabase();
    const staleBefore = new Date(Date.now() - STRANDED_REFINING_LOCK_TTL_MS).toISOString();

    const { data: stranded, error } = await db
      .from('delivery_runs')
      .select('id, stage')
      .eq('auto_run', true)
      .eq('paused_reason', 'refining')
      .lt('updated_at', staleBefore);

    if (error) {
      console.error('[auto-run] reclaimStrandedRefiningLocks: select failed:', error.message);
      return { reclaimed: 0 };
    }

    const rows = (stranded ?? []) as Array<{ id: string; stage: string }>;
    let reclaimed = 0;

    for (const row of rows) {
      try {
        // Conditional clear, NOT the unconditional updateRun(row.id, {...}) this
        // replaced: the batch SELECT above and this per-row clear are two
        // separate round trips, so paused_reason could have changed to a
        // GENUINE human gate (e.g. 'missing listing field: price') in between
        // — an unconditional clear would silently wipe that real gate. Re-
        // asserting `paused_reason = 'refining'` (and the staleness bound) in
        // the UPDATE's own WHERE makes the clear a CAS: it only ever touches a
        // row that is STILL stranded at the moment of the write. Uses the
        // supabase client directly (updateRun has no conditional-WHERE
        // support) — same client this function's own SELECT above uses.
        const { data: cleared, error: clearError } = await db
          .from('delivery_runs')
          .update({ paused_reason: null })
          .eq('id', row.id)
          .eq('paused_reason', 'refining')
          .lt('updated_at', staleBefore)
          .select('id');

        if (clearError) {
          console.error(`[auto-run] reclaimStrandedRefiningLocks: failed to clear run ${row.id}:`, clearError.message);
          continue;
        }

        if (Array.isArray(cleared) && cleared.length === 1) {
          console.log(
            `[auto-run] reclaimStrandedRefiningLocks: cleared stranded 'refining' lock — run=${row.id} stage=${row.stage} (stale > ${STRANDED_REFINING_LOCK_TTL_MS / 60_000}min)`,
          );
          reclaimed++;
        } else {
          // 0 rows matched: paused_reason changed (to a genuine gate, or was
          // already cleared by another actor) between the SELECT and this
          // write — never a bug, just a race this CAS is here to lose safely.
          console.log(
            `[auto-run] reclaimStrandedRefiningLocks: run=${row.id} no longer stranded at clear time (paused_reason changed) — skipped`,
          );
        }
      } catch (err) {
        console.error(`[auto-run] reclaimStrandedRefiningLocks: failed to clear run ${row.id}:`, err);
      }
    }

    return { reclaimed };
  } catch (err) {
    console.error('[auto-run] reclaimStrandedRefiningLocks threw:', err);
    return { reclaimed: 0 };
  }
}

// ─── PER-GATE RESOLVERS ───────────────────────────────────────────────────────

/**
 * photo_selection — AI-recommended photo set auto-approval gate.
 *
 * The AI selection is persisted upstream (lib/pipeline/selection.ts via
 * lib/pipeline.ts) before the run reaches this stage; getPhotoSelectionForRun
 * returns the already-ranked selected_photo_ids.
 *
 * If the AI selected ≥ AUTO_PHOTO_MIN_SELECTED photos: accept all of them
 * (passing ONLY photo_order, no rejections, so the "rejection reason required"
 * guard in applyPhotoSelectionForRun is never triggered). The RPC
 * approve_photo_selection sets the selected photos AND advances the run to
 * 'generating' in a single transaction — do NOT call advanceRun separately.
 *
 * After applying, fire the same continue hop the operator route fires after
 * approve_photo_selection: POST /api/pipeline/continue/[runId] on a fresh
 * Vercel function to start the heavy post-approval compute (style guide +
 * director scripting + N provider submits). Fire-and-forget; the
 * generating-stage reaper (reapStuckGeneratingDeliveryRuns) is the backstop if
 * the hop fails to land.
 *
 * Pause paths:
 *  - selected_photo_ids.length === 0: no AI photos at all.
 *  - selected_photo_ids.length < AUTO_PHOTO_MIN_SELECTED: thin coverage.
 */
export async function resolvePhotoSelection(run: DeliveryRunRow): Promise<GateOutcome> {
  const { selected_photo_ids } = await getPhotoSelectionForRun(run.id);

  if (selected_photo_ids.length === 0) {
    const reason = 'photo_selection: no AI-recommended photos';
    await pauseForHuman(run.id, reason);
    return { action: 'paused', reason };
  }

  if (selected_photo_ids.length < AUTO_PHOTO_MIN_SELECTED) {
    const reason = `photo_selection: only ${selected_photo_ids.length} photos selected (min ${AUTO_PHOTO_MIN_SELECTED}) — thin coverage`;
    await pauseForHuman(run.id, reason);
    return { action: 'paused', reason };
  }

  // Accept all AI-recommended photos. Pass ONLY photo_order (no rejected array)
  // so the removal-rejection-reason guard never fires. The RPC advances the run
  // to 'generating' — do NOT call advanceRun after this.
  await applyPhotoSelectionForRun(run.id, { photo_order: selected_photo_ids });

  // Fire the continue hop FIRST — unconditionally, before any await that could
  // throw. The run is already at 'generating'; if telemetry below throws the
  // hop has still landed so the pipeline resumes. Same ordering guarantee the
  // operator route uses. Fire-and-forget; the generating-stage reaper backstops
  // a hop that fails to land. Uses VERCEL_URL (always set in Vercel runtimes).
  const host = process.env.VERCEL_URL;
  if (host) {
    const continueUrl = `https://${host}/api/pipeline/continue/${encodeURIComponent(run.id)}`;
    void fetch(continueUrl, { method: 'POST' }).catch((e: unknown) => {
      console.warn(`[auto-run] photo_selection continue hop failed to dispatch; reaper will recover`, e);
    });
  } else {
    console.warn(`[auto-run] photo_selection: VERCEL_URL unset — continue hop skipped; reaper will recover`);
  }

  // Telemetry is best-effort: a DB hiccup must not prevent the function from
  // returning 'advanced' (the hop has already fired above).
  try {
    await recordMlEvent(run.id, 'auto_advance', {
      source: 'auto',
      gate: 'photo_selection',
      confidence: 1,
      selected_count: selected_photo_ids.length,
    });
  } catch (e) {
    console.error(`[auto-run] photo_selection: recordMlEvent failed (non-fatal, hop already fired)`, e);
  }

  return { action: 'advanced', to: 'generating' };
}

/**
 * checkpoint_a — Judge-winner confirmation gate.
 *
 * Generation-completeness gate runs FIRST: a scene that never got a
 * scene_variants row at all (submission silently dropped) never appears in
 * `variants`, so the per-pair loop below — which only walks scenes that DO
 * have a variant row — would never notice it and would silently accept a
 * partial run. (Incident: delivery run 4b15ef63 — 4 of 7 scenes had
 * attempt_count=0/provider=null/no clip_url; runJudgePass judged the 3 that
 * did have variant rows, checkpoint_a auto-accepted, and assembly stitched a
 * 3-clip video and marked the property complete.) We compare the full scene
 * set for the property against which scenes have a winning clip and pause
 * for a human instead of advancing when any are missing.
 *
 * Then, for each scene pair that IS present, compute margin =
 * abs(scoreA − scoreB) / 20. Degraded pairs (winner_source='default', no
 * real judge scores) are auto-accepted — there's no meaningful choice to
 * re-examine. If ALL real-judged scenes have a margin ≥ AUTO_JUDGE_MARGIN,
 * advance. If any scene's margin is below the threshold, pause.
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

  // Generation-completeness gate. Skipped only for the synthetic
  // zero-variant case (unreachable in prod — runJudgePass never advances a
  // run to checkpoint_a while `pairs.length === 0`), so there is nothing to
  // reconcile against and no DB round trip is needed.
  if (variants.length > 0) {
    const { data: sceneRows, error: scenesErr } = await getSupabase()
      .from('scenes')
      .select('id, scene_number')
      .eq('property_id', run.property_id);
    if (scenesErr) {
      throw new Error(`resolveCheckpointA: scenes lookup failed: ${scenesErr.message}`);
    }

    const allScenes = (sceneRows ?? []) as Array<{ id: string; scene_number: number }>;
    const missingSceneNumbers: number[] = [];
    for (const scene of allScenes) {
      const entry = byScene.get(scene.id);
      const winnerRow = entry ? (entry.a?.winner ? entry.a : entry.b?.winner ? entry.b : undefined) : undefined;
      if (!winnerRow?.clip_url) missingSceneNumbers.push(scene.scene_number);
    }

    if (missingSceneNumbers.length > 0) {
      missingSceneNumbers.sort((a, b) => a - b);
      const reason =
        `generation incomplete: ${missingSceneNumbers.length} of ${allScenes.length} scenes have no clip ` +
        `(scenes ${missingSceneNumbers.join(', ')})`;
      await pauseForHuman(run.id, reason);
      return { action: 'paused', reason };
    }
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
    // gemini_scores is JSONB → Supabase types it as Record<string,unknown>; cast
    // through unknown before narrowing to the domain shape we store at write time.
    const aScores = a?.gemini_scores as unknown as (VariantScores & { judge_error?: string }) | null | undefined;
    const bScores = b?.gemini_scores as unknown as (VariantScores & { judge_error?: string }) | null | undefined;

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
 * Build the ordered room sequence the finalized cut will actually show, from
 * delivery_runs.scene_order (winning scene ids in display order, set at the
 * checkpoint_a gate — BEFORE voiceover runs) joined to scenes.room_type
 * (denormalized from the linked photo — migration 063).
 *
 * Feeds generateDeliveryScript so narration beats track the on-screen room
 * order instead of being generated blind from listing facts alone (the bug:
 * e.g. "garage" narration over a kitchen clip).
 *
 * Robust by design — any missing/empty data returns null and callers fall
 * back to the prior whole-listing behavior. Never throws.
 */
export async function buildOrderedRoomSequence(
  run: DeliveryRunRow,
): Promise<Array<{ position: number; room: string }> | null> {
  const order = run.scene_order;
  if (!order || order.length === 0) return null;

  try {
    const db = getSupabase();
    const { data: scenes, error } = await db
      .from('scenes')
      .select('id, room_type')
      .in('id', order);

    if (error) {
      console.error('[delivery/auto-run] buildOrderedRoomSequence: scenes lookup failed, falling back to whole-listing narration:', error);
      return null;
    }
    if (!scenes || scenes.length === 0) return null;

    const roomById = new Map<string, string | null>(
      (scenes as Array<{ id: string; room_type: string | null }>).map(s => [s.id, s.room_type]),
    );

    const sequence = order
      .filter(id => roomById.has(id))
      .map((id, idx) => ({ position: idx + 1, room: roomById.get(id) || 'interior' }));

    return sequence.length > 0 ? sequence : null;
  } catch (err) {
    console.error('[delivery/auto-run] buildOrderedRoomSequence threw, falling back to whole-listing narration:', err);
    return null;
  }
}

/**
 * voiceover — Script generation + voice-tone selection gate.
 *
 * 1. Generate script if absent (reuses generateDeliveryScript — records its own cost_events).
 *    Script generation is grounded in the finalized scene_order's room sequence
 *    (see buildOrderedRoomSequence) so narration follows the on-screen room order;
 *    falls back to whole-listing narration when scene_order/room data is unavailable.
 * 2. Make a small Haiku LLM call to pick voice tone from listing context (records cost_events).
 * 3. Select voiceover_voice_id from the tone pick; delegate to runDeliveryAudio shared runner
 *    (duration-audit / auto-shorten loop + retry, records its own cost_events).
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
      // Ground the script in the actual on-screen room order (set at
      // checkpoint_a, before this gate runs). Returns null — and
      // generateDeliveryScript falls back to whole-listing narration — when
      // scene_order or room data isn't available; never blocks generation.
      const roomSequence = await buildOrderedRoomSequence(run);
      const result = await generateDeliveryScript({
        runId: run.id,
        propertyId: run.property_id,
        address: prop.address as string,
        videoType: run.video_type,
        durationSec: run.duration_seconds ?? 30,
        details: run.listing_details,
        roomSequence: roomSequence ?? undefined,
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

  // Idempotency: if audio already exists (a prior overlapping resolver paid for
  // it), skip the voice-pick Haiku call AND the synth entirely — reuse it and
  // advance. This prevents a double-spend on the expensive ElevenLabs synth.
  if (!run.voiceover_audio_url) {
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
      'Reply with ONLY the voice name (e.g. Brian).',
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

    // Persist the picked voice BEFORE synth so the shared audio runner (which
    // reads the run fresh) sees it.
    await updateRun(run.id, { voiceover_voice_id: voiceId } as Partial<DeliveryRunRow>);

    // 3. Synthesize audio via the SHARED runner so autopilot gets the same
    //    duration-audit / auto-shorten loop + retry the human path uses. It
    //    persists voiceover_audio_url and records its own cost_events; on a
    //    hard failure it sets the run error, and we pause for a human.
    const audioResult = await runDeliveryAudio(run.id);
    if (audioResult.ok === false) {
      const reason = `voiceover: audio synthesis failed — ${audioResult.error}`;
      await pauseForHuman(run.id, reason);
      return { action: 'paused', reason };
    }

    await recordMlEvent(run.id, 'auto_advance', {
      source: 'auto',
      gate: 'voiceover',
      confidence: 0.9,
      voice_id: voiceId,
      tone_pick: tonePick,
      ...(audioResult.duration_warning ? { duration_warning: audioResult.duration_warning } : {}),
    });
  }

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
  // Idempotency: if a track was already chosen (a prior overlapping resolver),
  // skip the mood Haiku call + track query/pick entirely and reuse it.
  if (run.music_track_id) {
    return advanceMusicToAssembling(run);
  }

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
  return advanceMusicToAssembling(run);
}

/**
 * Advance music → assembling and DRIVE the assembly stage for an autopilot run.
 *
 * BLOCKER FIX: nothing else moves an auto-run from 'assembling' to 'checkpoint_b'
 * — the cron sweep only acts on gate stages and there is no assembling reaper, so
 * resolveMusic advancing to 'assembling' previously left autopilot stalled.
 * runAssembleStage self-advances to checkpoint_b and fires the existing inline
 * kick. We are only reachable through resolveGate, which already passed the
 * canWrite() guard (Guard 4), so the writes runAssembleStage performs are
 * permitted here. A failure pauses the run for a human rather than silently
 * stalling. (The inline checkpoint_b kick re-enters resolveGate and is harmlessly
 * lease-blocked by the outer claim; the cron sweep resolves checkpoint_b next pass.)
 */
async function advanceMusicToAssembling(run: DeliveryRunRow): Promise<GateOutcome> {
  await _advanceRun(run.id, 'assembling');
  try {
    const { runAssembleStage } = await import('./assemble.js');
    await runAssembleStage(run.id);
  } catch (err) {
    // [ASSEMBLY_TIMEOUT] tagged errors: render is still in-flight at cron budget end.
    // Leave the run at 'assembling' — resolveAssembling() resumes polling on the next
    // sweep tick via the persisted job token. Do NOT pause for human.
    const isTimeout = Boolean((err as { isAssemblyTimeout?: unknown }).isAssemblyTimeout);
    if (isTimeout) {
      return { action: 'noop', reason: 'assembly in progress: render timed out, resuming next sweep tick' };
    }
    const reason = `assembly failed: ${err instanceof Error ? err.message : String(err)}`;
    await pauseForHuman(run.id, reason);
    return { action: 'paused', reason };
  }
  // runAssembleStage self-advances to checkpoint_b. Report the actual final stage.
  return { action: 'advanced', to: 'checkpoint_b' };
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

  // Empty-run guard: the base score (0.5) plus listing/audio/music bonuses can
  // reach AUTO_DELIVER_THRESHOLD with ZERO scene variants — that would auto-
  // deliver an empty video. Require at least one real scene before delivering;
  // otherwise pause for a human.
  if (byScene.size < 1) {
    const reason = 'quality below threshold: no scene variants to deliver (empty run)';
    await pauseForHuman(run.id, reason);
    return { action: 'paused', reason };
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

    // gemini_scores is JSONB → Supabase types it as Record<string,unknown>; cast
    // through unknown before narrowing to the domain shape we store at write time.
    const aScores = a?.gemini_scores as unknown as (VariantScores & { judge_error?: string }) | null | undefined;
    const bScores = b?.gemini_scores as unknown as (VariantScores & { judge_error?: string }) | null | undefined;
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
