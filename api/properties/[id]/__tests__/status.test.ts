/**
 * Tests for PATCH /api/properties/:id/status auth guards.
 *
 * Success criteria (task 2-status-patch-auth):
 *  - PATCH no auth          → 401
 *  - PATCH valid non-owner non-admin → 403
 *  - PATCH as owner         → 200
 *  - PATCH as admin         → 200
 *  - GET  no auth           → 200  (delivery emails link here; must stay open)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Auth mock ────────────────────────────────────────────────────────────────

const mockVerifyAuth = vi.fn();

vi.mock('../../../../lib/auth', () => ({
  verifyAuth: (...args: unknown[]) => mockVerifyAuth(...args),
  // requireAuth and requireAdmin are NOT used directly in this handler —
  // the handler uses verifyAuth so it can distinguish 401 from 403 itself.
}));

// ── DB mock ──────────────────────────────────────────────────────────────────

const mockGetProperty = vi.fn();
const mockGetScenesForProperty = vi.fn();

// Chainable Supabase builder used for .from('properties').update(...).eq(...).
type Chain = {
  update: (v: unknown) => Chain;
  eq: (col: string, val: string) => Chain & Promise<{ error: null }>;
  then: (resolve: (v: { error: null }) => unknown) => unknown;
};

function makeUpdateChain(): Chain {
  const chain: Chain = {
    update: () => chain,
    eq: () => chain as Chain & Promise<{ error: null }>,
    then: (resolve) => resolve({ error: null }),
  };
  return chain;
}

const mockSupabase = {
  from: () => mockSupabase,
  update: () => mockSupabase,
  eq: () => mockSupabase,
  then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
};

vi.mock('../../../../lib/db', () => ({
  getProperty: (...args: unknown[]) => mockGetProperty(...args),
  getScenesForProperty: (...args: unknown[]) => mockGetScenesForProperty(...args),
  getSupabase: () => mockSupabase,
}));

// Import handler after mocks are set up (vitest hoists vi.mock calls).
import handler from '../status.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

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
    method: 'PATCH',
    query: { id: 'prop-uuid-1' },
    body: { status: 'delivered' },
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

const ownerUserId = 'user-owner-123';
const otherUserId = 'user-other-456';

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

const baseProperty = {
  id: 'prop-uuid-1',
  address: '1 Main St',
  status: 'complete',
  submitted_by: ownerUserId,
  created_at: '2026-01-01T00:00:00Z',
};

const baseScenes = [
  { id: 's1', status: 'qc_pass' },
  { id: 's2', status: 'rendering' },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetProperty.mockResolvedValue(baseProperty);
  mockGetScenesForProperty.mockResolvedValue(baseScenes);
});

describe('PATCH /api/properties/:id/status — auth guards', () => {
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

  it('returns 200 when caller is the property owner', async () => {
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect((res._body as { id: string }).id).toBe('prop-uuid-1');
  });

  it('returns 200 when caller is an admin (not the owner)', async () => {
    mockVerifyAuth.mockResolvedValue(adminAuth);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
  });

  it('returns 400 for an invalid status value even when owner is authed', async () => {
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    const res = makeRes();
    await handler(
      makeReq({ body: { status: 'not_a_real_status' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
  });
});

describe('GET /api/properties/:id/status — no auth required', () => {
  it('returns 200 with no Authorization header (delivery-email links must work)', async () => {
    const res = makeRes();
    await handler(
      makeReq({ method: 'GET', headers: {} }),
      res as unknown as VercelResponse,
    );
    // verifyAuth must NOT be called for GET
    expect(mockVerifyAuth).not.toHaveBeenCalled();
    expect(res._status).toBe(200);
  });
});
