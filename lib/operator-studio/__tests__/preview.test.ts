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

import { createPreviewLink, fetchByToken, recordPreviewView, insertClientNote, resolveHeroPhotoUrl, isVideoUrl, insertViewEvent, aggregateViewEvents } from '../preview';

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

  it('persists label when provided (round-trip)', async () => {
    const insert = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnThis();
    const single = vi.fn().mockResolvedValue({ data: { id: 'pv3', token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', property_id: 'p1', label: 'Sent to Brian' }, error: null });
    mockFrom.mockReturnValue({ insert, select, single });
    const row = await createPreviewLink('p1', null, 'client', 'Sent to Brian');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ label: 'Sent to Brian' }));
    expect(row.label).toBe('Sent to Brian');
  });

  it('omits label from the insert when not provided', async () => {
    const insert = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnThis();
    const single = vi.fn().mockResolvedValue({ data: { id: 'pv4', token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', property_id: 'p1' }, error: null });
    mockFrom.mockReturnValue({ insert, select, single });
    await createPreviewLink('p1');
    const payload = insert.mock.calls[0][0] as Record<string, unknown>;
    expect('label' in payload).toBe(false);
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

  it('marks expired when revoked_at is set (even with no expiry)', async () => {
    mockFrom
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { property_id: 'p1', expires_at: null, revoked_at: '2026-06-11T00:00:00Z' } }) }) }) })
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'p1', address: '1 Oak', client_id: null } }) }) }) });
    const r = await fetchByToken('t');
    expect(r?.expired).toBe(true);
  });

  it('does not mark expired when revoked_at is null and not past expiry', async () => {
    mockFrom
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { property_id: 'p1', expires_at: null, revoked_at: null } }) }) }) })
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'p1', address: '1 Oak', client_id: null } }) }) }) });
    const r = await fetchByToken('t');
    expect(r?.expired).toBe(false);
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

describe('fetchByToken — show_branding via fetchPreviewMeta (P1 regression)', () => {
  /** Build a standard from() chain that can satisfy either a maybeSingle or chain ending. */
  function makeSimpleChain(data: unknown) {
    return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data, error: null }) }) }) };
  }

  /** Build a photos chain for resolveHeroPhotoUrl (two-eq selected query). */
  function makePhotosChain() {
    return { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }) };
  }

  it('passes show_branding=false from the DB row through to preview.show_branding', async () => {
    // Call order: (1) property_previews select * (pv row), (2) properties select, (3) fetchPreviewMeta select w/ show_branding,
    // (4+5) resolveHeroPhotoUrl photos queries
    const selectSpy = vi.fn().mockReturnValue({ eq: () => ({ maybeSingle: () => Promise.resolve({
      data: { kind: 'public', allow_download: false, allow_approve: false, allow_revision: false, approved_at: null, label: null, revoked_at: null, show_branding: false },
      error: null,
    }) }) });
    mockFrom
      .mockReturnValueOnce(makeSimpleChain({ property_id: 'p1', expires_at: null }))        // 1: pv row
      .mockReturnValueOnce(makeSimpleChain({ id: 'p1', address: '1 Main', client_id: null, horizontal_video_url: null, vertical_video_url: null, brokerage: null })) // 2: property
      .mockReturnValueOnce({ select: selectSpy })  // 3: fetchPreviewMeta — spy on select
      .mockReturnValueOnce(makePhotosChain())       // 4: resolveHeroPhotoUrl selected-photos
      .mockReturnValueOnce(makePhotosChain());      // 5: resolveHeroPhotoUrl any-photos fallback

    const r = await fetchByToken('tok');
    // Assert the column list passed to select includes show_branding
    expect(selectSpy).toHaveBeenCalledWith(expect.stringContaining('show_branding'));
    // Assert the returned PreviewMeta carries show_branding=false (not undefined ?? true)
    expect(r?.preview?.show_branding).toBe(false);
  });

  it('defaults show_branding=true when column is absent from DB row (pre-087 fallback)', async () => {
    const selectSpy = vi.fn().mockReturnValue({ eq: () => ({ maybeSingle: () => Promise.resolve({
      // Row WITHOUT show_branding — simulates pre-migration DB returning the column as undefined
      data: { kind: 'public', allow_download: false, allow_approve: false, allow_revision: false, approved_at: null, label: null, revoked_at: null },
      error: null,
    }) }) });
    mockFrom
      .mockReturnValueOnce(makeSimpleChain({ property_id: 'p1', expires_at: null }))
      .mockReturnValueOnce(makeSimpleChain({ id: 'p1', address: '1 Main', client_id: null, horizontal_video_url: null, vertical_video_url: null, brokerage: null }))
      .mockReturnValueOnce({ select: selectSpy })
      .mockReturnValueOnce(makePhotosChain())
      .mockReturnValueOnce(makePhotosChain());

    const r = await fetchByToken('tok');
    // Pre-087: column absent → default true (preserves branded behavior)
    expect(r?.preview?.show_branding).toBe(true);
  });

  // -------------------------------------------------------------------------
  // P1 safety regression: 42703 retry path — migration 087 NOT applied
  // (083/084 present, 087 absent — the ACTUAL production state until 087 is applied).
  //
  // The critical invariant: a missing show_branding column MUST NOT cause kind,
  // allow_download, allow_approve, allow_revision, or approved_at to be lost.
  // Before this fix, fetchPreviewMeta had ONE combined select that included
  // show_branding; PostgREST returns 42703 for the whole query, fetchPreviewMeta
  // returned null, and api/preview/[token].ts defaulted kind='client' + all caps TRUE
  // — silently inverting capability isolation on every public/customer link.
  // -------------------------------------------------------------------------
  it('42703 on first select (show_branding absent) retries WITHOUT show_branding and preserves kind/capabilities', async () => {
    // fetchPreviewMeta fires TWO from('property_previews') calls when it hits 42703:
    //   call A: select with show_branding   → 42703 error
    //   call B: select WITHOUT show_branding → success with kind='public' + caps all false
    let fromCallCount = 0;

    // Build a chain that returns 42703 on first call, success on second
    const makeMetaChain42703 = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({
            data: null,
            error: { code: '42703', message: 'column "show_branding" does not exist' },
          }),
        }),
      }),
    });
    const makeMetaChainFallback = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({
            data: { kind: 'public', allow_download: false, allow_approve: false, allow_revision: false, approved_at: null, label: 'Customer Link', revoked_at: null },
            error: null,
          }),
        }),
      }),
    });

    mockFrom
      .mockReturnValueOnce(makeSimpleChain({ property_id: 'p1', expires_at: null }))   // 1: pv row (fetchByToken outer)
      .mockReturnValueOnce(makeSimpleChain({ id: 'p1', address: '1 Main', client_id: null, horizontal_video_url: null, vertical_video_url: null, brokerage: null })) // 2: property
      .mockImplementationOnce(() => { fromCallCount++; return makeMetaChain42703(); }) // 3: fetchPreviewMeta first attempt → 42703
      .mockImplementationOnce(() => { fromCallCount++; return makeMetaChainFallback(); }) // 4: fetchPreviewMeta retry → success
      .mockReturnValueOnce(makePhotosChain())  // 5: resolveHeroPhotoUrl selected-photos
      .mockReturnValueOnce(makePhotosChain()); // 6: resolveHeroPhotoUrl any-photos fallback

    const r = await fetchByToken('tok');

    // Both meta from() calls were made (42703 triggered the retry)
    expect(fromCallCount).toBe(2);
    // CRITICAL: kind and capabilities are NOT lost — they reflect the real DB row
    expect(r?.preview?.kind).toBe('public');
    expect(r?.preview?.allow_download).toBe(false);
    expect(r?.preview?.allow_approve).toBe(false);
    expect(r?.preview?.allow_revision).toBe(false);
    expect(r?.preview?.label).toBe('Customer Link');
    // show_branding defaults to true on the fallback path (no column = branded)
    expect(r?.preview?.show_branding).toBe(true);
    // fetchByToken itself is not null — the link is still resolvable
    expect(r).not.toBeNull();
  });

  it('42703 on first select: a public link with allow_download=false does NOT silently upgrade to allow_download=true', async () => {
    // This is the concrete capability-isolation regression: pre-fix, a public link
    // (allow_download=false) would fall through fetchPreviewMeta→null, then
    // api/preview/[token].ts would default allow_download = preview?.allow_download ?? true → true.
    // Post-fix, the retry returns the real row and allow_download stays false.
    mockFrom
      .mockReturnValueOnce(makeSimpleChain({ property_id: 'p1', expires_at: null }))
      .mockReturnValueOnce(makeSimpleChain({ id: 'p1', address: '1 Main', client_id: null, horizontal_video_url: null, vertical_video_url: null, brokerage: null }))
      .mockReturnValueOnce({
        // first meta call → 42703
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { code: '42703', message: 'column "show_branding" does not exist' } }) }) }),
      })
      .mockReturnValueOnce({
        // retry → real public row (download disabled)
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { kind: 'public', allow_download: false, allow_approve: false, allow_revision: false, approved_at: null, label: null, revoked_at: null }, error: null }) }) }),
      })
      .mockReturnValueOnce(makePhotosChain())
      .mockReturnValueOnce(makePhotosChain());

    const r = await fetchByToken('tok');
    expect(r?.preview?.kind).toBe('public');
    // The real false value must survive — NOT defaulted to true
    expect(r?.preview?.allow_download).toBe(false);
    expect(r?.preview?.allow_approve).toBe(false);
    expect(r?.preview?.allow_revision).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fetchByToken — properties hls/poster columns (migration 102)
//
// horizontal_hls_url/horizontal_poster_url/vertical_hls_url/vertical_poster_url
// are additive nullable columns. The properties select tries the full column
// list first; on 42703 (undefined_column — migration 102 not yet applied on
// this env's shared DB) it retries with the pre-102 list so the preview link
// never 404s mid-rollout. Mirrors the show_branding 42703-retry tests above.
// ---------------------------------------------------------------------------

describe('fetchByToken — properties hls/poster columns (migration 102)', () => {
  it('passes horizontal_hls_url/horizontal_poster_url/vertical_hls_url/vertical_poster_url through when present', async () => {
    mockFrom
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { property_id: 'p1', expires_at: null }, error: null }) }) }) }) // 1: pv row
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({
        data: {
          id: 'p1', address: '1 Oak', client_id: null,
          horizontal_video_url: 'https://cdn/h.mp4', vertical_video_url: null,
          horizontal_hls_url: 'https://cdn/h.m3u8', horizontal_poster_url: 'https://cdn/h-poster.jpg',
          vertical_hls_url: null, vertical_poster_url: null,
        },
        error: null,
      }) }) }) }); // 2: property (full select succeeds)

    const r = await fetchByToken('tok');
    expect(r).not.toBeNull();
    const prop = r?.property as Record<string, unknown>;
    expect(prop.horizontal_hls_url).toBe('https://cdn/h.m3u8');
    expect(prop.horizontal_poster_url).toBe('https://cdn/h-poster.jpg');
    expect(prop.vertical_hls_url).toBeNull();
    expect(prop.vertical_poster_url).toBeNull();
  });

  it('42703 on the properties select (migration 102 not applied) retries WITHOUT hls/poster columns and still resolves the link', async () => {
    let propertyCallCount = 0;
    mockFrom
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { property_id: 'p1', expires_at: null }, error: null }) }) }) }) // 1: pv row
      .mockImplementationOnce(() => {
        propertyCallCount++;
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({
          data: null,
          error: { code: '42703', message: 'column "horizontal_hls_url" does not exist' },
        }) }) }) };
      }) // 2: property full select → 42703
      .mockImplementationOnce(() => {
        propertyCallCount++;
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({
          data: { id: 'p1', address: '1 Oak', client_id: null, horizontal_video_url: 'https://cdn/h.mp4', vertical_video_url: null, brokerage: null },
          error: null,
        }) }) }) };
      }); // 3: property fallback select → success (pre-102 columns only)

    const r = await fetchByToken('tok');

    expect(propertyCallCount).toBe(2);
    expect(r).not.toBeNull();
    const prop = r?.property as Record<string, unknown>;
    // Pre-existing fields survive the fallback.
    expect(prop.id).toBe('p1');
    expect(prop.horizontal_video_url).toBe('https://cdn/h.mp4');
    // New columns simply absent (undefined) on the fallback shape — never crash,
    // never 404 the link.
    expect(prop.horizontal_hls_url).toBeUndefined();
    expect(prop.horizontal_poster_url).toBeUndefined();
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

// ---------------------------------------------------------------------------
// insertViewEvent — append-only beacon insert, pre-migration safe
// ---------------------------------------------------------------------------

describe('insertViewEvent', () => {
  it('inserts a preview_view_events row with clamped strings', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert });
    await insertViewEvent({ preview_id: 'pv1', session_id: 's1', event: 'play', position_seconds: 12, orientation: 'horizontal' });
    expect(mockFrom).toHaveBeenCalledWith('preview_view_events');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ preview_id: 'pv1', session_id: 's1', event: 'play', position_seconds: 12, orientation: 'horizontal' }));
  });

  it('does not throw when the DB insert returns an error (pre-migration safe)', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'relation "preview_view_events" does not exist' } });
    mockFrom.mockReturnValue({ insert });
    await expect(insertViewEvent({ preview_id: 'pv1', session_id: 's1', event: 'view' })).resolves.toBeUndefined();
  });

  it('does not throw when the insert call itself rejects', async () => {
    const insert = vi.fn().mockRejectedValue(new Error('network down'));
    mockFrom.mockReturnValue({ insert });
    await expect(insertViewEvent({ preview_id: 'pv1', session_id: 's1', event: 'view' })).resolves.toBeUndefined();
  });

  it('clamps user_agent and referrer to 512 chars', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert });
    const long = 'x'.repeat(900);
    await insertViewEvent({ preview_id: 'pv1', session_id: 's1', event: 'view', user_agent: long, referrer: long });
    const payload = insert.mock.calls[0][0] as { user_agent: string; referrer: string };
    expect(payload.user_agent.length).toBe(512);
    expect(payload.referrer.length).toBe(512);
  });
});

// ---------------------------------------------------------------------------
// aggregateViewEvents — pure distinct-session math (DB-free, unit-testable)
// ---------------------------------------------------------------------------

describe('aggregateViewEvents', () => {
  it('returns zeroes for an empty event list', () => {
    const r = aggregateViewEvents([]);
    expect(r).toEqual({ total_plays: 0, unique_viewers: 0, avg_completion_pct: 0 });
  });

  it('dedupes plays by session and counts distinct viewers across all events', () => {
    // s1 plays twice (counts once), s2 plays once, s3 only viewed (no play)
    const r = aggregateViewEvents([
      { session_id: 's1', event: 'view' },
      { session_id: 's1', event: 'play' },
      { session_id: 's1', event: 'play' },
      { session_id: 's2', event: 'play' },
      { session_id: 's3', event: 'view' },
    ]);
    expect(r.total_plays).toBe(2); // distinct sessions with a play: s1, s2
    expect(r.unique_viewers).toBe(3); // distinct session_id across all events: s1, s2, s3
  });

  it('computes avg completion from the max milestone per session', () => {
    // s1 reached progress_75 (75%), s2 reached complete (100%), s3 only played (0%)
    const r = aggregateViewEvents([
      { session_id: 's1', event: 'play' },
      { session_id: 's1', event: 'progress_25' },
      { session_id: 's1', event: 'progress_75' },
      { session_id: 's2', event: 'play' },
      { session_id: 's2', event: 'complete' },
      { session_id: 's3', event: 'play' },
    ]);
    // avg over sessions that have a play: (75 + 100 + 0) / 3 = 58.33 → rounded 58
    expect(r.avg_completion_pct).toBe(58);
  });

  it('maps each milestone event to its completion percentage', () => {
    const r = aggregateViewEvents([
      { session_id: 'a', event: 'progress_25' },
      { session_id: 'b', event: 'progress_50' },
    ]);
    // a=25, b=50 → avg 37.5 → 38
    expect(r.avg_completion_pct).toBe(38);
  });
});
