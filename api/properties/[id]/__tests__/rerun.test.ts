/**
 * Tests for POST /api/properties/:id/rerun
 *
 * Success criteria:
 *  - no token → 401 (F3 auth gate)
 *  - valid token but non-owner non-admin → 403 (F3 ownership gate)
 *  - owner → performs reset (200)
 *  - admin (not the owner) → performs reset (200)
 *  - rerun does NOT delete pipeline_logs
 *  - rerun nulls scene_id on pipeline_logs BEFORE deleting scenes
 *  - rerun still deletes scenes (fresh video generation still happens)
 *  - rerun resets property fields and sets status to 'queued'
 *  - rerun logs a tombstone marker via log()
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Auth mock ────────────────────────────────────────────────────────────────

const mockVerifyAuth = vi.fn();

vi.mock('../../../../lib/auth', () => ({
  verifyAuth: (...args: unknown[]) => mockVerifyAuth(...args),
}));

// ── DB mock ──────────────────────────────────────────────────────────────────

const mockLog = vi.fn();
const mockGetProperty = vi.fn();
const mockUpdatePropertyStatus = vi.fn();
const mockGetSupabase = vi.fn();

vi.mock('../../../../lib/db.js', () => ({
  getProperty: (...args: unknown[]) => mockGetProperty(...args),
  updatePropertyStatus: (...args: unknown[]) => mockUpdatePropertyStatus(...args),
  log: (...args: unknown[]) => mockLog(...args),
  getSupabase: () => mockGetSupabase(),
}));

import handler from '../rerun.js';

// ── Auth fixtures ─────────────────────────────────────────────────────────────

const ownerUserId = 'user-owner-123';

const ownerAuth = {
  user: { id: ownerUserId, email: 'owner@test.com' },
  profile: { role: 'user' as const },
};
const adminAuth = {
  user: { id: 'user-admin-789', email: 'admin@test.com' },
  profile: { role: 'admin' as const },
};
const strangerAuth = {
  user: { id: 'user-other-456', email: 'stranger@test.com' },
  profile: { role: 'user' as const },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Tracks the order and args of every Supabase chain call. */
type Call = { table: string; method: string; args: unknown[] };

interface MakeSupabaseOpts {
  /** If set, the pipeline_logs update chain resolves with this error. */
  pipelineLogsUpdateError?: { message: string; code?: string } | null;
}

function makeSupabase(opts: MakeSupabaseOpts = {}): {
  supabase: ReturnType<typeof mockGetSupabase>;
  calls: Call[];
} {
  const calls: Call[] = [];

  // Build a re-usable chainable builder that records every call.
  // `thenResult` controls what the chain resolves to when awaited.
  function makeChain(table: string, thenResult: { data: null; error: unknown }) {
    const chain: Record<string, unknown> = {};

    const record =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      };

    chain.update = record('update');
    chain.delete = record('delete');
    chain.eq = record('eq');
    // Make the chain thenable so `await chain` resolves cleanly.
    chain.then = (resolve: (v: typeof thenResult) => unknown) =>
      Promise.resolve(resolve(thenResult));

    return chain;
  }

  const supabase = {
    from: (table: string) => {
      calls.push({ table, method: 'from', args: [table] });
      const error =
        table === 'pipeline_logs' && opts.pipelineLogsUpdateError !== undefined
          ? opts.pipelineLogsUpdateError
          : null;
      return makeChain(table, { data: null, error });
    },
  };

  return { supabase, calls };
}

function makeRes() {
  return {
    _status: 0,
    _body: {} as unknown,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(body: unknown) {
      this._body = body;
      return this;
    },
    setHeader() {
      return this;
    },
  };
}

function makeReq(id = 'prop-uuid-1'): VercelRequest {
  return {
    method: 'POST',
    query: { id },
    headers: {},
  } as unknown as VercelRequest;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: authenticated as the property owner so all existing wipe-logic tests pass.
  mockVerifyAuth.mockResolvedValue(ownerAuth);
  // Include submitted_by so the ownership gate resolves correctly for ownerAuth.
  mockGetProperty.mockResolvedValue({ id: 'prop-uuid-1', submitted_by: ownerUserId });
  mockUpdatePropertyStatus.mockResolvedValue(undefined);
  mockLog.mockResolvedValue(undefined);
  // Arm the env write-guard so the destructive wipe path is reachable in tests.
  process.env.LE_ALLOW_NONPROD_WRITES = 'true';
});

describe('POST /api/properties/:id/rerun — log preservation', () => {
  it('does NOT delete pipeline_logs', async () => {
    const { supabase, calls } = makeSupabase();
    mockGetSupabase.mockReturnValue(supabase);

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);

    const deletedTables = calls
      .filter((c) => c.method === 'delete')
      .map((c) => c.table);

    expect(deletedTables).not.toContain('pipeline_logs');
  });

  it('nulls scene_id on pipeline_logs before deleting scenes', async () => {
    const { supabase, calls } = makeSupabase();
    mockGetSupabase.mockReturnValue(supabase);

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);

    // Find the pipeline_logs update and the scenes delete positions in the call log.
    const logsUpdateIdx = calls.findIndex(
      (c) => c.table === 'pipeline_logs' && c.method === 'update',
    );
    const scenesDeleteIdx = calls.findIndex(
      (c) => c.table === 'scenes' && c.method === 'delete',
    );

    expect(logsUpdateIdx).toBeGreaterThanOrEqual(0);
    expect(scenesDeleteIdx).toBeGreaterThanOrEqual(0);

    // NULL-first recipe: pipeline_logs update must precede scenes delete.
    expect(logsUpdateIdx).toBeLessThan(scenesDeleteIdx);

    // Confirm the update payload contains scene_id: null.
    const updateCall = calls[logsUpdateIdx];
    expect(updateCall.args[0]).toEqual({ scene_id: null });
  });

  it('still deletes scenes so rerun produces a fresh video', async () => {
    const { supabase, calls } = makeSupabase();
    mockGetSupabase.mockReturnValue(supabase);

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);

    const deletedTables = calls
      .filter((c) => c.method === 'delete')
      .map((c) => c.table);

    expect(deletedTables).toContain('scenes');
  });

  it('logs a tombstone marker via log()', async () => {
    const { supabase } = makeSupabase();
    mockGetSupabase.mockReturnValue(supabase);

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);

    expect(mockLog).toHaveBeenCalledOnce();
    const [propId, stage, level, msg] = mockLog.mock.calls[0] as [
      string,
      string,
      string,
      string,
    ];
    expect(propId).toBe('prop-uuid-1');
    expect(stage).toBe('intake');
    expect(level).toBe('info');
    expect(msg).toMatch(/rerun initiated/i);
  });

  it('resets property fields and queues the property', async () => {
    const { supabase } = makeSupabase();
    mockGetSupabase.mockReturnValue(supabase);

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);

    expect(mockUpdatePropertyStatus).toHaveBeenCalledWith('prop-uuid-1', 'queued');
    expect(res._status).toBe(200);
    expect((res._body as { status: string }).status).toBe('queued');
  });

  it('returns 405 for non-POST requests', async () => {
    const res = makeRes();
    await handler(
      { method: 'GET', query: { id: 'p1' }, headers: {} } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(405);
  });

  it('aborts before scenes.delete() when pipeline_logs null-update errors', async () => {
    // Arrange: pipeline_logs UPDATE returns an error so the null-first guard fires.
    const dbError = { message: 'FK constraint', code: '23503' };
    const { supabase, calls } = makeSupabase({ pipelineLogsUpdateError: dbError });
    mockGetSupabase.mockReturnValue(supabase);

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);

    // The handler must surface a 500 (not 200).
    expect(res._status).toBe(500);

    // scenes.delete() must NOT have been called — logs must be safe.
    const scenesDeleteCalled = calls.some(
      (c) => c.table === 'scenes' && c.method === 'delete',
    );
    expect(scenesDeleteCalled).toBe(false);
  });
});

// ── F3 auth-gate tests ────────────────────────────────────────────────────────

describe('POST /api/properties/:id/rerun — auth gate (F3)', () => {
  it('returns 401 when no auth token is provided', async () => {
    mockVerifyAuth.mockResolvedValue(null);

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);

    expect(res._status).toBe(401);
    expect((res._body as { error: string }).error).toBe('Unauthorized');
    // Supabase must never be touched — wipe logic must not run unauthenticated.
    expect(mockGetSupabase).not.toHaveBeenCalled();
  });

  it('returns 403 when caller is authenticated but is not the owner and not an admin', async () => {
    mockVerifyAuth.mockResolvedValue(strangerAuth);
    const { supabase } = makeSupabase();
    mockGetSupabase.mockReturnValue(supabase);

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);

    expect(res._status).toBe(403);
    expect((res._body as { error: string }).error).toBe('Forbidden');
    // Wipe logic (getSupabase → supabase.from) must not execute for non-owners.
    expect(mockGetSupabase).not.toHaveBeenCalled();
  });

  it('allows the property owner to reset (200)', async () => {
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    const { supabase } = makeSupabase();
    mockGetSupabase.mockReturnValue(supabase);

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    expect((res._body as { status: string }).status).toBe('queued');
  });

  it('allows an admin (non-owner) to reset (200)', async () => {
    mockVerifyAuth.mockResolvedValue(adminAuth);
    const { supabase } = makeSupabase();
    mockGetSupabase.mockReturnValue(supabase);

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    expect((res._body as { status: string }).status).toBe('queued');
  });
});
