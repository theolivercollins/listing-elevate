import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockRequireAdmin = vi.fn();
const mockGetLatestDraft = vi.fn();
const mockUpsertDraft = vi.fn();

vi.mock('../../../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock('../../../../../lib/studio/drafts', () => ({
  getLatestDraft: (...args: unknown[]) => mockGetLatestDraft(...args),
  upsertDraft: (...args: unknown[]) => mockUpsertDraft(...args),
}));

import handler from '../index';

function makeRes() {
  return {
    _status: 0,
    _body: {} as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
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

const adminUser = { user: { id: 'admin-1', email: 'a@test.com' }, profile: { role: 'admin' } };

beforeEach(() => {
  mockRequireAdmin.mockReset();
  mockGetLatestDraft.mockReset();
  mockUpsertDraft.mockReset();
  mockRequireAdmin.mockResolvedValue(adminUser);
  process.env.LE_ALLOW_NONPROD_WRITES = 'true';
});

afterEach(() => {
  delete process.env.LE_ALLOW_NONPROD_WRITES;
  delete process.env.VERCEL_ENV;
});

describe('GET /api/admin/studio/drafts', () => {
  it('returns 401 when requireAdmin rejects', async () => {
    mockRequireAdmin.mockImplementation((_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
  });

  it('returns the draft for the calling admin', async () => {
    mockGetLatestDraft.mockResolvedValue({ id: 'd1', submitted_by: 'admin-1' });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(mockGetLatestDraft).toHaveBeenCalledWith('admin-1');
    expect(res._status).toBe(200);
    expect((res._body as { draft: unknown }).draft).toEqual({ id: 'd1', submitted_by: 'admin-1' });
  });

  it('returns { draft: null } when the admin has no draft', async () => {
    mockGetLatestDraft.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect((res._body as { draft: unknown }).draft).toBeNull();
  });

  it('GET works even when writes are disabled (non-prod, no opt-in)', async () => {
    delete process.env.LE_ALLOW_NONPROD_WRITES;
    mockGetLatestDraft.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
  });

  it('returns 500 when getLatestDraft throws (handler is guarded)', async () => {
    mockGetLatestDraft.mockRejectedValue(new Error('db down'));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(500);
    expect((res._body as { error: string }).error).toMatch(/db down/);
  });
});

describe('PUT/POST /api/admin/studio/drafts', () => {
  it('returns 403 when writes are disabled (non-prod, no opt-in)', async () => {
    delete process.env.LE_ALLOW_NONPROD_WRITES;
    const res = makeRes();
    await handler(
      makeReq({ method: 'PUT', body: { address: '123 Oak St' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(403);
    expect(mockUpsertDraft).not.toHaveBeenCalled();
  });

  it('upserts when LE_ALLOW_NONPROD_WRITES=true (PUT)', async () => {
    mockUpsertDraft.mockResolvedValue({ id: 'd1', submitted_by: 'admin-1', address: '123 Oak St' });
    const res = makeRes();
    await handler(
      makeReq({ method: 'PUT', body: { address: '123 Oak St' } }),
      res as unknown as VercelResponse,
    );
    expect(mockUpsertDraft).toHaveBeenCalledWith('admin-1', { address: '123 Oak St' });
    expect(res._status).toBe(200);
    expect((res._body as { draft: { id: string } }).draft.id).toBe('d1');
  });

  it('upserts when VERCEL_ENV=production (POST)', async () => {
    delete process.env.LE_ALLOW_NONPROD_WRITES;
    process.env.VERCEL_ENV = 'production';
    mockUpsertDraft.mockResolvedValue({ id: 'd1' });
    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: {} }), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect(mockUpsertDraft).toHaveBeenCalledWith('admin-1', {});
  });

  it('defaults to an empty object when body is missing', async () => {
    mockUpsertDraft.mockResolvedValue({ id: 'd1' });
    const res = makeRes();
    await handler(
      makeReq({ method: 'PUT', body: undefined as unknown as Record<string, unknown> }),
      res as unknown as VercelResponse,
    );
    expect(mockUpsertDraft).toHaveBeenCalledWith('admin-1', {});
    expect(res._status).toBe(200);
  });

  it('returns 500 when upsertDraft throws', async () => {
    mockUpsertDraft.mockRejectedValue(new Error('db down'));
    const res = makeRes();
    await handler(makeReq({ method: 'PUT', body: {} }), res as unknown as VercelResponse);
    expect(res._status).toBe(500);
    expect((res._body as { error: string }).error).toMatch(/db down/);
  });
});

describe('other methods', () => {
  it('returns 405 for DELETE', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'DELETE' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
    expect((res._body as { error: string }).error).toBe('method_not_allowed');
  });
});
