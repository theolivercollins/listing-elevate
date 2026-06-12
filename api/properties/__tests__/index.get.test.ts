/**
 * Tests for GET /api/properties auth + tenant-scoping (P0 security fix).
 *
 * Success criteria:
 *  - GET with no auth token       → 401
 *  - GET as non-admin user        → 200, query scoped to submitted_by = user.id
 *  - GET as admin                 → 200, query NOT scoped (full list)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Auth mock ─────────────────────────────────────────────────────────────────

const mockRequireAuth = vi.fn();

vi.mock('../../../lib/auth', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

// ── DB mock — chainable Supabase builder ──────────────────────────────────────

const eqCalls: Array<[string, string]> = [];

function makeQueryChain() {
  const chain: Record<string, unknown> = {};
  const self = chain as {
    select: () => typeof chain;
    order: () => typeof chain;
    range: () => typeof chain;
    eq: (col: string, val: string) => typeof chain;
    ilike: () => typeof chain;
    then: (resolve: (v: { data: unknown[]; count: number; error: null }) => unknown) => unknown;
  };
  self.select = () => self;
  self.order = () => self;
  self.range = () => self;
  self.eq = (col: string, val: string) => { eqCalls.push([col, val]); return self; };
  self.ilike = () => self;
  self.then = (resolve) => resolve({ data: [{ id: 'p1' }], count: 1, error: null });
  return self;
}

vi.mock('../../../lib/db', () => ({
  getSupabase: () => ({
    from: () => makeQueryChain(),
  }),
  createProperty: vi.fn(),
  insertPhotos: vi.fn(),
}));

// handlePost uses billing/stripe — stub it out so the import doesn't explode
vi.mock('../../../lib/billing/stripe', () => ({
  createCheckoutSession: vi.fn(),
  formatLineItemsForOrder: vi.fn(() => []),
  sumLineItemsCents: vi.fn(() => 0),
}));
vi.mock('../../../lib/billing/owner-bypass', () => ({
  isOwnerBypassEligible: vi.fn(() => false),
}));
vi.mock('../../../lib/pipeline', () => ({
  runPipeline: vi.fn(),
}));

import handler from '../index.js';

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
    query: {},
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

const userAuth = {
  user: { id: 'user-abc-123', email: 'agent@test.com' },
  profile: { role: 'user' as const },
};

const adminAuth = {
  user: { id: 'admin-xyz-999', email: 'admin@test.com' },
  profile: { role: 'admin' as const },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  eqCalls.length = 0;
});

describe('GET /api/properties — auth + tenant scoping', () => {
  it('returns 401 when no auth token is provided', async () => {
    // requireAuth writes the 401 and returns null when unauthenticated
    mockRequireAuth.mockImplementation(async (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => unknown } }) => {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
  });

  it('scopes the query to submitted_by = user.id for a non-admin caller', async () => {
    mockRequireAuth.mockResolvedValue(userAuth);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    // The .eq('submitted_by', userId) call must have been made
    const submittedByCall = eqCalls.find(([col]) => col === 'submitted_by');
    expect(submittedByCall).toBeDefined();
    expect(submittedByCall?.[1]).toBe(userAuth.user.id);
  });

  it('does NOT add a submitted_by scope for admins (unscoped full list)', async () => {
    mockRequireAuth.mockResolvedValue(adminAuth);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const submittedByCall = eqCalls.find(([col]) => col === 'submitted_by');
    expect(submittedByCall).toBeUndefined();
  });

  it('returns the properties array in the response body', async () => {
    mockRequireAuth.mockResolvedValue(userAuth);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { properties: unknown[] };
    expect(Array.isArray(body.properties)).toBe(true);
    expect(body.properties.length).toBe(1);
  });
});
