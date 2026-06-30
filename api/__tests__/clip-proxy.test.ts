/**
 * Tests for GET /api/clip-proxy (api/clip-proxy.ts).
 *
 * Verifies:
 *  - Missing url param → 400
 *  - Non-Bunny host (arbitrary, evil.com, cloud metadata IP) → 403
 *  - Non-https scheme → 403
 *  - Valid Bunny CDN URL → fetch called with Referer header; Range forwarded
 *  - fetch error → 502
 *  - Upstream not ok → upstream status passed through
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

import handler from '../clip-proxy.js';

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
describe('GET /api/clip-proxy — missing url', () => {
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
    // Layer 2 (assertAllowedMediaUrl) would block this, but layer 1 also
    // blocks it because the hostname is not the Bunny CDN host.
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
});

describe('GET /api/clip-proxy — valid Bunny URL', () => {
  const bunnyUrl = `https://${BUNNY_HOST}/some-guid/play_1080p.mp4`;

  it('calls fetch with the Referer header set for the Bunny CDN URL', async () => {
    // Mock: upstream ok but body null → handler returns 502 after the fetch.
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
    // fetch was still called (SSRF guard passed, Bunny returned 403)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
