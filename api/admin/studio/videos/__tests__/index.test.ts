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
  meta?: { data: unknown; error: unknown };
  creatives?: { data: unknown; count: number | null; error: unknown };
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
          : table === 'creatives'
            ? (opts.creatives ?? { data: [], count: 0, error: null })
          : table === 'video_library_meta'
            ? (opts.meta ?? { data: [], error: null })
            : (opts.previews ?? { data: [], error: null });
      const chain: Record<string, unknown> = {};
      chain.select = record('select');
      chain.eq = record('eq');
      chain.not = record('not');
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

  it('paginates with page size 24 (page 2 → overfetches range 0..47 before hosted merge)', async () => {
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
    expect(range!.args).toEqual([0, 47]);
  });

  it('includes uploaded hosted videos from creatives as first-class library items', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({
      properties: { data: [], count: 0, error: null },
      creatives: {
        data: [
          {
            id: 'creative-1',
            title: 'Aysen hosted master',
            description: 'Listing Elevate upload',
            public_url: 'https://stream.example/play.mp4',
            thumbnail_url: 'https://cdn/thumb.jpg',
            created_at: '2026-06-12T12:00:00Z',
            share_token: 'hosted-token',
            view_count: 42,
          },
        ],
        count: 1,
        error: null,
      },
      captured,
    }));

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);

    const body = res._body as {
      items: Array<{
        id: string;
        title: string;
        address: string;
        description: string | null;
        library_source: string;
        hero_photo_url: string | null;
        total_views: number;
        link_count: number;
        shareUrl: string;
        embedUrl: string;
        manageUrl: string;
      }>;
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: 'creative-1',
      title: 'Aysen hosted master',
      address: 'Aysen hosted master',
      description: 'Listing Elevate upload',
      library_source: 'upload',
      hero_photo_url: 'https://cdn/thumb.jpg',
      total_views: 42,
      link_count: 1,
      shareUrl: 'https://listingelevate.com/v/hosted-token',
      embedUrl: 'https://listingelevate.com/embed/hosted-token',
      manageUrl: '/dashboard/studio/video/share?creative=creative-1',
    });

    const creativesQuery = captured.find((c) => c.table === 'creatives')!;
    expect(creativesQuery).toBeDefined();
    expect(creativesQuery.filters.some((f) => f.op === 'eq' && f.args[0] === 'kind' && f.args[1] === 'video')).toBe(true);
    expect(creativesQuery.filters.some((f) => f.op === 'eq' && f.args[0] === 'source' && f.args[1] === 'upload')).toBe(true);
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

describe('GET /api/admin/studio/videos — folders + archive (video_library_meta sidecar)', () => {
  // Three properties on the page: p1 filed in folder f1, p2 archived, p3 deleted,
  // p4 unfiled (no meta row at all).
  function fourProps() {
    return [
      { id: 'p1', address: '1 Filed St', horizontal_video_url: 'https://cdn/h1.mp4', vertical_video_url: null, created_at: '2026-06-01T00:00:00Z', client: null },
      { id: 'p2', address: '2 Archived St', horizontal_video_url: 'https://cdn/h2.mp4', vertical_video_url: null, created_at: '2026-06-01T00:00:00Z', client: null },
      { id: 'p3', address: '3 Deleted St', horizontal_video_url: 'https://cdn/h3.mp4', vertical_video_url: null, created_at: '2026-06-01T00:00:00Z', client: null },
      { id: 'p4', address: '4 Unfiled St', horizontal_video_url: 'https://cdn/h4.mp4', vertical_video_url: null, created_at: '2026-06-01T00:00:00Z', client: null },
    ];
  }
  function metaRows() {
    return [
      { property_id: 'p1', folder_id: 'f1', archived_at: null, library_deleted_at: null },
      { property_id: 'p2', folder_id: null, archived_at: '2026-06-05T00:00:00Z', library_deleted_at: null },
      { property_id: 'p3', folder_id: 'f1', archived_at: null, library_deleted_at: '2026-06-06T00:00:00Z' },
      // p4 has no meta row.
    ];
  }

  it('default view excludes archived and deleted; items carry folder_id and archived_at', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({
      properties: { data: fourProps(), count: 4, error: null },
      meta: { data: metaRows(), error: null },
      captured,
    }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { items: Array<{ id: string; folder_id: string | null; archived_at: string | null }>; total: number };
    // p2 (archived) and p3 (deleted) excluded → p1 + p4.
    expect(body.items.map((i) => i.id).sort()).toEqual(['p1', 'p4']);
    expect(body.total).toBe(2);
    const p1 = body.items.find((i) => i.id === 'p1')!;
    expect(p1.folder_id).toBe('f1');
    expect(p1.archived_at).toBeNull();
    const p4 = body.items.find((i) => i.id === 'p4')!;
    expect(p4.folder_id).toBeNull();
    expect(p4.archived_at).toBeNull();

    // The meta query must scope to the page's property ids via .in().
    const metaQuery = captured.find((c) => c.table === 'video_library_meta')!;
    expect(metaQuery).toBeDefined();
    const inFilter = metaQuery.filters.find((f) => f.op === 'in');
    expect(inFilter).toBeDefined();
  });

  it('?archived=1 returns only archived (and not deleted)', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({
      properties: { data: fourProps(), count: 4, error: null },
      meta: { data: metaRows(), error: null },
      captured,
    }));
    const res = makeRes();
    await handler(makeReq({ query: { archived: '1' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { items: Array<{ id: string; archived_at: string | null }>; total: number };
    expect(body.items.map((i) => i.id)).toEqual(['p2']);
    expect(body.items[0].archived_at).toBe('2026-06-05T00:00:00Z');
    expect(body.total).toBe(1);
  });

  it('?folder=<id> filters to that folder (excluding deleted)', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({
      properties: { data: fourProps(), count: 4, error: null },
      meta: { data: metaRows(), error: null },
      captured,
    }));
    const res = makeRes();
    await handler(makeReq({ query: { folder: 'f1' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { items: Array<{ id: string }>; total: number };
    // p1 and p3 are in f1, but p3 is deleted → only p1.
    expect(body.items.map((i) => i.id)).toEqual(['p1']);
    expect(body.total).toBe(1);
  });

  it('?folder=none returns only unfiled (no meta row OR null folder_id, not archived)', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({
      properties: { data: fourProps(), count: 4, error: null },
      meta: { data: metaRows(), error: null },
      captured,
    }));
    const res = makeRes();
    await handler(makeReq({ query: { folder: 'none' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { items: Array<{ id: string }>; total: number };
    // p4 has no meta row (unfiled). p2 has null folder_id but is archived → excluded by default archived filter.
    expect(body.items.map((i) => i.id)).toEqual(['p4']);
    expect(body.total).toBe(1);
  });

  it('pre-migration: meta query errors with table-absent code → full library renders, no 500', async () => {
    const captured: Captured[] = [];
    mockGetSupabase.mockReturnValue(makeDb({
      properties: { data: fourProps(), count: 4, error: null },
      meta: { data: null, error: { code: '42P01', message: 'relation "video_library_meta" does not exist' } },
      captured,
    }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { items: Array<{ id: string; folder_id: string | null; archived_at: string | null }>; total: number };
    // No meta → nothing deleted/archived → all four render as unfiled.
    expect(body.items.map((i) => i.id).sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(body.total).toBe(4);
    for (const item of body.items) {
      expect(item.folder_id).toBeNull();
      expect(item.archived_at).toBeNull();
    }
  });
});
