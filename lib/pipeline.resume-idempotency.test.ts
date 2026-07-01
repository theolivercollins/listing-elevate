/**
 * Idempotency + clarity coverage for the "Resume generation" path
 * (continuePipelineAfterPhotoSelection → runScripting → runGenerationSubmit).
 *
 * Two layers:
 *  1. Pure boundaries extracted from runGenerationSubmit / continuePipeline:
 *       - scenesNeedingSubmit — proves a resume re-submits ONLY scenes lacking
 *         provider_task_id AND clip_url, and leaves already-submitted /
 *         already-collected scenes untouched (idempotency (b) + (c)).
 *       - submitCompletionLog — proves the terminal log reflects REAL counts and
 *         never claims "all scenes submitted" when 0 were (clarity C.1).
 *       - resumeRunErrorAction — proves the operator-actionable balance error is
 *         set when 0 submitted + insufficient balance, cleared on real progress
 *         (clarity C.2).
 *  2. Integration via the exported continuePipelineAfterPhotoSelection (mock
 *     strategy mirrors pipeline.director-failure.test.ts): a resume on a run
 *     whose scenes already exist inserts NO duplicate scene rows (idempotency
 *     (a) — runScripting's existing-scenes guard) and still reaches the
 *     scene_variants submission path so the run can advance (idempotency (d)).
 *
 * NOT re-tested here (covered elsewhere / integration): the live provider
 * round-trip that submits a previously-unsubmitted scene and stamps
 * provider_task_id (lib/delivery/variants.failover.test.ts + the real submit
 * loop in runGenerationSubmit). We assert the observable contract at the
 * function boundaries we touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Anthropic SDK: never actually reached (scenes/style-guide already exist),
//    mocked so importing pipeline.ts is side-effect-free. ──
const mockMessagesCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: (...a: unknown[]) => mockMessagesCreate(...a) };
  }
  return { default: MockAnthropic };
});

vi.mock('./prompts/resolve.js', () => ({
  resolveProductionPrompt: vi.fn().mockResolvedValue({ source: 'compile_time', body: 'DIRECTOR', version: 0 }),
}));
vi.mock('./prompts/per-photo-retrieval.js', () => ({
  fetchPerPhotoRetrievalBundle: vi.fn().mockResolvedValue({ recipes: [], exemplars: [], losers: [] }),
  renderPerPhotoBlock: vi.fn().mockReturnValue(''),
}));

// ── ./delivery/variants.js: spy on the A/B submission (idempotency (d)). ──
const mockSubmitVariantsForProperty = vi.fn();
vi.mock('./delivery/variants.js', () => ({
  submitVariantsForProperty: (...a: unknown[]) => mockSubmitVariantsForProperty(...a),
}));

// ── ./db.js: importOriginal so real exports survive; stub the touched ones. ──
const mockRecordCostEvent = vi.fn();
const mockUpdatePropertyStatus = vi.fn();
const mockGetScenesForProperty = vi.fn();
const mockGetSelectedPhotos = vi.fn();
const mockGetProperty = vi.fn();
const mockLog = vi.fn();
const mockGetSupabase = vi.fn();
const mockInsertScenes = vi.fn();
const mockUpdateSceneStatus = vi.fn();

vi.mock('./db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db.js')>();
  return {
    ...actual,
    recordCostEvent: (...a: unknown[]) => mockRecordCostEvent(...a),
    updatePropertyStatus: (...a: unknown[]) => mockUpdatePropertyStatus(...a),
    getScenesForProperty: (...a: unknown[]) => mockGetScenesForProperty(...a),
    getSelectedPhotos: (...a: unknown[]) => mockGetSelectedPhotos(...a),
    getProperty: (...a: unknown[]) => mockGetProperty(...a),
    log: (...a: unknown[]) => mockLog(...a),
    getSupabase: (...a: unknown[]) => mockGetSupabase(...a),
    insertScenes: (...a: unknown[]) => mockInsertScenes(...a),
    updateSceneStatus: (...a: unknown[]) => mockUpdateSceneStatus(...a),
  };
});

import {
  continuePipelineAfterPhotoSelection,
  scenesNeedingSubmit,
  submitCompletionLog,
  resumeRunErrorAction,
  RESUME_BALANCE_ERROR,
  RESUME_PARTIAL_FAILURE_ERROR,
  type SubmitResult,
} from './pipeline.js';

// ─── Pure: scenesNeedingSubmit ────────────────────────────────────────────────

describe('scenesNeedingSubmit', () => {
  it('returns only scenes lacking BOTH provider_task_id and clip_url', () => {
    const scenes = [
      { id: 'a', provider_task_id: null, clip_url: null },       // unsubmitted → include
      { id: 'b', provider_task_id: 'task-b', clip_url: null },   // in-flight   → exclude
      { id: 'c', provider_task_id: null, clip_url: 'http://c' }, // collected   → exclude
      { id: 'd', provider_task_id: 'task-d', clip_url: 'http://d' }, // done    → exclude
      { id: 'e', provider_task_id: null, clip_url: null },       // unsubmitted → include
    ];
    expect(scenesNeedingSubmit(scenes).map((s) => s.id)).toEqual(['a', 'e']);
  });

  it('leaves a fully-submitted run untouched (empty resubmit set)', () => {
    const scenes = [
      { id: 'a', provider_task_id: 'task-a', clip_url: null },
      { id: 'b', provider_task_id: 'task-b', clip_url: 'http://b' },
    ];
    expect(scenesNeedingSubmit(scenes)).toEqual([]);
  });

  it('selects every scene of a stuck 402 run (all unsubmitted: no task_id, no clip)', () => {
    const scenes = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, provider_task_id: null, clip_url: null }));
    expect(scenesNeedingSubmit(scenes)).toHaveLength(12);
  });
});

// ─── Pure: submitCompletionLog ────────────────────────────────────────────────

const base: SubmitResult = { attempted: 0, submittedThisRound: 0, totalSubmitted: 0, failedAtSubmit: 0, insufficientBalance: false };

describe('submitCompletionLog', () => {
  it('info + "submitted" when this round made progress', () => {
    const out = submitCompletionLog({ ...base, attempted: 12, submittedThisRound: 12, totalSubmitted: 12 });
    expect(out.level).toBe('info');
    expect(out.message).toMatch(/12 scene\(s\) submitted to providers/i);
  });

  it('info when scenes were already submitted in a prior round (totalSubmitted>0, none this round)', () => {
    const out = submitCompletionLog({ ...base, attempted: 0, submittedThisRound: 0, totalSubmitted: 12 });
    expect(out.level).toBe('info');
  });

  it('does NOT claim "all scenes submitted" when 0 were, and names the balance cause', () => {
    const out = submitCompletionLog({ ...base, attempted: 12, submittedThisRound: 0, totalSubmitted: 0, failedAtSubmit: 12, insufficientBalance: true });
    expect(out.level).toBe('warn');
    expect(out.message).not.toMatch(/all scenes submitted/i);
    expect(out.message).toMatch(/no scenes submitted/i);
    expect(out.message).toMatch(/out of balance/i);
  });

  it('warns generically when 0 submitted for a non-balance reason', () => {
    const out = submitCompletionLog({ ...base, attempted: 5, submittedThisRound: 0, totalSubmitted: 0, failedAtSubmit: 5 });
    expect(out.level).toBe('warn');
    expect(out.message).not.toMatch(/out of balance/i);
  });

  // N1: a PARTIAL success (some submitted, some failed) must NOT log the fully
  // reassuring "N submitted… Cron will collect clips + assemble" info line — it
  // must warn and name the failures (and the balance cause when applicable).
  it('does NOT log the reassuring info line on a partial balance drain (5 submit, 7 × 402)', () => {
    const out = submitCompletionLog({ ...base, attempted: 12, submittedThisRound: 5, totalSubmitted: 5, failedAtSubmit: 7, insufficientBalance: true });
    expect(out.level).toBe('warn');
    expect(out.message).toMatch(/5 scene\(s\) submitted/i);
    expect(out.message).toMatch(/7 failed/i);
    expect(out.message).toMatch(/out of balance/i);
    // Must NOT reassure that the cron will just collect + assemble.
    expect(out.message).not.toMatch(/collect clips \+ assemble/i);
  });

  it('warns and names the failure count on a partial NON-balance drain (no balance note)', () => {
    const out = submitCompletionLog({ ...base, attempted: 12, submittedThisRound: 5, totalSubmitted: 5, failedAtSubmit: 7, insufficientBalance: false });
    expect(out.level).toBe('warn');
    expect(out.message).toMatch(/7 failed/i);
    expect(out.message).not.toMatch(/out of balance/i);
  });
});

// ─── Pure: resumeRunErrorAction ───────────────────────────────────────────────

describe('resumeRunErrorAction', () => {
  it('sets the operator-actionable balance error when 0 submitted + insufficient balance', () => {
    const action = resumeRunErrorAction({ ...base, attempted: 12, submittedThisRound: 0, insufficientBalance: true });
    expect(action).toEqual({ type: 'set', message: RESUME_BALANCE_ERROR });
    expect(RESUME_BALANCE_ERROR).toMatch(/out of balance/i);
    expect(RESUME_BALANCE_ERROR).toMatch(/resume/i);
  });

  it('clears the stale error once a resume actually submits scenes', () => {
    const action = resumeRunErrorAction({ ...base, attempted: 12, submittedThisRound: 12, totalSubmitted: 12 });
    expect(action).toEqual({ type: 'clear' });
  });

  it('does nothing when nothing was attempted and there is no balance failure', () => {
    const action = resumeRunErrorAction({ ...base, attempted: 0 });
    expect(action).toEqual({ type: 'none' });
  });

  it('does not misclassify a transient (non-balance) all-fail as a balance problem', () => {
    const action = resumeRunErrorAction({ ...base, attempted: 5, submittedThisRound: 0, insufficientBalance: false });
    expect(action).toEqual({ type: 'none' });
  });

  // M1: partial balance drain — 5 submit, then Atlas 402s the remaining 7. The
  // old logic cleared the error because submittedThisRound>0, hiding 7 dead
  // scenes and silently stalling the run. The balance error MUST be SET.
  it('SETS the balance error on a partial drain (some submitted, rest 402) — never clears', () => {
    const action = resumeRunErrorAction({
      ...base, attempted: 12, submittedThisRound: 5, totalSubmitted: 5, failedAtSubmit: 7, insufficientBalance: true,
    });
    expect(action).toEqual({ type: 'set', message: RESUME_BALANCE_ERROR });
    expect(action).not.toEqual({ type: 'clear' });
  });

  // M1 (non-balance partial): some submitted, some failed for a non-balance
  // reason → do NOT clear (the failed scenes are still dead); surface a
  // resume-actionable partial-failure error instead.
  it('SETS a partial-failure error when some submit and some fail for a non-balance reason', () => {
    const action = resumeRunErrorAction({
      ...base, attempted: 12, submittedThisRound: 5, totalSubmitted: 5, failedAtSubmit: 7, insufficientBalance: false,
    });
    expect(action).toEqual({ type: 'set', message: RESUME_PARTIAL_FAILURE_ERROR });
    expect(action).not.toEqual({ type: 'clear' });
  });

  it('clears only when progress was made AND nothing is left dead at submit', () => {
    const clean = resumeRunErrorAction({ ...base, attempted: 12, submittedThisRound: 12, totalSubmitted: 12, failedAtSubmit: 0 });
    expect(clean).toEqual({ type: 'clear' });
  });
});

// ─── Integration: resume is idempotent (no duplicate scenes; variants reached) ─

const PROP_ID = 'prop-resume-001';

describe('continuePipelineAfterPhotoSelection — resume idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Style-guide pass short-circuits (property already has a style_guide).
    mockGetProperty.mockResolvedValue({ id: PROP_ID, style_guide: 'built', pipeline_mode: 'v1', video_model_sku: null });
    // Scenes ALREADY exist and are already submitted → runScripting must no-op
    // (no insertScenes) and runGenerationSubmit must find nothing to re-submit.
    mockGetScenesForProperty.mockResolvedValue([
      { id: 's1', provider_task_id: 'task-1', clip_url: 'https://cdn/1.mp4', status: 'qc_pass', scene_number: 1 },
      { id: 's2', provider_task_id: 'task-2', clip_url: null, status: 'generating', scene_number: 2 },
      { id: 's3', provider_task_id: 'task-3', clip_url: 'https://cdn/3.mp4', status: 'qc_pass', scene_number: 3 },
    ]);
    mockGetSelectedPhotos.mockResolvedValue([]);
    // delivery_runs lookup inside the variants block resolves an active run.
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'order', 'limit', 'is', 'not', 'in']) chain[m] = vi.fn().mockReturnValue(chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'run-x' }, error: null });
    chain.single = vi.fn().mockResolvedValue({ data: { id: 'run-x' }, error: null });
    mockGetSupabase.mockReturnValue({ from: vi.fn().mockReturnValue(chain) });
    mockLog.mockResolvedValue(undefined);
    mockUpdatePropertyStatus.mockResolvedValue(undefined);
    mockRecordCostEvent.mockResolvedValue(undefined);
    mockSubmitVariantsForProperty.mockResolvedValue(undefined);
  });

  it('(a) inserts NO duplicate scenes when scenes already exist, and (d) still reaches the scene_variants submission', async () => {
    await continuePipelineAfterPhotoSelection(PROP_ID, { order_mode: 'operator' });

    // (a) runScripting's existing-scenes guard prevented any new scene rows.
    expect(mockInsertScenes).not.toHaveBeenCalled();
    // No director call was made either (short-circuited before the LLM).
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    // (d) the A/B variant submission path (needed to advance past 'generating')
    // was reached with the active run id.
    expect(mockSubmitVariantsForProperty).toHaveBeenCalledWith(PROP_ID, 'run-x');
  });

  it('(b/c) does not re-submit already-submitted scenes (no provider calls for a fully-submitted run)', async () => {
    await continuePipelineAfterPhotoSelection(PROP_ID, { order_mode: 'operator' });
    // Every existing scene already has a provider_task_id → scenesNeedingSubmit
    // is empty → the per-scene submit path never runs, so no scene status is
    // flipped to needs_review and no scene row is mutated for a resubmit.
    expect(mockUpdateSceneStatus).not.toHaveBeenCalled();
  });
});
