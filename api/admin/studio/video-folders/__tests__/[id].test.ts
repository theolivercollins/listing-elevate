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

import handler from '../[id]';

function makeRes() {
  const res = {
    _status: 0,
    _body: {} as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
    end() { return this; },
  };
  return res;
}

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'PATCH',
    query: { id: 'f1' },
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
 * makeDb — for the [id] route which issues a single UPDATE or DELETE
 * against video_folders, filtered by eq('id', ...).
 */
function makeDb(opts: {
  result?: { data: unknown; error: unknown };
  captured: Captured[];
  dbError?: { code: string; message: string };
}) {
  return {
    from(table: string) {
      const cap: Captured = { table, filters: [] };
      opts.captured.push(cap);
      const record = (op: string) => (...args: unknown[]) => { cap.filters.push({ op, args }); return chain; };

      const result = opts.dbError
        ? { data: null, error: opts.dbError }
        : (opts.result ?? { data: [{ id: 'f1' }], error: null });

      const chain: Record<string, unknown> = {};
      chain.update = record('update');
      chain.delete = record('delete');
      chain.eq = record('eq');
      chain.select = record('select');
      chain.single = () => {
        cap.filters.push({ op: 'single', args: [] });
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

describe('video-folders/[id] — auth + method', () => {
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

  it('returns 405 on GET', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
  });

  it('returns 405 on POST', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'POST' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
  });

  it('returns 400 when id query param is missing', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({ captured }));
    const res = makeRes();
    await handler(makeReq({ query: {} }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH — update name and/or position
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/studio/video-folders/[id]', () => {
  it('updates name when provided', async () => {
    const captured: Captured[] = [];
    const updated = { id: 'f1', name: 'Renamed', position: 2 };
    mockGetSupabase.mockReturnValue(makeDb({
      result: { data: [updated], error: null },
      captured,
    }));
    const res = makeRes();
    await handler(
      makeReq({ method: 'PATCH', query: { id: 'f1' }, body: { name: 'Renamed' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    const body = res._body as { folder: typeof updated };
    expect(body.folder).toMatchObject({ id: 'f1', name: 'Renamed' });

    // Verify eq filter used the correct id
    const cap = captured.find((c) => c.table === 'video_folders')!;
    const eqFilter = cap.filters.find((f) => f.op === 'eq');
    expect(eqFilter?.args).toEqual(['id', 'f1']);
  });

  it('updates position when provided', async () => {
    const captured: Captured[] = [];
    const updated = { id: 'f1', name: 'Condos', position: 5 };
    mockGetSupabase.mockReturnValue(makeDb({
      result: { data: [updated], error: null },
      captured,
    }));
    const res = makeRes();
    await handler(
      makeReq({ method: 'PATCH', query: { id: 'f1' }, body: { position: 5 } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    const body = res._body as { folder: typeof updated };
    expect(body.folder.position).toBe(5);
  });

  it('updates both name and position at once', async () => {
    const captured: Captured[] = [];
    const updated = { id: 'f1', name: 'Renamed', position: 3 };
    mockGetSupabase.mockReturnValue(makeDb({
      result: { data: [updated], error: null },
      captured,
    }));
    const res = makeRes();
    await handler(
      makeReq({ method: 'PATCH', query: { id: 'f1' }, body: { name: 'Renamed', position: 3 } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
  });

  it('returns 400 when body is empty (nothing to update)', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({ captured }));
    const res = makeRes();
    await handler(
      makeReq({ method: 'PATCH', query: { id: 'f1' }, body: {} }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
  });

  it('returns 503 when video_folders table does not exist (42P01)', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({
      dbError: { code: '42P01', message: 'relation "video_folders" does not exist' },
      captured,
    }));
    const res = makeRes();
    await handler(
      makeReq({ method: 'PATCH', query: { id: 'f1' }, body: { name: 'X' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(503);
    const body = res._body as { error: string };
    expect(body.error).toBe('migration_pending');
  });

  it('returns 500 on other DB errors during PATCH', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({
      dbError: { code: '23505', message: 'unique violation' },
      captured,
    }));
    const res = makeRes();
    await handler(
      makeReq({ method: 'PATCH', query: { id: 'f1' }, body: { name: 'Dupe' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(500);
  });

  it('returns 401 on PATCH when requireAdmin returns null', async () => {
    mockRequireAdmin.mockImplementation(
      (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
        res.status(401).json({ error: 'Unauthorized' });
        return null;
      },
    );
    const res = makeRes();
    await handler(
      makeReq({ method: 'PATCH', query: { id: 'f1' }, body: { name: 'X' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE — remove folder (FK ON DELETE SET NULL un-files videos)
// ---------------------------------------------------------------------------

describe('DELETE /api/admin/studio/video-folders/[id]', () => {
  it('deletes the folder and returns 204', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({
      result: { data: null, error: null },
      captured,
    }));
    const res = makeRes();
    await handler(
      makeReq({ method: 'DELETE', query: { id: 'f1' }, body: {} }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(204);

    // Verify the eq filter was applied with the correct id
    const cap = captured.find((c) => c.table === 'video_folders')!;
    const eqFilter = cap.filters.find((f) => f.op === 'eq');
    expect(eqFilter?.args).toEqual(['id', 'f1']);
  });

  it('returns 503 when video_folders table does not exist (42P01) on DELETE', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({
      dbError: { code: '42P01', message: 'relation "video_folders" does not exist' },
      captured,
    }));
    const res = makeRes();
    await handler(
      makeReq({ method: 'DELETE', query: { id: 'f1' }, body: {} }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(503);
    const body = res._body as { error: string };
    expect(body.error).toBe('migration_pending');
  });

  it('returns 500 on non-42P01 errors during DELETE', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({
      dbError: { code: '23503', message: 'foreign key violation' },
      captured,
    }));
    const res = makeRes();
    await handler(
      makeReq({ method: 'DELETE', query: { id: 'f1' }, body: {} }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(500);
  });

  it('returns 401 on DELETE when requireAdmin returns null', async () => {
    mockRequireAdmin.mockImplementation(
      (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
        res.status(401).json({ error: 'Unauthorized' });
        return null;
      },
    );
    const res = makeRes();
    await handler(
      makeReq({ method: 'DELETE', query: { id: 'f1' }, body: {} }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(401);
  });
});
