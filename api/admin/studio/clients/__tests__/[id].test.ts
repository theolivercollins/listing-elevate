import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockRequireAdmin = vi.fn();
const mockGetClient = vi.fn();
const mockUpdateClient = vi.fn();
const mockArchiveClient = vi.fn();

vi.mock('../../../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock('../../../../../lib/operator-studio/clients', () => ({
  getClient: (...args: unknown[]) => mockGetClient(...args),
  updateClient: (...args: unknown[]) => mockUpdateClient(...args),
  archiveClient: (...args: unknown[]) => mockArchiveClient(...args),
}));

import handler from '../[id]';

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
    query: { id: 'client-abc' },
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

const adminUser = { user: { id: 'u1', email: 'admin@test.com' }, profile: { role: 'admin' } };
const sampleClient = { id: 'client-abc', name: 'Helgemo Team', archived_at: null };

beforeEach(() => {
  mockRequireAdmin.mockReset();
  mockGetClient.mockReset();
  mockUpdateClient.mockReset();
  mockArchiveClient.mockReset();
});

describe('GET /api/admin/studio/clients/[id]', () => {
  it('returns 401 when requireAdmin returns null', async () => {
    mockRequireAdmin.mockImplementation((_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
  });

  it('returns 200 with client on found', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetClient.mockResolvedValue(sampleClient);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect((res._body as { client: unknown }).client).toEqual(sampleClient);
  });

  it('returns 404 when getClient returns null', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetClient.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
    expect((res._body as { error: string }).error).toBe('not_found');
  });

  it('passes the id from query to getClient', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetClient.mockResolvedValue(sampleClient);
    const res = makeRes();
    await handler(makeReq({ query: { id: 'specific-id' } }), res as unknown as VercelResponse);
    expect(mockGetClient).toHaveBeenCalledWith('specific-id');
  });
});

describe('PATCH /api/admin/studio/clients/[id]', () => {
  it('returns 200 with updated client', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const updatedClient = { ...sampleClient, name: 'Updated Name' };
    mockUpdateClient.mockResolvedValue(updatedClient);
    const res = makeRes();
    await handler(makeReq({ method: 'PATCH', body: { name: 'Updated Name' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect((res._body as { client: unknown }).client).toEqual(updatedClient);
  });

  it('passes id and body to updateClient', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockUpdateClient.mockResolvedValue(sampleClient);
    const patch = { name: 'New Name', monthly_rate_cents: 50000 };
    const res = makeRes();
    await handler(makeReq({ method: 'PATCH', body: patch }), res as unknown as VercelResponse);
    expect(mockUpdateClient).toHaveBeenCalledWith('client-abc', patch);
  });
});

describe('DELETE /api/admin/studio/clients/[id]', () => {
  it('returns 200 with archived client row', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const archivedClient = { ...sampleClient, archived_at: '2026-05-15T00:00:00Z' };
    mockArchiveClient.mockResolvedValue(archivedClient);
    const res = makeRes();
    await handler(makeReq({ method: 'DELETE' }), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect((res._body as { client: typeof archivedClient }).client.archived_at).toBeTruthy();
  });

  it('passes id to archiveClient', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockArchiveClient.mockResolvedValue(sampleClient);
    const res = makeRes();
    await handler(makeReq({ method: 'DELETE', query: { id: 'delete-me' } }), res as unknown as VercelResponse);
    expect(mockArchiveClient).toHaveBeenCalledWith('delete-me');
  });
});

describe('unsupported methods', () => {
  it('returns 405 for PUT', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const res = makeRes();
    await handler(makeReq({ method: 'PUT' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
    expect((res._body as { error: string }).error).toBe('method_not_allowed');
  });
});
