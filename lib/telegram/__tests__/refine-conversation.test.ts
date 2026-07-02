/**
 * Tests for lib/telegram/refine-conversation.ts
 *
 * All side-effectful modules are mocked at the boundary (drive/intake-db,
 * delivery/runs, refine-agent, refine-execute, the Telegram client, and the
 * raw Supabase client used for the refining-lock CAS). refine-context.js is
 * PARTIALLY mocked: buildRefineContext is stubbed (network), but the real
 * validateRefineActions runs through so the "stale action dropped on apply"
 * scenario exercises genuine validation logic, not a hand-rolled stub.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../drive/intake-db.js', () => ({
  getActiveRefineIntake: vi.fn(),
  getIntakeByPendingPlanId: vi.fn(),
  getChatMessages: vi.fn(),
  appendChatMessages: vi.fn(),
  stagePlan: vi.fn(),
  getPendingPlan: vi.fn(),
  consumePlan: vi.fn(),
  clearPendingPlan: vi.fn(),
  accumulatePlan: vi.fn(),
  setStatus: vi.fn(),
  setLastPausedReason: vi.fn(),
  setTelegramMessageId: vi.fn(),
}));

vi.mock('../../delivery/runs.js', () => ({
  getRun: vi.fn(),
}));

vi.mock('../refine-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../refine-context.js')>();
  return { ...actual, buildRefineContext: vi.fn() };
});

vi.mock('../refine-agent.js', () => ({
  planRefinement: vi.fn(),
}));

vi.mock('../refine-execute.js', () => ({
  executeRefinement: vi.fn(),
}));

// lib/telegram/client.ts — the Telegram Bot API client. escapeMarkdown is a
// pure utility and must pass through, or refine-conversation.ts throws at
// runtime formatting any message.
vi.mock('../client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client.js')>();
  return { ...actual, sendMessage: vi.fn(), editMessageText: vi.fn() };
});

// lib/client.ts — the raw Supabase client used ONLY for the refining-lock CAS
// (delivery_runs.paused_reason). Distinct file from lib/telegram/client.ts above.
vi.mock('../../client.js', () => ({
  getSupabase: vi.fn(),
}));

import { handleRefineMessage, handleRefineCallback, applyPlan } from '../refine-conversation';
import * as intakeDb from '../../drive/intake-db.js';
import * as runsModule from '../../delivery/runs.js';
import * as refineContextModule from '../refine-context.js';
import * as refineAgentModule from '../refine-agent.js';
import * as refineExecuteModule from '../refine-execute.js';
import * as telegramClient from '../client.js';
import { getSupabase } from '../../client.js';
import type { ExecuteResult, RefineAction, RefineContext, RefinePlan } from '../refine-types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeIntake(overrides: Record<string, unknown> = {}) {
  return {
    id: 'intake-1',
    drive_folder_id: 'folder-1',
    address: '123 Main St',
    final_folder_id: null,
    photo_count: 10,
    last_count_change_at: new Date().toISOString(),
    status: 'generating',
    telegram_message_id: null,
    feedback_notes: null,
    property_id: 'prop-1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    delivery_run_id: 'run-1',
    ...overrides,
  };
}

function makeCtx(overrides: Partial<RefineContext> = {}): RefineContext {
  return {
    runId: 'run-1',
    propertyId: 'prop-1',
    stage: 'music',
    video_type: 'just_listed',
    duration_seconds: 30,
    scene_order: ['scene-1'],
    scenes: [{ id: 'scene-1', room_type: 'kitchen', winner: 'A' }],
    music_track_id: 'track-1',
    voiceover_voice_id: 'voice-1',
    voiceover_script: 'Welcome home.',
    listing_details: { price: 500000 },
    paused_reason: null,
    availableTracks: [{ id: 'track-1', name: 'Track 1', mood: 'upbeat', genre: 'acoustic' }],
    availableVoices: [{ id: 'voice-1', name: 'Brian', isClientVoice: false }],
    usage: { regenerateClipCount: 0, generateMusicCount: 0, rerenderCount: 0 },
    ...overrides,
  };
}

function makePlan(overrides: Partial<RefinePlan> = {}): RefinePlan {
  return { actions: [], summary: 'summary', reply: 'reply', needsConfirm: false, commit: false, ...overrides };
}

function makeResult(overrides: Partial<ExecuteResult> = {}): ExecuteResult {
  return { steps: [], rerendering: false, summary: '0 of 0 change(s) applied', ...overrides };
}

/** Fake `delivery_runs` Supabase table, tracking each distinct .update(...)
 *  call (with its own .eq()/.or() args) so acquire/release/force-clear can be
 *  told apart precisely. `.select()` resolves the acquire-CAS outcome. */
function makeFakeRunsDb(acquireSucceeds = true) {
  const updates: Array<{ patch: Record<string, unknown>; eqArgs: Array<[string, unknown]>; orArgs: unknown[] }> = [];

  function makeChain(patch: Record<string, unknown>) {
    const record = { patch, eqArgs: [] as Array<[string, unknown]>, orArgs: [] as unknown[] };
    updates.push(record);
    const chain: Record<string, unknown> = {
      eq: vi.fn((col: string, val: unknown) => {
        record.eqArgs.push([col, val]);
        return chain;
      }),
      or: vi.fn((cond: unknown) => {
        record.orArgs.push(cond);
        return chain;
      }),
      select: vi.fn(() =>
        Promise.resolve(acquireSucceeds ? { data: [{ id: 'run-1' }], error: null } : { data: [], error: null }),
      ),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
    };
    return chain;
  }

  const client = { from: vi.fn(() => ({ update: vi.fn((patch: Record<string, unknown>) => makeChain(patch)) })) };
  return { client, updates };
}

/** Flush the microtask/timer queue enough for a fire-and-forget async chain
 *  (unawaited by the code under test) to fully settle before assertions. */
async function flush(ticks = 6): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSupabase).mockReturnValue(makeFakeRunsDb().client as never);
  vi.mocked(intakeDb.getChatMessages).mockResolvedValue([]);
  vi.mocked(intakeDb.appendChatMessages).mockResolvedValue(undefined);
  vi.mocked(intakeDb.setStatus).mockResolvedValue(undefined);
  vi.mocked(intakeDb.setLastPausedReason).mockResolvedValue(undefined);
  vi.mocked(intakeDb.setTelegramMessageId).mockResolvedValue(undefined);
  vi.mocked(intakeDb.clearPendingPlan).mockResolvedValue(undefined);
  vi.mocked(intakeDb.accumulatePlan).mockResolvedValue(undefined);
  vi.mocked(runsModule.getRun).mockResolvedValue({ id: 'run-1' } as never);
  vi.mocked(telegramClient.sendMessage).mockResolvedValue({ messageId: 999 });
  vi.mocked(telegramClient.editMessageText).mockResolvedValue(undefined);
});

// ── handleRefineMessage ───────────────────────────────────────────────────────

describe('handleRefineMessage — no active listing', () => {
  it('sends a friendly message and never calls the planner when there is no active refine intake', async () => {
    vi.mocked(intakeDb.getActiveRefineIntake).mockResolvedValue(null);

    await handleRefineMessage('change the music');

    expect(telegramClient.sendMessage).toHaveBeenCalledWith(
      'No active listing to work on right now — approve one first.',
    );
    expect(refineAgentModule.planRefinement).not.toHaveBeenCalled();
  });

  it('treats a delivery_run_id-less intake the same as no active intake', async () => {
    vi.mocked(intakeDb.getActiveRefineIntake).mockResolvedValue(makeIntake({ delivery_run_id: null }) as never);

    await handleRefineMessage('change the music');

    expect(telegramClient.sendMessage).toHaveBeenCalledWith(
      'No active listing to work on right now — approve one first.',
    );
  });
});

describe('handleRefineMessage — pure Q&A (no actions)', () => {
  it('sends the reply verbatim and never stages a plan or executes anything', async () => {
    vi.mocked(intakeDb.getActiveRefineIntake).mockResolvedValue(makeIntake() as never);
    vi.mocked(refineContextModule.buildRefineContext).mockResolvedValue(makeCtx());
    vi.mocked(refineAgentModule.planRefinement).mockResolvedValue(
      makePlan({ reply: 'The listing has 3 beds and 2 baths.' }),
    );

    await handleRefineMessage('how many beds does it have?');

    expect(telegramClient.sendMessage).toHaveBeenCalledWith('The listing has 3 beds and 2 baths.');
    expect(intakeDb.stagePlan).not.toHaveBeenCalled();
    expect(refineExecuteModule.executeRefinement).not.toHaveBeenCalled();
    expect(intakeDb.appendChatMessages).toHaveBeenCalledWith('intake-1', [
      { role: 'user', content: 'how many beds does it have?' },
      { role: 'assistant', content: 'The listing has 3 beds and 2 baths.' },
    ]);
  });
});

// ── FIX 3 — accumulate across turns; "go" commits ONE combined plan ─────────
//
// Supersedes the old "needsConfirm plan" / "non-confirm plan (immediate
// execute)" tests: for a NON-paused run, NOTHING executes or stages a
// confirm card on an ordinary message anymore — everything accumulates
// until an explicit commit ("go"). Also folds in the old M1 (b)/(c) cases
// (a lone `resume` when the run isn't genuinely paused) — resume is no
// longer special-cased once the run isn't paused; it accumulates like any
// other action. M1 (a) — resume forced through confirm at a GENUINE pause —
// moves to the "paused-run" describe block below, since that's the only
// place the pre-FIX-3 immediate-apply flow still runs.

describe('handleRefineMessage — FIX 3: non-paused turns accumulate; "go" commits ONE combined plan', () => {
  it('a single change request (commit:false) accumulates — no stagePlan, no executeRefinement — and replies with the running summary', async () => {
    vi.mocked(intakeDb.getActiveRefineIntake).mockResolvedValue(makeIntake() as never); // no pending_plan yet
    vi.mocked(refineContextModule.buildRefineContext).mockResolvedValue(makeCtx());
    const plan = makePlan({
      actions: [{ kind: 'set_voice', voice_id: 'voice-1' }],
      summary: 'Switch narrator to Brian.',
      reply: 'Switching the narrator.',
      commit: false,
    });
    vi.mocked(refineAgentModule.planRefinement).mockResolvedValue(plan);

    await handleRefineMessage('use Mark instead');

    expect(intakeDb.accumulatePlan).toHaveBeenCalledWith('intake-1', {
      actions: [{ kind: 'set_voice', voice_id: 'voice-1' }],
      summary: 'Switch narrator to Brian',
    });
    expect(intakeDb.stagePlan).not.toHaveBeenCalled();
    expect(refineExecuteModule.executeRefinement).not.toHaveBeenCalled();
    expect(telegramClient.sendMessage).toHaveBeenCalledWith(
      "Got it — Switch narrator to Brian. Anything else, or say 'go' to apply + render.",
    );
  });

  it('a single-turn commit (a change + an explicit "go" in the same message) stages + shows ONE confirm card immediately', async () => {
    vi.mocked(intakeDb.getActiveRefineIntake).mockResolvedValue(makeIntake() as never); // no pending_plan
    vi.mocked(refineContextModule.buildRefineContext).mockResolvedValue(makeCtx());
    const plan = makePlan({
      actions: [{ kind: 'set_music', music_track_id: 'track-1' }],
      summary: 'Switch music to Track 1.',
      reply: 'Switching the music now.',
      commit: true,
    });
    vi.mocked(refineAgentModule.planRefinement).mockResolvedValue(plan);
    vi.mocked(intakeDb.stagePlan).mockResolvedValue('plan-abc');
    vi.mocked(telegramClient.sendMessage).mockResolvedValue({ messageId: 555 });

    await handleRefineMessage('use the other track and go');

    expect(intakeDb.accumulatePlan).not.toHaveBeenCalled();
    expect(intakeDb.stagePlan).toHaveBeenCalledWith('intake-1', {
      actions: plan.actions,
      summary: 'Switch music to Track 1',
    });
    expect(telegramClient.sendMessage).toHaveBeenCalledWith(
      "Apply: Switch music to Track 1 + re-render?",
      expect.objectContaining({
        buttons: [
          [
            { text: '✅ Apply & re-render', callbackData: 'apply:plan-abc' },
            { text: '✏️ Adjust', callbackData: 'adjust:plan-abc' },
            { text: '❌ Cancel', callbackData: 'cancel:plan-abc' },
          ],
        ],
      }),
    );
    expect(intakeDb.setTelegramMessageId).toHaveBeenCalledWith('intake-1', 555);
    expect(refineExecuteModule.executeRefinement).not.toHaveBeenCalled();
  });

  it('a lone `resume` when the run is NOT paused accumulates like any other action (resume is no longer special-cased for a non-paused run)', async () => {
    vi.mocked(intakeDb.getActiveRefineIntake).mockResolvedValue(makeIntake() as never);
    vi.mocked(refineContextModule.buildRefineContext).mockResolvedValue(makeCtx({ paused_reason: null }));
    const plan = makePlan({
      actions: [{ kind: 'resume' }],
      summary: 'Resume the run.',
      reply: 'Resuming.',
      commit: false,
    });
    vi.mocked(refineAgentModule.planRefinement).mockResolvedValue(plan);

    await handleRefineMessage('resume it');

    expect(intakeDb.accumulatePlan).toHaveBeenCalledWith('intake-1', { actions: [{ kind: 'resume' }], summary: 'Resume the run' });
    expect(intakeDb.stagePlan).not.toHaveBeenCalled();
    expect(refineExecuteModule.executeRefinement).not.toHaveBeenCalled();
  });

  it('a lone `resume` when paused_reason is only the internal "refining" lock sentinel is NOT a genuine pause — also accumulates', async () => {
    vi.mocked(intakeDb.getActiveRefineIntake).mockResolvedValue(makeIntake() as never);
    vi.mocked(refineContextModule.buildRefineContext).mockResolvedValue(makeCtx({ paused_reason: 'refining' }));
    const plan = makePlan({
      actions: [{ kind: 'resume' }],
      summary: 'Resume the run.',
      reply: 'Resuming.',
      commit: false,
    });
    vi.mocked(refineAgentModule.planRefinement).mockResolvedValue(plan);

    await handleRefineMessage('resume it');

    expect(intakeDb.accumulatePlan).toHaveBeenCalledWith('intake-1', { actions: [{ kind: 'resume' }], summary: 'Resume the run' });
    expect(refineExecuteModule.executeRefinement).not.toHaveBeenCalled();
  });

  it('"go" with nothing accumulated and nothing new this turn: friendly nudge, no stagePlan/accumulatePlan/execute call', async () => {
    vi.mocked(intakeDb.getActiveRefineIntake).mockResolvedValue(makeIntake() as never); // no pending_plan
    vi.mocked(refineContextModule.buildRefineContext).mockResolvedValue(makeCtx());
    const plan = makePlan({ actions: [], summary: '', reply: 'Applying now.', commit: true });
    vi.mocked(refineAgentModule.planRefinement).mockResolvedValue(plan);

    await handleRefineMessage('go');

    expect(telegramClient.sendMessage).toHaveBeenCalledWith('Nothing queued to apply — tell me what to change first.');
    expect(intakeDb.stagePlan).not.toHaveBeenCalled();
    expect(intakeDb.accumulatePlan).not.toHaveBeenCalled();
    expect(refineExecuteModule.executeRefinement).not.toHaveBeenCalled();
  });

  it('accumulates across TWO change turns, then "go" stages ONE combined plan; applying it executes ONCE with the COMBINED actions from all turns', async () => {
    vi.mocked(refineContextModule.buildRefineContext).mockResolvedValue(makeCtx());

    // Turn 1 — accumulate the first change.
    vi.mocked(intakeDb.getActiveRefineIntake).mockResolvedValueOnce(makeIntake() as never); // no pending_plan yet
    vi.mocked(refineAgentModule.planRefinement).mockResolvedValueOnce(makePlan({
      actions: [{ kind: 'set_music', music_track_id: 'track-1' }],
      summary: 'Switch music to Track 1.',
      reply: 'Sure, switching the music.',
      commit: false,
    }));

    await handleRefineMessage('switch the music to track 1');

    expect(intakeDb.accumulatePlan).toHaveBeenNthCalledWith(1, 'intake-1', {
      actions: [{ kind: 'set_music', music_track_id: 'track-1' }],
      summary: 'Switch music to Track 1',
    });
    expect(telegramClient.sendMessage).toHaveBeenLastCalledWith(
      "Got it — Switch music to Track 1. Anything else, or say 'go' to apply + render.",
    );

    // Turn 2 — accumulate a second change; the intake now reflects turn 1's accumulation.
    vi.mocked(intakeDb.getActiveRefineIntake).mockResolvedValueOnce(makeIntake({
      pending_plan: { actions: [{ kind: 'set_music', music_track_id: 'track-1' }], summary: 'Switch music to Track 1' },
    }) as never);
    vi.mocked(refineAgentModule.planRefinement).mockResolvedValueOnce(makePlan({
      actions: [{ kind: 'reorder', scene_order: ['scene-1'] }],
      summary: 'Reorder the scenes.',
      reply: 'Got it, reordering too.',
      commit: false,
    }));

    await handleRefineMessage('also reorder the scenes');

    const combinedActions: RefineAction[] = [
      { kind: 'set_music', music_track_id: 'track-1' },
      { kind: 'reorder', scene_order: ['scene-1'] },
    ];
    expect(intakeDb.accumulatePlan).toHaveBeenNthCalledWith(2, 'intake-1', {
      actions: combinedActions,
      summary: 'Switch music to Track 1; Reorder the scenes',
    });

    // Turn 3 — "go": stages the FULL combined batch as ONE plan.
    vi.mocked(intakeDb.getActiveRefineIntake).mockResolvedValueOnce(makeIntake({
      pending_plan: { actions: combinedActions, summary: 'Switch music to Track 1; Reorder the scenes' },
    }) as never);
    vi.mocked(refineAgentModule.planRefinement).mockResolvedValueOnce(makePlan({
      actions: [], summary: '', reply: 'Applying everything now.', commit: true,
    }));
    vi.mocked(intakeDb.stagePlan).mockResolvedValue('plan-final');

    await handleRefineMessage('go');

    expect(intakeDb.stagePlan).toHaveBeenCalledWith('intake-1', {
      actions: combinedActions,
      summary: 'Switch music to Track 1; Reorder the scenes',
    });
    expect(refineExecuteModule.executeRefinement).not.toHaveBeenCalled(); // staged, not yet applied

    // Turn 4 — tap "Apply": executeRefinement fires exactly ONCE with the COMBINED actions.
    // Resolved via the planId (getIntakeByPendingPlanId), not "active" state.
    vi.mocked(intakeDb.getIntakeByPendingPlanId).mockResolvedValueOnce(makeIntake({ telegram_message_id: 555 }) as never);
    vi.mocked(intakeDb.getPendingPlan).mockResolvedValue({ actions: combinedActions, summary: 'Switch music to Track 1; Reorder the scenes' });
    vi.mocked(intakeDb.consumePlan).mockResolvedValue(true);
    vi.mocked(refineExecuteModule.executeRefinement).mockResolvedValue(
      makeResult({
        steps: [{ action: 'set_music', ok: true }, { action: 'reorder', ok: true }],
        rerendering: true,
        summary: '2 of 2 change(s) applied — re-rendered',
      }),
    );

    await handleRefineCallback('apply:plan-final');

    expect(refineExecuteModule.executeRefinement).toHaveBeenCalledTimes(1);
    expect(refineExecuteModule.executeRefinement).toHaveBeenCalledWith('run-1', combinedActions);
  });
});

// ── paused-run turns still apply immediately (FIX 3 does not change this) ──

describe('handleRefineMessage — paused-run turns still apply immediately (FIX 3 preserves this)', () => {
  it('routes a lone `resume` through the confirm card when the run is paused at a genuine human gate (M1 injection defense)', async () => {
    vi.mocked(intakeDb.getActiveRefineIntake).mockResolvedValue(makeIntake() as never);
    vi.mocked(refineContextModule.buildRefineContext).mockResolvedValue(
      makeCtx({ paused_reason: 'quality below threshold: 0.400' }),
    );
    const plan = makePlan({
      actions: [{ kind: 'resume' }],
      summary: 'Resume the paused run.',
      reply: 'Resuming.',
      needsConfirm: false, // the planner alone thinks resume is cheap/instant
    });
    vi.mocked(refineAgentModule.planRefinement).mockResolvedValue(plan);
    vi.mocked(intakeDb.stagePlan).mockResolvedValue('plan-resume');

    await handleRefineMessage('resume it');

    // Forced through the confirm card despite plan.needsConfirm === false —
    // an injected `[resume]` must never silently release spend past a real gate.
    expect(intakeDb.stagePlan).toHaveBeenCalledWith('intake-1', { actions: plan.actions, summary: plan.summary });
    expect(intakeDb.accumulatePlan).not.toHaveBeenCalled();
    expect(refineExecuteModule.executeRefinement).not.toHaveBeenCalled();
  });

  it('a non-resume, non-confirm change at a genuine paused gate applies immediately — never deferred to the accumulation', async () => {
    vi.mocked(intakeDb.getActiveRefineIntake).mockResolvedValue(makeIntake() as never);
    vi.mocked(refineContextModule.buildRefineContext).mockResolvedValue(makeCtx({ paused_reason: 'missing listing field: price' }));
    const plan = makePlan({
      actions: [{ kind: 'edit_details', price: 550000 }],
      reply: 'Got it, updating the price.',
      needsConfirm: false,
      commit: false, // deliberately false — a paused-run turn applies regardless of commit
    });
    vi.mocked(refineAgentModule.planRefinement).mockResolvedValue(plan);
    vi.mocked(refineExecuteModule.executeRefinement).mockResolvedValue(
      makeResult({ steps: [{ action: 'edit_details', ok: true }], summary: '1 of 1 change(s) applied' }),
    );

    await handleRefineMessage('the price is actually 550k');

    expect(refineExecuteModule.executeRefinement).toHaveBeenCalledWith('run-1', plan.actions);
    expect(intakeDb.accumulatePlan).not.toHaveBeenCalled();
    expect(intakeDb.stagePlan).not.toHaveBeenCalled();
  });

  it('a needsConfirm action at a genuine paused gate still stages ONE confirm card (needsConfirm gate preserved for paused runs)', async () => {
    vi.mocked(intakeDb.getActiveRefineIntake).mockResolvedValue(makeIntake() as never);
    vi.mocked(refineContextModule.buildRefineContext).mockResolvedValue(makeCtx({ paused_reason: 'music pick needed' }));
    const plan = makePlan({
      actions: [{ kind: 'generate_music' }],
      summary: 'Generate new AI music.',
      reply: 'Generating new music options.',
      needsConfirm: true,
      commit: false,
    });
    vi.mocked(refineAgentModule.planRefinement).mockResolvedValue(plan);
    vi.mocked(intakeDb.stagePlan).mockResolvedValue('plan-paused-confirm');

    await handleRefineMessage('make some new music');

    expect(intakeDb.stagePlan).toHaveBeenCalledWith('intake-1', { actions: plan.actions, summary: plan.summary });
    expect(refineExecuteModule.executeRefinement).not.toHaveBeenCalled();
    expect(intakeDb.accumulatePlan).not.toHaveBeenCalled();
  });
});

// ── M2 — concrete before→after echo for silent inline edits ─────────────────
//
// M2 only fires on the immediate-apply (never-confirmed) path, which after
// FIX 3 exists ONLY for a genuinely-paused run (see the describe block
// above) — a non-paused turn always goes through an explicit confirm card
// first, which already shows the summary before anything executes.

describe('handleRefineMessage — M2: concrete before/after echo for inline edits (paused-run path)', () => {
  it('echoes "Set price to $X" and "beds N→M" for an inline edit_details batch while genuinely paused', async () => {
    vi.mocked(intakeDb.getActiveRefineIntake).mockResolvedValue(makeIntake() as never);
    vi.mocked(refineContextModule.buildRefineContext).mockResolvedValue(
      makeCtx({ paused_reason: 'missing listing field: price', listing_details: { price: 400000, beds: 3, baths: 2, sqft: 1500 } }),
    );
    const plan = makePlan({
      actions: [{ kind: 'edit_details', price: 500000, beds: 4 }],
      reply: 'Updating the listing details.',
      needsConfirm: false,
    });
    vi.mocked(refineAgentModule.planRefinement).mockResolvedValue(plan);
    vi.mocked(refineExecuteModule.executeRefinement).mockResolvedValue(
      makeResult({ steps: [{ action: 'edit_details', ok: true }], summary: '1 of 1 change(s) applied' }),
    );

    await handleRefineMessage('bump the price to 500k and make it 4 beds');

    expect(telegramClient.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Set price to $500,000'),
    );
    expect(telegramClient.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('beds 3→4'),
    );
    // The terse executor summary still rides along, not replaced.
    expect(telegramClient.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('1 of 1 change(s) applied'),
    );
  });

  it('echoes "Updated the script" for an inline set_script batch while genuinely paused — a silent tamper is never invisible', async () => {
    vi.mocked(intakeDb.getActiveRefineIntake).mockResolvedValue(makeIntake() as never);
    vi.mocked(refineContextModule.buildRefineContext).mockResolvedValue(makeCtx({ paused_reason: 'awaiting voiceover script' }));
    const plan = makePlan({
      actions: [{ kind: 'set_script', text: 'Brand new narration.' }],
      reply: 'Updating the script.',
      needsConfirm: false,
    });
    vi.mocked(refineAgentModule.planRefinement).mockResolvedValue(plan);
    vi.mocked(refineExecuteModule.executeRefinement).mockResolvedValue(
      makeResult({ steps: [{ action: 'set_script', ok: true }], summary: '1 of 1 change(s) applied' }),
    );

    await handleRefineMessage('rewrite the script');

    expect(telegramClient.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Updated the script'),
    );
  });

  it('does not add a concrete-change prefix for actions outside edit_details/set_script (e.g. set_voice), while genuinely paused', async () => {
    vi.mocked(intakeDb.getActiveRefineIntake).mockResolvedValue(makeIntake() as never);
    vi.mocked(refineContextModule.buildRefineContext).mockResolvedValue(makeCtx({ paused_reason: 'awaiting voice pick' }));
    const plan = makePlan({
      actions: [{ kind: 'set_voice', voice_id: 'voice-1' }],
      reply: 'Switching narrator.',
      needsConfirm: false,
    });
    vi.mocked(refineAgentModule.planRefinement).mockResolvedValue(plan);
    vi.mocked(refineExecuteModule.executeRefinement).mockResolvedValue(
      makeResult({ steps: [{ action: 'set_voice', ok: true }], summary: '1 of 1 change(s) applied' }),
    );

    await handleRefineMessage('use a different voice');

    expect(telegramClient.sendMessage).toHaveBeenCalledWith('1 of 1 change(s) applied');
  });
});

// ── handleRefineCallback — apply ─────────────────────────────────────────────

describe('handleRefineCallback — apply', () => {
  it('consumes the staged plan, kicks the executor, and reports a fast ack (never awaiting the render inline)', async () => {
    vi.mocked(intakeDb.getIntakeByPendingPlanId).mockResolvedValue(makeIntake({ telegram_message_id: 555 }) as never);
    const staged = { actions: [{ kind: 'set_music', music_track_id: 'track-1' }] as RefineAction[], summary: 'Switch music.' };
    vi.mocked(intakeDb.getPendingPlan).mockResolvedValue(staged);
    vi.mocked(intakeDb.consumePlan).mockResolvedValue(true);
    vi.mocked(refineContextModule.buildRefineContext).mockResolvedValue(makeCtx());
    vi.mocked(refineExecuteModule.executeRefinement).mockResolvedValue(
      makeResult({ steps: [{ action: 'set_music', ok: true }], rerendering: true, summary: '1 of 1 change(s) applied — re-rendered' }),
    );

    await handleRefineCallback('apply:plan-abc');

    expect(intakeDb.getIntakeByPendingPlanId).toHaveBeenCalledWith('plan-abc');
    expect(intakeDb.getPendingPlan).toHaveBeenCalledWith('intake-1', 'plan-abc');
    expect(intakeDb.consumePlan).toHaveBeenCalledWith('intake-1', 'plan-abc');
    expect(telegramClient.editMessageText).toHaveBeenCalledWith(555, expect.stringContaining('Applying'), { buttons: [] });
    expect(telegramClient.sendMessage).toHaveBeenCalledWith(
      "Applying — re-rendering now, I'll send the updated video when it's ready.",
    );

    // The executor was kicked (called) synchronously before the handler
    // returned, even though its own promise wasn't awaited inline.
    expect(refineExecuteModule.executeRefinement).toHaveBeenCalledWith('run-1', staged.actions);

    await flush();
    expect(intakeDb.setStatus).toHaveBeenCalledWith('intake-1', 'generating');
  });

  it('single-use: a replayed apply on an already-consumed plan is a safe no-op', async () => {
    vi.mocked(intakeDb.getIntakeByPendingPlanId).mockResolvedValue(makeIntake({ telegram_message_id: 555 }) as never);
    const staged = { actions: [{ kind: 'set_music', music_track_id: 'track-1' }] as RefineAction[], summary: 'Switch music.' };
    vi.mocked(intakeDb.getPendingPlan).mockResolvedValue(staged);
    vi.mocked(intakeDb.consumePlan).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    vi.mocked(refineContextModule.buildRefineContext).mockResolvedValue(makeCtx());
    vi.mocked(refineExecuteModule.executeRefinement).mockResolvedValue(makeResult());

    await handleRefineCallback('apply:plan-abc');
    expect(refineExecuteModule.executeRefinement).toHaveBeenCalledTimes(1);

    vi.mocked(telegramClient.sendMessage).mockClear();
    await handleRefineCallback('apply:plan-abc');

    expect(telegramClient.sendMessage).toHaveBeenCalledWith("That's already been applied.");
    // The executor is NEVER invoked a second time for the same plan.
    expect(refineExecuteModule.executeRefinement).toHaveBeenCalledTimes(1);
  });

  it('reports "already been applied" when no plan matches the tapped planId at all', async () => {
    // Nothing resolves for this planId at the DB level — getPendingPlan is
    // never even reached (short-circuits on the falsy `active`).
    vi.mocked(intakeDb.getIntakeByPendingPlanId).mockResolvedValue(null);

    await handleRefineCallback('apply:some-old-id');

    expect(telegramClient.sendMessage).toHaveBeenCalledWith("That's already been applied.");
    expect(intakeDb.getPendingPlan).not.toHaveBeenCalled();
    expect(intakeDb.consumePlan).not.toHaveBeenCalled();
    expect(refineExecuteModule.executeRefinement).not.toHaveBeenCalled();
  });

  it('drops a stale action against fresh context, tells the user, and only applies the surviving action', async () => {
    vi.mocked(intakeDb.getIntakeByPendingPlanId).mockResolvedValue(makeIntake({ telegram_message_id: 555 }) as never);
    const staged = {
      actions: [
        { kind: 'set_music', music_track_id: 'track-GONE' }, // no longer in availableTracks
        { kind: 'set_voice', voice_id: 'voice-1' }, // still valid
      ] as RefineAction[],
      summary: 'Switch music and voice.',
    };
    vi.mocked(intakeDb.getPendingPlan).mockResolvedValue(staged);
    vi.mocked(intakeDb.consumePlan).mockResolvedValue(true);
    vi.mocked(refineContextModule.buildRefineContext).mockResolvedValue(makeCtx()); // only track-1 is valid
    vi.mocked(refineExecuteModule.executeRefinement).mockResolvedValue(
      makeResult({ steps: [{ action: 'set_voice', ok: true }], summary: '1 of 1 change(s) applied' }),
    );

    await handleRefineCallback('apply:plan-abc');

    expect(telegramClient.sendMessage).toHaveBeenCalledWith(expect.stringContaining('stale'));
    expect(refineExecuteModule.executeRefinement).toHaveBeenCalledWith('run-1', [
      { kind: 'set_voice', voice_id: 'voice-1' },
    ]);
  });

  it('reports nothing-to-apply and never calls the executor when every action drops on re-validation', async () => {
    vi.mocked(intakeDb.getIntakeByPendingPlanId).mockResolvedValue(makeIntake({ telegram_message_id: 555 }) as never);
    const staged = {
      actions: [{ kind: 'set_music', music_track_id: 'track-GONE' }] as RefineAction[],
      summary: 'Switch music.',
    };
    vi.mocked(intakeDb.getPendingPlan).mockResolvedValue(staged);
    vi.mocked(intakeDb.consumePlan).mockResolvedValue(true);
    vi.mocked(refineContextModule.buildRefineContext).mockResolvedValue(makeCtx());

    await handleRefineCallback('apply:plan-abc');

    expect(refineExecuteModule.executeRefinement).not.toHaveBeenCalled();
    expect(telegramClient.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Nothing left to apply'),
    );
  });
});

// ── FIX 3 — apply/adjust/cancel callbacks bind to the planId, never to
// "whichever intake is currently active" ────────────────────────────────────
//
// Regression coverage for the plan-binding race: getActiveRefineIntake()'s
// result can change between when a confirm card was sent and when the
// operator taps a button on it (a newer listing entering the eligible set
// mid-conversation). The callback handlers must resolve the intake to
// mutate from the planId embedded in the callback data (via
// getIntakeByPendingPlanId), never from "active" state — otherwise a tap on
// an OLD listing's confirm card could silently apply against a DIFFERENT,
// newer run.
describe('handleRefineCallback — FIX 3: resolves via planId, not "active" intake', () => {
  it('applies against the CORRECT (older) intake/run the plan was staged on, even though getActiveRefineIntake now resolves to a DIFFERENT, newer intake', async () => {
    const correctIntake = makeIntake({
      id: 'intake-old',
      delivery_run_id: 'run-old',
      telegram_message_id: 555,
      created_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const newerIntake = makeIntake({
      id: 'intake-new',
      delivery_run_id: 'run-new',
      created_at: new Date().toISOString(),
    });

    // A second listing entered the eligible set AFTER this plan was staged —
    // getActiveRefineIntake (ordered by created_at DESC) now resolves to IT,
    // not the intake the confirm card was actually built against.
    vi.mocked(intakeDb.getActiveRefineIntake).mockResolvedValue(newerIntake as never);
    // getIntakeByPendingPlanId still correctly resolves the OLD intake —
    // it looks up by planId, never by "whichever is active".
    vi.mocked(intakeDb.getIntakeByPendingPlanId).mockResolvedValue(correctIntake as never);

    const staged = { actions: [{ kind: 'set_music', music_track_id: 'track-1' }] as RefineAction[], summary: 'Switch music.' };
    vi.mocked(intakeDb.getPendingPlan).mockResolvedValue(staged);
    vi.mocked(intakeDb.consumePlan).mockResolvedValue(true);
    vi.mocked(refineContextModule.buildRefineContext).mockResolvedValue(makeCtx({ runId: 'run-old' }));
    vi.mocked(refineExecuteModule.executeRefinement).mockResolvedValue(
      makeResult({ steps: [{ action: 'set_music', ok: true }], rerendering: true, summary: '1 of 1 change(s) applied — re-rendered' }),
    );

    await handleRefineCallback('apply:plan-old');

    expect(intakeDb.getIntakeByPendingPlanId).toHaveBeenCalledWith('plan-old');
    expect(intakeDb.getPendingPlan).toHaveBeenCalledWith('intake-old', 'plan-old');
    expect(intakeDb.consumePlan).toHaveBeenCalledWith('intake-old', 'plan-old');
    expect(refineContextModule.buildRefineContext).toHaveBeenCalledWith('run-old');
    expect(refineExecuteModule.executeRefinement).toHaveBeenCalledWith('run-old', staged.actions);
    expect(refineExecuteModule.executeRefinement).not.toHaveBeenCalledWith('run-new', expect.anything());

    await flush();
    // The intake advanced back to 'generating' is the CORRECT (old) one.
    expect(intakeDb.setStatus).toHaveBeenCalledWith('intake-old', 'generating');
    expect(intakeDb.setStatus).not.toHaveBeenCalledWith('intake-new', expect.anything());
  });
});

// ── handleRefineCallback — adjust / cancel ──────────────────────────────────

describe('handleRefineCallback — adjust', () => {
  it('clears the pending plan and asks what to change', async () => {
    vi.mocked(intakeDb.getIntakeByPendingPlanId).mockResolvedValue(makeIntake() as never);
    vi.mocked(intakeDb.getPendingPlan).mockResolvedValue({ actions: [], summary: 'x' });

    await handleRefineCallback('adjust:plan-abc');

    expect(intakeDb.clearPendingPlan).toHaveBeenCalledWith('intake-1');
    expect(telegramClient.sendMessage).toHaveBeenCalledWith('Sure — tell me what to change.');
  });

  it('does not clear a different, newer plan when the tapped planId no longer matches', async () => {
    // Nothing resolves for this planId — getPendingPlan is never reached.
    vi.mocked(intakeDb.getIntakeByPendingPlanId).mockResolvedValue(null);

    await handleRefineCallback('adjust:stale-id');

    expect(intakeDb.getPendingPlan).not.toHaveBeenCalled();
    expect(intakeDb.clearPendingPlan).not.toHaveBeenCalled();
    expect(telegramClient.sendMessage).toHaveBeenCalledWith("That plan isn't pending anymore.");
  });
});

describe('handleRefineCallback — cancel', () => {
  it('clears the pending plan and strips buttons on the original message', async () => {
    vi.mocked(intakeDb.getIntakeByPendingPlanId).mockResolvedValue(makeIntake({ telegram_message_id: 777 }) as never);
    vi.mocked(intakeDb.getPendingPlan).mockResolvedValue({ actions: [], summary: 'x' });

    await handleRefineCallback('cancel:plan-abc');

    expect(intakeDb.clearPendingPlan).toHaveBeenCalledWith('intake-1');
    expect(telegramClient.editMessageText).toHaveBeenCalledWith(777, 'Cancelled.', { buttons: [] });
    expect(telegramClient.sendMessage).not.toHaveBeenCalled();
  });

  it('falls back to a plain sendMessage when there is no message id to edit', async () => {
    vi.mocked(intakeDb.getIntakeByPendingPlanId).mockResolvedValue(makeIntake({ telegram_message_id: null }) as never);
    vi.mocked(intakeDb.getPendingPlan).mockResolvedValue({ actions: [], summary: 'x' });

    await handleRefineCallback('cancel:plan-abc');

    expect(telegramClient.sendMessage).toHaveBeenCalledWith('Cancelled.');
  });
});

// ── applyPlan — the locked executor wrapper ─────────────────────────────────

describe('applyPlan', () => {
  it('acquires the refining lock, executes, re-arms the poller on a successful re-render, and releases the lock it acquired', async () => {
    const { client, updates } = makeFakeRunsDb(true);
    vi.mocked(getSupabase).mockReturnValue(client as never);
    vi.mocked(refineExecuteModule.executeRefinement).mockResolvedValue(
      makeResult({ steps: [{ action: 'set_music', ok: true }], rerendering: true, summary: '1 of 1 change(s) applied — re-rendered' }),
    );

    const summary = await applyPlan(makeIntake() as never, 'run-1', [{ kind: 'set_music', music_track_id: 'track-1' }]);

    expect(intakeDb.setStatus).toHaveBeenCalledWith('intake-1', 'generating');
    expect(intakeDb.setLastPausedReason).toHaveBeenCalledWith('intake-1', null);
    expect(summary).toContain("I'll send the updated video when it's ready");

    // First update = acquire (paused_reason -> 'refining', gated by .or()).
    expect(updates[0].patch.paused_reason).toBe('refining');
    expect(updates[0].orArgs.length).toBe(1);
    // Second update = release (paused_reason -> null, CAS'd on the exact
    // 'refining' value this call itself set).
    expect(updates[1].patch.paused_reason).toBeNull();
    expect(updates[1].eqArgs).toContainEqual(['paused_reason', 'refining']);
  });

  it('force-clears a pre-existing pause (not CAS-gated) when the lock was never ours but a re-render just succeeded', async () => {
    const { client, updates } = makeFakeRunsDb(false); // acquire fails: run was already paused for a real reason
    vi.mocked(getSupabase).mockReturnValue(client as never);
    vi.mocked(refineExecuteModule.executeRefinement).mockResolvedValue(
      makeResult({ steps: [{ action: 'set_music', ok: true }], rerendering: true, summary: '1 of 1 change(s) applied — re-rendered' }),
    );

    await applyPlan(makeIntake() as never, 'run-1', [{ kind: 'set_music', music_track_id: 'track-1' }]);

    expect(updates).toHaveLength(2);
    expect(updates[1].patch.paused_reason).toBeNull();
    // Force-clear has NO paused_reason CAS condition — it unconditionally
    // clears by run id only (the pre-existing pause wasn't ours to CAS against).
    expect(updates[1].eqArgs).toEqual([['id', 'run-1']]);
  });

  it('leaves a genuine pre-existing pause untouched when nothing render-affecting happened', async () => {
    const { client, updates } = makeFakeRunsDb(false); // acquire fails
    vi.mocked(getSupabase).mockReturnValue(client as never);
    vi.mocked(refineExecuteModule.executeRefinement).mockResolvedValue(
      makeResult({ steps: [{ action: 'set_voice', ok: true }], rerendering: false, summary: '1 of 1 change(s) applied' }),
    );

    await applyPlan(makeIntake() as never, 'run-1', [{ kind: 'set_voice', voice_id: 'voice-1' }]);

    // Only the (failed) acquire attempt — no release, no force-clear.
    expect(updates).toHaveLength(1);
    expect(intakeDb.setStatus).not.toHaveBeenCalled();
  });

  // ── BUG 1 — applyPlan must key off the REAL rerendering value ────────────

  it('BUG 1: a render-affecting action succeeding but the render submission itself failing (rerendering:false) never sets status=generating or clears last_paused_reason', async () => {
    const { client, updates } = makeFakeRunsDb(true); // this call acquires the lock
    vi.mocked(getSupabase).mockReturnValue(client as never);
    // Simulates refine-execute.ts's BUG 1 fix outcome (c): the mutation
    // landed but the render never actually started.
    vi.mocked(refineExecuteModule.executeRefinement).mockResolvedValue(
      makeResult({
        steps: [{ action: 'set_music', ok: true }],
        rerendering: false,
        summary: "1 of 1 change(s) applied — the re-render did not start — I've logged it; try again",
      }),
    );

    const summary = await applyPlan(makeIntake() as never, 'run-1', [{ kind: 'set_music', music_track_id: 'track-1' }]);

    expect(intakeDb.setStatus).not.toHaveBeenCalled();
    expect(intakeDb.setLastPausedReason).not.toHaveBeenCalled();
    // The lock THIS call itself acquired still releases normally on exit
    // (that's unconditional cleanup of OUR OWN lock, unrelated to the render
    // outcome) — but it must be the CAS'd release, never the unconditional
    // force-clear (force-clear is reserved for a pre-existing pause this call
    // never acquired — see the next test).
    expect(updates).toHaveLength(2);
    expect(updates[1].patch.paused_reason).toBeNull();
    expect(updates[1].eqArgs).toContainEqual(['paused_reason', 'refining']);
    // Humanized wording matches the honest, non-misleading phrasing.
    expect(summary).toBe("Applied your changes, but I couldn't start the re-render — I've logged it; try again.");
  });

  it('BUG 1: does not force-clear a pre-existing genuine pause when a render-affecting action succeeded but the render submission failed', async () => {
    const { client, updates } = makeFakeRunsDb(false); // acquire fails: genuinely paused already
    vi.mocked(getSupabase).mockReturnValue(client as never);
    vi.mocked(refineExecuteModule.executeRefinement).mockResolvedValue(
      makeResult({
        steps: [{ action: 'set_music', ok: true }],
        rerendering: false,
        summary: "1 of 1 change(s) applied — the re-render did not start — I've logged it; try again",
      }),
    );

    await applyPlan(makeIntake() as never, 'run-1', [{ kind: 'set_music', music_track_id: 'track-1' }]);

    expect(intakeDb.setStatus).not.toHaveBeenCalled();
    // Only the failed acquire attempt — no release, no force-clear of the
    // pre-existing pause (it was never rendered, so nothing to unstick).
    expect(updates).toHaveLength(1);
  });

  it('rewords a successful regenerate_clip step as "a couple minutes", never implying it is instant', async () => {
    vi.mocked(refineExecuteModule.executeRefinement).mockResolvedValue(
      makeResult({ steps: [{ action: 'regenerate_clip', ok: true }], rerendering: false, summary: '1 of 1 change(s) applied' }),
    );

    const summary = await applyPlan(makeIntake() as never, 'run-1', [{ kind: 'regenerate_clip', sceneId: 'scene-1' }]);

    expect(summary).toContain('a couple minutes');
  });

  it('rewords a too-early-to-render note into a plain "saved for later" message', async () => {
    vi.mocked(refineExecuteModule.executeRefinement).mockResolvedValue(
      makeResult({
        steps: [{ action: 'flip_winner', ok: true }],
        rerendering: false,
        summary:
          "1 of 1 change(s) applied — changes saved — the run is at 'checkpoint_a', too early to render yet; they'll apply once it reaches assembly",
      }),
    );

    const summary = await applyPlan(makeIntake() as never, 'run-1', [{ kind: 'flip_winner', sceneId: 'scene-1' }]);

    expect(summary).toBe("That change is saved — it'll apply once the video reaches the render stage.");
  });

  it('releases the lock and returns a friendly (sanitized) error if executeRefinement itself throws — L3', async () => {
    const { client, updates } = makeFakeRunsDb(true);
    vi.mocked(getSupabase).mockReturnValue(client as never);
    vi.mocked(refineExecuteModule.executeRefinement).mockRejectedValue(new Error('run vanished'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const summary = await applyPlan(makeIntake() as never, 'run-1', [{ kind: 'set_voice', voice_id: 'voice-1' }]);

    // L3 — the raw internal error text must never reach the chat surface.
    expect(summary).not.toContain('run vanished');
    expect(summary).toBe("Hit a snag applying that — I've logged it; try again.");
    // ...but it IS logged loudly, so it's diagnosable without re-running.
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('executeRefinement threw'), expect.any(Error));
    expect(updates).toHaveLength(2); // acquire + release, even on failure
    expect(updates[1].patch.paused_reason).toBeNull();
    errSpy.mockRestore();
  });

  it('rewords a regenerate_clip-ONLY batch to the full honest phrase, with no redundant terse count tail (P1-3)', async () => {
    vi.mocked(refineExecuteModule.executeRefinement).mockResolvedValue(
      makeResult({ steps: [{ action: 'regenerate_clip', ok: true }], rerendering: false, summary: '1 of 1 change(s) applied' }),
    );

    const summary = await applyPlan(makeIntake() as never, 'run-1', [{ kind: 'regenerate_clip', sceneId: 'scene-1' }]);

    expect(summary).toBe("Regenerating that clip — takes a couple minutes. I'll let you know when it lands so you can review it.");
    // Never claims an updated video is on the way, and never bolts the raw
    // terse count onto the end of the honest note.
    expect(summary).not.toContain('updated video');
    expect(summary).not.toContain('change(s) applied');
  });

  it('a mixed batch (regenerate_clip + a genuinely render-affecting action) still shows both the clip note and the render note', async () => {
    vi.mocked(refineExecuteModule.executeRefinement).mockResolvedValue(
      makeResult({
        steps: [
          { action: 'regenerate_clip', ok: true },
          { action: 'set_music', ok: true },
        ],
        rerendering: true,
        summary: '2 of 2 change(s) applied — re-rendered',
      }),
    );

    const summary = await applyPlan(makeIntake() as never, 'run-1', [
      { kind: 'regenerate_clip', sceneId: 'scene-1' },
      { kind: 'set_music', music_track_id: 'track-2' },
    ]);

    expect(summary).toContain('takes a couple minutes');
    expect(summary).toContain("I'll send the updated video when it's ready");
  });
});

// ── L2 — concurrent-apply serialization ─────────────────────────────────────

describe('applyPlan — L2: concurrent-apply serialization', () => {
  it('refuses and asks the operator to wait when another apply currently holds the "refining" lock', async () => {
    const { client, updates } = makeFakeRunsDb(false); // acquire fails
    vi.mocked(getSupabase).mockReturnValue(client as never);
    vi.mocked(runsModule.getRun).mockResolvedValue({ id: 'run-1', paused_reason: 'refining' } as never);

    const summary = await applyPlan(makeIntake() as never, 'run-1', [{ kind: 'set_voice', voice_id: 'voice-1' }]);

    expect(summary).toBe("I'm still applying your last change — give me a moment.");
    // Never touches executeRefinement — no double-render, no double cap-spend.
    expect(refineExecuteModule.executeRefinement).not.toHaveBeenCalled();
    // Only the failed acquire attempt happened — no release, no force-clear.
    expect(updates).toHaveLength(1);
  });

  it('proceeds (does not refuse) when the run is genuinely human-paused for some OTHER reason', async () => {
    const { client } = makeFakeRunsDb(false); // acquire fails
    vi.mocked(getSupabase).mockReturnValue(client as never);
    vi.mocked(runsModule.getRun).mockResolvedValue({ id: 'run-1', paused_reason: 'missing listing field: price' } as never);
    vi.mocked(refineExecuteModule.executeRefinement).mockResolvedValue(
      makeResult({ steps: [{ action: 'set_voice', ok: true }], rerendering: false, summary: '1 of 1 change(s) applied' }),
    );

    const summary = await applyPlan(makeIntake() as never, 'run-1', [{ kind: 'set_voice', voice_id: 'voice-1' }]);

    expect(refineExecuteModule.executeRefinement).toHaveBeenCalledWith('run-1', [{ kind: 'set_voice', voice_id: 'voice-1' }]);
    expect(summary).toBe('1 of 1 change(s) applied');
  });
});
