/**
 * T4 — OG unfurl shim: /preview/:token page handler
 *
 * Spec §3: serverless route that serves /preview/:token requests.
 * - Valid token → fetches /index.html, injects og:title, og:description,
 *   og:image, twitter:card=summary_large_image, returns modified HTML.
 * - Invalid/expired token → returns untouched index.html (SPA shows 404 state).
 *
 * Route must appear in vercel.json BEFORE the SPA catch-all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockIsWellFormedToken = vi.fn();
const mockFetchByToken = vi.fn();
const mockFetch = vi.fn();

vi.mock('../../../lib/operator-studio/preview-tokens.js', () => ({
  isWellFormedToken: (t: string) => mockIsWellFormedToken(t),
}));
vi.mock('../../../lib/operator-studio/preview.js', () => ({
  fetchByToken: (t: string) => mockFetchByToken(t),
}));

// Stub global fetch used to retrieve index.html
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Import handler AFTER mocks are established
// ---------------------------------------------------------------------------
import handler from '../[token].js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Listing Elevate</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

function makeRes() {
  const res = {
    _status: 0,
    _body: '',
    _headers: {} as Record<string, string>,
    status(code: number) { this._status = code; return this; },
    send(body: string) { this._body = body; return this; },
    setHeader(key: string, value: string) { this._headers[key.toLowerCase()] = value; return this; },
    end() { return this; },
  };
  return res;
}

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'GET',
    query: { token: 'validtoken1234567890validtoken12' },
    body: {},
    headers: { host: 'listingelevate.com' },
    ...overrides,
  } as unknown as VercelRequest;
}

function makeValidResult(overrides: {
  address?: string;
  thumbnail_url?: string | null;
  agentName?: string | null;
} = {}) {
  const address = overrides.address ?? '123 Main St, Springfield, IL 62701, USA';
  return {
    expired: false,
    property: {
      id: 'p1',
      address,
      horizontal_video_url: 'https://cdn/h.mp4',
      vertical_video_url: null,
      client_id: overrides.agentName ? 'c1' : null,
      thumbnail_url: overrides.thumbnail_url !== undefined ? overrides.thumbnail_url : 'https://cdn/thumb.jpg',
    },
    client: overrides.agentName
      ? { name: 'Acme Realty', brand_logo_url: null, agent_name: overrides.agentName, agent_headshot_url: null, brokerage: null }
      : null,
    preview: { kind: 'client', allow_download: true, allow_approve: true, allow_revision: true, approved_at: null },
  };
}

beforeEach(() => {
  mockIsWellFormedToken.mockReset();
  mockFetchByToken.mockReset();
  mockFetch.mockReset();
  // Default: fetch index.html succeeds
  mockFetch.mockResolvedValue({
    ok: true,
    text: async () => INDEX_HTML,
  });
});

// ---------------------------------------------------------------------------
// Valid token — meta tag injection
// ---------------------------------------------------------------------------
describe('GET /preview/[token] — valid token meta injection', () => {
  it('responds with 200 and text/html content-type', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeValidResult());
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect(res._headers['content-type']).toMatch(/text\/html/);
  });

  it('injects og:title with the street address (before first comma)', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeValidResult({ address: '456 Elm Ave, Portland, OR 97201, USA' }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._body).toContain('<meta property="og:title" content="456 Elm Ave"');
  });

  it('injects og:description with "Listing film · <locality>" when no agent name', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeValidResult({ address: '789 Oak Blvd, Austin, TX 78701, USA' }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._body).toContain('<meta property="og:description" content="Listing film · Austin, TX 78701"');
  });

  it('injects og:description with agent name when client has agent_name', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeValidResult({ agentName: 'Jane Smith' }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._body).toContain('<meta property="og:description" content="Jane Smith"');
  });

  it('injects og:image with thumbnail_url', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeValidResult({ thumbnail_url: 'https://cdn/thumbnail.jpg' }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._body).toContain('<meta property="og:image" content="https://cdn/thumbnail.jpg"');
  });

  it('injects twitter:card=summary_large_image', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeValidResult());
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._body).toContain('<meta name="twitter:card" content="summary_large_image"');
  });

  it('injects all four meta tags in one response', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeValidResult({
      address: '5019 San Massimo Dr, Punta Gorda, FL 33950, USA',
      thumbnail_url: 'https://cdn/thumb.jpg',
    }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    const html = res._body;
    // og:title = street address
    expect(html).toContain('<meta property="og:title" content="5019 San Massimo Dr"');
    // og:description = Listing film · locality (no trailing ", USA")
    expect(html).toContain('<meta property="og:description" content="Listing film · Punta Gorda, FL 33950"');
    // og:image = thumbnail_url
    expect(html).toContain('<meta property="og:image" content="https://cdn/thumb.jpg"');
    // twitter:card
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
  });

  it('omits og:image tag when thumbnail_url is null', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeValidResult({ thumbnail_url: null }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    // No og:image injection, but other three still present
    expect(res._body).not.toContain('og:image');
    expect(res._body).toContain('og:title');
    expect(res._body).toContain('og:description');
    expect(res._body).toContain('twitter:card');
  });

  it('fetches index.html from the deployment origin, not an external URL', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeValidResult());
    const res = makeRes();
    await handler(
      makeReq({ headers: { host: 'myapp.vercel.app' } }),
      res as unknown as VercelResponse,
    );
    const fetchedUrl: string = mockFetch.mock.calls[0][0];
    expect(fetchedUrl).toMatch(/^https?:\/\/myapp\.vercel\.app\/index\.html/);
  });
});

// ---------------------------------------------------------------------------
// Invalid / expired token — untouched index.html returned
// ---------------------------------------------------------------------------
describe('GET /preview/[token] — invalid or expired token', () => {
  it('returns untouched index.html (200) for malformed token', async () => {
    mockIsWellFormedToken.mockReturnValue(false);
    const res = makeRes();
    await handler(makeReq({ query: { token: 'bad!' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect(res._body).toBe(INDEX_HTML);
    // No injected meta — nothing was looked up
    expect(res._body).not.toContain('og:title');
  });

  it('returns untouched index.html (200) when token not found in DB', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect(res._body).toBe(INDEX_HTML);
    expect(res._body).not.toContain('og:title');
  });

  it('returns untouched index.html (200) when token is expired', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue({ expired: true, property: {}, client: null, preview: null });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect(res._body).toBe(INDEX_HTML);
    expect(res._body).not.toContain('og:title');
  });
});

// ---------------------------------------------------------------------------
// vercel.json route order assertion
// ---------------------------------------------------------------------------
describe('vercel.json route order', () => {
  it('preview-page shim route appears before the SPA catch-all /(.*)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const vercelJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'),
    ) as { routes: Array<{ src?: string; dest?: string; handle?: string }> };
    const routes = vercelJson.routes;
    const shimIdx = routes.findIndex((r) => r.src === '/preview/([^/]+)');
    const spaIdx = routes.findIndex((r) => r.src === '/(.*)');
    expect(shimIdx).toBeGreaterThan(-1); // shim route must exist
    expect(spaIdx).toBeGreaterThan(-1);  // SPA catch-all must exist
    expect(shimIdx).toBeLessThan(spaIdx); // shim must come first
  });
});
