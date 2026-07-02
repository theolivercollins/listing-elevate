/**
 * Tests for GET /api/properties/:id auth + owner-gate + cost-event stripping (P1 fix).
 *
 * Success criteria:
 *  - GET with no auth              → 401
 *  - GET by non-owner non-admin    → 403
 *  - GET by property owner         → 200, costEvents = [] (stripped)
 *  - GET by admin                  → 200, costEvents populated
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
  created_at: '2026-01-01T00:00:00Z',
};

const mockCostEvents = [
  { id: 'ce1', stage: 'analyze', provider: 'anthropic', cost_cents: 12 },
];

const mockGetProperty = vi.fn();
const mockGetPhotos = vi.fn();
const mockGetScenes = vi.fn();
const mockGetRatings = vi.fn();

// Chainable Supabase query builder that returns cost events
function makeCostChain() {
  const self: Record<string, unknown> = {};
  const s = self as {
    select: () => typeof self;
    eq: () => typeof self;
    order: () => typeof self;
    then: (resolve: (v: { data: typeof mockCostEvents }) => unknown) => unknown;
  };
  s.select = () => s;
  s.eq = () => s;
  s.order = () => s;
  s.then = (resolve) => resolve({ data: mockCostEvents });
  return s;
}

vi.mock('../../../lib/db', () => ({
  getProperty: (...args: unknown[]) => mockGetProperty(...args),
  getPhotosForProperty: (...args: unknown[]) => mockGetPhotos(...args),
  getScenesForProperty: (...args: unknown[]) => mockGetScenes(...args),
  getRatingsForProperty: (...args: unknown[]) => mockGetRatings(...args),
  getSupabase: () => ({ from: () => makeCostChain() }),
}));

import handler from '../[id].js';

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
    method: 'GET',
    query: { id: 'prop-uuid-1' },
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

const ownerAuth = {
  user: { id: ownerUserId, email: 'owner@test.com' },
  profile: { role: 'user' as const },
};
const adminAuth = {
  user: { id: 'admin-789', email: 'admin@test.com' },
  profile: { role: 'admin' as const },
};
const strangerAuth = {
  user: { id: otherUserId, email: 'stranger@test.com' },
  profile: { role: 'user' as const },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetProperty.mockResolvedValue(mockProperty);
  mockGetPhotos.mockResolvedValue([]);
  mockGetScenes.mockResolvedValue([]);
  mockGetRatings.mockResolvedValue([]);
});

describe('GET /api/properties/:id — auth + cost-event gate', () => {
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

  it('strips costEvents for non-admin owners (internal margin data not exposed to customers)', async () => {
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { costEvents: unknown[] };
    // Owner must get an empty array, NOT the internal cost events
    expect(body.costEvents).toEqual([]);
  });

  it('returns 200 and includes costEvents for admins', async () => {
    mockVerifyAuth.mockResolvedValue(adminAuth);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { costEvents: unknown[] };
    // Admin gets the real cost events
    expect(body.costEvents.length).toBeGreaterThan(0);
  });
});
