import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { hashPassword } from '../../../lib/operator-studio/creatives.js';

const mockMaybeSingle = vi.fn();
const mockRpc = vi.fn();
const mockCreateSignedUrl = vi.fn();

const supabase = {
  from: () => ({
    select: () => ({
      eq: () => ({ maybeSingle: () => mockMaybeSingle() }),
    }),
  }),
  rpc: (...args: unknown[]) => mockRpc(...args),
  storage: {
    from: () => ({ createSignedUrl: (...a: unknown[]) => mockCreateSignedUrl(...a) }),
  },
};

vi.mock('../../../lib/client', () => ({
  getSupabase: () => supabase,
}));

import handler from '../[token]';

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
    query: { token: 'tok123' },
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

function baseRow(extra: Record<string, unknown> = {}) {
  return {
    id: 'cr1',
    title: 'My Video',
    description: null,
    source: 'render',
    kind: 'video',
    bucket: 'property-videos',
    storage_path: null,
    public_url: 'https://cdn.example.com/v.mp4',
    thumbnail_url: null,
    mime_type: null,
    duration_seconds: null,
    width: null,
    height: null,
    file_size_bytes: null,
    property_id: 'p1',
    share_token: 'tok123',
    visibility: 'unlisted',
    allow_download: false,
    allow_embed: true,
    presentation_enabled: true,
    password_hash: null,
    expires_at: null,
    view_count: 0,
    last_viewed_at: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

beforeEach(() => {
  mockMaybeSingle.mockReset();
  mockRpc.mockReset();
  mockCreateSignedUrl.mockReset();
  mockRpc.mockResolvedValue({ error: null });
});

describe('GET /api/share/[token]', () => {
  it('returns 400 when token is missing', async () => {
    const res = makeRes();
    await handler(makeReq({ query: {} }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });

  it('returns 404 for an unknown token', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
  });

  it('returns 410 when expired', async () => {
    mockMaybeSingle.mockResolvedValue({ data: baseRow({ expires_at: '2020-01-01T00:00:00Z' }) });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(410);
  });

  it('returns 401 requiresPassword when password set and none provided', async () => {
    mockMaybeSingle.mockResolvedValue({ data: baseRow({ password_hash: hashPassword('secret') }) });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
    expect((res._body as { requiresPassword: boolean }).requiresPassword).toBe(true);
  });

  it('returns 200 for an open render creative with playbackUrl === public_url and increments view', async () => {
    mockMaybeSingle.mockResolvedValue({ data: baseRow() });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect((res._body as { playbackUrl: string }).playbackUrl).toBe('https://cdn.example.com/v.mp4');
    expect(mockRpc).toHaveBeenCalledWith('increment_creative_view', { p_token: 'tok123' });
  });

  it('returns 403 for embed ctx when allow_embed is false', async () => {
    mockMaybeSingle.mockResolvedValue({ data: baseRow({ allow_embed: false }) });
    const res = makeRes();
    await handler(
      makeReq({ query: { token: 'tok123', ctx: 'embed' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(403);
    expect((res._body as { error: string }).error).toBe('embedding disabled');
  });

  it('accepts password via POST body and returns 200', async () => {
    mockMaybeSingle.mockResolvedValue({ data: baseRow({ password_hash: hashPassword('secret') }) });
    const res = makeRes();
    await handler(
      makeReq({ method: 'POST', body: { password: 'secret' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
  });

  it('does not fail the request when the view rpc throws', async () => {
    mockMaybeSingle.mockResolvedValue({ data: baseRow() });
    mockRpc.mockRejectedValue(new Error('rpc down'));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
  });
});
