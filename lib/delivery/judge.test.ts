import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks for the runJudgePass suite (hoisted above the dynamic import) ──

const updates: Array<{ table: string; id: string; patch: Record<string, unknown> }> = [];
let scenesData: Array<Record<string, unknown>> = [];

const fakeDb = {
  from(table: string) {
    return {
      select: () => ({
        eq: () => Promise.resolve({ data: table === 'scenes' ? scenesData : [], error: null }),
        in: () => Promise.resolve({ data: [], error: null }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: (_col: string, id: string) => {
          updates.push({ table, id, patch });
          return Promise.resolve({ data: null, error: null });
        },
      }),
    };
  },
};

// withJudgeRetry mock — hoisted so it's available when vi.mock factory runs.
// By default it passes through to fn() so existing tests are unaffected.
const { mockWithJudgeRetry } = vi.hoisted(() => {
  return { mockWithJudgeRetry: vi.fn(<T>(fn: () => Promise<T>) => fn()) };
});
vi.mock('../judge/retry', () => ({
  withJudgeRetry: (...args: Parameters<typeof mockWithJudgeRetry>) => mockWithJudgeRetry(...args),
}));

const mockGenerateContent = vi.fn();
const mockUpload = vi.fn();
const mockDeleteFile = vi.fn();
const mockGetRun = vi.fn().mockResolvedValue({ id: 'r1', stage: 'judging', property_id: 'p1' });

vi.mock('../client', () => ({ getSupabase: () => fakeDb }));
vi.mock('../db', () => ({
  recordCostEvent: vi.fn().mockResolvedValue(undefined),
  log: vi.fn().mockResolvedValue(undefined),
  updatePropertyStatus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../providers/gemini-judge', () => ({ geminiCostCents: () => 1 }));
vi.mock('../providers/gemini-files', () => ({
  uploadVideoToGeminiFiles: (...a: unknown[]) => mockUpload(...a),
  deleteGeminiFile: (...a: unknown[]) => mockDeleteFile(...a),
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: (...a: unknown[]) => mockGenerateContent(...a) };
  },
}));
vi.mock('./runs', () => ({
  getRun: (...a: unknown[]) => mockGetRun(...a),
  getVariantsForRun: (...a: unknown[]) => mockGetVariants(...a),
  advanceRun: vi.fn().mockResolvedValue(undefined),
  updateRun: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./order', () => ({ draftOrderForRun: vi.fn().mockResolvedValue(['s1']) }));

const mockGetVariants = vi.fn();

// Dynamic import so the vi.mock calls above are hoisted first.
const { scoreTotal, pickWinner, parseJudgeJson, runJudgePass } = await import('./judge');

const s = (motion: number, artifacts: number, realism: number, composition: number) =>
  ({ motion_quality: motion, artifacts, realism, composition });

describe('scoreTotal', () => {
  it('sums the four rubric dimensions', () => {
    expect(scoreTotal(s(4, 3, 5, 4))).toBe(16);
  });
});

describe('pickWinner', () => {
  it('higher total wins', () => {
    expect(pickWinner(s(4, 4, 4, 4), s(5, 5, 5, 5))).toBe('B');
    expect(pickWinner(s(5, 5, 5, 4), s(4, 4, 4, 4))).toBe('A');
  });
  it('tie goes to A (deterministic)', () => {
    expect(pickWinner(s(4, 4, 4, 4), s(4, 4, 4, 4))).toBe('A');
  });
  it('missing B scores -> A (degraded pair)', () => {
    expect(pickWinner(s(1, 1, 1, 1), null)).toBe('A');
  });
  it('missing A scores -> B', () => {
    expect(pickWinner(null, s(1, 1, 1, 1))).toBe('B');
  });
});

describe('parseJudgeJson', () => {
  it('parses fenced JSON and clamps to the rubric shape', () => {
    const parsed = parseJudgeJson('```json\n{"a":{"motion_quality":4,"artifacts":3,"realism":5,"composition":4},"b":{"motion_quality":2,"artifacts":2,"realism":2,"composition":2}}\n```');
    expect(parsed.a?.motion_quality).toBe(4);
    expect(parsed.b?.composition).toBe(2);
  });
  it('throws on non-JSON', () => {
    expect(() => parseJudgeJson('the better clip is A')).toThrow(/non-JSON/);
  });
});

// ── runJudgePass winner_source marking ──

const variantRow = (over: Partial<Record<string, unknown>>) => ({
  id: 'v?', delivery_run_id: 'r1', scene_id: 's1', variant: 'A',
  provider: 'atlas', provider_task_id: 'task', clip_url: null, cost_cents: 10,
  gemini_scores: null, winner: false, winner_source: null, degraded: false,
  error: null, created_at: '', updated_at: '', ...over,
});

const sceneRow = {
  id: 's1', scene_number: 1, photo_id: 'ph1', prompt: 'slow pan left',
  clip_url: 'https://x/a.mp4', generation_cost_cents: 5, status: 'complete',
};

const winnerUpdates = () => updates.filter((u) => u.table === 'scene_variants' && u.patch.winner === true);

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  scenesData = [sceneRow];
  mockGetRun.mockResolvedValue({ id: 'r1', stage: 'judging', property_id: 'p1' });
  process.env.GEMINI_API_KEY = 'test-key';
  mockUpload.mockResolvedValue({ name: 'files/test', uri: 'https://generativelanguage.googleapis.com/v1beta/files/test', mimeType: 'video/mp4' });
  mockDeleteFile.mockResolvedValue(undefined);
});

describe('runJudgePass winner_source marking', () => {
  it('returns ready:false before generation starts', async () => {
    mockGetRun.mockResolvedValue({ id: 'r1', stage: 'photo_selection', property_id: 'p1' });

    await expect(runJudgePass('r1')).resolves.toEqual({ ready: false });

    expect(mockGetVariants).not.toHaveBeenCalled();
  });

  it('judge failure (unparseable response) -> winner_source=default + judge_error in gemini_scores', async () => {
    mockGetVariants.mockResolvedValue([
      variantRow({ id: 'va', variant: 'A', clip_url: 'https://x/a.mp4' }),
      variantRow({ id: 'vb', variant: 'B', clip_url: 'https://x/b.mp4' }),
    ]);
    mockGenerateContent.mockResolvedValue({ text: 'clip A looks nicer to me' }); // parse failure

    const { ready } = await runJudgePass('r1');
    expect(ready).toBe(true);

    const wins = winnerUpdates();
    expect(wins).toHaveLength(1);
    expect(wins[0].id).toBe('va'); // defaults to A
    expect(wins[0].patch.winner_source).toBe('default'); // NOT 'gemini'
    expect(wins[0].patch.gemini_scores).toEqual({ judge_error: expect.stringMatching(/non-JSON/) });
  });

  it('degraded pair (B never landed) -> winner_source=default + degraded judge_error, no Gemini call', async () => {
    mockGetVariants.mockResolvedValue([
      variantRow({ id: 'va', variant: 'A', clip_url: 'https://x/a.mp4' }),
      variantRow({ id: 'vb', variant: 'B', clip_url: null, error: 'B submit failed', degraded: true }),
    ]);

    const { ready } = await runJudgePass('r1');
    expect(ready).toBe(true);
    expect(mockGenerateContent).not.toHaveBeenCalled();

    const wins = winnerUpdates();
    expect(wins).toHaveLength(1);
    expect(wins[0].id).toBe('va');
    expect(wins[0].patch.winner_source).toBe('default');
    expect(wins[0].patch.gemini_scores).toEqual({ judge_error: 'degraded pair — no judging possible' });
  });

  it('successfully judged pair keeps winner_source=gemini with real scores (no judge_error)', async () => {
    mockGetVariants.mockResolvedValue([
      variantRow({ id: 'va', variant: 'A', clip_url: 'https://x/a.mp4' }),
      variantRow({ id: 'vb', variant: 'B', clip_url: 'https://x/b.mp4' }),
    ]);
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ a: s(3, 3, 3, 3), b: s(5, 5, 5, 5) }),
    });

    const { ready } = await runJudgePass('r1');
    expect(ready).toBe(true);
    // Both clips were uploaded via the Files API (never raw URLs).
    expect(mockUpload).toHaveBeenCalledTimes(2);

    // Real per-variant scores written on both rows.
    const scoreWrites = updates.filter((u) => u.patch.gemini_scores && !('winner' in u.patch));
    expect(scoreWrites.map((u) => u.id).sort()).toEqual(['va', 'vb']);

    const wins = winnerUpdates();
    expect(wins).toHaveLength(1);
    expect(wins[0].id).toBe('vb'); // B scored higher
    expect(wins[0].patch.winner_source).toBe('gemini');
    expect(wins[0].patch.gemini_scores).toBeUndefined(); // scores already on the rows; no judge_error overwrite
  });

  it('preserves an operator winner pick — re-judge skips the pair, never overwrites', async () => {
    // Operator flipped the winner to A at checkpoint_a (winner_source='operator').
    // A subsequent re-judge (cron sweep / Back-to-judging / Rerun) must leave the
    // pick untouched: no Gemini call, no winner write for this pair.
    mockGetVariants.mockResolvedValue([
      variantRow({ id: 'va', variant: 'A', clip_url: 'https://x/a.mp4', winner: true, winner_source: 'operator' }),
      variantRow({ id: 'vb', variant: 'B', clip_url: 'https://x/b.mp4', winner: false }),
    ]);
    // Even if the judge WOULD pick B, the operator's choice must win.
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify({ a: s(1, 1, 1, 1), b: s(5, 5, 5, 5) }) });

    const { ready } = await runJudgePass('r1');
    expect(ready).toBe(true);
    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(winnerUpdates()).toHaveLength(0);
  });

  it('upload failure -> treated as judge failure (default + judge_error), never falls back to raw URL', async () => {
    mockGetVariants.mockResolvedValue([
      variantRow({ id: 'va', variant: 'A', clip_url: 'https://x/a.mp4' }),
      variantRow({ id: 'vb', variant: 'B', clip_url: 'https://x/b.mp4' }),
    ]);
    mockUpload.mockRejectedValue(new Error('Gemini Files upload: files/x state=FAILED'));

    await runJudgePass('r1');
    expect(mockGenerateContent).not.toHaveBeenCalled(); // no judging without uploaded media

    const wins = winnerUpdates();
    expect(wins).toHaveLength(1);
    expect(wins[0].patch.winner_source).toBe('default');
    expect(wins[0].patch.gemini_scores).toEqual({ judge_error: expect.stringMatching(/Files upload/) });
  });
});

// ── withJudgeRetry integration ──
//
// These tests verify that runJudgePass wraps judgePair with withJudgeRetry so
// that transient Gemini failures are retried before the default-A fallback fires.

describe('runJudgePass withJudgeRetry integration', () => {
  // vi.clearAllMocks() in the outer beforeEach resets mockWithJudgeRetry;
  // restore the pass-through default so non-override tests still work.
  beforeEach(() => {
    mockWithJudgeRetry.mockImplementation(<T>(fn: () => Promise<T>) => fn());
  });

  it('invokes withJudgeRetry for each ready pair — transient retry path is wired', async () => {
    mockGetVariants.mockResolvedValue([
      variantRow({ id: 'va', variant: 'A', clip_url: 'https://x/a.mp4' }),
      variantRow({ id: 'vb', variant: 'B', clip_url: 'https://x/b.mp4' }),
    ]);
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ a: s(4, 4, 4, 4), b: s(3, 3, 3, 3) }),
    });

    await runJudgePass('r1');

    // withJudgeRetry must have been called at least once (for the pair above).
    expect(mockWithJudgeRetry).toHaveBeenCalled();
  });

  it('a transient judgePair error retries via withJudgeRetry and a successful retry yields winner_source=gemini', async () => {
    mockGetVariants.mockResolvedValue([
      variantRow({ id: 'va', variant: 'A', clip_url: 'https://x/a.mp4' }),
      variantRow({ id: 'vb', variant: 'B', clip_url: 'https://x/b.mp4' }),
    ]);

    // First upload attempt (first call) raises a transient error;
    // second call (the retry pass-through) returns valid scores.
    let callCount = 0;
    mockGenerateContent.mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw new Error('HTTP 503 UNAVAILABLE');
      return Promise.resolve({ text: JSON.stringify({ a: s(2, 2, 2, 2), b: s(5, 5, 5, 5) }) });
    });

    // Let withJudgeRetry actually execute the real retry logic by restoring
    // the real implementation for this test.
    mockWithJudgeRetry.mockImplementationOnce(async <T>(fn: () => Promise<T>) => {
      // Simulate one retry: call fn twice — first throws, second succeeds.
      try {
        return await fn();
      } catch {
        return await fn(); // one retry
      }
    });

    const { ready } = await runJudgePass('r1');
    expect(ready).toBe(true);

    // After the simulated retry, B should win (higher scores) and winner_source=gemini.
    const wins = winnerUpdates();
    expect(wins).toHaveLength(1);
    expect(wins[0].id).toBe('vb');
    expect(wins[0].patch.winner_source).toBe('gemini');
    expect(wins[0].patch.gemini_scores).toBeUndefined();
  });

  it('when withJudgeRetry exhausts all retries (permanent error), runJudgePass defaults to winner=A with winner_source=default', async () => {
    mockGetVariants.mockResolvedValue([
      variantRow({ id: 'va', variant: 'A', clip_url: 'https://x/a.mp4' }),
      variantRow({ id: 'vb', variant: 'B', clip_url: 'https://x/b.mp4' }),
    ]);

    // withJudgeRetry re-throws after exhaustion — simulate that by throwing.
    mockWithJudgeRetry.mockRejectedValueOnce(new Error('Gemini RESOURCE_EXHAUSTED after all retries'));

    const { ready } = await runJudgePass('r1');
    expect(ready).toBe(true);

    const wins = winnerUpdates();
    expect(wins).toHaveLength(1);
    expect(wins[0].id).toBe('va'); // defaults to A on exhaustion
    expect(wins[0].patch.winner_source).toBe('default');
    expect((wins[0].patch.gemini_scores as Record<string, unknown>).judge_error).toMatch(/RESOURCE_EXHAUSTED/);
  });
});
