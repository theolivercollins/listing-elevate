import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../../../lib/auth', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('../../../../../lib/drive/client', () => ({
  listPropertyFolders: vi.fn(),
  findFinalSubfolder: vi.fn(),
  countFinalImages: vi.fn(),
  DriveUnconfiguredError: class DriveUnconfiguredError extends Error {
    constructor() {
      super('Google Drive not configured');
      this.name = 'DriveUnconfiguredError';
    }
  },
}));

import { requireAdmin } from '../../../../../lib/auth';
import {
  listPropertyFolders,
  findFinalSubfolder,
  countFinalImages,
  DriveUnconfiguredError,
} from '../../../../../lib/drive/client';
import handler from '../folders';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeReq(method = 'GET'): VercelRequest {
  return { method } as unknown as VercelRequest;
}

function makeRes() {
  const res = {
    _status: 0,
    _body: undefined as unknown,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(body: unknown) {
      this._body = body;
      return this;
    },
  };
  return res as unknown as VercelResponse & { _status: number; _body: unknown };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GET /api/admin/studio/drive/folders', () => {
  const mockedRequireAdmin = vi.mocked(requireAdmin);
  const mockedListFolders = vi.mocked(listPropertyFolders);
  const mockedFindFinal = vi.mocked(findFinalSubfolder);
  const mockedCountImages = vi.mocked(countFinalImages);

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.DRIVE_PARENT_FOLDER_ID = 'parent-folder-id';
  });

  it('returns 405 for non-GET methods', async () => {
    const req = makeReq('POST');
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(405);
    expect(res._body).toEqual({ error: 'Method not allowed' });
  });

  it('returns nothing extra when admin is null (requireAdmin handles the response)', async () => {
    mockedRequireAdmin.mockResolvedValue(null);
    const req = makeReq('GET');
    const res = makeRes();
    await handler(req, res);
    // requireAdmin already sent the response; handler returns without writing
    expect(res._status).toBe(0);
    expect(mockedListFolders).not.toHaveBeenCalled();
  });

  it('returns 503 when DRIVE_PARENT_FOLDER_ID is missing', async () => {
    delete process.env.DRIVE_PARENT_FOLDER_ID;
    mockedRequireAdmin.mockResolvedValue({ id: 'admin-1' } as never);
    const req = makeReq('GET');
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(503);
    expect(res._body).toEqual({ error: 'Drive parent folder not configured' });
  });

  it('returns sorted folders with photo counts on happy path', async () => {
    mockedRequireAdmin.mockResolvedValue({ id: 'admin-1' } as never);
    mockedListFolders.mockResolvedValue([
      { id: 'f2', name: 'Zebra St' },
      { id: 'f1', name: 'Apple Ave' },
    ]);
    mockedFindFinal
      .mockResolvedValueOnce({ id: 'fin2', name: 'Final' }) // Zebra St
      .mockResolvedValueOnce({ id: 'fin1', name: 'Final' }); // Apple Ave
    mockedCountImages
      .mockResolvedValueOnce(5) // Zebra St
      .mockResolvedValueOnce(12); // Apple Ave

    const req = makeReq('GET');
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      folders: [
        { id: 'f1', name: 'Apple Ave', photoCount: 12 },
        { id: 'f2', name: 'Zebra St', photoCount: 5 },
      ],
    });
  });

  it('sets photoCount to null when a folder has no Final subfolder', async () => {
    mockedRequireAdmin.mockResolvedValue({ id: 'admin-1' } as never);
    mockedListFolders.mockResolvedValue([{ id: 'f1', name: 'No Final Here' }]);
    mockedFindFinal.mockResolvedValue(null);

    const req = makeReq('GET');
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      folders: [{ id: 'f1', name: 'No Final Here', photoCount: null }],
    });
  });

  it('sets photoCount to null when countFinalImages throws, without failing the request', async () => {
    mockedRequireAdmin.mockResolvedValue({ id: 'admin-1' } as never);
    mockedListFolders.mockResolvedValue([
      { id: 'f1', name: 'Good Folder' },
      { id: 'f2', name: 'Bad Folder' },
    ]);
    mockedFindFinal.mockResolvedValue({ id: 'fin', name: 'Final' });
    mockedCountImages
      .mockResolvedValueOnce(3)
      .mockRejectedValueOnce(new Error('Drive quota exceeded'));

    const req = makeReq('GET');
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    const body = res._body as { folders: Array<{ name: string; photoCount: number | null }> };
    const bad = body.folders.find((f) => f.name === 'Bad Folder');
    const good = body.folders.find((f) => f.name === 'Good Folder');
    expect(bad?.photoCount).toBeNull();
    expect(good?.photoCount).toBe(3);
  });

  it('returns 503 when listPropertyFolders throws DriveUnconfiguredError', async () => {
    mockedRequireAdmin.mockResolvedValue({ id: 'admin-1' } as never);
    mockedListFolders.mockRejectedValue(new DriveUnconfiguredError());

    const req = makeReq('GET');
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(503);
    expect(res._body).toEqual({ error: 'Google Drive service account not configured' });
  });

  it('returns 502 when listPropertyFolders throws a generic error — no detail leaked', async () => {
    mockedRequireAdmin.mockResolvedValue({ id: 'admin-1' } as never);
    mockedListFolders.mockRejectedValue(new Error('network timeout with internal URL'));

    const req = makeReq('GET');
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(502);
    // error field is present, but detail must never be echoed back
    expect((res._body as { error: string }).error).toBe('Drive request failed');
    expect((res._body as Record<string, unknown>).detail).toBeUndefined();
  });

  it('processes folders in batches of 5 and returns all results', async () => {
    mockedRequireAdmin.mockResolvedValue({ id: 'admin-1' } as never);

    // 7 folders — two batches (5 + 2) to exercise the batching path
    const sevenFolders = Array.from({ length: 7 }, (_, i) => ({
      id: `f${i}`,
      name: `Folder ${i}`,
    }));
    mockedListFolders.mockResolvedValue(sevenFolders);
    mockedFindFinal.mockResolvedValue({ id: 'fin', name: 'Final' });
    mockedCountImages.mockResolvedValue(3);

    const req = makeReq('GET');
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    const body = res._body as { folders: Array<{ id: string; photoCount: number | null }> };
    // All 7 folders returned
    expect(body.folders).toHaveLength(7);
    // Every folder got a count
    for (const f of body.folders) {
      expect(f.photoCount).toBe(3);
    }
    // findFinalSubfolder called once per folder
    expect(mockedFindFinal).toHaveBeenCalledTimes(7);
  });
});
