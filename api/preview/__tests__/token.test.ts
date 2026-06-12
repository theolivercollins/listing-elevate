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

  it('returns 200 with video_url, videos, and records view on valid GET', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue({
      expired: false,
      property: { id: 'p1', address: '123 Main St', vertical_video_url: 'https://cdn/v.mp4', horizontal_video_url: null, client_id: null },
      client: null,
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { address: string; video_url: string | null; videos: { horizontal: string | null; vertical: string | null }; brand: unknown };
    expect(body.address).toBe('123 Main St');
    // Only vertical available → video_url falls back to vertical
    expect(body.video_url).toBe('https://cdn/v.mp4');
    // videos field exposes both slots
    expect(body.videos.horizontal).toBeNull();
    expect(body.videos.vertical).toBe('https://cdn/v.mp4');
    expect(body.brand).toBeNull();
    expect(mockRecordPreviewView).toHaveBeenCalledWith('validtoken1234567890validtoken12');
  });

  it('prefers horizontal_video_url for video_url when both are set', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue({
      expired: false,
      property: { id: 'p1', address: '5 Elm', vertical_video_url: 'vertical.mp4', horizontal_video_url: 'horizontal.mp4', client_id: null },
      client: null,
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    const body = res._body as { video_url: string; videos: { horizontal: string; vertical: string } };
    // video_url now prefers horizontal for back-compat
    expect(body.video_url).toBe('horizontal.mp4');
    // both slots populated in videos
    expect(body.videos.horizontal).toBe('horizontal.mp4');
    expect(body.videos.vertical).toBe('vertical.mp4');
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
    const body = res._body as { video_url: string; videos: { horizontal: string; vertical: string | null } };
    expect(body.video_url).toBe('horizontal.mp4');
    expect(body.videos.horizontal).toBe('horizontal.mp4');
    expect(body.videos.vertical).toBeNull();
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

// ---------------------------------------------------------------------------
// T3 — capability enforcement on existing POST (revision note)
// ---------------------------------------------------------------------------

describe('POST /api/preview/[token] — allow_revision enforcement (spec §2)', () => {
  it('returns 403 when preview.allow_revision is false', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue({
      expired: false,
      property: { id: 'p1', address: '1 Oak', vertical_video_url: null, horizontal_video_url: null, client_id: null },
      client: null,
      preview: {
        kind: 'client',
        allow_download: true,
        allow_approve: true,
        allow_revision: false,
        approved_at: null,
      },
    });
    const res = makeRes();
    await handler(
      makeReq({ method: 'POST', body: { body: 'please fix the music' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(403);
    expect((res._body as { error: string }).error).toBe('not_allowed');
    expect(mockInsertClientNote).not.toHaveBeenCalled();
  });

  it('allows POST when allow_revision is true', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue({
      expired: false,
      property: { id: 'p1', address: '1 Oak', vertical_video_url: null, horizontal_video_url: null, client_id: null },
      client: null,
      preview: {
        kind: 'client',
        allow_download: true,
        allow_approve: true,
        allow_revision: true,
        approved_at: null,
      },
    });
    mockInsertClientNote.mockResolvedValue(undefined);
    const res = makeRes();
    await handler(
      makeReq({ method: 'POST', body: { body: 'please fix the music' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(201);
    expect(mockInsertClientNote).toHaveBeenCalled();
  });

  it('pre-migration fallback (preview null) treats allow_revision as true', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue({
      expired: false,
      property: { id: 'p1', address: '1 Oak', vertical_video_url: null, horizontal_video_url: null, client_id: null },
      client: null,
      preview: null,
    });
    mockInsertClientNote.mockResolvedValue(undefined);
    const res = makeRes();
    await handler(
      makeReq({ method: 'POST', body: { body: 'please fix the music' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(201);
    expect(mockInsertClientNote).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T2 — superset payload shape (new fields from spec §2)
// ---------------------------------------------------------------------------

type FullPayload = {
  address: string;
  address_parts: { street: string; locality: string };
  video_url: string | null;
  videos: { horizontal: string | null; vertical: string | null };
  thumbnail_url: string | null;
  brand: {
    logo: string | null;
    agent_name: string | null;
    name: string | null;
    headshot: string | null;
    brokerage: string | null;
  } | null;
  kind: string;
  capabilities: { download: boolean; approve: boolean; revision: boolean };
  approved_at: string | null;
};

function makeFullResult(overrides: {
  address?: string;
  // hero_photo_url is what fetchByToken now returns — resolved from photos table, never a video
  hero_photo_url?: string | null;
  horizontal_video_url?: string | null;
  vertical_video_url?: string | null;
  client?: {
    name: string;
    brand_logo_url: string | null;
    agent_name: string | null;
    agent_headshot_url?: string | null;
    brokerage?: string | null;
  } | null;
  preview?: {
    kind?: string;
    allow_download?: boolean;
    allow_approve?: boolean;
    allow_revision?: boolean;
    approved_at?: string | null;
  } | null;
} = {}) {
  return {
    expired: false,
    property: {
      id: 'p1',
      address: overrides.address ?? '5019 San Massimo Dr, Punta Gorda, FL 33950, USA',
      horizontal_video_url: overrides.horizontal_video_url ?? 'https://cdn/h.mp4',
      vertical_video_url: overrides.vertical_video_url ?? null,
      client_id: overrides.client !== undefined ? (overrides.client ? 'c1' : null) : null,
    },
    // hero_photo_url is resolved from photos table by fetchByToken (never property.thumbnail_url)
    hero_photo_url: overrides.hero_photo_url !== undefined ? overrides.hero_photo_url : 'https://cdn/thumb.jpg',
    client: overrides.client !== undefined
      ? overrides.client
      : null,
    preview: overrides.preview !== undefined
      ? overrides.preview
      : {
          kind: 'client',
          allow_download: true,
          allow_approve: true,
          allow_revision: true,
          approved_at: null,
        },
  };
}

describe('GET superset payload — new fields (spec §2)', () => {
  it('returns full superset shape including all new fields', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeFullResult({
      address: '5019 San Massimo Dr, Punta Gorda, FL 33950, USA',
      hero_photo_url: 'https://cdn/thumb.jpg',
      horizontal_video_url: 'https://cdn/h.mp4',
      vertical_video_url: 'https://cdn/v.mp4',
      client: { name: 'Helgemo', brand_logo_url: 'logo.png', agent_name: 'Abby', agent_headshot_url: 'head.jpg', brokerage: 'RE/MAX' },
      preview: { kind: 'client', allow_download: true, allow_approve: true, allow_revision: true, approved_at: null },
    }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as FullPayload;

    // address_parts
    expect(body.address_parts).toEqual({ street: '5019 San Massimo Dr', locality: 'Punta Gorda, FL 33950' });

    // thumbnail_url comes from hero_photo_url (photos table), not property.thumbnail_url
    expect(body.thumbnail_url).toBe('https://cdn/thumb.jpg');

    // extended brand
    expect(body.brand).toEqual({ logo: 'logo.png', agent_name: 'Abby', name: 'Helgemo', headshot: 'head.jpg', brokerage: 'RE/MAX' });

    // kind + capabilities + approved_at
    expect(body.kind).toBe('client');
    expect(body.capabilities).toEqual({ download: true, approve: true, revision: true });
    expect(body.approved_at).toBeNull();

    // back-compat fields preserved byte-for-byte
    expect(body.address).toBe('5019 San Massimo Dr, Punta Gorda, FL 33950, USA');
    expect(body.video_url).toBe('https://cdn/h.mp4');
    expect(body.videos.horizontal).toBe('https://cdn/h.mp4');
    expect(body.videos.vertical).toBe('https://cdn/v.mp4');
  });

  it('sets approved_at when set on preview', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeFullResult({
      preview: { kind: 'client', allow_download: false, allow_approve: true, allow_revision: false, approved_at: '2026-06-11T10:00:00Z' },
    }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    const body = res._body as FullPayload;
    expect(body.approved_at).toBe('2026-06-11T10:00:00Z');
    expect(body.capabilities.download).toBe(false);
    expect(body.capabilities.revision).toBe(false);
    expect(body.capabilities.approve).toBe(true);
  });

  it('uses kind=public when preview.kind is public', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeFullResult({
      preview: { kind: 'public', allow_download: false, allow_approve: false, allow_revision: false, approved_at: null },
    }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    const body = res._body as FullPayload;
    expect(body.kind).toBe('public');
    expect(body.capabilities).toEqual({ download: false, approve: false, revision: false });
  });
});

describe('address_parts parsing', () => {
  it('splits at first comma: street is before, locality is after without leading space', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeFullResult({ address: '123 Main St, Springfield, IL 62701, USA' }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    const body = res._body as FullPayload;
    expect(body.address_parts.street).toBe('123 Main St');
    expect(body.address_parts.locality).toBe('Springfield, IL 62701');
  });

  it('strips trailing ", USA" from locality', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeFullResult({ address: '42 Oak Ave, Portland, OR 97201, USA' }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    const body = res._body as FullPayload;
    expect(body.address_parts.locality).toBe('Portland, OR 97201');
  });

  it('locality without ", USA" suffix is returned unchanged', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeFullResult({ address: '10 Downing St, London' }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    const body = res._body as FullPayload;
    expect(body.address_parts.street).toBe('10 Downing St');
    expect(body.address_parts.locality).toBe('London');
  });

  it('address with no comma: street is full address, locality is empty string', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeFullResult({ address: 'NoCommaAddress' }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    const body = res._body as FullPayload;
    expect(body.address_parts.street).toBe('NoCommaAddress');
    expect(body.address_parts.locality).toBe('');
  });
});

describe('pre-migration fallback (result.preview is null)', () => {
  it('returns kind=client, all capabilities true, approved_at=null when preview is null', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    // Simulate pre-migration: fetchByToken returns null for preview field
    mockFetchByToken.mockResolvedValue(makeFullResult({ preview: null }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as FullPayload;
    expect(body.kind).toBe('client');
    expect(body.capabilities).toEqual({ download: true, approve: true, revision: true });
    expect(body.approved_at).toBeNull();
  });

  it('preserves all pre-existing GET fields even in pre-migration path', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue({
      expired: false,
      property: {
        id: 'p1',
        address: '7 Pine Rd, Albany, NY 12207, USA',
        horizontal_video_url: 'https://cdn/h.mp4',
        vertical_video_url: null,
        client_id: null,
        thumbnail_url: null,
      },
      client: null,
      // preview absent (property has no preview key) — simulates old fetchByToken shape
      preview: null,
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    const body = res._body as FullPayload;
    // Pre-existing fields unchanged
    expect(body.address).toBe('7 Pine Rd, Albany, NY 12207, USA');
    expect(body.video_url).toBe('https://cdn/h.mp4');
    expect(body.videos.horizontal).toBe('https://cdn/h.mp4');
    expect(body.videos.vertical).toBeNull();
    expect(body.brand).toBeNull();
    // New fields fall back to safe defaults
    expect(body.kind).toBe('client');
    expect(body.capabilities).toEqual({ download: true, approve: true, revision: true });
    expect(body.approved_at).toBeNull();
  });
});

describe('brand extended fields', () => {
  it('includes headshot and brokerage from client when present', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeFullResult({
      client: { name: 'Acme Realty', brand_logo_url: null, agent_name: 'Jane', agent_headshot_url: 'headshot.jpg', brokerage: 'Keller Williams' },
    }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    const body = res._body as FullPayload;
    expect(body.brand?.headshot).toBe('headshot.jpg');
    expect(body.brand?.brokerage).toBe('Keller Williams');
  });

  it('brand headshot and brokerage are null when client fields are absent', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeFullResult({
      client: { name: 'Solo Agent', brand_logo_url: null, agent_name: 'Bob' },
    }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    const body = res._body as FullPayload;
    expect(body.brand?.headshot).toBeNull();
    expect(body.brand?.brokerage).toBeNull();
  });

  it('thumbnail_url is null when hero_photo_url is null (no photo resolved)', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeFullResult({ hero_photo_url: null }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    const body = res._body as FullPayload;
    expect(body.thumbnail_url).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T5 — hero image is NEVER a video file (regression lock)
// ---------------------------------------------------------------------------

describe('GET thumbnail_url — hero is never a video', () => {
  it('thumbnail_url is a real photo URL from hero_photo_url, not property.thumbnail_url', async () => {
    // This is the live-repro scenario: property.thumbnail_url was a scene .mp4 video.
    // fetchByToken now resolves hero_photo_url from the photos table instead.
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue({
      expired: false,
      property: {
        id: 'p1',
        address: '1 Oak, City, FL 33950, USA',
        horizontal_video_url: 'https://cdn/h.mp4',
        vertical_video_url: null,
        client_id: null,
      },
      // hero_photo_url resolved from photos table — a real photo
      hero_photo_url: 'https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-photos/uuid/photo.jpg',
      client: null,
      preview: null,
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    const body = res._body as FullPayload;
    expect(body.thumbnail_url).toBe('https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-photos/uuid/photo.jpg');
    // Must NOT be a video URL
    expect(body.thumbnail_url).not.toMatch(/\.(mp4|webm|mov)$/i);
    expect(body.thumbnail_url).not.toContain('/property-videos/');
  });

  it('thumbnail_url is null (not a video) when no photo resolved from photos table', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue({
      expired: false,
      property: { id: 'p2', address: '2 Oak, City, FL, USA', horizontal_video_url: null, vertical_video_url: null, client_id: null },
      // No photo found — hero_photo_url is null
      hero_photo_url: null,
      client: null,
      preview: null,
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    const body = res._body as FullPayload;
    // Should be null, not a video
    expect(body.thumbnail_url).toBeNull();
  });
});
