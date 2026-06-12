import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockRequireAdmin = vi.fn();
const mockGetSupabase = vi.fn();

vi.mock('../../../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock('../../../../../lib/client', () => ({
  getSupabase: () => mockGetSupabase(),
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

type Captured = {
  table: string;
  filters: Array<{ op: string; args: unknown[] }>;
};

/**
 * makeDb — supports the query shapes used by the video-folders endpoints.
 *
 * Tables routed:
 *   'video_folders'   → foldersResult
 *   'video_library_meta' → metaResult
 *
 * Chainable methods tracked: select, insert, order, eq, in, limit, single, maybeSingle.
 * The chain always resolves to the table's configured result.
 */
function makeDb(opts: {
  folders?: { data: unknown; error: unknown };
  meta?: { data: unknown; error: unknown };
  captured: Captured[];
  /**
   * When set, any from('video_folders') call returns this error instead of
   * opts.folders. Used to simulate 42P01 (undefined_table).
   */
  foldersError?: { code: string; message: string };
}) {
  return {
    from(table: string) {
      const cap: Captured = { table, filters: [] };
      opts.captured.push(cap);
      const record = (op: string) => (...args: unknown[]) => { cap.filters.push({ op, args }); return chain; };

      let result: unknown;
      if (table === 'video_folders') {
        result = opts.foldersError
          ? { data: null, error: opts.foldersError }
          : (opts.folders ?? { data: [], error: null });
      } else {
        // video_library_meta or any other table
        result = opts.meta ?? { data: [], error: null };
      }

      const chain: Record<string, unknown> = {};
      chain.select = record('select');
      chain.insert = record('insert');
      chain.update = record('update');
      chain.delete = record('delete');
      chain.eq = record('eq');
      chain.in = record('in');
      chain.order = record('order');
      chain.limit = record('limit');
      chain.is = record('is');
      chain.not = record('not');
      chain.single = () => {
        cap.filters.push({ op: 'single', args: [] });
        // single() resolves to { data: first-item-or-null, error }
        const r = result as { data: unknown; error: unknown };
        const singleData = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
        return Promise.resolve({ data: singleData, error: r.error });
      };
      chain.maybeSingle = () => {
        cap.filters.push({ op: 'maybeSingle', args: [] });
        const r = result as { data: unknown; error: unknown };
        const singleData = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
        return Promise.resolve({ data: singleData, error: r.error });
      };
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return chain;
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockRequireAdmin.mockResolvedValue(adminUser);
});

// ---------------------------------------------------------------------------
// Auth + method guards
// ---------------------------------------------------------------------------

describe('GET /api/admin/studio/video-folders — auth + method', () => {
  it('returns 401 when requireAdmin returns null', async () => {
    mockRequireAdmin.mockImplementation(
      (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
        res.status(401).json({ error: 'Unauthorized' });
        return null;
      },
    );
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
  });

  it('returns 405 on PATCH', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'PATCH' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
  });

  it('returns 405 on DELETE', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'DELETE' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// GET — list folders with computed video_count
// ---------------------------------------------------------------------------

describe('GET /api/admin/studio/video-folders — listing', () => {
  it('returns folders ordered by position with video_count computed from video_library_meta', async () => {
    const captured: Captured[] = [];
    const folders = [
      { id: 'f1', name: 'Condos', position: 1 },
      { id: 'f2', name: 'Lakefront', position: 2 },
    ];
    // f1 has 2 non-archived, non-deleted videos; f2 has 1
    const meta = [
      { folder_id: 'f1', archived_at: null, library_deleted_at: null },
      { folder_id: 'f1', archived_at: null, library_deleted_at: null },
      { folder_id: 'f2', archived_at: null, library_deleted_at: null },
      // This one is archived → must NOT count
      { folder_id: 'f1', archived_at: '2026-06-01T00:00:00Z', library_deleted_at: null },
    ];
    mockGetSupabase.mockReturnValue(makeDb({
      folders: { data: folders, error: null },
      meta: { data: meta, error: null },
      captured,
    }));

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);

    const body = res._body as {
      folders: Array<{ id: string; name: string; position: number; video_count: number }>;
    };
    expect(body.folders).toHaveLength(2);
    expect(body.folders[0]).toMatchObject({ id: 'f1', name: 'Condos', position: 1, video_count: 2 });
    expect(body.folders[1]).toMatchObject({ id: 'f2', name: 'Lakefront', position: 2, video_count: 1 });
  });

  it('returns empty folders array when no folders exist', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({
      folders: { data: [], error: null },
      meta: { data: [], error: null },
      captured,
    }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { folders: unknown[] };
    expect(body.folders).toEqual([]);
  });

  it('returns 503 with migration_pending when video_folders table does not exist (42P01)', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({
      foldersError: { code: '42P01', message: 'relation "video_folders" does not exist' },
      captured,
    }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(503);
    const body = res._body as { error: string };
    expect(body.error).toBe('migration_pending');
  });

  it('returns 500 on non-42P01 errors', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({
      foldersError: { code: '42703', message: 'column does not exist' },
      captured,
    }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(500);
  });

  it('counts only videos where archived_at IS NULL AND library_deleted_at IS NULL', async () => {
    const captured: Captured[] = [];
    const folders = [{ id: 'f1', name: 'Test', position: 1 }];
    // One active, one deleted — only active counts
    const meta = [
      { folder_id: 'f1', archived_at: null, library_deleted_at: null },
      { folder_id: 'f1', archived_at: null, library_deleted_at: '2026-06-10T00:00:00Z' },
    ];
    mockGetSupabase.mockReturnValue(makeDb({
      folders: { data: folders, error: null },
      meta: { data: meta, error: null },
      captured,
    }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { folders: Array<{ video_count: number }> };
    expect(body.folders[0].video_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// POST — create folder
// ---------------------------------------------------------------------------

describe('POST /api/admin/studio/video-folders — create', () => {
  it('inserts a folder with position = max_existing_position + 1 and returns it', async () => {
    const captured: Captured[] = [];
    // Existing folders: highest position is 2
    const existingFolders = [
      { id: 'f1', name: 'A', position: 1 },
      { id: 'f2', name: 'B', position: 2 },
    ];
    const newFolder = { id: 'f3', name: 'New Folder', position: 3 };

    // First call (GET existing folders for max position) → returns existing
    // Second call (INSERT) → returns new folder
    let callCount = 0;
    const db = {
      from(table: string) {
        const cap: Captured = { table, filters: [] };
        captured.push(cap);
        const record = (op: string) => (...args: unknown[]) => { cap.filters.push({ op, args }); return chain; };

        callCount++;
        const result = callCount === 1
          ? { data: existingFolders, error: null }
          : { data: [newFolder], error: null };

        const chain: Record<string, unknown> = {};
        chain.select = record('select');
        chain.insert = record('insert');
        chain.order = record('order');
        chain.limit = record('limit');
        chain.eq = record('eq');
        chain.single = () => {
          cap.filters.push({ op: 'single', args: [] });
          const singleData = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
          return Promise.resolve({ data: singleData, error: result.error });
        };
        chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject);
        return chain;
      },
    };
    mockGetSupabase.mockReturnValue(db);

    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: { name: 'New Folder' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(201);
    const body = res._body as { folder: typeof newFolder };
    expect(body.folder).toMatchObject({ id: 'f3', name: 'New Folder', position: 3 });
  });

  it('creates with position 1 when no folders exist yet', async () => {
    const captured: Captured[] = [];
    const newFolder = { id: 'f1', name: 'First', position: 1 };

    let callCount = 0;
    const db = {
      from(table: string) {
        const cap: Captured = { table, filters: [] };
        captured.push(cap);
        const record = (op: string) => (...args: unknown[]) => { cap.filters.push({ op, args }); return chain; };

        callCount++;
        const result = callCount === 1
          ? { data: [], error: null }          // no existing folders
          : { data: [newFolder], error: null }; // inserted row returned

        const chain: Record<string, unknown> = {};
        chain.select = record('select');
        chain.insert = record('insert');
        chain.order = record('order');
        chain.limit = record('limit');
        chain.single = () => {
          cap.filters.push({ op: 'single', args: [] });
          const singleData = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
          return Promise.resolve({ data: singleData, error: result.error });
        };
        chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject);
        return chain;
      },
    };
    mockGetSupabase.mockReturnValue(db);

    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: { name: 'First' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(201);
    const body = res._body as { folder: { position: number } };
    expect(body.folder.position).toBe(1);
  });

  it('returns 400 when name is missing', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({ captured, folders: { data: [], error: null } }));
    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: {} }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });

  it('returns 400 when name is empty string', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({ captured, folders: { data: [], error: null } }));
    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: { name: '  ' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });

  it('returns 503 when video_folders table does not exist (42P01) on POST', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({
      foldersError: { code: '42P01', message: 'relation "video_folders" does not exist' },
      captured,
    }));
    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: { name: 'Test' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(503);
    const body = res._body as { error: string };
    expect(body.error).toBe('migration_pending');
  });

  it('returns 401 on POST when requireAdmin returns null', async () => {
    mockRequireAdmin.mockImplementation(
      (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
        res.status(401).json({ error: 'Unauthorized' });
        return null;
      },
    );
    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: { name: 'X' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
  });
});
