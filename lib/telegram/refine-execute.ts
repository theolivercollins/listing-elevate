/**
 * lib/telegram/refine-execute.ts
 *
 * Deterministic Telegram refine EXECUTOR. Applies a validated list of
 * RefineActions to a delivery run via the real lib/delivery/* functions
 * (dependency-injected for testing), then — ONLY if at least one
 * render-affecting action succeeded AND none of them failed — batches a
 * SINGLE re-render for the whole set of changes. Any render-affecting
 * failure blocks the render entirely, even if other render-affecting
 * actions in the same batch succeeded (never ship a half-applied batch).
 *
 * Safety, in order:
 *  1. Re-validate ALL actions against a FRESHLY built RefineContext (never
 *     trust the caller's list as-is — time may have passed since planning).
 *     If any render-affecting action fails this re-validation, ABORT before
 *     mutating anything at all.
 *  2. regenerate_all is exclusive: if present, it's the only thing applied
 *     (revertRun back to an early re-drivable stage); everything else in the
 *     batch is reported as skipped and no render is attempted — reverting
 *     the run mid-batch and then trying to render it is incoherent.
 *  3. Otherwise, apply the remaining actions in a fixed deterministic order
 *     (edit_details -> music* -> voice/script* -> reorder -> flip_winner ->
 *     regenerate_clip -> generate_audio), each wrapped in its own try/catch
 *     so one action's failure never blocks the rest of the batch. Per-step
 *     {action, ok, error} is always recorded — nothing is silently dropped.
 *     Each action dispatches against a MUTABLE per-batch working context
 *     (cloned from the fresh snapshot before this loop starts) that gets
 *     patched after every successful mutation — so e.g. generate_script
 *     after edit_details in the same batch sees the NEW listing details, not
 *     the pre-batch ones (validation above still uses the untouched fresh
 *     snapshot — that's a different question: the request vs. current state).
 *  4. Per-session caps (regenerate_clip <=10, generate_music <=3, re-renders
 *     <=10) are enforced by skipping the offending action/render and
 *     reporting it — never throwing.
 *  5. `resume` runs LAST, after the render decision — it clears
 *     paused_reason, and running it last avoids racing the CALLER's own
 *     temporary refine-lock release (see ExecuteDeps docblock: the webhook
 *     sets paused_reason='refining' before calling this function and clears
 *     it after; if `resume` cleared paused_reason mid-batch, the auto-run
 *     cron sweep could pick the run up concurrently with this still-running
 *     batch).
 *  6. No cross-subsystem rollback: mutations that already landed are never
 *     undone if a later step fails. Fail-safe + honest per-step reporting,
 *     matching the design's explicit "no rollback" decision (external side
 *     effects like a submitted provider render job can't be undone anyway).
 *
 * The batched re-render itself has exactly THREE possible outcomes, and
 * `rerendering` in ExecuteResult must tell them apart honestly (never report
 * an in-flight render that didn't happen):
 *  (a) submitted AND completed/advanced within this call — rerendering:true.
 *  (b) submitted, but the in-process poll ran out of its own time budget
 *      (tagged `isAssemblyTimeout` by lib/pipeline.ts, same signal
 *      assemble.ts/auto-run.ts use) — the job token persists on the run row
 *      and the auto-run sweep finishes polling it later — rerendering:true.
 *  (c) anything else (a stage-transition failure, a DB write failure, or the
 *      provider call itself throwing before any job token existed) — nothing
 *      is in flight — rerendering:false, and the summary says so plainly.
 * See the render-decision try/catch in executeRefinement for exactly how
 * (b) is told apart from (c).
 *
 * NOTE on the run-lock: executeRefinement never reads or requires any
 * particular `paused_reason` value (other than the `resume` action, which
 * explicitly clears it) — it is safe to call while the webhook's own
 * temporary refining-lock is held.
 */

import { getVariantsForRun, updateRun, advanceRun, revertRun, recordMlEvent, setListingDetails } from '../delivery/runs.js';
import { regenerateVariant } from '../delivery/variants.js';
import { generateDeliveryScript } from '../delivery/voiceover-script.js';
import { runDeliveryAudio } from '../delivery/audio.js';
import { runAssembleStage } from '../delivery/assemble.js';
import { validateListingDetails } from '../delivery/details.js';
import { generateMusicVariantsForRun, recordMusicTrackFeedback } from '../delivery/music-gen.js';
import { getSupabase } from '../client.js';
import type { DeliveryStage } from '../delivery/state.js';
import type { DeliveryRunRow } from '../types/operator-studio.js';
import { buildRefineContext, isRenderAffecting, validateRefineActions } from './refine-context.js';
import {
  REFINE_CAPS,
  type ExecuteDeps,
  type ExecuteResult,
  type RefineAction,
  type RefineContext,
  type RefineStepResult,
} from './refine-types.js';

// ---------------------------------------------------------------------------
// Dependency resolution
// ---------------------------------------------------------------------------

interface ResolvedDeps {
  getVariantsForRun: typeof getVariantsForRun;
  updateRun: typeof updateRun;
  advanceRun: typeof advanceRun;
  revertRun: typeof revertRun;
  recordMlEvent: typeof recordMlEvent;
  setListingDetails: typeof setListingDetails;
  validateListingDetails: typeof validateListingDetails;
  regenerateVariant: typeof regenerateVariant;
  generateDeliveryScript: typeof generateDeliveryScript;
  runDeliveryAudio: typeof runDeliveryAudio;
  runAssembleStage: typeof runAssembleStage;
  generateMusicVariantsForRun: typeof generateMusicVariantsForRun;
  recordMusicTrackFeedback: typeof recordMusicTrackFeedback;
  getSupabase: typeof getSupabase;
  buildRefineContext: (runId: string) => Promise<RefineContext>;
}

function resolveDeps(deps: ExecuteDeps): ResolvedDeps {
  return {
    getVariantsForRun: deps.getVariantsForRun ?? getVariantsForRun,
    updateRun: deps.updateRun ?? updateRun,
    advanceRun: deps.advanceRun ?? advanceRun,
    revertRun: deps.revertRun ?? revertRun,
    recordMlEvent: deps.recordMlEvent ?? recordMlEvent,
    setListingDetails: deps.setListingDetails ?? setListingDetails,
    validateListingDetails: deps.validateListingDetails ?? validateListingDetails,
    regenerateVariant: deps.regenerateVariant ?? regenerateVariant,
    generateDeliveryScript: deps.generateDeliveryScript ?? generateDeliveryScript,
    runDeliveryAudio: deps.runDeliveryAudio ?? runDeliveryAudio,
    runAssembleStage: deps.runAssembleStage ?? runAssembleStage,
    generateMusicVariantsForRun: deps.generateMusicVariantsForRun ?? generateMusicVariantsForRun,
    recordMusicTrackFeedback: deps.recordMusicTrackFeedback ?? recordMusicTrackFeedback,
    getSupabase: deps.getSupabase ?? getSupabase,
    buildRefineContext: deps.buildRefineContext ?? buildRefineContext,
  };
}

// ---------------------------------------------------------------------------
// Stage-driving — only from the LATE gates where voiceover/music have
// already been resolved (mirrors the proven autopilot template's own
// checkpoint_b/voiceover/music/assembling handling, using the CURRENT
// DELIVERY_STAGES names — unchanged since the stale template was written).
// Deliberately excludes 'details' and earlier: forcing a hop through
// 'voiceover'/'music' from there would skip real content-generation gates
// the run hasn't reached yet, not just re-flow already-decided content.
// ---------------------------------------------------------------------------

function canDriveToAssembling(stage: DeliveryStage): boolean {
  return stage === 'voiceover' || stage === 'music' || stage === 'assembling' || stage === 'checkpoint_b';
}

async function driveToAssemblingAndRender(runId: string, stage: DeliveryStage, d: ResolvedDeps): Promise<void> {
  if (stage === 'checkpoint_b') {
    await d.revertRun(runId, 'assembling');
  } else if (stage === 'voiceover') {
    await d.advanceRun(runId, 'music');
    await d.advanceRun(runId, 'assembling');
  } else if (stage === 'music') {
    await d.advanceRun(runId, 'assembling');
  } else if (stage === 'assembling') {
    // Already there — nothing to drive.
  } else {
    throw new Error(`cannot drive stage '${stage}' to assembling`);
  }
  await d.runAssembleStage(runId);
}

/** Earliest stage with an ACTIVE re-fire mechanism (see the operator route's
 *  'rerun' switch): 'intake'/'photo_selection'/'details' explicitly return
 *  "nothing to re-run at this stage" there, so reverting to any of those
 *  would leave the run silently stalled with nothing to pick it back up.
 *  'generating' re-fires continuePipelineAfterPhotoSelection, which redrives
 *  scene generation + judging from the same selected photos. revertRun's own
 *  CAS + canRevert guard make this a no-op error (not a crash) if the run is
 *  already at or before 'generating'. */
const REGENERATE_ALL_TARGET_STAGE: DeliveryStage = 'generating';

// ---------------------------------------------------------------------------
// Deterministic execution order (resume/regenerate_all handled outside this
// map — see executeRefinement).
// ---------------------------------------------------------------------------

const ORDER_RANK: Record<string, number> = {
  edit_details: 0,
  set_music: 1, generate_music: 1, music_feedback: 1,
  set_voice: 2, generate_script: 2, set_script: 2,
  reorder: 3,
  flip_winner: 4,
  regenerate_clip: 5,
  generate_audio: 6,
};

type DispatchableAction = Exclude<RefineAction, { kind: 'resume' } | { kind: 'regenerate_all' }>;

function isDispatchable(a: RefineAction): a is DispatchableAction {
  return a.kind !== 'resume' && a.kind !== 'regenerate_all';
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// executeRefinement
// ---------------------------------------------------------------------------

export async function executeRefinement(
  runId: string,
  actions: RefineAction[],
  deps: ExecuteDeps = {},
): Promise<ExecuteResult> {
  const d = resolveDeps(deps);

  // 1. Re-validate against FRESH state.
  const freshCtx = await d.buildRefineContext(runId);
  const { actions: validActions, dropped } = validateRefineActions(actions, freshCtx);
  const dropSteps: RefineStepResult[] = dropped.map((drop) => ({
    action: drop.kind,
    ok: false,
    error: `invalid: ${drop.reason}`,
  }));

  // Abort BEFORE mutating anything if any render-affecting action is invalid.
  const criticalDrop = dropped.find((drop) => isRenderAffecting(drop.kind));
  if (criticalDrop) {
    const abortedSteps: RefineStepResult[] = validActions.map((a) => ({
      action: a.kind,
      ok: false,
      error: 'aborted — a render-affecting action in this batch failed re-validation; nothing was applied',
    }));
    return {
      steps: [...dropSteps, ...abortedSteps],
      rerendering: false,
      summary: `Nothing applied — ${criticalDrop.reason}. Please resend the request.`,
    };
  }

  // 2. regenerate_all is exclusive.
  const regenerateAll = validActions.find((a) => a.kind === 'regenerate_all');
  if (regenerateAll) {
    const skipped: RefineStepResult[] = validActions
      .filter((a) => a.kind !== 'regenerate_all')
      .map((a) => ({ action: a.kind, ok: false, error: 'skipped — combined with regenerate_all in the same batch; send other changes in a separate message' }));
    try {
      await d.revertRun(runId, REGENERATE_ALL_TARGET_STAGE);
      return {
        steps: [...dropSteps, { action: 'regenerate_all', ok: true }, ...skipped],
        rerendering: false,
        summary: 'Starting the run over from scene generation — this takes a few minutes; I\'ll let you know when it\'s ready to review again.',
      };
    } catch (err) {
      // Graceful regenerate_all (nit): revertRun throws its own distinctive
      // "illegal transition" message (lib/delivery/runs.ts) when the run is
      // already AT or EARLIER than the regenerate_all target stage — that's
      // not a real failure, just nothing to redo yet. Give the honest,
      // friendly reply for that specific case. Any other (genuinely
      // unexpected) error is logged loud and never echoed raw to the chat —
      // same discipline as L3 elsewhere in this file.
      const msg = errMsg(err);
      const illegalTransition = /illegal transition/i.test(msg);
      if (!illegalTransition) {
        console.error(`[refine-execute] regenerate_all revertRun failed for run ${runId}:`, err);
      }
      return {
        steps: [...dropSteps, { action: 'regenerate_all', ok: false, error: msg }, ...skipped],
        rerendering: false,
        summary: illegalTransition
          ? 'Already at the start — nothing to redo.'
          : "Could not start over — I've logged it; try again.",
      };
    }
  }

  // 3. Deterministic ordered execution (resume excluded — runs last, below).
  const mainActions = validActions.filter(isDispatchable);
  const resumeAction = validActions.find((a) => a.kind === 'resume');

  const ordered = mainActions
    .map((action, index) => ({ action, index }))
    .sort((x, y) => (ORDER_RANK[x.action.kind] ?? 99) - (ORDER_RANK[y.action.kind] ?? 99) || x.index - y.index)
    .map((x) => x.action);

  const executedSteps: RefineStepResult[] = [];
  // Cap-skips are a deliberate, expected "not doing this one" — they do NOT
  // count as a failure for the render gate below. A genuine thrown error
  // from a render-affecting action DOES: per spec, ANY render-affecting
  // failure blocks the render entirely (even if other render-affecting
  // actions in the same batch succeeded) — a half-applied batch must never
  // be rendered and reported as done.
  let anyRenderAffectingSucceeded = false;
  let anyRenderAffectingFailed = false;
  let regenerateClipUsed = freshCtx.usage.regenerateClipCount;
  let generateMusicUsed = freshCtx.usage.generateMusicCount;

  // BUG 2 fix — mutable per-batch working context. Validation above stays
  // pinned to `freshCtx` (the immutable pre-batch snapshot — correct as-is,
  // it's re-checking the user's request against the state the plan was made
  // against). Execution must NOT stay pinned to that same stale snapshot:
  // dispatchAction patches `working` in place after each successful mutating
  // action (edit_details -> listing_details, set_script/generate_script ->
  // voiceover_script, set_voice -> voiceover_voice_id, reorder -> scene_order,
  // set_music/generate_music -> music_track_id) so a later action in the SAME
  // batch (e.g. generate_script after edit_details) sees what actually landed
  // instead of clobbering it back to pre-batch values. A shallow clone is
  // sufficient here: every patch below REPLACES a field wholesale (never
  // mutates freshCtx's nested objects/arrays in place), so freshCtx itself is
  // never touched by anything in this loop.
  const working: RefineContext = { ...freshCtx };

  for (const action of ordered) {
    // 4. Per-session caps — skip + report, never throw.
    if (action.kind === 'regenerate_clip' && regenerateClipUsed >= REFINE_CAPS.regenerateClip) {
      executedSteps.push({ action: action.kind, ok: false, error: `skipped — session cap reached (${REFINE_CAPS.regenerateClip} regenerate_clip)` });
      continue;
    }
    if (action.kind === 'generate_music' && generateMusicUsed >= REFINE_CAPS.generateMusic) {
      executedSteps.push({ action: action.kind, ok: false, error: `skipped — session cap reached (${REFINE_CAPS.generateMusic} generate_music)` });
      continue;
    }

    try {
      await dispatchAction(action, runId, working, d);
      executedSteps.push({ action: action.kind, ok: true });
      if (isRenderAffecting(action.kind)) anyRenderAffectingSucceeded = true;
      if (action.kind === 'regenerate_clip') regenerateClipUsed++;
      if (action.kind === 'generate_music') generateMusicUsed++;
    } catch (err) {
      executedSteps.push({ action: action.kind, ok: false, error: errMsg(err) });
      if (isRenderAffecting(action.kind)) anyRenderAffectingFailed = true;
    }
  }

  // Render decision.
  let rerendering = false;
  let renderNote = '';
  if (anyRenderAffectingFailed) {
    renderNote = 'a change failed — re-render skipped so the video is never shown half-updated; fix the failed change and try again';
  } else if (anyRenderAffectingSucceeded) {
    if (freshCtx.usage.rerenderCount >= REFINE_CAPS.rerender) {
      renderNote = `re-render skipped — session cap reached (${REFINE_CAPS.rerender} re-renders)`;
    } else if (!canDriveToAssembling(freshCtx.stage)) {
      renderNote = `changes saved — the run is at '${freshCtx.stage}', too early to render yet; they'll apply once it reaches assembly`;
    } else {
      try {
        // Cap-on-submit: record the batch_rerender ml_event BEFORE the actual
        // render kick, not after completion/failure — deliberately before we
        // know which of the three outcomes below this attempt lands in.
        // REFINE_CAPS.rerender must still bound spend even when the render
        // times out or fails outright; recording only on success would let a
        // repeatedly-timing-out (or repeatedly-failing) render dodge the cap
        // forever while still burning real provider spend on every attempt
        // (cost tracking is P0). BUG 1 fix note: this DOES mean a pure
        // pre-submission failure (outcome (c) below) still consumes a cap
        // slot — we cannot cleanly tell "the provider call never went out"
        // apart from "submitted, then genuinely failed post-submit" from out
        // here without an extra job-token DB read that would reintroduce the
        // very race this cap exists to close, and a hard-killed Vercel
        // function would never reach a post-call recording point anyway.
        // Documented deliberate trade-off, not an oversight.
        // If this write itself fails, fail safe: skip the render entirely
        // rather than submit it with no cap-tracking record of it.
        await d.recordMlEvent(runId, 'auto_advance', {
          source: 'telegram_refine',
          action: 'batch_rerender',
          actions: ordered.map((a) => a.kind),
        });
        await driveToAssemblingAndRender(runId, freshCtx.stage, d);
        // Outcome (a): submitted AND completed/advanced within this call.
        rerendering = true;
        renderNote = 're-rendered';
      } catch (err) {
        // BUG 1 fix — driveToAssemblingAndRender can throw for two radically
        // different reasons that must never be conflated:
        //  (b) the render WAS submitted — lib/pipeline.ts's runAssemblyStep
        //      persists the job token (persistAssemblyJobId) BEFORE polling —
        //      but the in-process poll ran out of its own time budget.
        //      Tagged `isAssemblyTimeout` (same signal assemble.ts/
        //      auto-run.ts use for this exact distinction). The token stays
        //      on the run row, so the auto-run sweep's resolveAssembling()
        //      finishes polling it on its next tick — still an honestly
        //      in-flight re-render.
        //  (c) everything else: a stage-transition CAS failure, a DB write
        //      failure inside runAssembleStage, or the render submission
        //      itself throwing before any job token existed (network/auth
        //      error reaching the provider). No re-render is in flight at
        //      all. Reporting rerendering:true here would BE the bug: it
        //      lies to the operator and (via applyPlan) wrongly flips the
        //      intake to 'generating', clears last_paused_reason, and
        //      force-clears the run's paused_reason lock for a render that
        //      never started.
        const isTimeout = Boolean((err as { isAssemblyTimeout?: unknown }).isAssemblyTimeout);
        if (isTimeout) {
          rerendering = true;
          console.error(`[refine-execute] re-render poll timed out (job submitted; auto-run sweep will finish it) for run ${runId}:`, err);
          renderNote = "re-render submitted — it's taking a bit longer than usual; I'll follow up once it's done";
        } else {
          rerendering = false;
          // L3 — never leak raw provider/DB error text to Telegram; log loud,
          // tell the user something honest (mirrors humanizePausedReason's
          // discipline in lib/drive/detect.ts).
          console.error(`[refine-execute] re-render submission failed (nothing submitted) for run ${runId}:`, err);
          // Stable substring — humanizeExecuteSummary (refine-conversation.ts)
          // matches on it to phrase this for the operator.
          renderNote = "the re-render did not start — I've logged it; try again";
        }
      }
    }
  }

  // 5. resume — always last (see file docblock for the race it avoids).
  if (resumeAction) {
    try {
      await d.updateRun(runId, { paused_reason: null } as Partial<DeliveryRunRow>);
      await d.recordMlEvent(runId, 'auto_resume', { source: 'telegram_refine' });
      executedSteps.push({ action: 'resume', ok: true });
    } catch (err) {
      executedSteps.push({ action: 'resume', ok: false, error: errMsg(err) });
    }
  }

  const okCount = executedSteps.filter((s) => s.ok).length;
  const failCount = executedSteps.length - okCount;
  const summaryParts = [
    `${okCount} of ${executedSteps.length} change(s) applied${failCount > 0 ? `, ${failCount} failed` : ''}`,
  ];
  if (renderNote) summaryParts.push(renderNote);

  return {
    steps: [...dropSteps, ...executedSteps],
    rerendering,
    summary: summaryParts.join(' — '),
  };
}

// ---------------------------------------------------------------------------
// dispatchAction — one real mutation per action kind. Throws on failure;
// the caller (executeRefinement's loop) catches per-action so one failure
// never blocks the rest of the batch.
//
// `ctx` is the batch's MUTABLE working context (see BUG 2 fix in
// executeRefinement) — every case below reads whatever the ctx-reading
// fields currently hold (which may already reflect an EARLIER action's
// success in this same batch), and patches those same fields on `ctx` right
// after its own DB write lands so a LATER action sees it too. Actions that
// only ever read fresh state straight from the DB inside their own
// lib/delivery/* call (generate_audio, regenerate_clip, flip_winner,
// music_feedback) need no such patch — they're already immune to staleness.
// ---------------------------------------------------------------------------

async function dispatchAction(
  action: DispatchableAction,
  runId: string,
  ctx: RefineContext,
  d: ResolvedDeps,
): Promise<void> {
  switch (action.kind) {
    case 'set_music': {
      await d.updateRun(runId, { music_track_id: action.music_track_id } as Partial<DeliveryRunRow>);
      await d.recordMlEvent(runId, 'music_choice', {
        music_track_id: action.music_track_id,
        source: 'telegram_refine',
      });
      ctx.music_track_id = action.music_track_id; // BUG 2 fix: keep working ctx in sync
      return;
    }

    case 'generate_music': {
      // FIX 1 (cost-guard): computeSessionUsage (refine-context.ts) derives
      // generateMusicCount from ml_events tagged event_type='music_choice' +
      // payload.subtype==='generate_music' + payload.source==='telegram_refine'.
      // Every attempt — success, fallback-to-library, AND outright failure —
      // burns real provider spend (4 parallel composeMusic() calls, each
      // separately cost-tracked), so every attempt must record ONE qualifying
      // event or REFINE_CAPS.generateMusic can never trip and an expensive
      // retry loop could continue unbounded. Cost tracking is P0.
      let result: Awaited<ReturnType<typeof d.generateMusicVariantsForRun>>;
      try {
        result = await d.generateMusicVariantsForRun(runId);
      } catch (err) {
        // The call itself threw (e.g. a DB read failed before any generation
        // was even attempted) — still record the attempt before propagating,
        // so a repeatedly-throwing call can't dodge the session cap forever.
        await d.recordMlEvent(runId, 'music_choice', {
          source: 'telegram_refine',
          subtype: 'generate_music',
          failed: true,
          error: errMsg(err),
        });
        throw err;
      }

      if (result.ok === false) {
        await d.recordMlEvent(runId, 'music_choice', {
          source: 'telegram_refine',
          subtype: 'generate_music',
          failed: true,
          error: result.error,
        });
        throw new Error(`generate_music: ${result.error}`);
      }

      const { tracks, fallback } = result.body;
      // The all-4-failed fallback path inside generateMusicVariantsForRun
      // already sets run.music_track_id + records its own music_choice event
      // (source:'library_fallback') — don't double-apply the run mutation
      // here. That internal event never carries source:'telegram_refine'/
      // subtype:'generate_music' though, so without a SEPARATE qualifying
      // event here, this (expensive, 4-generation) attempt would never count
      // against the session cap at all — record one.
      if (!fallback && tracks.length > 0) {
        const chosen = tracks[0];
        await d.updateRun(runId, { music_track_id: chosen.id } as Partial<DeliveryRunRow>);
        await d.recordMlEvent(runId, 'music_choice', {
          music_track_id: chosen.id,
          source: 'telegram_refine',
          subtype: 'generate_music',
          genre: chosen.genre ?? null,
          alternative_track_ids: tracks.slice(1).map((t) => t.id),
        });
      } else if (fallback) {
        await d.recordMlEvent(runId, 'music_choice', {
          music_track_id: tracks[0]?.id ?? null,
          source: 'telegram_refine',
          subtype: 'generate_music',
          fallback: true,
        });
      }
      // BUG 2 fix: keep working ctx in sync regardless of which branch
      // actually wrote music_track_id — tracks[0] is the winning track either
      // way (the fallback body above always carries exactly the fallback
      // track as tracks[0]; `ok:true` guarantees tracks.length > 0).
      if (tracks.length > 0) ctx.music_track_id = tracks[0].id;
      return;
    }

    case 'music_feedback': {
      const result = await d.recordMusicTrackFeedback(runId, action.track_id, action.verdict, action.comment ?? null);
      if (result.ok === false) throw new Error(`music_feedback: ${result.error}`);
      return;
    }

    case 'reorder': {
      const before = ctx.scene_order;
      await d.updateRun(runId, { scene_order: action.scene_order } as Partial<DeliveryRunRow>);
      await d.recordMlEvent(runId, 'reorder', { before, after: action.scene_order, source: 'telegram_refine' });
      ctx.scene_order = action.scene_order; // BUG 2 fix: keep working ctx in sync
      return;
    }

    case 'regenerate_clip': {
      // Always regenerate the 'B' slot — mirrors the operator route's own
      // default ('B' unless the operator explicitly requests 'A') and is the
      // only variant with a sync path into scenes.clip_url on the NEXT
      // flip_winner/judge pass. regenerateVariant only SUBMITS a provider
      // job (async) — it does not block for the clip to land, so this
      // batch's own re-render may not show the new clip until a later
      // flip/rejudge; same limitation as the existing human flow.
      await d.regenerateVariant(runId, action.sceneId, 'B', action.model ? { modelOverride: action.model } : undefined);
      await d.recordMlEvent(runId, 'regenerate', {
        scene_id: action.sceneId,
        variant: 'B',
        source: 'telegram_refine',
        ...(action.model ? { model: action.model } : {}),
      });
      return;
    }

    case 'flip_winner': {
      const variants = await d.getVariantsForRun(runId);
      const sceneVariants = variants.filter((v) => v.scene_id === action.sceneId);
      const varA = sceneVariants.find((v) => v.variant === 'A');
      const varB = sceneVariants.find((v) => v.variant === 'B');
      if (!varA?.clip_url || !varB?.clip_url) throw new Error('flip_winner: both variants need clips to flip');
      const oldWinner: 'A' | 'B' = varA.winner ? 'A' : 'B';
      const newWinner: 'A' | 'B' = oldWinner === 'A' ? 'B' : 'A';
      const db = d.getSupabase();
      const now = new Date().toISOString();
      // C3 — Supabase does not throw by default; a swallowed { error } here
      // would report "flip_winner: ok" while the DB write silently failed.
      // Capture + throw on either write, and only record the ml_event once
      // BOTH have actually landed.
      const { error: errA } = await db
        .from('scene_variants')
        .update({ winner: newWinner === 'A', winner_source: 'operator', updated_at: now })
        .eq('id', varA.id);
      if (errA) throw new Error(`flip_winner: failed updating variant A: ${errA.message}`);
      const { error: errB } = await db
        .from('scene_variants')
        .update({ winner: newWinner === 'B', winner_source: 'operator', updated_at: now })
        .eq('id', varB.id);
      if (errB) throw new Error(`flip_winner: failed updating variant B: ${errB.message}`);
      await d.recordMlEvent(runId, 'variant_override', {
        scene_id: action.sceneId,
        from: oldWinner,
        to: newWinner,
        source: 'telegram_refine',
      });
      return;
    }

    case 'set_voice': {
      await d.updateRun(runId, { voiceover_voice_id: action.voice_id } as Partial<DeliveryRunRow>);
      await d.recordMlEvent(runId, 'voice_choice', { voice_id: action.voice_id, source: 'telegram_refine' });
      ctx.voiceover_voice_id = action.voice_id; // BUG 2 fix: keep working ctx in sync
      return;
    }

    case 'generate_script': {
      const db = d.getSupabase();
      const { data: prop } = await db.from('properties').select('address').eq('id', ctx.propertyId).maybeSingle();
      const address = String((prop as { address?: string } | null)?.address ?? '');
      // BUG 2 fix: `ctx.listing_details` is the working context here, so an
      // earlier edit_details in this same batch (which patches it below) is
      // what generateDeliveryScript sees — never the pre-batch snapshot.
      const { script } = await d.generateDeliveryScript({
        runId,
        propertyId: ctx.propertyId,
        address,
        videoType: ctx.video_type,
        durationSec: ctx.duration_seconds ?? 30,
        details: ctx.listing_details,
        ...(action.note ? { guidanceNote: action.note } : {}),
      });
      await d.updateRun(runId, { voiceover_script: script } as Partial<DeliveryRunRow>);
      await d.recordMlEvent(runId, 'script_edit', {
        source: 'telegram_refine',
        ...(action.note ? { operator_note: action.note } : {}),
      });
      ctx.voiceover_script = script; // BUG 2 fix: keep working ctx in sync
      return;
    }

    case 'set_script': {
      const before = ctx.voiceover_script;
      await d.updateRun(runId, { voiceover_script: action.text } as Partial<DeliveryRunRow>);
      await d.recordMlEvent(runId, 'script_edit', { source: 'telegram_refine', before, after: action.text });
      ctx.voiceover_script = action.text; // BUG 2 fix: keep working ctx in sync
      return;
    }

    case 'generate_audio': {
      // BUG 2 note: runDeliveryAudio (lib/delivery/audio.ts) re-reads the
      // run's voiceover_script/voiceover_voice_id FRESH from the DB itself —
      // never from ctx — so it already sees whatever set_script/
      // generate_script/set_voice just persisted earlier in this same batch
      // via their own updateRun writes. No working-ctx patch needed here.
      const result = await d.runDeliveryAudio(runId);
      if (result.ok === false) throw new Error(`generate_audio: ${result.error}`);
      return;
    }

    case 'edit_details': {
      // BUG 2 fix: merges over `ctx.listing_details` — the working context —
      // so a SECOND edit_details in the same batch composes on top of the
      // first instead of both merging against the same stale pre-batch
      // snapshot and clobbering each other's unspecified fields back.
      const merged: Record<string, unknown> = {
        price: action.price !== undefined ? action.price : ctx.listing_details.price ?? null,
        beds: action.beds !== undefined ? action.beds : ctx.listing_details.beds ?? null,
        baths: action.baths !== undefined ? action.baths : ctx.listing_details.baths ?? null,
        sqft: action.sqft !== undefined ? action.sqft : ctx.listing_details.sqft ?? null,
        mls_description: action.description !== undefined ? action.description : ctx.listing_details.mls_description ?? null,
      };
      const v = d.validateListingDetails(merged);
      if (v.ok === false) throw new Error(`edit_details: ${v.error}`);
      const before = ctx.listing_details;
      await d.setListingDetails(runId, v.details);
      await d.recordMlEvent(runId, 'details_edit', { before, after: v.details, source: 'telegram_refine' });
      ctx.listing_details = v.details; // BUG 2 fix: keep working ctx in sync
      return;
    }

    default: {
      const exhausted: never = action;
      throw new Error(`dispatchAction: unhandled action kind '${(exhausted as { kind: string }).kind}'`);
    }
  }
}
