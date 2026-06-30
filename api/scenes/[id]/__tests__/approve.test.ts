/**
 * approve.test.ts
 *
 * Tests for POST /api/scenes/[id]/approve — F4 auth gate.
 *
 * 1. No token (requireAdmin returns null / sends 401) → handler returns without writing.
 * 2. Non-admin token (requireAdmin returns null / sends 403) → handler returns without writing.
 * 3. Admin + non-prod env without LE_ALLOW_NONPROD_WRITES → 200 skipped.
 * 4. Admin + non-prod env with LE_ALLOW_NONPROD_WRITES=true → proceeds and returns 200.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Auth mock ─────────────────────────────────────────────────────────────────
const mockRequireAdmin = vi.fn();
vi.mock('../../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

// ── DB mock ───────────────────────────────────────────────────────────────────
const mockUpdateSceneStatus = vi.fn().mockResolvedValue(undefined);
const mockLog = vi.fn().mockResolvedValue(undefined);

function makeSceneChain(sceneData: unknown) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.single = () => Promise.resolve({ data: sceneData, error: null });
  return chain;
}

const mockFrom = vi.fn();
vi.mock('../../../../lib/db', () => ({
  updateSceneStatus: (...args: unknown[]) => mockUpdateSceneStatus(...args),
  log: (...args: unknown[]) => mockLog(...args),
  getSupabase: () => ({ from: (...args: unknown[]) => mockFrom(...args) }),
}));

// ── Handler import (after mocks) ──────────────────────────────────────────────
const { default: handler } = await import('../approve.js');

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'POST',
    query: { id: 'scene-abc' },
    body: {},
    headers: { authorization: 'Bearer test-token' },
    ...overrides,
  } as unknown as VercelRequest;
}

function makeRes() {
  let currentStatus = 200;
  const calls: Array<{ status: number; body: unknown }> = [];
  const res = {
    status(s: number) { currentStatus = s; return res; },
    json(b: unknown) { calls.push({ status: currentStatus, body: b }); return res; },
    setHeader: vi.fn(),
    _calls: calls,
    _last() { return calls[calls.length - 1]; },
  };
  return res as unknown as VercelResponse & { _calls: typeof calls; _last(): typeof calls[0] };
}

const adminAuth = {
  user: { id: 'user-admin-1', email: 'admin@test.com' },
  profile: { role: 'admin' as const },
};

// ── Setup ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.VERCEL_ENV;
  delete process.env.LE_ALLOW_NONPROD_WRITES;
  mockFrom.mockImplementation(() => makeSceneChain({ property_id: 'prop-1', scene_number: 3 }));
});

afterEach(() => {
  delete process.env.VERCEL_ENV;
  delete process.env.LE_ALLOW_NONPROD_WRITES;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/scenes/[id]/approve — F4 auth gate', () => {
  it('returns 401 when no auth token provided (requireAdmin writes 401)', async () => {
    mockRequireAdmin.mockImplementation((_req: unknown, res: ReturnType<typeof makeRes>) => {
      res.status(401).json({ error: 'Unauthorized' });
      return Promise.resolve(null);
    });

    const res = makeRes();
    await handler(makeReq({ headers: {} }), res as unknown as VercelResponse);

    expect(res._last().status).toBe(401);
    expect(mockUpdateSceneStatus).not.toHaveBeenCalled();
  });

  it('returns 403 when non-admin user (requireAdmin writes 403)', async () => {
    mockRequireAdmin.mockImplementation((_req: unknown, res: ReturnType<typeof makeRes>) => {
      res.status(403).json({ error: 'Forbidden' });
      return Promise.resolve(null);
    });

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);

    expect(res._last().status).toBe(403);
    expect(mockUpdateSceneStatus).not.toHaveBeenCalled();
  });

  it('returns 200 skipped on non-prod without LE_ALLOW_NONPROD_WRITES', async () => {
    mockRequireAdmin.mockResolvedValue(adminAuth);
    process.env.VERCEL_ENV = 'preview';

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);

    const last = res._last();
    expect(last.status).toBe(200);
    expect((last.body as Record<string, unknown>).skipped).toBe('non-prod');
    expect(mockUpdateSceneStatus).not.toHaveBeenCalled();
  });

  it('proceeds and returns 200 on non-prod when LE_ALLOW_NONPROD_WRITES=true', async () => {
    mockRequireAdmin.mockResolvedValue(adminAuth);
    process.env.VERCEL_ENV = 'preview';
    process.env.LE_ALLOW_NONPROD_WRITES = 'true';

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);

    expect(mockUpdateSceneStatus).toHaveBeenCalledWith('scene-abc', 'qc_pass');
    const last = res._last();
    expect(last.status).toBe(200);
    expect((last.body as Record<string, unknown>).message).toBe('Scene approved');
  });
});
