/**
 * Tests for show_branding support across the preview-link admin API surface.
 *
 * Covers:
 *  - PATCH preview-links/[previewId]: validates show_branding (boolean), whitelists it, builds
 *    RETURNING dynamically so capability-only PATCHes never request show_branding (pre-087 safe)
 *  - GET videos/[id]: includes show_branding in the bundle, fallback → true when column absent
 *  - GET preview-links: includes show_branding per row, fallback → true when column absent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ────────────────────────────────────────────────────────────────────────────
// Shared mock scaffolding
// ────────────────────────────────────────────────────────────────────────────

const mockRequireAdmin = vi.fn();
const mockGetSupabase = vi.fn();

vi.mock('../../../../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock('../../../../../../lib/client', () => ({
  getSupabase: () => mockGetSupabase(),
}));

// Shared helpers
function makeRes() {
  const res = {
    _status: 0 as number,
    _body: undefined as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
  };
  return res;
}

const adminUser = { user: { id: 'u1', email: 'admin@test.com' }, profile: { role: 'admin' } };

// ────────────────────────────────────────────────────────────────────────────
// PATCH preview-links/[previewId]
// ────────────────────────────────────────────────────────────────────────────

describe('PATCH preview-links/[previewId] — show_branding', () => {
  // We need to mock at the path the PATCH handler actually imports from.
  // The handler is at api/admin/studio/properties/[id]/preview-links/[previewId].ts
  // and imports from ../../../../../../lib/auth and ../../../../../../lib/client.
  // Because vi.mock paths are resolved from the test file location, we need
  // to re-mock for this handler specifically using inline mocks in the
  // Supabase chain rather than relying on the module registry.

  // Track what selectCols string was used in the last .select() call.
  let capturedSelectCols = '';
  let capturedPatch: Record<string, unknown> = {};

  function makePatchChain(result: { data: unknown; error: { message: string; code?: string } | null }) {
    const chain = {
      from(_table: string) { return chain; },
      update(patch: Record<string, unknown>) { capturedPatch = patch; return chain; },
      eq(_col: string, _val: string) { return chain; },
      select(cols: string) { capturedSelectCols = cols; return chain; },
      single() { return Promise.resolve(result); },
    };
    return chain;
  }

  function makeReq(body: Record<string, unknown>, overrides: Partial<VercelRequest> = {}): VercelRequest {
    return {
      method: 'PATCH',
      query: { id: 'prop1', previewId: 'prev1' },
      body,
      headers: {},
      ...overrides,
    } as unknown as VercelRequest;
  }

  beforeEach(() => {
    mockRequireAdmin.mockReset();
    mockGetSupabase.mockReset();
    capturedSelectCols = '';
    capturedPatch = {};
    mockRequireAdmin.mockResolvedValue(adminUser);
  });

  it('accepts show_branding:true and includes show_branding in RETURNING', async () => {
    const chain = makePatchChain({ data: { id: 'prev1', show_branding: true }, error: null });
    mockGetSupabase.mockReturnValue(chain);

    const { default: handler } = await import(
      '../properties/[id]/preview-links/[previewId].js'
    );

    const req = makeReq({ show_branding: true });
    const res = makeRes();
    await handler(req as VercelRequest, res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    expect(capturedPatch).toMatchObject({ show_branding: true });
    expect(capturedSelectCols).toContain('show_branding');
  });

  it('accepts show_branding:false and includes show_branding in RETURNING', async () => {
    const chain = makePatchChain({ data: { id: 'prev1', show_branding: false }, error: null });
    mockGetSupabase.mockReturnValue(chain);

    const { default: handler } = await import(
      '../properties/[id]/preview-links/[previewId].js'
    );

    const req = makeReq({ show_branding: false });
    const res = makeRes();
    await handler(req as VercelRequest, res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    expect(capturedPatch).toMatchObject({ show_branding: false });
    expect(capturedSelectCols).toContain('show_branding');
  });

  it('rejects show_branding:"x" with 400 invalid_field', async () => {
    const chain = makePatchChain({ data: null, error: null });
    mockGetSupabase.mockReturnValue(chain);

    const { default: handler } = await import(
      '../properties/[id]/preview-links/[previewId].js'
    );

    const req = makeReq({ show_branding: 'x' });
    const res = makeRes();
    await handler(req as VercelRequest, res as unknown as VercelResponse);

    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toBe('invalid_field');
  });

  it('rejects show_branding:1 (number) with 400 invalid_field', async () => {
    const chain = makePatchChain({ data: null, error: null });
    mockGetSupabase.mockReturnValue(chain);

    const { default: handler } = await import(
      '../properties/[id]/preview-links/[previewId].js'
    );

    const req = makeReq({ show_branding: 1 });
    const res = makeRes();
    await handler(req as VercelRequest, res as unknown as VercelResponse);

    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toBe('invalid_field');
  });

  it('capability-only PATCH does NOT include show_branding in RETURNING', async () => {
    // This is the critical pre-migration-087 safety test. If a PATCH body has only
    // capability fields, the RETURNING select must NOT contain show_branding.
    // PostgREST would throw 42703 pre-087 if we requested a non-existent column.
    const chain = makePatchChain({ data: { id: 'prev1', allow_download: true }, error: null });
    mockGetSupabase.mockReturnValue(chain);

    const { default: handler } = await import(
      '../properties/[id]/preview-links/[previewId].js'
    );

    const req = makeReq({ allow_download: true });
    const res = makeRes();
    await handler(req as VercelRequest, res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    expect(capturedSelectCols).not.toContain('show_branding');
  });

  it('capability + show_branding PATCH includes show_branding in RETURNING', async () => {
    const chain = makePatchChain({
      data: { id: 'prev1', allow_download: false, show_branding: true },
      error: null,
    });
    mockGetSupabase.mockReturnValue(chain);

    const { default: handler } = await import(
      '../properties/[id]/preview-links/[previewId].js'
    );

    const req = makeReq({ allow_download: false, show_branding: true });
    const res = makeRes();
    await handler(req as VercelRequest, res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    expect(capturedSelectCols).toContain('show_branding');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GET videos/[id] bundle — show_branding fallback
// ────────────────────────────────────────────────────────────────────────────

describe('GET videos/[id] — show_branding in bundle', () => {
  // Re-mock with the correct relative paths the videos handler imports from.
  vi.mock('../../../../lib/auth', () => ({
    requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
  }));
  vi.mock('../../../../lib/client', () => ({
    getSupabase: () => mockGetSupabase(),
  }));
  vi.mock('../../../../lib/operator-studio/preview', () => ({
    resolveHeroPhotoUrl: () => Promise.resolve(null),
    aggregateViewEvents: () => ({ plays: 0, completions: 0, unique_viewers: 0, avg_pct: 0 }),
  }));

  function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
    return {
      method: 'GET',
      query: { id: 'prop1' },
      body: {},
      headers: {},
      ...overrides,
    } as unknown as VercelRequest;
  }

  const baseProperty = {
    id: 'prop1',
    address: '1 Main St',
    horizontal_video_url: null,
    vertical_video_url: null,
    client: null,
  };

  function makeDbChain(opts: {
    pvData?: unknown[];
    pvError?: { code?: string; message: string } | null;
    fallbackPvData?: unknown[];
    fallbackPvError?: { message: string } | null;
  }) {
    const {
      pvData = [],
      pvError = null,
      fallbackPvData = [],
      fallbackPvError = null,
    } = opts;

    let callCount = 0;
    // Track which select was called
    const selectCalls: string[] = [];

    const chain = {
      _selectCalls: selectCalls,
      from(_table: string) { return chain; },
      select(cols: string) {
        selectCalls.push(cols);
        return chain;
      },
      eq(_col: string, _val: string) { return chain; },
      order(_col: string, _opts: unknown) { return chain; },
      in(_col: string, _vals: string[]) { return chain; },
      maybeSingle() {
        return Promise.resolve({ data: baseProperty, error: null });
      },
      then(resolve: (v: { data: unknown; error: unknown }) => unknown) {
        callCount++;
        // First call = property_previews primary; second call = fallback (if applicable)
        if (callCount === 1) {
          return Promise.resolve({ data: pvData, error: pvError }).then(resolve);
        }
        return Promise.resolve({ data: fallbackPvData, error: fallbackPvError }).then(resolve);
      },
    };
    return chain;
  }

  beforeEach(() => {
    mockRequireAdmin.mockReset();
    mockGetSupabase.mockReset();
    mockRequireAdmin.mockResolvedValue(adminUser);
  });

  it('maps show_branding from DB into links[] when column exists', async () => {
    // Simulate a DB that has show_branding (post-087)
    const pvRow = {
      id: 'lnk1',
      token: 'tok1',
      kind: 'client',
      allow_download: true,
      allow_approve: true,
      allow_revision: true,
      approved_at: null,
      label: null,
      revoked_at: null,
      show_branding: false,
      viewed_count: 0,
      last_viewed_at: null,
      created_at: '2026-06-12T00:00:00Z',
      expires_at: null,
    };

    // Build a chainable mock for the videos/[id] handler.
    // The handler does: property query (maybeSingle) then preview query (then-resolved array).
    // We simulate it via a stateful sequence.
    let fromCall = 0;
    const db = {
      from(table: string) {
        fromCall++;
        return this._tableChain(table, fromCall);
      },
      _tableChain(table: string, n: number) {
        if (table === 'properties') {
          return {
            select: () => this._tableChain(table, n),
            eq: () => this._tableChain(table, n),
            maybeSingle: () => Promise.resolve({ data: baseProperty, error: null }),
          };
        }
        if (table === 'property_previews') {
          return {
            select: () => this._tableChain(table, n),
            eq: () => this._tableChain(table, n),
            order: () => Promise.resolve({ data: [pvRow], error: null }),
          };
        }
        if (table === 'preview_view_events') {
          return {
            select: () => this._tableChain(table, n),
            in: () => Promise.resolve({ data: [], error: null }),
          };
        }
        if (table === 'property_revision_notes') {
          return {
            select: () => this._tableChain(table, n),
            eq: () => this._tableChain(table, n),
            order: () => Promise.resolve({ data: [], error: null }),
          };
        }
        return {
          select: () => this._tableChain(table, n),
          eq: () => this._tableChain(table, n),
          order: () => Promise.resolve({ data: [], error: null }),
          in: () => Promise.resolve({ data: [], error: null }),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        };
      },
    };

    mockGetSupabase.mockReturnValue(db);

    const { default: handler } = await import('../videos/[id].js');
    const req = makeReq();
    const res = makeRes();
    await handler(req as VercelRequest, res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    const body = res._body as { links: Array<{ show_branding: boolean }> };
    expect(body.links).toHaveLength(1);
    expect(body.links[0].show_branding).toBe(false);
  });

  it('falls back show_branding→true when 42703 (column absent pre-087)', async () => {
    // Primary select throws 42703; fallback select has no show_branding column.
    let pvCallCount = 0;
    const pvRowNoShowBranding = {
      id: 'lnk1',
      token: 'tok1',
      kind: 'client',
      allow_download: true,
      allow_approve: true,
      allow_revision: true,
      approved_at: null,
      viewed_count: 0,
      last_viewed_at: null,
      created_at: '2026-06-12T00:00:00Z',
      expires_at: null,
      // label/revoked_at also absent in older fallback
    };

    const db = {
      from(table: string) { return this._tableChain(table); },
      _tableChain(table: string) {
        if (table === 'properties') {
          return {
            select: () => this._tableChain(table),
            eq: () => this._tableChain(table),
            maybeSingle: () => Promise.resolve({ data: baseProperty, error: null }),
          };
        }
        if (table === 'property_previews') {
          return {
            select: () => this._tableChain(table),
            eq: () => this._tableChain(table),
            order: () => {
              pvCallCount++;
              if (pvCallCount === 1) {
                return Promise.resolve({ data: null, error: { code: '42703', message: 'column does not exist' } });
              }
              return Promise.resolve({ data: [pvRowNoShowBranding], error: null });
            },
          };
        }
        if (table === 'preview_view_events') {
          return {
            select: () => this._tableChain(table),
            in: () => Promise.resolve({ data: [], error: null }),
          };
        }
        if (table === 'property_revision_notes') {
          return {
            select: () => this._tableChain(table),
            eq: () => this._tableChain(table),
            order: () => Promise.resolve({ data: [], error: null }),
          };
        }
        return {
          select: () => this._tableChain(table),
          eq: () => this._tableChain(table),
          order: () => Promise.resolve({ data: [], error: null }),
          in: () => Promise.resolve({ data: [], error: null }),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        };
      },
    };

    mockGetSupabase.mockReturnValue(db);

    const { default: handler } = await import('../videos/[id].js');
    const req = makeReq();
    const res = makeRes();
    await handler(req as VercelRequest, res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    const body = res._body as { links: Array<{ show_branding: boolean }> };
    expect(body.links).toHaveLength(1);
    // show_branding absent on row → ?? true
    expect(body.links[0].show_branding).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GET preview-links — show_branding fallback
// ────────────────────────────────────────────────────────────────────────────

describe('GET preview-links — show_branding in response', () => {
  vi.mock('../../../../../lib/auth', () => ({
    requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
  }));
  vi.mock('../../../../../lib/client', () => ({
    getSupabase: () => mockGetSupabase(),
  }));

  function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
    return {
      method: 'GET',
      query: { id: 'prop1' },
      body: {},
      headers: {},
      ...overrides,
    } as unknown as VercelRequest;
  }

  beforeEach(() => {
    mockRequireAdmin.mockReset();
    mockGetSupabase.mockReset();
    mockRequireAdmin.mockResolvedValue(adminUser);
  });

  it('returns show_branding from DB when column exists', async () => {
    const clientRow = {
      id: 'lnk1',
      token: 'tok1',
      kind: 'client',
      allow_download: true,
      allow_approve: true,
      allow_revision: true,
      approved_at: null,
      show_branding: false,
      viewed_count: 2,
      last_viewed_at: null,
      created_at: '2026-06-12T00:00:00Z',
    };

    let ordered = false;
    const chain = {
      from: (_t: string) => chain,
      select: (_cols: string) => chain,
      eq: (_c: string, _v: string) => chain,
      order: (_c: string, _o: unknown) => { ordered = true; return chain; },
      then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
        return Promise.resolve({ data: [clientRow], error: null }).then(resolve);
      },
    };

    mockGetSupabase.mockReturnValue(chain);

    const { default: handler } = await import('../properties/[id]/preview-links.js');
    const req = makeReq();
    const res = makeRes();
    await handler(req as VercelRequest, res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    const body = res._body as { client: { show_branding: boolean } | null; public: unknown };
    expect(body.client).not.toBeNull();
    expect(body.client!.show_branding).toBe(false);
  });

  it('falls back show_branding→true when 42703 (column absent pre-087)', async () => {
    const clientRowNoShowBranding = {
      id: 'lnk1',
      token: 'tok1',
      kind: 'client',
      allow_download: true,
      allow_approve: true,
      allow_revision: true,
      approved_at: null,
      viewed_count: 2,
      last_viewed_at: null,
      created_at: '2026-06-12T00:00:00Z',
    };

    let callCount = 0;
    const chain = {
      from: (_t: string) => chain,
      select: (_cols: string) => chain,
      eq: (_c: string, _v: string) => chain,
      order: (_c: string, _o: unknown) => chain,
      then(resolve: (v: { data: unknown[] | null; error: { code: string; message: string } | null }) => unknown) {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: null,
            error: { code: '42703', message: 'column show_branding does not exist' },
          }).then(resolve);
        }
        return Promise.resolve({ data: [clientRowNoShowBranding], error: null }).then(resolve);
      },
    };

    mockGetSupabase.mockReturnValue(chain);

    const { default: handler } = await import('../properties/[id]/preview-links.js');
    const req = makeReq();
    const res = makeRes();
    await handler(req as VercelRequest, res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    const body = res._body as { client: { show_branding: boolean } | null; public: unknown };
    expect(body.client).not.toBeNull();
    // Absent column → fallback to true
    expect(body.client!.show_branding).toBe(true);
  });
});
