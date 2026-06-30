/**
 * Tests for GET /api/clip-proxy (api/clip-proxy.ts).
 *
 * Verifies:
 *  - Missing url param → 400
 *  - Non-Bunny host (arbitrary, evil.com, cloud metadata IP) → 403, no fetch
 *  - Non-https scheme → 403
 *  - Non-default port on Bunny host → 403
 *  - Valid Bunny CDN URL → fetch called with Referer header; Range forwarded
 *  - fetch error → 502
 *  - Upstream not ok → upstream status passed through
 *  - 3xx with non-Bunny Location → 502, not followed to evil host
 *  - 3xx with valid Bunny Location → followed once; second 3xx → 502
 *  - config.maxDuration === 300
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const BUNNY_HOST = 'vz-test-lib.b-cdn.net';

// ── Env helpers ───────────────────────────────────────────────────────────────
let origCdn: string | undefined;
let origBase: string | undefined;

beforeEach(() => {
  origCdn = process.env.BUNNY_STREAM_CDN_HOSTNAME;
  origBase = process.env.LE_PUBLIC_BASE_URL;
  process.env.BUNNY_STREAM_CDN_HOSTNAME = BUNNY_HOST;
  process.env.LE_PUBLIC_BASE_URL = 'https://listingelevate.com';
  vi.clearAllMocks();
});

afterEach(() => {
  if (origCdn === undefined) delete process.env.BUNNY_STREAM_CDN_HOSTNAME;
  else process.env.BUNNY_STREAM_CDN_HOSTNAME = origCdn;
  if (origBase === undefined) delete process.env.LE_PUBLIC_BASE_URL;
  else process.env.LE_PUBLIC_BASE_URL = origBase;
  vi.restoreAllMocks();
});

// ── Mock fetch globally ───────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import handler, { config } from '../clip-proxy.js';

// ── Response / Request factories ──────────────────────────────────────────────
function makeRes() {
  return {
    _status: 0,
    _body: undefined as unknown,
    _headers: {} as Record<string, string>,
    _ended: false,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
    setHeader(name: string, val: string) { this._headers[name] = val; return this; },
    end() { this._ended = true; return this; },
    destroy() {},
    on() { return this; },
  };
}

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'GET',
    query: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('GET /api/clip-proxy — module config', () => {
  it('exports maxDuration: 300 so the Vercel function outlives large clip streams', () => {
    expect(config.maxDuration).toBe(300);
  });
});

describe('GET /api/clip-proxy — missing / invalid url', () => {
  it('returns 400 when url query param is absent', async () => {
    const res = makeRes();
    await handler(makeReq({ query: {} }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toBe('missing_url');
  });

  it('returns 405 for non-GET requests', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'POST', query: {} }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
  });
});

describe('GET /api/clip-proxy — SSRF guard rejects disallowed hosts', () => {
  it('returns 403 for an arbitrary non-Bunny host', async () => {
    const res = makeRes();
    await handler(
      makeReq({ query: { url: 'https://evil.com/malicious.mp4' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 403 for the cloud metadata IP (IMDS)', async () => {
    const res = makeRes();
    await handler(
      makeReq({ query: { url: 'https://169.254.169.254/latest/meta-data/' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 403 for http:// scheme even on the Bunny host', async () => {
    const res = makeRes();
    await handler(
      makeReq({ query: { url: `http://${BUNNY_HOST}/guid/play_1080p.mp4` } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 403 for a localhost URL', async () => {
    const res = makeRes();
    await handler(
      makeReq({ query: { url: 'https://localhost/internal' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 403 for a Bunny host URL with a non-default port (e.g. :8080)', async () => {
    const res = makeRes();
    await handler(
      makeReq({ query: { url: `https://${BUNNY_HOST}:8080/guid/play_1080p.mp4` } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 403 when BUNNY_STREAM_CDN_HOSTNAME is not set (fail-closed)', async () => {
    delete process.env.BUNNY_STREAM_CDN_HOSTNAME;
    const res = makeRes();
    await handler(
      makeReq({ query: { url: `https://${BUNNY_HOST}/guid/play_1080p.mp4` } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('GET /api/clip-proxy — redirect handling', () => {
  const bunnyUrl = `https://${BUNNY_HOST}/some-guid/play_1080p.mp4`;

  it('returns 502 and does NOT follow a 3xx whose Location is a non-Bunny host', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 301,
      headers: new Headers({ location: 'https://evil.com/steal.mp4' }),
    });

    const res = makeRes();
    await handler(makeReq({ query: { url: bunnyUrl } }), res as unknown as VercelResponse);

    expect(res._status).toBe(502);
    expect((res._body as { error: string }).error).toBe('redirect_forbidden');
    // fetch called once for the original URL; NOT a second time for evil.com
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns 502 and does NOT follow a 3xx with missing Location header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 302,
      headers: new Headers(),
    });

    const res = makeRes();
    await handler(makeReq({ query: { url: bunnyUrl } }), res as unknown as VercelResponse);

    expect(res._status).toBe(502);
    expect((res._body as { error: string }).error).toBe('redirect_forbidden');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('follows a 3xx to a valid Bunny Location exactly once', async () => {
    const redirectTarget = `https://${BUNNY_HOST}/other-guid/play_1080p.mp4`;

    // First fetch → 301 to another Bunny URL
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 301,
      headers: new Headers({ location: redirectTarget }),
    });
    // Second fetch → ok but body null → handler returns 502 (tests that it ran)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'video/mp4' }),
      body: null,
    });

    const res = makeRes();
    await handler(makeReq({ query: { url: bunnyUrl } }), res as unknown as VercelResponse);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toBe(redirectTarget);
    // Referer still set on the follow hop
    const secondOpts = mockFetch.mock.calls[1][1] as RequestInit & { headers: Record<string, string> };
    expect(secondOpts.headers['Referer']).toBe('https://www.listingelevate.com/');
  });

  it('returns 502 when the followed redirect itself returns another 3xx (no hop loop)', async () => {
    const hop1 = `https://${BUNNY_HOST}/hop1/play_1080p.mp4`;
    const hop2 = `https://${BUNNY_HOST}/hop2/play_1080p.mp4`;

    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 301, headers: new Headers({ location: hop1 }) })
      .mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: hop2 }) });

    const res = makeRes();
    await handler(makeReq({ query: { url: bunnyUrl } }), res as unknown as VercelResponse);

    expect(res._status).toBe(502);
    expect((res._body as { error: string }).error).toBe('too_many_redirects');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('GET /api/clip-proxy — valid Bunny URL', () => {
  const bunnyUrl = `https://${BUNNY_HOST}/some-guid/play_1080p.mp4`;

  it('calls fetch with redirect: manual', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'video/mp4' }),
      body: null,
    });

    const res = makeRes();
    await handler(makeReq({ query: { url: bunnyUrl } }), res as unknown as VercelResponse);

    const [, calledOpts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledOpts.redirect).toBe('manual');
  });

  it('calls fetch with the Referer header set for the Bunny CDN URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'video/mp4' }),
      body: null,
    });

    const res = makeRes();
    await handler(makeReq({ query: { url: bunnyUrl } }), res as unknown as VercelResponse);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOpts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(calledUrl).toBe(bunnyUrl);
    expect(calledOpts.headers['Referer']).toBe('https://www.listingelevate.com/');
  });

  it('forwards the Range request header to Bunny', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'video/mp4' }),
      body: null,
    });

    const res = makeRes();
    await handler(
      makeReq({ query: { url: bunnyUrl }, headers: { range: 'bytes=0-1023' } }),
      res as unknown as VercelResponse,
    );

    const [, calledOpts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(calledOpts.headers['Range']).toBe('bytes=0-1023');
  });

  it('returns 502 when fetch throws (network error / timeout)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

    const res = makeRes();
    await handler(makeReq({ query: { url: bunnyUrl } }), res as unknown as VercelResponse);
    expect(res._status).toBe(502);
    expect((res._body as { error: string }).error).toBe('upstream_fetch_failed');
  });

  it('passes through the upstream status when Bunny returns a non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: new Headers(),
    });

    const res = makeRes();
    await handler(makeReq({ query: { url: bunnyUrl } }), res as unknown as VercelResponse);
    expect(res._status).toBe(403);
    expect(res._ended).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
