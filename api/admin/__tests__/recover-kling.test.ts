/**
 * recover-kling.test.ts
 *
 * Tests for POST /api/admin/recover-kling — F4 auth gate.
 *
 * 1. No token (requireAdmin returns null / sends 401) → handler returns without spending credits.
 * 2. Non-admin token (requireAdmin returns null / sends 403) → handler returns without spending credits.
 * 3. Admin + non-prod env without LE_ALLOW_NONPROD_WRITES → 200 skipped.
 *
 * Note: the Kling/Bunny/Supabase calls are dynamic imports reached only AFTER
 * the auth + env guard, so these gate tests don't need to stub them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Auth mock ─────────────────────────────────────────────────────────────────
const mockRequireAdmin = vi.fn();
vi.mock('../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

// ── Handler import (after mocks) ──────────────────────────────────────────────
const { default: handler } = await import('../recover-kling.js');

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'POST',
    query: {},
    body: { propertyId: 'prop-test', taskIds: ['task-1'] },
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

// ── Setup ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.VERCEL_ENV;
  delete process.env.LE_ALLOW_NONPROD_WRITES;
});

afterEach(() => {
  delete process.env.VERCEL_ENV;
  delete process.env.LE_ALLOW_NONPROD_WRITES;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/recover-kling — F4 auth gate', () => {
  it('returns 401 when no auth token provided (requireAdmin writes 401)', async () => {
    mockRequireAdmin.mockImplementation((_req: unknown, res: ReturnType<typeof makeRes>) => {
      res.status(401).json({ error: 'Unauthorized' });
      return Promise.resolve(null);
    });

    const res = makeRes();
    await handler(makeReq({ headers: {} }), res as unknown as VercelResponse);

    expect(res._last().status).toBe(401);
  });

  it('returns 403 when non-admin user (requireAdmin writes 403)', async () => {
    mockRequireAdmin.mockImplementation((_req: unknown, res: ReturnType<typeof makeRes>) => {
      res.status(403).json({ error: 'Forbidden' });
      return Promise.resolve(null);
    });

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);

    expect(res._last().status).toBe(403);
  });

  it('returns 200 skipped on non-prod without LE_ALLOW_NONPROD_WRITES', async () => {
    mockRequireAdmin.mockResolvedValue({
      user: { id: 'user-admin-1', email: 'admin@test.com' },
      profile: { role: 'admin' as const },
    });
    process.env.VERCEL_ENV = 'preview';

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);

    const last = res._last();
    expect(last.status).toBe(200);
    expect((last.body as Record<string, unknown>).skipped).toBe('non-prod');
  });
});
