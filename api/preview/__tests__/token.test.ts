import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockIsWellFormedToken = vi.fn();
const mockFetchByToken = vi.fn();
const mockRecordPreviewView = vi.fn();
const mockInsertClientNote = vi.fn();

vi.mock('../../../lib/operator-studio/preview-tokens', () => ({
  isWellFormedToken: (t: string) => mockIsWellFormedToken(t),
}));
vi.mock('../../../lib/operator-studio/preview', () => ({
  fetchByToken: (t: string) => mockFetchByToken(t),
  recordPreviewView: (t: string) => mockRecordPreviewView(t),
  insertClientNote: (args: unknown) => mockInsertClientNote(args),
}));

import handler from '../[token]';

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
    query: { token: 'validtoken1234567890validtoken12' },
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

beforeEach(() => {
  mockIsWellFormedToken.mockReset();
  mockFetchByToken.mockReset();
  mockRecordPreviewView.mockReset().mockResolvedValue(undefined);
  mockInsertClientNote.mockReset();
});

describe('GET /api/preview/[token]', () => {
  it('returns 404 for malformed token without hitting DB', async () => {
    mockIsWellFormedToken.mockReturnValue(false);
    const res = makeRes();
    await handler(makeReq({ query: { token: 'bad!' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
    expect(mockFetchByToken).not.toHaveBeenCalled();
  });

  it('returns 404 when fetchByToken returns null', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
  });

  it('returns 404 when preview is expired', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue({
      expired: true,
      property: { id: 'p1', address: '1 Oak', vertical_video_url: 'v.mp4', horizontal_video_url: null, client_id: null },
      client: null,
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
  });

  it('returns 200 with video_url and records view on valid GET', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue({
      expired: false,
      property: { id: 'p1', address: '123 Main St', vertical_video_url: 'https://cdn/v.mp4', horizontal_video_url: null, client_id: null },
      client: null,
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { address: string; video_url: string | null; brand: unknown };
    expect(body.address).toBe('123 Main St');
    expect(body.video_url).toBe('https://cdn/v.mp4');
    expect(body.brand).toBeNull();
    expect(mockRecordPreviewView).toHaveBeenCalledWith('validtoken1234567890validtoken12');
  });

  it('prefers vertical_video_url over horizontal when both are set', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue({
      expired: false,
      property: { id: 'p1', address: '5 Elm', vertical_video_url: 'vertical.mp4', horizontal_video_url: 'horizontal.mp4', client_id: null },
      client: null,
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect((res._body as { video_url: string }).video_url).toBe('vertical.mp4');
  });

  it('falls back to horizontal_video_url when vertical is null', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue({
      expired: false,
      property: { id: 'p1', address: '5 Elm', vertical_video_url: null, horizontal_video_url: 'horizontal.mp4', client_id: null },
      client: null,
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect((res._body as { video_url: string }).video_url).toBe('horizontal.mp4');
  });

  it('includes brand info when client is set', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue({
      expired: false,
      property: { id: 'p1', address: '1 Oak', vertical_video_url: 'v.mp4', horizontal_video_url: null, client_id: 'c1' },
      client: { name: 'Helgemo', brand_logo_url: 'logo.png', agent_name: 'Abby' },
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    const body = res._body as { brand: { logo: string; agent_name: string; name: string } };
    expect(body.brand.logo).toBe('logo.png');
    expect(body.brand.agent_name).toBe('Abby');
    expect(body.brand.name).toBe('Helgemo');
  });
});

describe('POST /api/preview/[token]', () => {
  it('returns 404 for malformed token', async () => {
    mockIsWellFormedToken.mockReturnValue(false);
    const res = makeRes();
    await handler(makeReq({ method: 'POST', query: { token: '!!!' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
    expect(mockInsertClientNote).not.toHaveBeenCalled();
  });

  it('returns 400 when body is empty', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: { body: '  ' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });

  it('returns 400 when body exceeds 2000 chars', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: { body: 'x'.repeat(2001) } }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });

  it('returns 404 when preview not found or expired', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: { body: 'please fix the music' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
  });

  it('inserts note and returns 201 on valid POST', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue({
      expired: false,
      property: { id: 'p1', address: '1 Oak', vertical_video_url: null, horizontal_video_url: null, client_id: null },
      client: null,
    });
    mockInsertClientNote.mockResolvedValue(undefined);
    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: { body: 'please fix the music' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(201);
    expect(mockInsertClientNote).toHaveBeenCalledWith({
      property_id: 'p1',
      source: 'client_preview',
      body: 'please fix the music',
    });
    expect((res._body as { ok: boolean }).ok).toBe(true);
  });
});

describe('unsupported methods', () => {
  it('returns 405 for DELETE', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    const res = makeRes();
    await handler(makeReq({ method: 'DELETE' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
  });
});
