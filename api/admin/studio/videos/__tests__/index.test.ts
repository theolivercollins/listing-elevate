import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockRequireAdmin = vi.fn();
const mockGetSupabase = vi.fn();
const mockResolveHeroPhotoUrl = vi.fn();

vi.mock('../../../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock('../../../../../lib/client', () => ({
  getSupabase: () => mockGetSupabase(),
}));
vi.mock('../../../../../lib/operator-studio/preview', () => ({
  resolveHeroPhotoUrl: (db: unknown, id: string) => mockResolveHeroPhotoUrl(db, id),
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

/**
 * Records every filter call so tests can assert the query that was built.
 * `properties` resolves to { data, count, error }; `property_previews`
 * resolves to a plain { data, error } (used for per-property aggregate counts).
 */
type Captured = {
  table: string;
  filters: Array<{ op: string; args: unknown[] }>;
};

function makeDb(opts: {
  properties: { data: unknown; count: number | null; error: unknown };
  previews?: { data: unknown; error: unknown };
  captured: Captured[];
}) {
  return {
    from(table: string) {
      const cap: Captured = { table, filters: [] };
      opts.captured.push(cap);
      const record = (op: string) => (...args: unknown[]) => { cap.filters.push({ op, args }); return chain; };
      const result =
        table === 'properties'
          ? { data: opts.properties.data, count: opts.properties.count, error: opts.properties.error }
          : (opts.previews ?? { data: [], error: null });
      const chain: Record<string, unknown> = {};
      chain.select = record('select');
      chain.eq = record('eq');
      chain.or = record('or');
      chain.ilike = record('ilike');
      chain.in = record('in');
      chain.order = record('order');
      chain.range = record('range');
      chain.limit = record('limit');
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return chain;
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockRequireAdmin.mockResolvedValue(adminUser);
  mockResolveHeroPhotoUrl.mockResolvedValue('https://cdn/hero.jpg');
});

describe('GET /api/admin/studio/videos — auth + method', () => {
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
    const res = makeRes();
    await handler(makeReq({ method: 'POST' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
  });
});

describe('GET /api/admin/studio/videos — listing', () => {
  it('lists only video-bearing properties with hero, client, link count and view totals', async () => {
    const captured: Captured[] = [];
    const props = [
      {
        id: 'p1',
        address: '123 Main St, Springfield, IL 62701, USA',
        horizontal_video_url: 'https://cdn/h1.mp4',
        vertical_video_url: null,
        approved_at: null,
        created_at: '2026-06-01T00:00:00Z',
        client: { id: 'c1', name: 'Helgemo Team' },
      },
    ];
    mockGetSupabase.mockReturnValue(makeDb({
      properties: { data: props, count: 1, error: null },
      // property_previews aggregate for p1: 2 links, 5 + 3 views
      previews: { data: [{ property_id: 'p1', viewed_count: 5 }, { property_id: 'p1', viewed_count: 3 }], error: null },
      captured,
    }));

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);

    const body = res._body as {
      items: Array<{
        id: string;
        address: string;
        hero_photo_url: string | null;
        client: { id: string; name: string } | null;
        videos: { horizontal: string | null; vertical: string | null };
        link_count: number;
        total_views: number;
      }>;
      total: number;
      page: number;
      pageSize: number;
    };

    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(24);
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    expect(item.id).toBe('p1');
    expect(item.hero_photo_url).toBe('https://cdn/hero.jpg');
    expect(item.client).toEqual({ id: 'c1', name: 'Helgemo Team' });
    expect(item.videos).toEqual({ horizontal: 'https://cdn/h1.mp4', vertical: null });
    expect(item.link_count).toBe(2);
    expect(item.total_views).toBe(8);

    // The properties query must filter to rows with at least one video URL.
    const propsQuery = captured.find((c) => c.table === 'properties')!;
    const orFilter = propsQuery.filters.find((f) => f.op === 'or');
    expect(orFilter).toBeDefined();
    expect(String(orFilter!.args[0])).toContain('horizontal_video_url');
    expect(String(orFilter!.args[0])).toContain('vertical_video_url');
  });

  it('applies client_id filter when provided', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({
      properties: { data: [], count: 0, error: null },
      captured,
    }));
    const res = makeRes();
    await handler(makeReq({ query: { client_id: 'c9' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const propsQuery = captured.find((c) => c.table === 'properties')!;
    const eqFilter = propsQuery.filters.find((f) => f.op === 'eq' && f.args[0] === 'client_id');
    expect(eqFilter).toBeDefined();
    expect(eqFilter!.args[1]).toBe('c9');
  });

  it('applies case-insensitive address search when q provided', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({
      properties: { data: [], count: 0, error: null },
      captured,
    }));
    const res = makeRes();
    await handler(makeReq({ query: { q: 'Main' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const propsQuery = captured.find((c) => c.table === 'properties')!;
    const ilike = propsQuery.filters.find((f) => f.op === 'ilike' && f.args[0] === 'address');
    expect(ilike).toBeDefined();
    expect(String(ilike!.args[1])).toContain('Main');
  });

  it('paginates with page size 24 (page 2 → range 24..47)', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({
      properties: { data: [], count: 100, error: null },
      captured,
    }));
    const res = makeRes();
    await handler(makeReq({ query: { page: '2' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { page: number; pageSize: number; total: number };
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(24);
    expect(body.total).toBe(100);
    const propsQuery = captured.find((c) => c.table === 'properties')!;
    const range = propsQuery.filters.find((f) => f.op === 'range');
    expect(range).toBeDefined();
    expect(range!.args).toEqual([24, 47]);
  });

  it('returns 500 when the properties query errors (not column-missing)', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({
      properties: { data: null, count: null, error: { message: 'boom' } },
      captured,
    }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(500);
  });

  // REGRESSION: approved_at lives on property_previews, NOT on properties.
  // Selecting it from properties causes Postgres 42703 undefined_column → 500.
  it('does NOT select approved_at from the properties table', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({
      properties: { data: [], count: 0, error: null },
      captured,
    }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    const propsQuery = captured.find((c) => c.table === 'properties')!;
    const selectFilter = propsQuery.filters.find((f) => f.op === 'select');
    expect(selectFilter).toBeDefined();
    // The first arg to .select() is the column string — must NOT contain approved_at.
    expect(String(selectFilter!.args[0])).not.toContain('approved_at');
  });

  // REGRESSION: approved_at must still surface on items — derived from property_previews.
  it('derives approved_at from property_previews (most recent non-null wins)', async () => {
    const captured: Captured[] = [];
    const props = [
      {
        id: 'p1',
        address: '1 Approved Ave',
        horizontal_video_url: 'https://cdn/h1.mp4',
        vertical_video_url: null,
        created_at: '2026-06-01T00:00:00Z',
        client: null,
      },
      {
        id: 'p2',
        address: '2 Pending Blvd',
        horizontal_video_url: 'https://cdn/h2.mp4',
        vertical_video_url: null,
        created_at: '2026-06-01T00:00:00Z',
        client: null,
      },
    ];
    mockGetSupabase.mockReturnValue(makeDb({
      properties: { data: props, count: 2, error: null },
      previews: {
        data: [
          // p1 has two links: one approved, one not
          { property_id: 'p1', viewed_count: 2, approved_at: '2026-06-10T12:00:00Z' },
          { property_id: 'p1', viewed_count: 1, approved_at: null },
          // p2 has no approved links
          { property_id: 'p2', viewed_count: 5, approved_at: null },
        ],
        error: null,
      },
      captured,
    }));

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { items: Array<{ id: string; approved_at: string | null }> };
    const p1 = body.items.find((i) => i.id === 'p1')!;
    const p2 = body.items.find((i) => i.id === 'p2')!;
    // p1 has a non-null approved_at from a link
    expect(p1.approved_at).toBe('2026-06-10T12:00:00Z');
    // p2 has no approved links → null
    expect(p2.approved_at).toBeNull();

    // The property_previews query must select approved_at
    const pvQuery = captured.find((c) => c.table === 'property_previews')!;
    const pvSelect = pvQuery.filters.find((f) => f.op === 'select');
    expect(pvSelect).toBeDefined();
    expect(String(pvSelect!.args[0])).toContain('approved_at');
  });
});
