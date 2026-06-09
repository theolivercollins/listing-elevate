import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockRequireAdmin = vi.fn();

// Per-call result queues for the chainable supabase mock.
const orderResult = vi.fn(); // GET list terminal
const singleResult = vi.fn(); // insert().select().single() terminal
const maybeSingleResult = vi.fn(); // property lookup terminal

function makeQuery(table: string) {
  return {
    _table: table,
    select() { return this; },
    order: () => orderResult(),
    eq() { return this; },
    maybeSingle: () => maybeSingleResult(),
    insert() { return this; },
    single: () => singleResult(),
  };
}

const supabase = { from: (t: string) => makeQuery(t) };

vi.mock('../../../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock('../../../../../lib/client', () => ({
  getSupabase: () => supabase,
}));
vi.mock('../../../../../lib/operator-studio/creatives', () => ({
  generateShareToken: () => 'TESTTOKEN0000000000000000000000',
}));

import handler from '../index';

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
    method: 'GET',
    query: {},
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

const adminUser = { user: { id: 'u1', email: 'a@test.com' }, profile: { role: 'admin' } };

beforeEach(() => {
  mockRequireAdmin.mockReset();
  orderResult.mockReset();
  singleResult.mockReset();
  maybeSingleResult.mockReset();
  mockRequireAdmin.mockResolvedValue(adminUser);
  process.env.LE_ALLOW_NONPROD_WRITES = 'true';
});

afterEach(() => {
  delete process.env.LE_ALLOW_NONPROD_WRITES;
  delete process.env.VERCEL_ENV;
});

describe('GET /api/admin/studio/creatives', () => {
  it('returns rows with shareUrl and embedUrl', async () => {
    orderResult.mockResolvedValue({
      data: [{ id: 'c1', share_token: 'abc', title: 'V' }],
      error: null,
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const rows = (res._body as { creatives: Array<{ shareUrl: string; embedUrl: string }> }).creatives;
    expect(rows[0].shareUrl).toBe('https://listingelevate.com/v/abc');
    expect(rows[0].embedUrl).toBe('https://listingelevate.com/embed/abc');
  });
});

describe('write guard', () => {
  it('returns 403 when writes disabled (no LE_ALLOW_NONPROD_WRITES, not production)', async () => {
    delete process.env.LE_ALLOW_NONPROD_WRITES;
    delete process.env.VERCEL_ENV;
    const res = makeRes();
    await handler(
      makeReq({ method: 'POST', body: { mode: 'upload', storage_path: 'p', title: 't', kind: 'video' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(403);
    expect((res._body as { error: string }).error).toMatch(/writes disabled/);
  });
});

describe('POST mode:upload', () => {
  it('inserts with source upload + generated token', async () => {
    let captured: Record<string, unknown> = {};
    supabase.from = (t: string) => {
      const q = makeQuery(t);
      q.insert = function (this: typeof q, payload: Record<string, unknown>) {
        captured = payload;
        return this;
      } as never;
      return q;
    };
    singleResult.mockResolvedValue({
      data: { id: 'c2', share_token: 'TESTTOKEN0000000000000000000000', source: 'upload', title: 'My Up' },
      error: null,
    });
    const res = makeRes();
    await handler(
      makeReq({ method: 'POST', body: { mode: 'upload', storage_path: 'a/b.mp4', title: 'My Up', kind: 'video' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(201);
    expect(captured.source).toBe('upload');
    expect(captured.share_token).toBe('TESTTOKEN0000000000000000000000');
    expect(captured.bucket).toBe('creatives');
    const creative = (res._body as { creative: { shareUrl: string } }).creative;
    expect(creative.shareUrl).toBe('https://listingelevate.com/v/TESTTOKEN0000000000000000000000');
    // restore
    supabase.from = (t: string) => makeQuery(t);
  });

  it('returns 400 when required upload fields missing', async () => {
    const res = makeRes();
    await handler(
      makeReq({ method: 'POST', body: { mode: 'upload', title: 't' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
  });
});

describe('POST mode:render', () => {
  it('resolves the property video url into public_url', async () => {
    let captured: Record<string, unknown> = {};
    supabase.from = (t: string) => {
      const q = makeQuery(t);
      q.insert = function (this: typeof q, payload: Record<string, unknown>) {
        captured = payload;
        return this;
      } as never;
      return q;
    };
    maybeSingleResult.mockResolvedValue({
      data: { horizontal_video_url: 'https://cdn/h.mp4', vertical_video_url: null, address: '1 St' },
      error: null,
    });
    singleResult.mockResolvedValue({
      data: { id: 'c3', share_token: 'TESTTOKEN0000000000000000000000', source: 'render' },
      error: null,
    });
    const res = makeRes();
    await handler(
      makeReq({ method: 'POST', body: { mode: 'render', property_id: 'p1', orientation: 'horizontal', title: 'R' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(201);
    expect(captured.public_url).toBe('https://cdn/h.mp4');
    expect(captured.source).toBe('render');
    expect(captured.bucket).toBe('property-videos');
    supabase.from = (t: string) => makeQuery(t);
  });

  it('returns 422 when the chosen orientation has no video', async () => {
    maybeSingleResult.mockResolvedValue({
      data: { horizontal_video_url: null, vertical_video_url: null, address: '1 St' },
      error: null,
    });
    const res = makeRes();
    await handler(
      makeReq({ method: 'POST', body: { mode: 'render', property_id: 'p1', orientation: 'vertical', title: 'R' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(422);
  });
});
