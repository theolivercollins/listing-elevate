import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ---------------------------------------------------------------------------
// Mocks — 5 levels deep (same as index.test.ts in this directory)
// ---------------------------------------------------------------------------

const mockRequireAdmin = vi.fn();
const mockGetSupabase = vi.fn();

vi.mock('../../../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock('../../../../../lib/client', () => ({
  getSupabase: () => mockGetSupabase(),
}));

// Import AFTER mocks are set up.
import handler from '../[id]/library';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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
    query: { id: 'prop-uuid-1' },
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

const adminUser = { user: { id: 'u1', email: 'admin@test.com' }, profile: { role: 'admin' } };

// ---------------------------------------------------------------------------
// Chainable DB mock
//
// Captures the table name + method calls so tests can assert which table was
// acted on and with which arguments. Supports:
//   .upsert(data, opts)   → captures args, resolves { error: null }
//   .delete()             → returns a chain (chainable .eq()); resolves { error: null }
//   .eq(col, val)         → captures args, keeps chain alive
//
// Each `from(table)` call gets its own captured entry, so tests can identify
// separate operations across different tables.
// ---------------------------------------------------------------------------

type CapturedCall = { method: string; args: unknown[] };
type CapturedTable = { table: string; calls: CapturedCall[] };

function makeDb(opts: {
  upsertError?: { code?: string; message?: string } | null;
  deleteError?: { message?: string } | null;
  captured: CapturedTable[];
}) {
  return {
    from(table: string) {
      const entry: CapturedTable = { table, calls: [] };
      opts.captured.push(entry);

      // A thenable chain — each method records its call and returns the chain
      // so that callers can await the whole expression.
      const chain: Record<string, unknown> & {
        then: (
          resolve: (v: unknown) => unknown,
          reject: (e: unknown) => unknown,
        ) => Promise<unknown>;
      } = {
        then: (resolve, reject) => {
          // Default resolution — specific methods override below by replacing
          // this property. We resolve with the appropriate error result.
          const lastMethod = entry.calls[entry.calls.length - 1]?.method;
          const isDelete = entry.calls.some((c) => c.method === 'delete');
          const result = isDelete
            ? { error: opts.deleteError ?? null }
            : { error: opts.upsertError ?? null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };

      // Helper: record a call and return the chain so it's chainable.
      const record =
        (method: string) =>
        (...args: unknown[]) => {
          entry.calls.push({ method, args });
          return chain;
        };

      chain.upsert = record('upsert');
      chain.delete = record('delete');
      chain.eq = record('eq');

      return chain;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
  mockRequireAdmin.mockResolvedValue(adminUser);
});

// ── Auth + method guards ─────────────────────────────────────────────────────

describe('POST /api/admin/studio/videos/[id]/library — auth + method', () => {
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
    const captured: CapturedTable[] = [];
    mockGetSupabase.mockReturnValue(makeDb({ captured }));
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
    // No DB writes should have happened on a wrong-method request.
    expect(captured).toHaveLength(0);
  });
});

// ── Input validation ─────────────────────────────────────────────────────────

describe('POST /api/admin/studio/videos/[id]/library — validation', () => {
  it('returns 400 on unknown action', async () => {
    const captured: CapturedTable[] = [];
    mockGetSupabase.mockReturnValue(makeDb({ captured }));
    const res = makeRes();
    await handler(makeReq({ body: { action: 'nuke' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
    const body = res._body as { error: string };
    expect(body.error).toMatch(/action/i);
    expect(captured).toHaveLength(0);
  });

  it('returns 400 when action is missing', async () => {
    const captured: CapturedTable[] = [];
    mockGetSupabase.mockReturnValue(makeDb({ captured }));
    const res = makeRes();
    await handler(makeReq({ body: {} }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });
});

// ── Pre-migration tolerance (42P01 table not found) ──────────────────────────

describe('POST /api/admin/studio/videos/[id]/library — pre-migration tolerance', () => {
  it('returns 503 migration_pending when video_library_meta table is absent (42P01)', async () => {
    const captured: CapturedTable[] = [];
    mockGetSupabase.mockReturnValue(
      makeDb({ upsertError: { code: '42P01', message: 'relation "video_library_meta" does not exist' }, captured }),
    );
    const res = makeRes();
    await handler(makeReq({ body: { action: 'archive' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(503);
    const body = res._body as { error: string };
    expect(body.error).toBe('migration_pending');
  });
});

// ── action: 'move' ────────────────────────────────────────────────────────────

describe("action: 'move'", () => {
  it('upserts folder_id with the provided folder uuid', async () => {
    const captured: CapturedTable[] = [];
    mockGetSupabase.mockReturnValue(makeDb({ captured }));
    const res = makeRes();
    await handler(
      makeReq({ body: { action: 'move', folder_id: 'folder-uuid-99' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);

    const meta = captured.find((c) => c.table === 'video_library_meta');
    expect(meta).toBeDefined();
    const upsertCall = meta!.calls.find((c) => c.method === 'upsert');
    expect(upsertCall).toBeDefined();
    const upsertData = upsertCall!.args[0] as Record<string, unknown>;
    expect(upsertData.property_id).toBe('prop-uuid-1');
    expect(upsertData.folder_id).toBe('folder-uuid-99');
    // Must not touch archive or delete fields.
    expect(upsertData).not.toHaveProperty('archived_at');
    expect(upsertData).not.toHaveProperty('library_deleted_at');
  });

  it('upserts folder_id = null to unfile a video', async () => {
    const captured: CapturedTable[] = [];
    mockGetSupabase.mockReturnValue(makeDb({ captured }));
    const res = makeRes();
    // folder_id explicitly present as null (unfile)
    await handler(
      makeReq({ body: { action: 'move', folder_id: null } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);

    const meta = captured.find((c) => c.table === 'video_library_meta');
    expect(meta).toBeDefined();
    const upsertCall = meta!.calls.find((c) => c.method === 'upsert');
    expect(upsertCall).toBeDefined();
    const upsertData = upsertCall!.args[0] as Record<string, unknown>;
    // folder_id must be null (key present, value null) — distinct from "key absent"
    expect(Object.prototype.hasOwnProperty.call(upsertData, 'folder_id')).toBe(true);
    expect(upsertData.folder_id).toBeNull();
  });

  it('does NOT issue any delete against properties or cost_events on move', async () => {
    const captured: CapturedTable[] = [];
    mockGetSupabase.mockReturnValue(makeDb({ captured }));
    const res = makeRes();
    await handler(
      makeReq({ body: { action: 'move', folder_id: 'f1' } }),
      res as unknown as VercelResponse,
    );
    const touched = captured.map((c) => c.table);
    expect(touched).not.toContain('properties');
    expect(touched).not.toContain('cost_events');
  });
});

// ── action: 'archive' ────────────────────────────────────────────────────────

describe("action: 'archive'", () => {
  it('upserts archived_at = ISO timestamp', async () => {
    const captured: CapturedTable[] = [];
    mockGetSupabase.mockReturnValue(makeDb({ captured }));
    const res = makeRes();
    const before = new Date().toISOString();
    await handler(makeReq({ body: { action: 'archive' } }), res as unknown as VercelResponse);
    const after = new Date().toISOString();
    expect(res._status).toBe(200);

    const meta = captured.find((c) => c.table === 'video_library_meta');
    const upsertCall = meta!.calls.find((c) => c.method === 'upsert');
    const upsertData = upsertCall!.args[0] as Record<string, unknown>;
    expect(upsertData.property_id).toBe('prop-uuid-1');
    const archivedAt = upsertData.archived_at as string;
    // Must be a valid ISO timestamp between before and after.
    expect(archivedAt >= before).toBe(true);
    expect(archivedAt <= after).toBe(true);
    // Must not set library_deleted_at on archive.
    expect(upsertData).not.toHaveProperty('library_deleted_at');
  });

  it('does NOT delete from property_previews, properties, or cost_events on archive', async () => {
    const captured: CapturedTable[] = [];
    mockGetSupabase.mockReturnValue(makeDb({ captured }));
    const res = makeRes();
    await handler(makeReq({ body: { action: 'archive' } }), res as unknown as VercelResponse);
    const touched = captured.map((c) => c.table);
    expect(touched).not.toContain('property_previews');
    expect(touched).not.toContain('properties');
    expect(touched).not.toContain('cost_events');
  });
});

// ── action: 'restore' ────────────────────────────────────────────────────────

describe("action: 'restore'", () => {
  it('upserts archived_at = null', async () => {
    const captured: CapturedTable[] = [];
    mockGetSupabase.mockReturnValue(makeDb({ captured }));
    const res = makeRes();
    await handler(makeReq({ body: { action: 'restore' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(200);

    const meta = captured.find((c) => c.table === 'video_library_meta');
    const upsertCall = meta!.calls.find((c) => c.method === 'upsert');
    const upsertData = upsertCall!.args[0] as Record<string, unknown>;
    expect(upsertData.property_id).toBe('prop-uuid-1');
    // archived_at must be explicitly set to null (not absent).
    expect(Object.prototype.hasOwnProperty.call(upsertData, 'archived_at')).toBe(true);
    expect(upsertData.archived_at).toBeNull();
  });
});

// ── action: 'delete' ─────────────────────────────────────────────────────────

describe("action: 'delete'", () => {
  it('upserts library_deleted_at AND deletes property_previews rows for the property', async () => {
    const captured: CapturedTable[] = [];
    mockGetSupabase.mockReturnValue(makeDb({ captured }));
    const res = makeRes();
    const before = new Date().toISOString();
    await handler(makeReq({ body: { action: 'delete' } }), res as unknown as VercelResponse);
    const after = new Date().toISOString();
    expect(res._status).toBe(200);

    // (a) upsert on video_library_meta with library_deleted_at set
    const meta = captured.find((c) => c.table === 'video_library_meta');
    expect(meta).toBeDefined();
    const upsertCall = meta!.calls.find((c) => c.method === 'upsert');
    expect(upsertCall).toBeDefined();
    const upsertData = upsertCall!.args[0] as Record<string, unknown>;
    const deletedAt = upsertData.library_deleted_at as string;
    expect(deletedAt >= before).toBe(true);
    expect(deletedAt <= after).toBe(true);

    // (b) delete from property_previews scoped to property_id
    const ppEntry = captured.find((c) => c.table === 'property_previews');
    expect(ppEntry).toBeDefined();
    const deleteCall = ppEntry!.calls.find((c) => c.method === 'delete');
    expect(deleteCall).toBeDefined();
    // The .eq() filter after .delete() must scope to the property_id
    const eqCall = ppEntry!.calls.find(
      (c) => c.method === 'eq' && c.args[0] === 'property_id',
    );
    expect(eqCall).toBeDefined();
    expect(eqCall!.args[1]).toBe('prop-uuid-1');
  });

  it('does NOT delete or update the properties table on delete', async () => {
    const captured: CapturedTable[] = [];
    mockGetSupabase.mockReturnValue(makeDb({ captured }));
    const res = makeRes();
    await handler(makeReq({ body: { action: 'delete' } }), res as unknown as VercelResponse);
    const touched = captured.map((c) => c.table);
    expect(touched).not.toContain('properties');
  });

  it('does NOT touch cost_events on delete', async () => {
    const captured: CapturedTable[] = [];
    mockGetSupabase.mockReturnValue(makeDb({ captured }));
    const res = makeRes();
    await handler(makeReq({ body: { action: 'delete' } }), res as unknown as VercelResponse);
    const touched = captured.map((c) => c.table);
    expect(touched).not.toContain('cost_events');
  });

  it('does NOT manually delete preview_view_events (cascade handles it)', async () => {
    const captured: CapturedTable[] = [];
    mockGetSupabase.mockReturnValue(makeDb({ captured }));
    const res = makeRes();
    await handler(makeReq({ body: { action: 'delete' } }), res as unknown as VercelResponse);
    const touched = captured.map((c) => c.table);
    expect(touched).not.toContain('preview_view_events');
  });
});
