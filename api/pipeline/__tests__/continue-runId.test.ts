/**
 * Tests for POST /api/pipeline/continue/[runId] — the decoupled post-approval
 * generation hop (site (d) of the four generating-stage (re)fire sites).
 *
 * This hop now routes through the SHARED per-run resolve lease
 * (resumeGeneratingUnderLease → withResolveLease). resume-generation.ts and
 * resolve-lease.ts run for REAL here; only their leaf deps are mocked:
 *   - lib/client.getSupabase → a faked CAS db that grants / withholds the lease
 *   - lib/pipeline.continuePipelineAfterPhotoSelection → a spy (the heavy compute)
 *   - lib/delivery/runs.{getRun,setRunError} → spies
 *
 * The load-bearing regression: on a FRESH run the lease is free → the hop still
 * fires continuePipelineAfterPhotoSelection exactly as before (no behavior change
 * to the core generation path). Plus: a held lease no-ops without double-firing,
 * and a thrown compute still surfaces via setRunError.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../../lib/client.js';

// ── Leaf mocks (resume-generation + resolve-lease run for real) ────────────────
vi.mock('../../../lib/client', () => ({ getSupabase: vi.fn() }));

const mockContinuePipeline = vi.fn();
vi.mock('../../../lib/pipeline', () => ({
  continuePipelineAfterPhotoSelection: (...a: unknown[]) => mockContinuePipeline(...a),
}));

const mockGetRun = vi.fn();
const mockSetRunError = vi.fn();
vi.mock('../../../lib/delivery/runs', () => ({
  getRun: (...a: unknown[]) => mockGetRun(...a),
  setRunError: (...a: unknown[]) => mockSetRunError(...a),
}));

import handler from '../continue/[runId].js';

/** Faked CAS lease db (mirrors resolve-lease.test.ts::makeLeaseDb).
 *  Grants the lease at most `maxGrants` times. */
function makeLeaseDb(maxGrants: number) {
  let grants = 0;
  const claimSelect = vi.fn().mockImplementation(() =>
    Promise.resolve(
      grants < maxGrants
        ? ((grants += 1), { data: [{ id: 'run' }], error: null })
        : { data: [], error: null },
    ),
  );
  const releaseEq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockImplementation((patch: { resolving_at?: unknown }) => {
    if (patch && patch.resolving_at) {
      return { eq: () => ({ or: () => ({ is: () => ({ select: claimSelect }) }) }) };
    }
    return { eq: releaseEq };
  });
  return { from: vi.fn().mockReturnValue({ update }) };
}

function makeRes() {
  return {
    _status: 0,
    _body: {} as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
    setHeader() { return this; },
  };
}

const RUN_ID = '11111111-1111-1111-1111-111111111111';
const runRow = { id: RUN_ID, property_id: 'prop-1', stage: 'generating' };

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'POST',
    query: { runId: RUN_ID },
    headers: {},
    body: {},
    ...overrides,
  } as unknown as VercelRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetRun.mockResolvedValue(runRow);
  mockSetRunError.mockResolvedValue(undefined);
  mockContinuePipeline.mockResolvedValue(undefined);
});

describe('POST /api/pipeline/continue/[runId]', () => {
  // ── The load-bearing happy-path regression (site d) ──────────────────────────
  it('lease FREE (fresh run) → STILL fires continuePipelineAfterPhotoSelection normally, returns 200 complete', async () => {
    (getSupabase as Mock).mockReturnValue(makeLeaseDb(1));
    const res = makeRes();

    await handler(makeReq(), res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    expect((res._body as { status: string }).status).toBe('complete');
    // The core generation path is unchanged: continuePipeline fired with the
    // operator context keyed to this run's property + id.
    expect(mockContinuePipeline).toHaveBeenCalledTimes(1);
    expect(mockContinuePipeline).toHaveBeenCalledWith('prop-1', {
      order_mode: 'operator',
      delivery_run_id: RUN_ID,
    });
    expect(mockSetRunError).not.toHaveBeenCalled();
  });

  it('lease HELD by a concurrent (re)fire → no-op 200 in_progress, does NOT double-fire, does NOT error the run', async () => {
    (getSupabase as Mock).mockReturnValue(makeLeaseDb(0)); // never grants
    const res = makeRes();

    await handler(makeReq(), res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    expect((res._body as { status: string }).status).toBe('in_progress');
    expect(mockContinuePipeline).not.toHaveBeenCalled();
    expect(mockSetRunError).not.toHaveBeenCalled();
  });

  it('compute throws → setRunError + 500 (failure never silently stalls at generating)', async () => {
    (getSupabase as Mock).mockReturnValue(makeLeaseDb(1));
    mockContinuePipeline.mockRejectedValue(new Error('director scripting failed'));
    const res = makeRes();

    await handler(makeReq(), res as unknown as VercelResponse);

    expect(res._status).toBe(500);
    expect((res._body as { status: string }).status).toBe('failed');
    expect(mockSetRunError).toHaveBeenCalledWith(RUN_ID, expect.stringContaining('director scripting failed'));
  });

  it('unknown run → 404, no lease claim, no compute', async () => {
    mockGetRun.mockResolvedValue(null);
    (getSupabase as Mock).mockReturnValue(makeLeaseDb(1));
    const res = makeRes();

    await handler(makeReq(), res as unknown as VercelResponse);

    expect(res._status).toBe(404);
    expect(mockContinuePipeline).not.toHaveBeenCalled();
  });

  it('non-POST → 405', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
    expect(mockContinuePipeline).not.toHaveBeenCalled();
  });

  it('invalid (non-UUID) runId → 400, no compute', async () => {
    const res = makeRes();
    await handler(makeReq({ query: { runId: 'not-a-uuid' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
    expect(mockContinuePipeline).not.toHaveBeenCalled();
  });
});
