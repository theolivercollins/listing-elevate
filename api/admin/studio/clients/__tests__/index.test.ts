import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockRequireAdmin = vi.fn();
const mockListClients = vi.fn();
const mockCreateClient = vi.fn();

vi.mock('../../../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock('../../../../../lib/operator-studio/clients', () => ({
  listClients: (...args: unknown[]) => mockListClients(...args),
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import handler from '../index';

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

beforeEach(() => {
  mockRequireAdmin.mockReset();
  mockListClients.mockReset();
  mockCreateClient.mockReset();
});

describe('GET /api/admin/studio/clients', () => {
  it('returns 401 when requireAdmin returns null', async () => {
    mockRequireAdmin.mockImplementation((_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
  });

  it('returns 200 with clients array', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const rows = [{ id: 'c1', name: 'Helgemo Team' }];
    mockListClients.mockResolvedValue(rows);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect((res._body as { clients: unknown[] }).clients).toEqual(rows);
  });

  it('passes includeArchived=false by default', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockListClients.mockResolvedValue([]);
    const res = makeRes();
    await handler(makeReq({ query: {} }), res as unknown as VercelResponse);
    expect(mockListClients).toHaveBeenCalledWith({ includeArchived: false });
  });

  it('passes includeArchived=true when include_archived=true in query', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockListClients.mockResolvedValue([]);
    const res = makeRes();
    await handler(makeReq({ query: { include_archived: 'true' } }), res as unknown as VercelResponse);
    expect(mockListClients).toHaveBeenCalledWith({ includeArchived: true });
  });
});

describe('POST /api/admin/studio/clients', () => {
  it('returns 201 with created client on success', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const newClient = { id: 'c2', name: 'New Client' };
    mockCreateClient.mockResolvedValue(newClient);
    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: { name: 'New Client' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(201);
    expect((res._body as { client: unknown }).client).toEqual(newClient);
  });

  it('returns 400 when createClient throws a validation error', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockCreateClient.mockRejectedValue(new Error('name is required'));
    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: {} }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toMatch(/required/i);
  });

  it('returns 400 when createClient throws an invalid error', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockCreateClient.mockRejectedValue(new Error('invalid email format'));
    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: { name: 'Test' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });

  it('returns 500 on generic error', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockCreateClient.mockRejectedValue(new Error('db connection failed'));
    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: { name: 'Test' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(500);
  });
});

describe('unsupported methods', () => {
  it('returns 405 for DELETE', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const res = makeRes();
    await handler(makeReq({ method: 'DELETE' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
    expect((res._body as { error: string }).error).toBe('method_not_allowed');
  });
});
