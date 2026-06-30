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
  setNoStore: vi.fn(),
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
    // Owners are restricted to OWNER_PATCH_STATUSES (currently only 'archived').
    // The default makeReq() body uses 'delivered' which is intentionally blocked
    // for owners since the P2 auth-split fix; use 'archived' here.
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    const res = makeRes();
    await handler(makeReq({ body: { status: 'archived' } }), res as unknown as VercelResponse);
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

  it('returns 403 when owner tries to set a status outside the owner-safe subset (e.g. complete)', async () => {
    // P2 fix: owners may only set status=archived; other values that admins
    // can set (complete, delivered, failed, needs_review) must be blocked for
    // non-admin owners to prevent order-state corruption.
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    const res = makeRes();
    await handler(
      makeReq({ body: { status: 'complete' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(403);
  });

  it('returns 403 when owner tries to set status=delivered', async () => {
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    const res = makeRes();
    await handler(
      makeReq({ body: { status: 'delivered' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(403);
  });

  it('returns 200 when owner sets status=archived (the one allowed owner transition)', async () => {
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    const res = makeRes();
    await handler(
      makeReq({ body: { status: 'archived' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
  });

  it('returns 200 when admin sets status=delivered (admins bypass owner restriction)', async () => {
    mockVerifyAuth.mockResolvedValue(adminAuth);
    const res = makeRes();
    await handler(
      makeReq({ body: { status: 'delivered' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
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

  it('returns exactly { status, label, currentStage, totalStages } — no sensitive fields', async () => {
    const res = makeRes();
    await handler(
      makeReq({ method: 'GET', headers: {} }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);

    const body = res._body as Record<string, unknown>;

    // Required fields must be present
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('label');
    expect(body).toHaveProperty('currentStage');
    expect(body).toHaveProperty('totalStages');

    // Sensitive fields must NOT be present
    const forbidden = [
      'address',
      'horizontalVideoUrl',
      'verticalVideoUrl',
      'createdAt',
      'processingTimeMs',
      'clipsCompleted',
      'clipsTotal',
    ];
    for (const field of forbidden) {
      expect(body).not.toHaveProperty(field);
    }

    // The body must have EXACTLY the four allowed keys (no extras)
    const allowedKeys = new Set(['status', 'label', 'currentStage', 'totalStages']);
    for (const key of Object.keys(body)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });

  it('returns a human-readable label derived from the status', async () => {
    // baseProperty.status = 'complete' — label should be 'Delivered'
    const res = makeRes();
    await handler(
      makeReq({ method: 'GET', headers: {} }),
      res as unknown as VercelResponse,
    );
    expect((res._body as { label: string }).label).toBe('Delivered');
  });
});

describe('GET /api/properties/:id/status — authenticated rich shape', () => {
  it('returns real clipsCompleted / clipsTotal from getScenesForProperty (not hardcoded 0)', async () => {
    // baseScenes: s1 = qc_pass, s2 = rendering → clipsCompleted=1, clipsTotal=2
    // This regression test guards against the P2 finding where lines 157-158
    // hardcoded clipsCompleted:0 / clipsTotal:0, silently disabling the
    // Status-page Clips widget for authenticated owners.
    const res = makeRes();
    await handler(
      makeReq({
        method: 'GET',
        headers: { authorization: 'Bearer token-owner' },
      }),
      res as unknown as VercelResponse,
    );
    mockVerifyAuth.mockResolvedValueOnce(ownerAuth);

    // Re-run with auth resolved correctly (beforeEach sets mockGetScenesForProperty)
    const res2 = makeRes();
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    await handler(
      makeReq({
        method: 'GET',
        headers: { authorization: 'Bearer token-owner' },
      }),
      res2 as unknown as VercelResponse,
    );
    expect(res2._status).toBe(200);
    const body = res2._body as Record<string, unknown>;
    // Must have real counts, not the hardcoded zero fallback
    expect(body.clipsTotal).toBe(2);
    expect(body.clipsCompleted).toBe(1);
    // getScenesForProperty must have been called
    expect(mockGetScenesForProperty).toHaveBeenCalledWith('prop-uuid-1');
  });
});
