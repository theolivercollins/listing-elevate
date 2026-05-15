import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockRequireAdmin = vi.fn();
const mockBuildInvoice = vi.fn();
const mockFormatInvoiceSummary = vi.fn();

vi.mock('../../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock('../../../../lib/operator-studio/invoice-data', () => ({
  buildInvoice: (...args: unknown[]) => mockBuildInvoice(...args),
}));
vi.mock('../../../../lib/operator-studio/invoice', () => ({
  formatInvoiceSummary: (...args: unknown[]) => mockFormatInvoiceSummary(...args),
}));

import handler from '../invoice-summary';

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
    method: 'POST',
    query: {},
    body: { client_id: 'c1', from: '2026-05-01', to: '2026-05-31' },
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

const adminUser = { user: { id: 'u1', email: 'admin@test.com' }, profile: { role: 'admin' } };
const sampleSummary = {
  client_id: 'c1',
  client_name: 'Helgemo Team',
  from: '2026-05-01',
  to: '2026-05-31',
  videos_delivered: 3,
  raw_cost_cents: 1500,
  contracted_rate_cents: 50000,
  line_items: [],
};

beforeEach(() => {
  mockRequireAdmin.mockReset();
  mockBuildInvoice.mockReset();
  mockFormatInvoiceSummary.mockReset();
});

describe('POST /api/admin/studio/invoice-summary', () => {
  it('returns 401 when requireAdmin returns null', async () => {
    mockRequireAdmin.mockImplementation((_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
  });

  it('returns 400 when client_id is missing', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const res = makeRes();
    await handler(makeReq({ body: { from: '2026-05-01', to: '2026-05-31' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toMatch(/client_id/);
  });

  it('returns 400 when body is null/undefined', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const res = makeRes();
    await handler(makeReq({ body: null }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });

  it('returns 200 with text and data on happy path', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockBuildInvoice.mockResolvedValue({ summary: sampleSummary });
    mockFormatInvoiceSummary.mockReturnValue('CLIENT: Helgemo Team\nPERIOD: ...');
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { text: string; data: typeof sampleSummary };
    expect(body.text).toBe('CLIENT: Helgemo Team\nPERIOD: ...');
    expect(body.data).toEqual(sampleSummary);
  });

  it('passes client_id, from, to to buildInvoice', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockBuildInvoice.mockResolvedValue({ summary: sampleSummary });
    mockFormatInvoiceSummary.mockReturnValue('...');
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(mockBuildInvoice).toHaveBeenCalledWith({ client_id: 'c1', from: '2026-05-01', to: '2026-05-31' });
  });

  it('returns 404 when buildInvoice throws "not found" error', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockBuildInvoice.mockRejectedValue(new Error('client c1 not found'));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
    expect((res._body as { error: string }).error).toMatch(/not found/i);
  });

  it('returns 500 on generic error', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockBuildInvoice.mockRejectedValue(new Error('db timeout'));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(500);
    expect((res._body as { error: string }).error).toMatch(/db timeout/);
  });
});

describe('non-POST methods', () => {
  it('returns 405 for GET', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
    expect((res._body as { error: string }).error).toBe('method_not_allowed');
  });
});
