/**
 * TDD tests for:
 *   GET  /api/admin/studio/properties/[id]/preview-links
 *   PATCH /api/admin/studio/properties/[id]/preview-links/[previewId]
 *
 * Both must be admin-gated exactly like sibling routes.
 * GET returns newest per kind (client + public) with view stats.
 * PATCH persists capability boolean toggles.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ─────────────────────────────────────────────────────────────────────────────
// Shared mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockRequireAdmin = vi.fn();
const mockGetSupabase = vi.fn();

vi.mock('../../../../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock('../../../../../../lib/client', () => ({
  getSupabase: () => mockGetSupabase(),
}));

import listHandler from '../preview-links';
import patchHandler from '../preview-links/[previewId]';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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
    query: { id: 'prop-abc' },
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

const adminUser = { user: { id: 'u1' }, profile: { role: 'admin' } };

// ─────────────────────────────────────────────────────────────────────────────
// GET preview-links
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/studio/properties/[id]/preview-links', () => {
  beforeEach(() => {
    mockRequireAdmin.mockReset();
    mockGetSupabase.mockReset();
  });

  it('returns 401 when requireAdmin returns null', async () => {
    mockRequireAdmin.mockImplementation((_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    });
    const res = makeRes();
    await listHandler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
  });

  it('returns 405 for non-GET methods', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const res = makeRes();
    await listHandler(makeReq({ method: 'POST' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
  });

  it('returns empty object when no previews exist', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const order = vi.fn().mockReturnThis();
    const eq = vi.fn().mockReturnThis();
    mockGetSupabase.mockReturnValue({
      from: () => ({
        select: () => ({ eq, order }),
        eq,
        order,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
      }),
    });
    // Build a proper chain
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    mockGetSupabase.mockReturnValue({ from: () => chain });

    const res = makeRes();
    await listHandler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { client: null | object; public: null | object };
    expect(body.client).toBeNull();
    expect(body.public).toBeNull();
  });

  it('surfaces newest client link with view stats', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);

    const rows = [
      {
        id: 'pv-client-1',
        token: 'clienttoken111111111111111111111',
        kind: 'client',
        allow_download: true,
        allow_approve: true,
        allow_revision: true,
        approved_at: null,
        viewed_count: 5,
        last_viewed_at: '2026-06-10T09:00:00Z',
        created_at: '2026-06-09T08:00:00Z',
      },
      {
        id: 'pv-public-1',
        token: 'publictoken111111111111111111111',
        kind: 'public',
        allow_download: false,
        allow_approve: false,
        allow_revision: false,
        approved_at: null,
        viewed_count: 12,
        last_viewed_at: '2026-06-11T10:00:00Z',
        created_at: '2026-06-10T08:00:00Z',
      },
    ];

    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    mockGetSupabase.mockReturnValue({ from: () => chain });

    const res = makeRes();
    await listHandler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);

    const body = res._body as {
      client: { id: string; token: string; kind: string; viewed_count: number; last_viewed_at: string | null; approved_at: string | null } | null;
      public: { id: string; token: string; kind: string; viewed_count: number } | null;
    };

    // Client link surfaced
    expect(body.client).not.toBeNull();
    expect(body.client?.id).toBe('pv-client-1');
    expect(body.client?.viewed_count).toBe(5);
    expect(body.client?.approved_at).toBeNull();

    // Public link surfaced
    expect(body.public).not.toBeNull();
    expect(body.public?.id).toBe('pv-public-1');
    expect(body.public?.viewed_count).toBe(12);
  });

  it('returns newest per kind when multiple rows exist for same kind', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);

    // Two client links — ordered newest first by the DB query (created_at DESC)
    const rows = [
      {
        id: 'pv-client-new',
        token: 'clientnew1111111111111111111111',
        kind: 'client',
        allow_download: true,
        allow_approve: false,
        allow_revision: true,
        approved_at: null,
        viewed_count: 3,
        last_viewed_at: null,
        created_at: '2026-06-11T00:00:00Z', // newest
      },
      {
        id: 'pv-client-old',
        token: 'clientold1111111111111111111111',
        kind: 'client',
        allow_download: true,
        allow_approve: true,
        allow_revision: true,
        approved_at: '2026-06-10T09:00:00Z',
        viewed_count: 10,
        last_viewed_at: '2026-06-10T10:00:00Z',
        created_at: '2026-06-10T00:00:00Z', // older
      },
    ];

    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    mockGetSupabase.mockReturnValue({ from: () => chain });

    const res = makeRes();
    await listHandler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);

    const body = res._body as { client: { id: string } | null; public: { id: string } | null };
    // Must surface newest (first in array since ordered DESC)
    expect(body.client?.id).toBe('pv-client-new');
    // No public rows
    expect(body.public).toBeNull();
  });

  it('returns 500 when DB errors', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve({ data: null, error: { message: 'db error' } }).then(resolve, reject),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    mockGetSupabase.mockReturnValue({ from: () => chain });

    const res = makeRes();
    await listHandler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH preview-links/[previewId]
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/admin/studio/properties/[id]/preview-links/[previewId]', () => {
  beforeEach(() => {
    mockRequireAdmin.mockReset();
    mockGetSupabase.mockReset();
  });

  function makePatchReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
    return {
      method: 'PATCH',
      query: { id: 'prop-abc', previewId: 'pv-123' },
      body: { allow_download: false, allow_approve: true, allow_revision: false },
      headers: {},
      ...overrides,
    } as unknown as VercelRequest;
  }

  it('returns 401 when requireAdmin returns null', async () => {
    mockRequireAdmin.mockImplementation((_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    });
    const res = makeRes();
    await patchHandler(makePatchReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
  });

  it('returns 405 for non-PATCH methods', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const res = makeRes();
    await patchHandler(makePatchReq({ method: 'GET' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
  });

  it('returns 400 when no capability field is provided', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const res = makeRes();
    await patchHandler(makePatchReq({ body: {} }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });

  it('returns 400 when a capability field is not boolean', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const res = makeRes();
    await patchHandler(makePatchReq({ body: { allow_download: 'yes' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });

  it('persists toggle changes and returns updated row', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);

    const updatedRow = {
      id: 'pv-123',
      token: 'clienttoken111111111111111111111',
      kind: 'client',
      allow_download: false,
      allow_approve: true,
      allow_revision: false,
      approved_at: null,
      viewed_count: 3,
      last_viewed_at: null,
      created_at: '2026-06-10T00:00:00Z',
    };

    const single = vi.fn().mockResolvedValue({ data: updatedRow, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const eqPreviewId = vi.fn().mockReturnValue({ select });
    const eqPropertyId = vi.fn().mockReturnValue({ eq: eqPreviewId });
    const update = vi.fn().mockReturnValue({ eq: eqPropertyId });

    mockGetSupabase.mockReturnValue({
      from: () => ({ update }),
    });

    const res = makeRes();
    await patchHandler(
      makePatchReq({ body: { allow_download: false, allow_revision: false } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    const body = res._body as typeof updatedRow;
    expect(body.allow_download).toBe(false);
    expect(body.allow_revision).toBe(false);
    expect(body.allow_approve).toBe(true);
  });

  it('only sends recognized capability fields to DB (ignores unknown keys)', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);

    const updatedRow = {
      id: 'pv-123',
      token: 'clienttoken111111111111111111111',
      kind: 'client',
      allow_download: true,
      allow_approve: false,
      allow_revision: true,
      approved_at: null,
      viewed_count: 0,
      last_viewed_at: null,
      created_at: '2026-06-10T00:00:00Z',
    };

    const single = vi.fn().mockResolvedValue({ data: updatedRow, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const eqPreviewId = vi.fn().mockReturnValue({ select });
    const eqPropertyId = vi.fn().mockReturnValue({ eq: eqPreviewId });
    const update = vi.fn().mockReturnValue({ eq: eqPropertyId });

    mockGetSupabase.mockReturnValue({
      from: () => ({ update }),
    });

    const res = makeRes();
    await patchHandler(
      makePatchReq({ body: { allow_approve: false, evil_field: true } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    // update was called with only recognized keys
    const updateArg = update.mock.calls[0][0] as Record<string, unknown>;
    expect('evil_field' in updateArg).toBe(false);
    expect(updateArg.allow_approve).toBe(false);
  });

  it('returns 500 when DB update errors', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);

    const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'constraint' } });
    const select = vi.fn().mockReturnValue({ single });
    const eqPreviewId = vi.fn().mockReturnValue({ select });
    const eqPropertyId = vi.fn().mockReturnValue({ eq: eqPreviewId });
    const update = vi.fn().mockReturnValue({ eq: eqPropertyId });

    mockGetSupabase.mockReturnValue({
      from: () => ({ update }),
    });

    const res = makeRes();
    await patchHandler(
      makePatchReq({ body: { allow_download: false } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(500);
  });

  // ── label / revoked extension (spec §2 / §6) ─────────────────────────────────

  it('PATCH {label} sets label on the row and returns it', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);

    const updatedRow = {
      id: 'pv-123',
      token: 'clienttoken111111111111111111111',
      kind: 'client',
      allow_download: true,
      allow_approve: true,
      allow_revision: true,
      approved_at: null,
      label: 'Sent to Brian',
      revoked_at: null,
      viewed_count: 0,
      last_viewed_at: null,
      created_at: '2026-06-10T00:00:00Z',
    };

    const single = vi.fn().mockResolvedValue({ data: updatedRow, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const eqPreviewId = vi.fn().mockReturnValue({ select });
    const eqPropertyId = vi.fn().mockReturnValue({ eq: eqPreviewId });
    const update = vi.fn().mockReturnValue({ eq: eqPropertyId });

    mockGetSupabase.mockReturnValue({ from: () => ({ update }) });

    const res = makeRes();
    await patchHandler(
      makePatchReq({ body: { label: 'Sent to Brian' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    const body = res._body as typeof updatedRow;
    expect(body.label).toBe('Sent to Brian');
    // label is included in the DB update call
    const updateArg = update.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.label).toBe('Sent to Brian');
  });

  it('PATCH {label: null} clears label (passes null to DB)', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);

    const updatedRow = {
      id: 'pv-123', token: 't', kind: 'client',
      allow_download: true, allow_approve: true, allow_revision: true,
      approved_at: null, label: null, revoked_at: null,
      viewed_count: 0, last_viewed_at: null, created_at: '2026-06-10T00:00:00Z',
    };

    const single = vi.fn().mockResolvedValue({ data: updatedRow, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const eqPreviewId = vi.fn().mockReturnValue({ select });
    const eqPropertyId = vi.fn().mockReturnValue({ eq: eqPreviewId });
    const update = vi.fn().mockReturnValue({ eq: eqPropertyId });

    mockGetSupabase.mockReturnValue({ from: () => ({ update }) });

    const res = makeRes();
    await patchHandler(
      makePatchReq({ body: { label: null } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    const updateArg = update.mock.calls[0][0] as Record<string, unknown>;
    expect('label' in updateArg).toBe(true);
    expect(updateArg.label).toBeNull();
  });

  it('PATCH {label} clamps label to 200 chars', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);

    const longLabel = 'a'.repeat(300);
    const clamped = 'a'.repeat(200);

    const updatedRow = {
      id: 'pv-123', token: 't', kind: 'client',
      allow_download: true, allow_approve: true, allow_revision: true,
      approved_at: null, label: clamped, revoked_at: null,
      viewed_count: 0, last_viewed_at: null, created_at: '2026-06-10T00:00:00Z',
    };

    const single = vi.fn().mockResolvedValue({ data: updatedRow, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const eqPreviewId = vi.fn().mockReturnValue({ select });
    const eqPropertyId = vi.fn().mockReturnValue({ eq: eqPreviewId });
    const update = vi.fn().mockReturnValue({ eq: eqPropertyId });

    mockGetSupabase.mockReturnValue({ from: () => ({ update }) });

    const res = makeRes();
    await patchHandler(
      makePatchReq({ body: { label: longLabel } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    const updateArg = update.mock.calls[0][0] as Record<string, unknown>;
    expect((updateArg.label as string).length).toBe(200);
  });

  it('PATCH {revoked: true} stamps revoked_at and returns non-null revoked_at', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);

    const updatedRow = {
      id: 'pv-123', token: 't', kind: 'client',
      allow_download: true, allow_approve: true, allow_revision: true,
      approved_at: null, label: null, revoked_at: '2026-06-11T12:00:00Z',
      viewed_count: 0, last_viewed_at: null, created_at: '2026-06-10T00:00:00Z',
    };

    const single = vi.fn().mockResolvedValue({ data: updatedRow, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const eqPreviewId = vi.fn().mockReturnValue({ select });
    const eqPropertyId = vi.fn().mockReturnValue({ eq: eqPreviewId });
    const update = vi.fn().mockReturnValue({ eq: eqPropertyId });

    mockGetSupabase.mockReturnValue({ from: () => ({ update }) });

    const res = makeRes();
    await patchHandler(
      makePatchReq({ body: { revoked: true } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    const body = res._body as typeof updatedRow;
    expect(body.revoked_at).not.toBeNull();
    // DB update must have received a non-null revoked_at value
    const updateArg = update.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.revoked_at).toBeTruthy();
  });

  it('PATCH {revoked: false} clears revoked_at (passes null to DB)', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);

    const updatedRow = {
      id: 'pv-123', token: 't', kind: 'client',
      allow_download: true, allow_approve: true, allow_revision: true,
      approved_at: null, label: null, revoked_at: null,
      viewed_count: 0, last_viewed_at: null, created_at: '2026-06-10T00:00:00Z',
    };

    const single = vi.fn().mockResolvedValue({ data: updatedRow, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const eqPreviewId = vi.fn().mockReturnValue({ select });
    const eqPropertyId = vi.fn().mockReturnValue({ eq: eqPreviewId });
    const update = vi.fn().mockReturnValue({ eq: eqPropertyId });

    mockGetSupabase.mockReturnValue({ from: () => ({ update }) });

    const res = makeRes();
    await patchHandler(
      makePatchReq({ body: { revoked: false } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    const body = res._body as typeof updatedRow;
    expect(body.revoked_at).toBeNull();
    const updateArg = update.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.revoked_at).toBeNull();
  });

  it('PATCH {revoked: "yes"} returns 400 (must be boolean)', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const res = makeRes();
    await patchHandler(makePatchReq({ body: { revoked: 'yes' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });

  it('existing capability PATCH still works alongside empty label/revoked', async () => {
    // Regression: capability toggle still accepted; label/revoked absent → not sent to DB
    mockRequireAdmin.mockResolvedValue(adminUser);

    const updatedRow = {
      id: 'pv-123', token: 't', kind: 'client',
      allow_download: false, allow_approve: true, allow_revision: true,
      approved_at: null, label: null, revoked_at: null,
      viewed_count: 0, last_viewed_at: null, created_at: '2026-06-10T00:00:00Z',
    };

    const single = vi.fn().mockResolvedValue({ data: updatedRow, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const eqPreviewId = vi.fn().mockReturnValue({ select });
    const eqPropertyId = vi.fn().mockReturnValue({ eq: eqPreviewId });
    const update = vi.fn().mockReturnValue({ eq: eqPropertyId });

    mockGetSupabase.mockReturnValue({ from: () => ({ update }) });

    const res = makeRes();
    await patchHandler(
      makePatchReq({ body: { allow_download: false } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    const updateArg = update.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.allow_download).toBe(false);
    // label and revoked_at must NOT appear in the patch when not supplied
    expect('label' in updateArg).toBe(false);
    expect('revoked_at' in updateArg).toBe(false);
  });

  // ── pre-migration back-compat guard (P1 regression fix) ─────────────────────
  // Before this fix the RETURNING select ALWAYS included label/revoked_at, causing
  // PostgREST to error with 42703 (undefined_column) pre-migration on capability-only
  // PATCHes that already work in production. Fix: only add those columns when the
  // caller actually supplied them; capability-only PATCH never requests them.

  it('capability-only PATCH does not request label/revoked_at in RETURNING select (pre-migration safe)', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);

    const updatedRow = {
      id: 'pv-123', token: 't', kind: 'client',
      allow_download: false, allow_approve: true, allow_revision: true,
      approved_at: null, viewed_count: 0, last_viewed_at: null,
      created_at: '2026-06-10T00:00:00Z',
    };

    const single = vi.fn().mockResolvedValue({ data: updatedRow, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const eqPreviewId = vi.fn().mockReturnValue({ select });
    const eqPropertyId = vi.fn().mockReturnValue({ eq: eqPreviewId });
    const update = vi.fn().mockReturnValue({ eq: eqPropertyId });

    mockGetSupabase.mockReturnValue({ from: () => ({ update }) });

    const res = makeRes();
    await patchHandler(
      makePatchReq({ body: { allow_download: false } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    // The select column string must NOT contain migration-084 columns for a
    // capability-only patch — this is what prevents 42703 pre-migration.
    const selectArg = select.mock.calls[0][0] as string;
    expect(selectArg).not.toContain('label');
    expect(selectArg).not.toContain('revoked_at');
  });

  it('capability-only PATCH with 42703 error from DB returns 500 (not silently swallowed)', async () => {
    // Sanity check: if some OTHER column causes 42703 on a capability-only PATCH,
    // we still surface the error (42703 is not blanket-swallowed in PATCH).
    mockRequireAdmin.mockResolvedValue(adminUser);

    const single = vi.fn().mockResolvedValue({ data: null, error: { code: '42703', message: 'column "foo" does not exist' } });
    const select = vi.fn().mockReturnValue({ single });
    const eqPreviewId = vi.fn().mockReturnValue({ select });
    const eqPropertyId = vi.fn().mockReturnValue({ eq: eqPreviewId });
    const update = vi.fn().mockReturnValue({ eq: eqPropertyId });

    mockGetSupabase.mockReturnValue({ from: () => ({ update }) });

    const res = makeRes();
    await patchHandler(
      makePatchReq({ body: { allow_download: false } }),
      res as unknown as VercelResponse,
    );
    // A genuine 42703 (e.g. schema drift) is a real error → 500.
    expect(res._status).toBe(500);
  });
});
