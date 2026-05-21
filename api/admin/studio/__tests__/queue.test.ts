import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockRequireAdmin = vi.fn();

// Chainable Supabase mock
function makeChain(result: { data: unknown[] | null; error: { message: string } | null }) {
  const chain = {
    _eqArgs: null as unknown,
    from: () => chain,
    select: () => chain,
    eq: (...args: unknown[]) => { chain._eqArgs = args; return chain; },
    order: () => chain,
    limit: () => Promise.resolve(result),
  };
  return chain;
}

const mockGetSupabase = vi.fn();

vi.mock('../../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock('../../../../lib/client', () => ({
  getSupabase: () => mockGetSupabase(),
}));

import handler from '../queue';

function makeRes() {
  const res = {
    _status: 0,
    _body: {} as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
  };
  return res;
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

const adminUser = { user: { id: 'u1', email: 'admin@test.com' }, profile: { role: 'admin' } };

const sampleRows = [
  { id: 'p1', address: '1 Main St', status: 'queued', total_cost_cents: 0, created_at: '2026-05-01T00:00:00Z', client: { id: 'c1', name: 'Acme', brand_primary_hex: '#ff0000' } },
  { id: 'p2', address: '2 Oak Ave', status: 'needs_review', total_cost_cents: 5000, created_at: '2026-05-02T00:00:00Z', client: null },
  { id: 'p3', address: '3 Pine Rd', status: 'complete', total_cost_cents: 9900, created_at: '2026-05-03T00:00:00Z', client: null },
  { id: 'p4', address: '4 Elm St', status: 'ingesting', total_cost_cents: 0, created_at: '2026-05-04T00:00:00Z', client: null },
  { id: 'p5', address: '5 Maple Dr', status: 'assembling', total_cost_cents: 0, created_at: '2026-05-05T00:00:00Z', client: null },
  { id: 'p6', address: '6 Cedar Ln', status: 'qc', total_cost_cents: 0, created_at: '2026-05-06T00:00:00Z', client: null },
];

beforeEach(() => {
  mockRequireAdmin.mockReset();
  mockGetSupabase.mockReset();
});

describe('GET /api/admin/studio/queue', () => {
  it('returns 401 when requireAdmin returns null', async () => {
    mockRequireAdmin.mockImplementation((_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
  });

  it('returns 405 on POST', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const res = makeRes();
    await handler(makeReq({ method: 'POST' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
    expect((res._body as { error: string }).error).toBe('method_not_allowed');
  });

  it('returns 200 with buckets on GET happy path', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetSupabase.mockReturnValue(makeChain({ data: sampleRows, error: null }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { buckets: Record<string, unknown[]> };
    expect(body.buckets).toBeDefined();
    expect(Object.keys(body.buckets)).toEqual(['inbox', 'rendering', 'needs_review', 'delivered']);
  });

  it('routes "queued" and "assembling" to rendering bucket', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetSupabase.mockReturnValue(makeChain({ data: sampleRows, error: null }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    const body = res._body as { buckets: Record<string, Array<{ id: string }>> };
    const renderingIds = body.buckets.rendering.map(r => r.id);
    expect(renderingIds).toContain('p1'); // queued
    expect(renderingIds).toContain('p5'); // assembling
  });

  it('routes "needs_review" and "qc" to needs_review bucket', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetSupabase.mockReturnValue(makeChain({ data: sampleRows, error: null }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    const body = res._body as { buckets: Record<string, Array<{ id: string }>> };
    const reviewIds = body.buckets.needs_review.map(r => r.id);
    expect(reviewIds).toContain('p2'); // needs_review
    expect(reviewIds).toContain('p6'); // qc
  });

  it('routes "complete" to delivered bucket', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetSupabase.mockReturnValue(makeChain({ data: sampleRows, error: null }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    const body = res._body as { buckets: Record<string, Array<{ id: string }>> };
    const deliveredIds = body.buckets.delivered.map(r => r.id);
    expect(deliveredIds).toContain('p3');
  });

  it('routes unknown status (e.g. "ingesting") to inbox bucket', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetSupabase.mockReturnValue(makeChain({ data: sampleRows, error: null }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    const body = res._body as { buckets: Record<string, Array<{ id: string }>> };
    const inboxIds = body.buckets.inbox.map(r => r.id);
    expect(inboxIds).toContain('p4'); // ingesting -> inbox
  });

  it('filters by order_mode = operator (eq call is made)', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const chain = makeChain({ data: [], error: null });
    mockGetSupabase.mockReturnValue(chain);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(chain._eqArgs).toEqual(['order_mode', 'operator']);
  });

  it('returns 500 when supabase returns an error', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetSupabase.mockReturnValue(makeChain({ data: null, error: { message: 'db connection failed' } }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(500);
    expect((res._body as { error: string }).error).toMatch(/db connection failed/);
  });
});
