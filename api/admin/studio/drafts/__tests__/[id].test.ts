import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockRequireAdmin = vi.fn();
const mockDeleteDraft = vi.fn();
const mockPurge = vi.fn();

vi.mock('../../../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock('../../../../../lib/studio/drafts', () => ({
  deleteDraft: (...args: unknown[]) => mockDeleteDraft(...args),
}));
vi.mock('../../../../../lib/studio/draft-cleanup', () => ({
  purgeDraftStorageForOwner: (...args: unknown[]) => mockPurge(...args),
}));

import handler from '../[id]';

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
    method: 'DELETE',
    query: { id: 'draft-1' },
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

const adminUser = { user: { id: 'admin-1', email: 'a@test.com' }, profile: { role: 'admin' } };

beforeEach(() => {
  mockRequireAdmin.mockReset();
  mockDeleteDraft.mockReset();
  mockPurge.mockReset();
  mockRequireAdmin.mockResolvedValue(adminUser);
  mockDeleteDraft.mockResolvedValue(undefined);
  mockPurge.mockResolvedValue({ deletedPhotos: 0, failedPhotoDeletes: 0, skippedReferencedPhotos: 0 });
  process.env.LE_ALLOW_NONPROD_WRITES = 'true';
});

afterEach(() => {
  delete process.env.LE_ALLOW_NONPROD_WRITES;
  delete process.env.VERCEL_ENV;
});

describe('DELETE /api/admin/studio/drafts/[id]', () => {
  it('returns 401 when requireAdmin rejects', async () => {
    mockRequireAdmin.mockImplementation((_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
    expect(mockDeleteDraft).not.toHaveBeenCalled();
  });

  it('returns 403 when writes are disabled (non-prod, no opt-in)', async () => {
    delete process.env.LE_ALLOW_NONPROD_WRITES;
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(403);
    expect(mockDeleteDraft).not.toHaveBeenCalled();
  });

  it('deletes scoped to the calling admin and returns 204', async () => {
    const res = makeRes();
    await handler(makeReq({ query: { id: 'draft-1' } }), res as unknown as VercelResponse);
    expect(mockDeleteDraft).toHaveBeenCalledWith('draft-1', 'admin-1');
    expect(res._status).toBe(204);
  });

  it('does NOT purge storage without ?purge=1 (submit path: row-only, fast + safe)', async () => {
    const res = makeRes();
    await handler(makeReq({ query: { id: 'draft-1' } }), res as unknown as VercelResponse);
    expect(mockPurge).not.toHaveBeenCalled();
    expect(mockDeleteDraft).toHaveBeenCalledWith('draft-1', 'admin-1');
    expect(res._status).toBe(204);
  });

  it('purges storage before deleting the row when ?purge=1 (Discard path)', async () => {
    const res = makeRes();
    await handler(
      makeReq({ query: { id: 'draft-1', purge: '1' } }),
      res as unknown as VercelResponse,
    );
    expect(mockPurge).toHaveBeenCalledWith('draft-1', 'admin-1');
    expect(mockDeleteDraft).toHaveBeenCalledWith('draft-1', 'admin-1');
    // purge must run before the row delete
    expect(mockPurge.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteDraft.mock.invocationCallOrder[0],
    );
    expect(res._status).toBe(204);
  });

  it('still deletes the row when purge throws (Discard must always clear the draft)', async () => {
    mockPurge.mockRejectedValue(new Error('storage flaky'));
    const res = makeRes();
    await handler(
      makeReq({ query: { id: 'draft-1', purge: '1' } }),
      res as unknown as VercelResponse,
    );
    expect(mockDeleteDraft).toHaveBeenCalledWith('draft-1', 'admin-1');
    expect(res._status).toBe(204);
  });

  it('deletes when VERCEL_ENV=production', async () => {
    delete process.env.LE_ALLOW_NONPROD_WRITES;
    process.env.VERCEL_ENV = 'production';
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(204);
  });

  it('returns 400 when id is missing', async () => {
    const res = makeRes();
    await handler(makeReq({ query: {} }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
    expect(mockDeleteDraft).not.toHaveBeenCalled();
  });

  it('returns 500 when deleteDraft throws', async () => {
    mockDeleteDraft.mockRejectedValue(new Error('db down'));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(500);
    expect((res._body as { error: string }).error).toMatch(/db down/);
  });

  it('returns 405 for non-DELETE methods', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
  });
});
