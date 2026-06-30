/**
 * Tests for POST /api/properties/:id/archive — auth + owner-gate + env write-guard (F4).
 *
 * Success criteria:
 *  - POST no auth                              → 401
 *  - POST non-owner non-admin token            → 403
 *  - POST owner token, non-prod, no unlock     → 200 skipped (write-guard)
 *  - POST owner token, LE_ALLOW_NONPROD_WRITES → 200 archived
 *  - POST admin token, LE_ALLOW_NONPROD_WRITES → 200 archived
 *  - POST owner token, unknown property        → 404
 *  - Non-POST method                           → 405
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Auth mock ─────────────────────────────────────────────────────────────────

const mockVerifyAuth = vi.fn();

vi.mock('../../../../lib/auth', () => ({
  verifyAuth: (...args: unknown[]) => mockVerifyAuth(...args),
  setNoStore: vi.fn(),
}));

// ── DB mock ───────────────────────────────────────────────────────────────────

const ownerUserId = 'user-owner-123';
const otherUserId = 'user-other-456';

const baseProperty = {
  id: 'prop-uuid-1',
  address: '1 Main St',
  status: 'complete',
  submitted_by: ownerUserId,
  created_at: '2026-01-01T00:00:00Z',
};

const mockGetProperty = vi.fn();

// Chainable Supabase builder for update().eq()
const mockSupabase = {
  from: () => mockSupabase,
  update: () => mockSupabase,
  eq: () => mockSupabase,
  then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
};

vi.mock('../../../../lib/db', () => ({
  getProperty: (...args: unknown[]) => mockGetProperty(...args),
  getSupabase: () => mockSupabase,
}));

import handler from '../archive.js';

// ── Auth fixtures ─────────────────────────────────────────────────────────────

const ownerAuth = {
  user: { id: ownerUserId, email: 'owner@test.com' },
  profile: { role: 'user' as const },
};
const adminAuth = {
  user: { id: 'user-admin-789', email: 'admin@test.com' },
  profile: { role: 'admin' as const },
};
const strangerAuth = {
  user: { id: otherUserId, email: 'stranger@test.com' },
  profile: { role: 'user' as const },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRes() {
  return {
    _status: 0,
    _body: {} as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
    setHeader() { return this; },
  };
}

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'POST',
    query: { id: 'prop-uuid-1' },
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

// ── Env guard helpers ─────────────────────────────────────────────────────────

const originalVercelEnv = process.env.VERCEL_ENV;
const originalAllowWrites = process.env.LE_ALLOW_NONPROD_WRITES;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetProperty.mockResolvedValue(baseProperty);
  // Default: non-prod with no unlock → write-guard will fire.
  delete process.env.VERCEL_ENV;
  delete process.env.LE_ALLOW_NONPROD_WRITES;
});

afterEach(() => {
  if (originalVercelEnv !== undefined) process.env.VERCEL_ENV = originalVercelEnv;
  else delete process.env.VERCEL_ENV;
  if (originalAllowWrites !== undefined) process.env.LE_ALLOW_NONPROD_WRITES = originalAllowWrites;
  else delete process.env.LE_ALLOW_NONPROD_WRITES;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/properties/:id/archive — auth guards (F4)', () => {
  it('returns 401 when no auth token is provided', async () => {
    mockVerifyAuth.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
  });

  it('returns 403 when caller is authenticated but is not the owner and not an admin', async () => {
    mockVerifyAuth.mockResolvedValue(strangerAuth);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(403);
  });

  it('returns 200 skipped (write-guard) when owner is authed in non-prod without override', async () => {
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect((res._body as { skipped: string }).skipped).toBe('non-prod');
  });

  it('returns 200 archived when LE_ALLOW_NONPROD_WRITES=true and owner is authed', async () => {
    process.env.LE_ALLOW_NONPROD_WRITES = 'true';
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect((res._body as { status: string }).status).toBe('archived');
  });

  it('returns 200 archived when admin is authed and writes are unlocked', async () => {
    process.env.LE_ALLOW_NONPROD_WRITES = 'true';
    mockVerifyAuth.mockResolvedValue(adminAuth);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect((res._body as { status: string }).status).toBe('archived');
  });

  it('returns 404 when the property does not exist', async () => {
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    mockGetProperty.mockRejectedValue(new Error('not found'));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
  });

  it('returns 405 for non-POST methods', async () => {
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
  });
});
