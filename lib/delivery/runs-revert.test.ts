import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Supabase mock ────────────────────────────────────────────────────────────
// Mirror the pattern used by runs.test.ts: a single chain object where every
// method returns itself so we can override individual calls per test.

const mockChain: Record<string, ReturnType<typeof vi.fn>> = {};
for (const m of ['from', 'select', 'insert', 'update', 'eq', 'order', 'maybeSingle', 'single']) {
  mockChain[m] = vi.fn().mockReturnValue(mockChain);
}

vi.mock('../client.js', () => ({ getSupabase: () => mockChain }));

import { revertRun } from './runs';

// Helper: configure getRun (maybeSingle) and the CAS update result (maybeSingle)
// in the expected call order (getRun first, CAS second).
function setupMocks({
  getRunResult,
  casResult,
}: {
  getRunResult: { data: unknown; error: null } | { data: null; error: { message: string } };
  casResult?: { data: unknown; error: null } | { data: null; error: null };
}) {
  vi.clearAllMocks();
  for (const m of Object.keys(mockChain)) mockChain[m].mockReturnValue(mockChain);

  if (casResult !== undefined) {
    mockChain.maybeSingle
      .mockResolvedValueOnce(getRunResult)
      .mockResolvedValueOnce(casResult);
  } else {
    mockChain.maybeSingle.mockResolvedValue(getRunResult);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('revertRun — happy path', () => {
  it('moves the run strictly backward (judging -> scraping)', async () => {
    setupMocks({
      getRunResult: { data: { id: 'r1', stage: 'judging' }, error: null },
      casResult: { data: { id: 'r1', stage: 'scraping' }, error: null },
    });

    const row = await revertRun('r1', 'scraping');
    expect(row.stage).toBe('scraping');
    expect(mockChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'scraping', error: null }),
    );
    // CAS: WHERE stage = 'judging' (the from-stage).
    expect(mockChain.eq).toHaveBeenCalledWith('stage', 'judging');
  });

  it('moves the run one step back (checkpoint_a -> judging)', async () => {
    setupMocks({
      getRunResult: { data: { id: 'r1', stage: 'checkpoint_a' }, error: null },
      casResult: { data: { id: 'r1', stage: 'judging' }, error: null },
    });

    const row = await revertRun('r1', 'judging');
    expect(row.stage).toBe('judging');
  });

  it('allows jumping back multiple steps (delivered -> intake)', async () => {
    setupMocks({
      getRunResult: { data: { id: 'r1', stage: 'delivered' }, error: null },
      casResult: { data: { id: 'r1', stage: 'intake' }, error: null },
    });

    const row = await revertRun('r1', 'intake');
    expect(row.stage).toBe('intake');
  });
});

describe('revertRun — validation rejections (no DB write)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const m of Object.keys(mockChain)) mockChain[m].mockReturnValue(mockChain);
    // getRun returns a run in voiceover — same stage used across all rejection tests.
    mockChain.maybeSingle.mockResolvedValue({ data: { id: 'r1', stage: 'voiceover' }, error: null });
  });

  it('rejects an invalid stage string with "not a delivery stage"', async () => {
    await expect(revertRun('r1', 'bogus')).rejects.toThrow(/not a delivery stage/i);
    expect(mockChain.update).not.toHaveBeenCalled();
  });

  it('rejects a forward transition (voiceover -> music) with "illegal transition"', async () => {
    await expect(revertRun('r1', 'music')).rejects.toThrow(/illegal transition/i);
    expect(mockChain.update).not.toHaveBeenCalled();
  });

  it('rejects same-stage transition (voiceover -> voiceover) with "illegal transition"', async () => {
    await expect(revertRun('r1', 'voiceover')).rejects.toThrow(/illegal transition/i);
    expect(mockChain.update).not.toHaveBeenCalled();
  });
});

describe('revertRun — CAS conflict (stage moved)', () => {
  it('throws "stage moved" when the CAS update matches no row', async () => {
    // getRun says judging, but by the time the UPDATE fires, another actor
    // has already moved the run → the .eq('stage', 'judging') filter matches
    // nothing and maybeSingle returns null.
    setupMocks({
      getRunResult: { data: { id: 'r1', stage: 'judging' }, error: null },
      casResult: { data: null, error: null },
    });

    await expect(revertRun('r1', 'scraping')).rejects.toThrow(/stage moved/i);
  });
});
