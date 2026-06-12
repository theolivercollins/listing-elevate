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

const mockGenerateContent = vi.fn();
const mockUpload = vi.fn();
const mockDeleteFile = vi.fn();

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
  getRun: vi.fn().mockResolvedValue({ id: 'r1', stage: 'judging', property_id: 'p1' }),
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
  process.env.GEMINI_API_KEY = 'test-key';
  mockUpload.mockResolvedValue({ name: 'files/test', uri: 'https://generativelanguage.googleapis.com/v1beta/files/test', mimeType: 'video/mp4' });
  mockDeleteFile.mockResolvedValue(undefined);
});

describe('runJudgePass winner_source marking', () => {
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
