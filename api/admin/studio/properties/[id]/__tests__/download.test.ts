import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockRequireAdmin = vi.fn();
const mockGetSupabase = vi.fn();

vi.mock('../../../../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock('../../../../../../lib/client', () => ({
  getSupabase: () => mockGetSupabase(),
}));

// We'll capture fetch calls via vitest's global mock
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import handler from '../download';

const adminUser = { user: { id: 'u1', email: 'admin@test.com' }, profile: { role: 'admin' } };

function makeDb(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = () => Promise.resolve(result);
  return { from: (_table: string) => chain };
}

function makeRes() {
  const headers: Record<string, string | number> = {};
  const res = {
    _status: 0,
    _body: {} as unknown,
    _headers: headers,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
    setHeader(name: string, value: string | number) { headers[name.toLowerCase()] = value; },
    end() {},
    destroy() {},
    // Node Writable interface methods required by pipe
    write(_chunk: unknown, _enc?: unknown, cb?: (() => void)) { if (typeof cb === 'function') cb(); return true; },
    once(_event: string, _cb: () => void) { return this; },
    emit(_event: string) { return false; },
    on(_event: string, _cb: () => void) { return this; },
    removeListener(_event: string, _cb: () => void) { return this; },
  };
  return res;
}

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'GET',
    query: { id: 'prop-abc', format: 'horizontal' },
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

beforeEach(() => {
  mockRequireAdmin.mockReset();
  mockGetSupabase.mockReset();
  mockFetch.mockReset();
});

describe('GET /api/admin/studio/properties/[id]/download', () => {
  it('returns 401 when requireAdmin returns null', async () => {
    mockRequireAdmin.mockImplementation((_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
  });

  it('returns 405 for non-GET methods', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const res = makeRes();
    await handler(makeReq({ method: 'POST' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
  });

  it('returns 400 when format is invalid', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const res = makeRes();
    await handler(makeReq({ query: { id: 'prop-abc', format: 'square' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toMatch(/format/);
  });

  it('returns 404 when property not found', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetSupabase.mockReturnValue(makeDb({ data: null, error: null }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
    expect((res._body as { error: string }).error).toBe('not_found');
  });

  it('returns 404 when horizontal URL is null', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetSupabase.mockReturnValue(makeDb({
      data: { id: 'prop-abc', address: '1 Main St', horizontal_video_url: null, vertical_video_url: 'https://test.b-cdn.net/v.mp4' },
      error: null,
    }));
    const res = makeRes();
    await handler(makeReq({ query: { id: 'prop-abc', format: 'horizontal' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
    expect((res._body as { error: string }).error).toBe('horizontal_video_not_ready');
  });

  it('returns 404 when vertical URL is null', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetSupabase.mockReturnValue(makeDb({
      data: { id: 'prop-abc', address: '1 Main St', horizontal_video_url: 'https://test.b-cdn.net/h.mp4', vertical_video_url: null },
      error: null,
    }));
    const res = makeRes();
    await handler(makeReq({ query: { id: 'prop-abc', format: 'vertical' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
    expect((res._body as { error: string }).error).toBe('vertical_video_not_ready');
  });

  it('sets Content-Disposition with slugified address for horizontal', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetSupabase.mockReturnValue(makeDb({
      data: { id: 'prop-abc', address: '1 Main St, Springfield, IL', horizontal_video_url: 'https://test.b-cdn.net/h.mp4', vertical_video_url: null },
      error: null,
    }));
    // Provide a real Web ReadableStream so Readable.fromWeb is satisfied
    const fakeBody = new ReadableStream({ start(ctrl) { ctrl.close(); } });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (k: string) => k === 'content-length' ? '1000' : null },
      body: fakeBody,
    });

    const res = makeRes();
    await handler(makeReq({ query: { id: 'prop-abc', format: 'horizontal' } }), res as unknown as VercelResponse);
    expect(res._headers['content-disposition']).toBe('attachment; filename="1-main-st-springfield-il-horizontal.mp4"');
    expect(res._headers['content-type']).toBe('video/mp4');
    expect(res._headers['content-length']).toBe('1000');
  });

  it('sets Content-Disposition with property id when address is missing', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetSupabase.mockReturnValue(makeDb({
      data: { id: 'prop-xyz', address: null, horizontal_video_url: 'https://test.b-cdn.net/h.mp4', vertical_video_url: null },
      error: null,
    }));
    // Provide a real Web ReadableStream so Readable.fromWeb is satisfied
    const fakeBody = new ReadableStream({ start(ctrl) { ctrl.close(); } });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: fakeBody,
    });

    const res = makeRes();
    await handler(makeReq({ query: { id: 'prop-xyz', format: 'horizontal' } }), res as unknown as VercelResponse);
    expect(res._headers['content-disposition']).toBe('attachment; filename="prop-xyz-horizontal.mp4"');
  });

  it('returns 502 when upstream fetch fails', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetSupabase.mockReturnValue(makeDb({
      data: { id: 'prop-abc', address: '1 Main', horizontal_video_url: 'https://test.b-cdn.net/h.mp4', vertical_video_url: null },
      error: null,
    }));
    mockFetch.mockRejectedValue(new Error('network error'));

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(502);
    expect((res._body as { error: string }).error).toBe('upstream_fetch_failed');
  });

  it('returns 502 when upstream responds with non-OK status', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetSupabase.mockReturnValue(makeDb({
      data: { id: 'prop-abc', address: '1 Main', horizontal_video_url: 'https://test.b-cdn.net/h.mp4', vertical_video_url: null },
      error: null,
    }));
    mockFetch.mockResolvedValue({ ok: false, status: 403, headers: { get: () => null }, body: null });

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(502);
    expect((res._body as { error: string }).error).toBe('upstream_403');
  });
});
