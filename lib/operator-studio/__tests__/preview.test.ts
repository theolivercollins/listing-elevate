import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
const mockRpc = vi.fn();
vi.mock('../../client', () => ({
  getSupabase: () => ({ from: mockFrom, rpc: mockRpc }),
}));
vi.mock('../preview-tokens', () => ({
  generatePreviewToken: () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
}));
// Mock toPublicPhotoUrl so tests are independent of SUPABASE_URL env var
const mockToPublicPhotoUrl = vi.fn((path: string) => path.startsWith('http') ? path : `https://test.supabase.co/storage/v1/object/public/property-photos/${path}`);
vi.mock('../ingest', () => ({
  toPublicPhotoUrl: (path: string) => mockToPublicPhotoUrl(path),
}));

import { createPreviewLink, fetchByToken, recordPreviewView, insertClientNote, resolveHeroPhotoUrl, isVideoUrl } from '../preview';

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset().mockResolvedValue({ data: null, error: null });
});

describe('createPreviewLink', () => {
  it('inserts a row with the generated token + property_id', async () => {
    const insert = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnThis();
    const single = vi.fn().mockResolvedValue({ data: { id: 'pv1', token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', property_id: 'p1' }, error: null });
    mockFrom.mockReturnValue({ insert, select, single });
    const row = await createPreviewLink('p1');
    expect(mockFrom).toHaveBeenCalledWith('property_previews');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ property_id: 'p1', token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }));
    expect(row.id).toBe('pv1');
  });

  it('throws when DB returns an error', async () => {
    const insert = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnThis();
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'db boom' } });
    mockFrom.mockReturnValue({ insert, select, single });
    await expect(createPreviewLink('p1')).rejects.toThrow(/db boom/);
  });

  it('passes expires_at when provided', async () => {
    const insert = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnThis();
    const single = vi.fn().mockResolvedValue({ data: { id: 'pv2', token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', property_id: 'p1', expires_at: '2099-01-01T00:00:00Z' }, error: null });
    mockFrom.mockReturnValue({ insert, select, single });
    const row = await createPreviewLink('p1', '2099-01-01T00:00:00Z');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ expires_at: '2099-01-01T00:00:00Z' }));
    expect(row.id).toBe('pv2');
  });
});

describe('fetchByToken', () => {
  it('returns null when token not found', async () => {
    mockFrom.mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) });
    expect(await fetchByToken('nope')).toBeNull();
  });

  it('marks expired when expires_at is in the past', async () => {
    mockFrom
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { property_id: 'p1', expires_at: '2020-01-01T00:00:00Z' } }) }) }) })
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'p1', address: '1 Oak', client_id: null } }) }) }) });
    const r = await fetchByToken('t');
    expect(r?.expired).toBe(true);
  });

  it('marks not-expired when expires_at is null', async () => {
    mockFrom
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { property_id: 'p1', expires_at: null } }) }) }) })
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'p1', address: '1 Oak', client_id: null } }) }) }) });
    const r = await fetchByToken('t');
    expect(r?.expired).toBe(false);
  });

  it('returns null when property not found', async () => {
    mockFrom
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { property_id: 'p1', expires_at: null } }) }) }) })
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) });
    expect(await fetchByToken('t')).toBeNull();
  });

  it('includes client brand fields when client_id is set', async () => {
    mockFrom
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { property_id: 'p1', expires_at: null } }) }) }) })
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'p1', address: '1 Oak', client_id: 'c1' } }) }) }) })
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: 'Helgemo', brand_logo_url: 'logo.png', agent_name: 'Abby' } }) }) }) });
    const r = await fetchByToken('t');
    expect(r?.client?.name).toBe('Helgemo');
    expect(r?.client?.agent_name).toBe('Abby');
    expect(r?.client?.brand_logo_url).toBe('logo.png');
  });

  it('sets client to null when no client_id', async () => {
    mockFrom
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { property_id: 'p1', expires_at: null } }) }) }) })
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'p1', address: '1 Oak', client_id: null } }) }) }) });
    const r = await fetchByToken('t');
    expect(r?.client).toBeNull();
  });
});

describe('recordPreviewView', () => {
  it('calls the increment_preview_view RPC', async () => {
    await recordPreviewView('tok');
    expect(mockRpc).toHaveBeenCalledWith('increment_preview_view', { p_token: 'tok' });
  });
});

describe('insertClientNote', () => {
  it('inserts a property_revision_notes row tagged client_preview', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert });
    await insertClientNote({ property_id: 'p1', source: 'client_preview', body: 'fix it' });
    expect(mockFrom).toHaveBeenCalledWith('property_revision_notes');
    expect(insert).toHaveBeenCalledWith({ property_id: 'p1', source: 'client_preview', body: 'fix it' });
  });

  it('throws when DB insert fails', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'constraint violation' } });
    mockFrom.mockReturnValue({ insert });
    await expect(insertClientNote({ property_id: 'p1', source: 'client_preview', body: 'oops' })).rejects.toThrow(/constraint violation/);
  });
});

// ---------------------------------------------------------------------------
// isVideoUrl — guard function
// ---------------------------------------------------------------------------

describe('isVideoUrl', () => {
  it('returns true for .mp4 URLs', () => {
    expect(isVideoUrl('https://cdn/scene_1_B.mp4')).toBe(true);
  });

  it('returns true for .webm URLs', () => {
    expect(isVideoUrl('https://cdn/clip.webm')).toBe(true);
  });

  it('returns true for .mov URLs', () => {
    expect(isVideoUrl('https://cdn/clip.mov')).toBe(true);
  });

  it('returns true for property-videos bucket URLs', () => {
    expect(isVideoUrl('https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/uuid/scene.mp4')).toBe(true);
  });

  it('returns true for property-videos bucket even for non-video extension', () => {
    // Belt-and-suspenders: anything from property-videos bucket is rejected
    expect(isVideoUrl('https://cdn/property-videos/uuid/something')).toBe(true);
  });

  it('returns false for .jpg URLs', () => {
    expect(isVideoUrl('https://cdn/photo.jpg')).toBe(false);
  });

  it('returns false for .jpeg URLs', () => {
    expect(isVideoUrl('https://cdn/photo.jpeg')).toBe(false);
  });

  it('returns false for property-photos bucket URLs', () => {
    expect(isVideoUrl('https://example.supabase.co/storage/v1/object/public/property-photos/uuid/photo.jpg')).toBe(false);
  });

  it('returns false for .mp4 appearing only in the path prefix, not extension', () => {
    // e.g., a folder called "mp4archive" should not be rejected
    expect(isVideoUrl('https://cdn/property-photos/uuid/photo.jpg')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveHeroPhotoUrl — photos table query
// ---------------------------------------------------------------------------

type PhotosResult = { data: Array<{ file_url: string | null; quality_score?: number }> | null; error: { message: string } | null };

/** Build mock chain for the SELECTED query (two .eq() calls):
 * .select().eq('property_id').eq('selected').order().limit() */
function makeSelectedPhotosChain(result: PhotosResult) {
  const limit = vi.fn().mockResolvedValue(result);
  const order = vi.fn().mockReturnValue({ limit });
  const eq2 = vi.fn().mockReturnValue({ order });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  return { select };
}

/** Build mock chain for the ANY-PHOTO fallback query (one .eq() call):
 * .select().eq('property_id').order().limit() */
function makeAnyPhotosChain(result: PhotosResult) {
  const limit = vi.fn().mockResolvedValue(result);
  const order = vi.fn().mockReturnValue({ limit });
  const eq1 = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  return { select };
}

describe('resolveHeroPhotoUrl', () => {
  const fakeDb = () => ({ from: mockFrom, rpc: mockRpc });

  it('returns the selected photo URL when selected=true rows exist', async () => {
    // selected query (two .eq() calls) returns a photo
    mockFrom.mockReturnValueOnce(makeSelectedPhotosChain({
      data: [{ file_url: 'uuid/photo.jpg', quality_score: 90 }],
      error: null,
    }));
    const url = await resolveHeroPhotoUrl(fakeDb() as ReturnType<typeof import('../../client').getSupabase>, 'p1');
    expect(url).toBe('https://test.supabase.co/storage/v1/object/public/property-photos/uuid/photo.jpg');
  });

  it('falls back to any photo when no selected=true rows exist', async () => {
    // selected query returns empty — triggers fallback
    mockFrom.mockReturnValueOnce(makeSelectedPhotosChain({ data: [], error: null }));
    // fallback query (one .eq() call) returns a photo
    mockFrom.mockReturnValueOnce(makeAnyPhotosChain({
      data: [{ file_url: 'uuid/fallback.jpg', quality_score: 70 }],
      error: null,
    }));
    const url = await resolveHeroPhotoUrl(fakeDb() as ReturnType<typeof import('../../client').getSupabase>, 'p1');
    expect(url).toBe('https://test.supabase.co/storage/v1/object/public/property-photos/uuid/fallback.jpg');
  });

  it('returns null when no photos exist at all', async () => {
    mockFrom
      .mockReturnValueOnce(makeSelectedPhotosChain({ data: [], error: null }))
      .mockReturnValueOnce(makeAnyPhotosChain({ data: [], error: null }));
    const url = await resolveHeroPhotoUrl(fakeDb() as ReturnType<typeof import('../../client').getSupabase>, 'p1');
    expect(url).toBeNull();
  });

  it('returns null when the photo file_url is a video (.mp4) — isVideoUrl guard', async () => {
    // selected query returns a video URL — rejected by guard → fallback triggered
    mockFrom.mockReturnValueOnce(makeSelectedPhotosChain({
      data: [{ file_url: 'https://cdn/property-videos/uuid/scene_1_B.mp4', quality_score: 90 }],
      error: null,
    }));
    // fallback also returns a video URL — rejected by guard
    mockFrom.mockReturnValueOnce(makeAnyPhotosChain({
      data: [{ file_url: 'https://cdn/property-videos/uuid/scene_1_B.mp4', quality_score: 90 }],
      error: null,
    }));
    const url = await resolveHeroPhotoUrl(fakeDb() as ReturnType<typeof import('../../client').getSupabase>, 'p1');
    expect(url).toBeNull();
  });

  it('returns null on DB error (never throws)', async () => {
    mockFrom.mockReturnValueOnce(makeSelectedPhotosChain({ data: null, error: { message: 'db boom' } }));
    mockFrom.mockReturnValueOnce(makeAnyPhotosChain({ data: null, error: { message: 'db boom' } }));
    await expect(resolveHeroPhotoUrl(fakeDb() as ReturnType<typeof import('../../client').getSupabase>, 'p1')).resolves.toBeNull();
  });

  it('passes through absolute URLs unchanged (no double-prefix)', async () => {
    mockFrom.mockReturnValueOnce(makeSelectedPhotosChain({
      data: [{ file_url: 'https://example.supabase.co/storage/v1/object/public/property-photos/uuid/photo.jpg', quality_score: 80 }],
      error: null,
    }));
    const url = await resolveHeroPhotoUrl(fakeDb() as ReturnType<typeof import('../../client').getSupabase>, 'p1');
    // toPublicPhotoUrl is a pass-through for already-absolute URLs
    expect(url).toBe('https://example.supabase.co/storage/v1/object/public/property-photos/uuid/photo.jpg');
  });
});
