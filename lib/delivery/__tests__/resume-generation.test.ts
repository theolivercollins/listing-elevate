/**
 * Unit tests for lib/delivery/resume-generation.ts — resumeGeneratingUnderLease,
 * the shared mutex wrapper that funnels ALL four generating-stage (re)fire sites
 * (operator rerun/retry, stuck-reaper Path A, initial continue hop) through the
 * SAME per-run resolve lease (delivery_runs.resolving_at CAS) so scenes can never
 * be double-submitted (= duplicate paid provider jobs).
 *
 * withResolveLease is the REAL implementation here (backed by a faked CAS db, the
 * same way resolve-lease.test.ts fakes it). continuePipelineAfterPhotoSelection is
 * mocked so we can assert exactly how many times the heavy compute ran.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { getSupabase } from '../../client.js';
import { resumeGeneratingUnderLease } from '../resume-generation.js';

vi.mock('../../client.js', () => ({ getSupabase: vi.fn() }));

const mockContinuePipeline = vi.fn();
vi.mock('../../pipeline.js', () => ({
  continuePipelineAfterPhotoSelection: (...a: unknown[]) => mockContinuePipeline(...a),
}));

/** getSupabase mock whose CAS lease-claim grants at most `maxGrants` times.
 *  Mirrors resolve-lease.test.ts::makeLeaseDb (claim → update().eq().or().select();
 *  release → update().eq()). */
function makeLeaseDb(maxGrants: number) {
  let grants = 0;
  let releaseCount = 0;
  const claimSelect = vi.fn().mockImplementation(() =>
    Promise.resolve(
      grants < maxGrants
        ? ((grants += 1), { data: [{ id: 'run-1' }], error: null })
        : { data: [], error: null },
    ),
  );
  const releaseEq = vi.fn().mockImplementation(() => {
    releaseCount += 1;
    return Promise.resolve({ error: null });
  });
  const update = vi.fn().mockImplementation((patch: { resolving_at?: unknown }) => {
    if (patch && patch.resolving_at) {
      return { eq: () => ({ or: () => ({ is: () => ({ select: claimSelect }) }) }) };
    }
    return { eq: releaseEq };
  });
  return {
    db: { from: vi.fn().mockReturnValue({ update }) },
    getReleaseCount: () => releaseCount,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockContinuePipeline.mockResolvedValue(undefined);
});

describe('resumeGeneratingUnderLease', () => {
  it('lease FREE (fresh run) → claims, fires continuePipeline with the operator context, ran:true', async () => {
    const { db, getReleaseCount } = makeLeaseDb(1);
    (getSupabase as Mock).mockReturnValue(db);

    const outcome = await resumeGeneratingUnderLease('run-1', 'prop-1');

    expect(outcome).toEqual({ ran: true, result: undefined });
    expect(mockContinuePipeline).toHaveBeenCalledTimes(1);
    expect(mockContinuePipeline).toHaveBeenCalledWith('prop-1', {
      order_mode: 'operator',
      delivery_run_id: 'run-1',
    });
    // Lease acquired → released exactly once.
    expect(getReleaseCount()).toBe(1);
  });

  it('threads extraContext (e.g. rerun_stage) AFTER the two defaults', async () => {
    const { db } = makeLeaseDb(1);
    (getSupabase as Mock).mockReturnValue(db);

    await resumeGeneratingUnderLease('run-1', 'prop-1', { rerun_stage: 'generating' });

    expect(mockContinuePipeline).toHaveBeenCalledWith('prop-1', {
      order_mode: 'operator',
      delivery_run_id: 'run-1',
      rerun_stage: 'generating',
    });
  });

  it('lease HELD → ran:false and continuePipeline is NEVER invoked (no double-submit)', async () => {
    const { db, getReleaseCount } = makeLeaseDb(0); // never grants → lost the race
    (getSupabase as Mock).mockReturnValue(db);

    const outcome = await resumeGeneratingUnderLease('run-1', 'prop-1');

    expect(outcome).toEqual({ ran: false });
    expect(mockContinuePipeline).not.toHaveBeenCalled();
    // Never acquired → must NOT release (would clear the real holder's lease).
    expect(getReleaseCount()).toBe(0);
  });

  it('TWO concurrent (re)fires for one run → EXACTLY ONE runs continuePipeline; the other gets ran:false', async () => {
    const { db, getReleaseCount } = makeLeaseDb(1); // only ONE grant available
    (getSupabase as Mock).mockReturnValue(db);

    let ranCount = 0;
    mockContinuePipeline.mockImplementation(async () => {
      await Promise.resolve();
      ranCount += 1;
    });

    const [a, b] = await Promise.all([
      resumeGeneratingUnderLease('run-1', 'prop-1'),
      resumeGeneratingUnderLease('run-1', 'prop-1'),
    ]);

    expect([a, b].filter((o) => o.ran).length).toBe(1);
    expect([a, b].filter((o) => !o.ran).length).toBe(1);
    expect(ranCount).toBe(1);
    expect(mockContinuePipeline).toHaveBeenCalledTimes(1);
    expect(getReleaseCount()).toBe(1); // only the winner releases
    // Generous explicit timeout: this is the only real-async (Promise.all +
    // dynamic import) test in the file; under full-suite fork contention the
    // default 5s can be starved. The assertion itself is deterministic.
  }, 20_000);

  it('propagates a continuePipeline throw and still releases the lease', async () => {
    const { db, getReleaseCount } = makeLeaseDb(1);
    (getSupabase as Mock).mockReturnValue(db);
    mockContinuePipeline.mockRejectedValue(new Error('director scripting failed'));

    await expect(resumeGeneratingUnderLease('run-1', 'prop-1')).rejects.toThrow(
      'director scripting failed',
    );
    expect(getReleaseCount()).toBe(1);
  });
});
