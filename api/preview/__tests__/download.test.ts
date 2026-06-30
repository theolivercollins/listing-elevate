import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockIsWellFormedToken = vi.fn();
const mockFetchByToken = vi.fn();

vi.mock('../../../lib/operator-studio/preview-tokens', () => ({
  isWellFormedToken: (t: string) => mockIsWellFormedToken(t),
}));
vi.mock('../../../lib/operator-studio/preview', () => ({
  fetchByToken: (t: string) => mockFetchByToken(t),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import handler from '../[token]/download';

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
    query: { token: 'validtoken1234567890validtoken12', orientation: 'horizontal' },
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

function makeDownloadResult(overrides: {
  expired?: boolean;
  allow_download?: boolean;
  horizontal_video_url?: string | null;
  vertical_video_url?: string | null;
  address?: string;
} = {}) {
  return {
    expired: overrides.expired ?? false,
    property: {
      id: 'p1',
      address: overrides.address ?? '5019 San Massimo Dr, Punta Gorda, FL 33950, USA',
      horizontal_video_url: overrides.horizontal_video_url !== undefined
        ? overrides.horizontal_video_url
        : 'https://test.b-cdn.net/h.mp4',
      vertical_video_url: overrides.vertical_video_url !== undefined
        ? overrides.vertical_video_url
        : null,
      client_id: null,
    },
    client: null,
    preview: {
      kind: 'client',
      allow_download: overrides.allow_download ?? true,
      allow_approve: true,
      allow_revision: true,
      approved_at: null,
    },
  };
}

beforeEach(() => {
  mockIsWellFormedToken.mockReset();
  mockFetchByToken.mockReset();
  mockFetch.mockReset();
});

describe('GET /api/preview/[token]/download', () => {
  it('returns 404 for malformed token', async () => {
    mockIsWellFormedToken.mockReturnValue(false);
    const res = makeRes();
    await handler(makeReq({ query: { token: '!!!' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
    expect(mockFetchByToken).not.toHaveBeenCalled();
  });

  it('returns 404 when token not found', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
  });

  it('returns 404 when preview is expired', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeDownloadResult({ expired: true }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
  });

  it('returns 403 when allow_download is false', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeDownloadResult({ allow_download: false }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(403);
    expect((res._body as { error: string }).error).toBe('not_allowed');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 400 when orientation param is missing', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeDownloadResult());
    const res = makeRes();
    await handler(makeReq({ query: { token: 'validtoken1234567890validtoken12' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });

  it('returns 400 when orientation param is invalid', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeDownloadResult());
    const res = makeRes();
    await handler(makeReq({ query: { token: 'validtoken1234567890validtoken12', orientation: 'square' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });

  it('returns 404 when horizontal orientation has no URL', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeDownloadResult({ horizontal_video_url: null, vertical_video_url: 'https://test.b-cdn.net/v.mp4' }));
    const res = makeRes();
    await handler(makeReq({ query: { token: 'validtoken1234567890validtoken12', orientation: 'horizontal' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
    expect((res._body as { error: string }).error).toBe('no_url');
  });

  it('returns 404 when vertical orientation has no URL', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeDownloadResult({ horizontal_video_url: 'https://test.b-cdn.net/h.mp4', vertical_video_url: null }));
    const res = makeRes();
    await handler(makeReq({ query: { token: 'validtoken1234567890validtoken12', orientation: 'vertical' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
    expect((res._body as { error: string }).error).toBe('no_url');
  });

  it('sets Content-Disposition with wide suffix for horizontal orientation', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeDownloadResult({ address: '123 Main St, Springfield, IL 62701, USA' }));
    const fakeBody = new ReadableStream({ start(ctrl) { ctrl.close(); } });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (k: string) => k === 'content-length' ? '1000' : null },
      body: fakeBody,
    });
    const res = makeRes();
    await handler(makeReq({ query: { token: 'validtoken1234567890validtoken12', orientation: 'horizontal' } }), res as unknown as VercelResponse);
    expect(res._headers['content-disposition']).toBe('attachment; filename="123-main-st-springfield-il-62701-usa-wide.mp4"');
    expect(res._headers['content-type']).toBe('video/mp4');
    expect(res._headers['content-length']).toBe('1000');
  });

  it('sets Content-Disposition with vertical suffix for vertical orientation', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeDownloadResult({
      address: '42 Oak Ave, Portland, OR 97201',
      horizontal_video_url: 'https://test.b-cdn.net/h.mp4',
      vertical_video_url: 'https://test.b-cdn.net/v.mp4',
    }));
    const fakeBody = new ReadableStream({ start(ctrl) { ctrl.close(); } });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: fakeBody,
    });
    const res = makeRes();
    await handler(makeReq({ query: { token: 'validtoken1234567890validtoken12', orientation: 'vertical' } }), res as unknown as VercelResponse);
    expect(res._headers['content-disposition']).toBe('attachment; filename="42-oak-ave-portland-or-97201-vertical.mp4"');
  });

  it('returns 502 when upstream fetch throws', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeDownloadResult());
    mockFetch.mockRejectedValue(new Error('network failure'));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(502);
    expect((res._body as { error: string }).error).toBe('upstream_fetch_failed');
  });

  it('returns 502 when upstream responds with non-OK status', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeDownloadResult());
    mockFetch.mockResolvedValue({ ok: false, status: 403, headers: { get: () => null }, body: null });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(502);
    expect((res._body as { error: string }).error).toBe('upstream_403');
  });

  it('returns 405 for non-GET methods', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    const res = makeRes();
    await handler(makeReq({ method: 'POST' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
  });

  it('pre-migration fallback (preview: null) treats as allow_download=true', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue({
      expired: false,
      property: { id: 'p1', address: '1 Oak', horizontal_video_url: 'https://test.b-cdn.net/h.mp4', vertical_video_url: null, client_id: null },
      client: null,
      preview: null, // pre-migration → all-on
    });
    const fakeBody = new ReadableStream({ start(ctrl) { ctrl.close(); } });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: fakeBody,
    });
    const res = makeRes();
    await handler(makeReq({ query: { token: 'validtoken1234567890validtoken12', orientation: 'horizontal' } }), res as unknown as VercelResponse);
    // should proceed, not 403
    expect(res._status).not.toBe(403);
    expect(res._headers['content-disposition']).toMatch(/attachment; filename=".+wide\.mp4"/);
  });
});
