/**
 * Tests for GET /api/properties auth + tenant-scoping guard.
 *
 * Success criteria (P0 fix — handleGet was unauthenticated and unscoped):
 *  - GET no auth          → 401
 *  - GET as admin         → 200, NO submitted_by filter applied (sees all)
 *  - GET as non-admin     → 200, submitted_by=user.id filter applied (own rows only)
 *  - POST still routes to handlePost (auth tested separately)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Auth mock ────────────────────────────────────────────────────────────────

const mockRequireAuth = vi.fn();

vi.mock('../../../lib/auth', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

// ── DB mock ──────────────────────────────────────────────────────────────────

// Track which eq() calls are made on the query chain to assert scoping.
const eqCalls: Array<[string, string]> = [];

function makeQueryChain(result: { data: unknown[]; count: number; error: null }) {
  const chain: Record<string, unknown> = {};
  chain['select'] = () => chain;
  chain['order'] = () => chain;
  chain['range'] = () => chain;
  chain['eq'] = (col: string, val: string) => { eqCalls.push([col, val]); return chain; };
  chain['ilike'] = () => chain;
  // Make the chain thenable so `await query` resolves.
  chain['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

let mockQueryResult = { data: [] as unknown[], count: 0, error: null };
const mockFrom = vi.fn(() => makeQueryChain(mockQueryResult));

vi.mock('../../../lib/db', () => ({
  getSupabase: () => ({ from: (...args: unknown[]) => mockFrom(...args) }),
  // POST-path helpers — not exercised by these tests, but must exist to satisfy imports.
  createProperty: vi.fn(),
  insertPhotos: vi.fn(),
}));

// Other POST-path imports that need stubs so the module loads.
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

function makeGetReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'GET',
    query: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

const agentUserId = 'user-agent-001';
const agentAuth = {
  user: { id: agentUserId, email: 'agent@test.com' },
  profile: { role: 'user' as const },
};
const adminAuth = {
  user: { id: 'user-admin-999', email: 'admin@test.com' },
  profile: { role: 'admin' as const },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  eqCalls.length = 0;
  mockQueryResult = { data: [], count: 0, error: null };
});

describe('GET /api/properties — auth + tenant-scoping guard', () => {
  it('returns 401 when no auth token is provided', async () => {
    // requireAuth writes the 401 and returns null
    mockRequireAuth.mockImplementation((_req: unknown, res: { status: (n: number) => { json: (b: unknown) => unknown } }) => {
      res.status(401).json({ error: 'Unauthorized' });
      return Promise.resolve(null);
    });

    const res = makeRes();
    await handler(makeGetReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
  });

  it('returns 200 for an admin without applying a submitted_by filter', async () => {
    mockRequireAuth.mockResolvedValue(adminAuth);

    const res = makeRes();
    await handler(makeGetReq(), res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    // Admin must NOT have a submitted_by constraint injected.
    const submittedByCall = eqCalls.find(([col]) => col === 'submitted_by');
    expect(submittedByCall).toBeUndefined();
  });

  it('returns 200 for a non-admin agent with submitted_by scoped to their own user id', async () => {
    mockRequireAuth.mockResolvedValue(agentAuth);

    const res = makeRes();
    await handler(makeGetReq(), res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    // Non-admin MUST have submitted_by filtered to their own user id.
    const submittedByCall = eqCalls.find(([col]) => col === 'submitted_by');
    expect(submittedByCall).toBeDefined();
    expect(submittedByCall![1]).toBe(agentUserId);
  });

  it('does not expose other tenants properties to non-admin agents', async () => {
    const otherUserId = 'user-other-tenant-002';
    mockRequireAuth.mockResolvedValue(agentAuth);
    mockQueryResult = {
      data: [
        { id: 'prop-1', submitted_by: agentUserId, address: 'My St' },
        // This row should NOT appear — filter is applied at DB layer.
        { id: 'prop-2', submitted_by: otherUserId, address: 'Other St' },
      ],
      count: 2,
      error: null,
    };

    const res = makeRes();
    await handler(makeGetReq(), res as unknown as VercelResponse);

    // The eq('submitted_by', agentUserId) was called — DB does the actual filtering.
    // We assert the filter was applied correctly.
    const submittedByCall = eqCalls.find(([col]) => col === 'submitted_by');
    expect(submittedByCall![1]).toBe(agentUserId);
    expect(submittedByCall![1]).not.toBe(otherUserId);
  });
});
