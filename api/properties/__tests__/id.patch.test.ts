/**
 * Tests for PATCH /api/properties/:id — auth + owner-gate (F11).
 *
 * Before this fix the PATCH branch had no auth; any caller could set
 * pipeline_mode on any property and receive the full row.
 *
 * Success criteria:
 *  - PATCH no auth              → 401
 *  - PATCH non-owner non-admin  → 403
 *  - PATCH by owner             → 200 with updated row
 *  - PATCH by admin             → 200 with updated row
 *  - PATCH unknown property     → 404
 *  - PATCH invalid pipeline_mode → 400 (when caller is owner)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Auth mock ─────────────────────────────────────────────────────────────────

const mockVerifyAuth = vi.fn();

vi.mock('../../../lib/auth', () => ({
  verifyAuth: (...args: unknown[]) => mockVerifyAuth(...args),
  setNoStore: vi.fn(),
}));

// ── DB mock ───────────────────────────────────────────────────────────────────

const ownerUserId = 'user-owner-123';
const otherUserId = 'user-other-456';

const mockProperty = {
  id: 'prop-uuid-1',
  address: '1 Main St',
  status: 'complete',
  submitted_by: ownerUserId,
  pipeline_mode: 'v1',
  created_at: '2026-01-01T00:00:00Z',
};

const mockGetProperty = vi.fn();
const mockGetPhotos = vi.fn();
const mockGetScenes = vi.fn();
const mockGetRatings = vi.fn();

// Chainable builder for update().eq().select().single()
// Each from() call returns a fresh chain so parallel calls don't share state.
function makePatchChain(returnData: unknown = mockProperty) {
  const chain: Record<string, unknown> = {};
  const c = chain as {
    update: () => typeof chain;
    eq: () => typeof chain;
    select: () => typeof chain;
    single: () => Promise<{ data: unknown; error: null }>;
  };
  c.update = () => c;
  c.eq = () => c;
  c.select = () => c;
  c.single = () => Promise.resolve({ data: returnData, error: null });
  return c;
}

// Chainable builder for the GET branch's cost_events query (select/eq/order/then).
function makeCostChain() {
  const self: Record<string, unknown> = {};
  const s = self as {
    select: () => typeof self;
    eq: () => typeof self;
    order: () => typeof self;
    then: (resolve: (v: { data: never[] }) => unknown) => unknown;
  };
  s.select = () => s;
  s.eq = () => s;
  s.order = () => s;
  s.then = (resolve) => resolve({ data: [] });
  return s;
}

vi.mock('../../../lib/db', () => ({
  getProperty: (...args: unknown[]) => mockGetProperty(...args),
  getPhotosForProperty: (...args: unknown[]) => mockGetPhotos(...args),
  getScenesForProperty: (...args: unknown[]) => mockGetScenes(...args),
  getRatingsForProperty: (...args: unknown[]) => mockGetRatings(...args),
  // Return a patch chain for 'properties' and a cost chain for anything else.
  getSupabase: () => ({
    from: (table: string) => table === 'properties' ? makePatchChain() : makeCostChain(),
  }),
}));

import handler from '../[id].js';

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
    method: 'PATCH',
    query: { id: 'prop-uuid-1' },
    body: { pipeline_mode: 'v1.1' },
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetProperty.mockResolvedValue(mockProperty);
  mockGetPhotos.mockResolvedValue([]);
  mockGetScenes.mockResolvedValue([]);
  mockGetRatings.mockResolvedValue([]);
});

describe('PATCH /api/properties/:id — auth guards (F11)', () => {
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
  });

  it('returns 200 when caller is an admin (not the owner)', async () => {
    mockVerifyAuth.mockResolvedValue(adminAuth);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
  });

  it('returns 404 when the property does not exist', async () => {
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    mockGetProperty.mockRejectedValue(new Error('not found'));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
  });

  it('returns 400 when owner provides an invalid pipeline_mode', async () => {
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    const res = makeRes();
    await handler(makeReq({ body: { pipeline_mode: 'v3' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });
});
