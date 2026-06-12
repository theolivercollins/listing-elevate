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
vi.mock('../../../../../lib/operator-studio/preview', async (importOriginal) => {
  // Keep the real aggregateViewEvents (pure logic) so the hub's math is exercised,
  // only stub the DB-touching resolveHeroPhotoUrl.
  const actual = await importOriginal<typeof import('../../../../../lib/operator-studio/preview')>();
  return {
    ...actual,
    resolveHeroPhotoUrl: (db: unknown, id: string) => mockResolveHeroPhotoUrl(db, id),
  };
});

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
    query: { id: 'p1' },
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

const adminUser = { user: { id: 'u1', email: 'admin@test.com' }, profile: { role: 'admin' } };

/**
 * Routes results by table name so the order of internal queries doesn't matter.
 * `events` controls preview_view_events: pass { error } to simulate the
 * pre-migration missing-table case.
 */
function makeDb(opts: {
  property: { data: unknown; error: unknown };
  previews: { data: unknown; error: unknown };
  events: { data: unknown; error: unknown };
  notes: { data: unknown; error: unknown };
}) {
  return {
    from(table: string) {
      const result =
        table === 'properties' ? opts.property
        : table === 'property_previews' ? opts.previews
        : table === 'preview_view_events' ? opts.events
        : table === 'property_revision_notes' ? opts.notes
        : { data: null, error: null };
      const chain: Record<string, unknown> = {};
      const passthrough = () => chain;
      chain.select = passthrough;
      chain.eq = passthrough;
      chain.in = passthrough;
      chain.order = passthrough;
      chain.limit = passthrough;
      chain.maybeSingle = () => Promise.resolve(result);
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

describe('GET /api/admin/studio/videos/[id] — auth + method', () => {
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

  it('returns 404 when property not found', async () => {
    mockGetSupabase.mockReturnValue(makeDb({
      property: { data: null, error: null },
      previews: { data: [], error: null },
      events: { data: [], error: null },
      notes: { data: [], error: null },
    }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
  });
});

const property = {
  id: 'p1',
  address: '5019 San Massimo Dr, Punta Gorda, FL 33950, USA',
  horizontal_video_url: 'https://cdn/h.mp4',
  vertical_video_url: 'https://cdn/v.mp4',
  client: { id: 'c1', name: 'Helgemo Team' },
};

// Two links of different kinds, both newer/older — the hub must return BOTH,
// not just the newest of each kind.
const previews = [
  {
    id: 'pv-client-old', token: 'tok_client_old', kind: 'client',
    allow_download: true, allow_approve: true, allow_revision: true,
    approved_at: '2026-06-05T00:00:00Z', label: 'Sent to Brian', revoked_at: null,
    viewed_count: 4, last_viewed_at: '2026-06-06T00:00:00Z',
    created_at: '2026-06-01T00:00:00Z', expires_at: null,
  },
  {
    id: 'pv-public', token: 'tok_public', kind: 'public',
    allow_download: false, allow_approve: false, allow_revision: false,
    approved_at: null, label: 'IG bio', revoked_at: '2026-06-09T00:00:00Z',
    viewed_count: 12, last_viewed_at: null,
    created_at: '2026-06-02T00:00:00Z', expires_at: '2026-07-01T00:00:00Z',
  },
];

const notes = [
  { id: 'n1', source: 'client_approval', body: 'Approved', created_at: '2026-06-06T00:00:00Z' },
];

describe('GET /api/admin/studio/videos/[id] — hub bundle', () => {
  it('returns property, client, hero, ALL links with per-link aggregates, notes, totals', async () => {
    // Events: client-old link → session A plays + reaches 50; session B reaches 100.
    //   public link → session C plays + reaches 25.
    const events = [
      { preview_id: 'pv-client-old', session_id: 'A', event: 'play' },
      { preview_id: 'pv-client-old', session_id: 'A', event: 'progress_25' },
      { preview_id: 'pv-client-old', session_id: 'A', event: 'progress_50' },
      { preview_id: 'pv-client-old', session_id: 'B', event: 'play' },
      { preview_id: 'pv-client-old', session_id: 'B', event: 'complete' },
      { preview_id: 'pv-public', session_id: 'C', event: 'play' },
      { preview_id: 'pv-public', session_id: 'C', event: 'progress_25' },
    ];
    mockGetSupabase.mockReturnValue(makeDb({
      property: { data: property, error: null },
      previews: { data: previews, error: null },
      events: { data: events, error: null },
      notes: { data: notes, error: null },
    }));

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);

    const body = res._body as {
      property: { id: string; address: string; videos: { horizontal: string | null; vertical: string | null } };
      client: { id: string; name: string } | null;
      hero_photo_url: string | null;
      links: Array<{
        id: string; token: string; kind: string; label: string | null;
        revoked_at: string | null; capabilities: { download: boolean; approve: boolean; revision: boolean };
        viewed_count: number;
        analytics: { total_plays: number; unique_viewers: number; avg_completion_pct: number };
      }>;
      revision_notes: Array<{ id: string }>;
      totals: { total_plays: number; unique_viewers: number; avg_completion_pct: number };
    };

    expect(body.property.id).toBe('p1');
    expect(body.property.videos).toEqual({ horizontal: 'https://cdn/h.mp4', vertical: 'https://cdn/v.mp4' });
    expect(body.client).toEqual({ id: 'c1', name: 'Helgemo Team' });
    expect(body.hero_photo_url).toBe('https://cdn/hero.jpg');

    // ALL links returned — both kinds, both rows.
    expect(body.links).toHaveLength(2);
    const clientLink = body.links.find((l) => l.id === 'pv-client-old')!;
    const publicLink = body.links.find((l) => l.id === 'pv-public')!;

    expect(clientLink.label).toBe('Sent to Brian');
    expect(clientLink.capabilities).toEqual({ download: true, approve: true, revision: true });
    // client-old: 2 sessions played; A reached 50, B reached 100 → avg (50+100)/2 = 75
    expect(clientLink.analytics).toEqual({ total_plays: 2, unique_viewers: 2, avg_completion_pct: 75 });

    expect(publicLink.revoked_at).toBe('2026-06-09T00:00:00Z');
    // public: 1 session, reached 25
    expect(publicLink.analytics).toEqual({ total_plays: 1, unique_viewers: 1, avg_completion_pct: 25 });

    // Notes pass through.
    expect(body.revision_notes).toHaveLength(1);
    expect(body.revision_notes[0].id).toBe('n1');

    // Totals across all events: 3 play sessions (A,B,C), 3 unique viewers,
    // avg of furthest-per-session (50, 100, 25) = 58 (rounded).
    expect(body.totals.total_plays).toBe(3);
    expect(body.totals.unique_viewers).toBe(3);
    expect(body.totals.avg_completion_pct).toBe(58);
  });

  it('events-table absent (pre-migration) → zeroed aggregates, status 200', async () => {
    mockGetSupabase.mockReturnValue(makeDb({
      property: { data: property, error: null },
      previews: { data: previews, error: null },
      // Simulate undefined_column / missing table: error set, data null.
      events: { data: null, error: { code: '42P01', message: 'relation "preview_view_events" does not exist' } },
      notes: { data: notes, error: null },
    }));

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);

    const body = res._body as {
      links: Array<{ id: string; analytics: { total_plays: number; unique_viewers: number; avg_completion_pct: number } }>;
      totals: { total_plays: number; unique_viewers: number; avg_completion_pct: number };
    };

    // Still returns all links, just with zeroed analytics.
    expect(body.links).toHaveLength(2);
    for (const link of body.links) {
      expect(link.analytics).toEqual({ total_plays: 0, unique_viewers: 0, avg_completion_pct: 0 });
    }
    expect(body.totals).toEqual({ total_plays: 0, unique_viewers: 0, avg_completion_pct: 0 });
  });

  it('pre-migration label/revoked_at absent on rows → null fallbacks', async () => {
    const bareRows = [
      {
        id: 'pv1', token: 'tok1', kind: 'client',
        allow_download: true, allow_approve: true, allow_revision: true,
        approved_at: null,
        viewed_count: 0, last_viewed_at: null,
        created_at: '2026-06-01T00:00:00Z', expires_at: null,
      },
    ];
    mockGetSupabase.mockReturnValue(makeDb({
      property: { data: property, error: null },
      previews: { data: bareRows, error: null },
      events: { data: [], error: null },
      notes: { data: [], error: null },
    }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { links: Array<{ label: string | null; revoked_at: string | null }> };
    expect(body.links[0].label).toBeNull();
    expect(body.links[0].revoked_at).toBeNull();
  });

  // ── pre-migration back-compat guard (P1 regression fix) ─────────────────────
  // Before this fix, the property_previews SELECT always requested label/revoked_at.
  // Pre-migration PostgREST returns 42703 (undefined_column), so pvError was set
  // and the handler returned 500 — the entire hub failed to load.
  // Fix: on 42703 from the first select, retry without label/revoked_at; hub renders
  // with null labels. Any other error is still a genuine 500.

  it('property_previews 42703 (pre-migration columns absent) → status 200 with null labels', async () => {
    const bareRows = [
      {
        id: 'pv1', token: 'tok1', kind: 'client',
        allow_download: true, allow_approve: true, allow_revision: true,
        approved_at: null, viewed_count: 0, last_viewed_at: null,
        created_at: '2026-06-01T00:00:00Z', expires_at: null,
        // No label / revoked_at — simulates pre-migration row shape from fallback select
      },
    ];

    // Custom db mock: property_previews fails with 42703 on the first call,
    // succeeds with bare rows on the second call (the fallback select).
    let previewsCallCount = 0;
    const db = {
      from(table: string) {
        const isProperty = table === 'properties';
        const isNotes = table === 'property_revision_notes';
        const isEvents = table === 'preview_view_events';
        const isPreviews = table === 'property_previews';

        let result: { data: unknown; error: unknown };
        if (isProperty) {
          result = { data: property, error: null };
        } else if (isPreviews) {
          previewsCallCount += 1;
          // First call (full select with label/revoked_at) → 42703.
          // Second call (fallback select without those columns) → success.
          result = previewsCallCount === 1
            ? { data: null, error: { code: '42703', message: 'column "label" of relation "property_previews" does not exist' } }
            : { data: bareRows, error: null };
        } else if (isEvents) {
          result = { data: [], error: null };
        } else if (isNotes) {
          result = { data: [], error: null };
        } else {
          result = { data: null, error: null };
        }

        const chain: Record<string, unknown> = {};
        const passthrough = () => chain;
        chain.select = passthrough;
        chain.eq = passthrough;
        chain.in = passthrough;
        chain.order = passthrough;
        chain.limit = passthrough;
        chain.maybeSingle = () => Promise.resolve(result);
        chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject);
        return chain;
      },
    };

    mockGetSupabase.mockReturnValue(db);

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);

    // Hub must render, not 500.
    expect(res._status).toBe(200);

    const body = res._body as {
      links: Array<{ id: string; label: string | null; revoked_at: string | null }>;
      totals: { total_plays: number };
    };
    expect(body.links).toHaveLength(1);
    // label and revoked_at fall back to null when columns are absent.
    expect(body.links[0].label).toBeNull();
    expect(body.links[0].revoked_at).toBeNull();

    // The fallback select was triggered (two calls to property_previews).
    expect(previewsCallCount).toBe(2);
  });

  it('property_previews non-42703 error → status 500 (real errors surface)', async () => {
    mockGetSupabase.mockReturnValue(makeDb({
      property: { data: property, error: null },
      previews: { data: null, error: { code: '23503', message: 'foreign key violation' } },
      events: { data: [], error: null },
      notes: { data: [], error: null },
    }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(500);
  });
});
