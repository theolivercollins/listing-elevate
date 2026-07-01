// lib/studio/__tests__/draft-cleanup.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanupStaleDrafts, purgeDraftStorageForOwner } from '../draft-cleanup';

interface StaleRow {
  id: string;
  photo_paths: Array<{ path?: string; url?: string }> | null;
}

function makeSupabase(opts: {
  staleRows: StaleRow[];
  /** photos.file_url values that exist (a path whose URL is here is "live"). */
  referencedUrls?: string[];
  /** Force the photos reference-check query to error (fail-safe test). */
  photosErr?: string;
  removeImpl?: (paths: string[]) => Promise<{ data: unknown; error: unknown }>;
  deleteImpl?: (id: string) => Promise<{ error: unknown }>;
}) {
  const removeSpy = vi.fn(
    opts.removeImpl ??
      (async (paths: string[]) => ({ data: paths.map((p) => ({ name: p })), error: null })),
  );
  const deleteSpy = vi.fn(opts.deleteImpl ?? (async () => ({ error: null })));
  const referenced = new Set(opts.referencedUrls ?? []);
  const photosInSpy = vi.fn((_col: string, urls: string[]) =>
    Promise.resolve(
      opts.photosErr
        ? { data: null, error: { message: opts.photosErr } }
        : { data: urls.filter((u) => referenced.has(u)).map((u) => ({ file_url: u })), error: null },
    ),
  );

  const supabase = {
    from: (table: string) => {
      if (table === 'studio_drafts') {
        return {
          select: () => ({
            lt: () => Promise.resolve({ data: opts.staleRows, error: null }),
          }),
          delete: () => ({
            eq: (_col: string, id: string) => deleteSpy(id),
          }),
        };
      }
      if (table === 'photos') {
        return { select: () => ({ in: (col: string, urls: string[]) => photosInSpy(col, urls) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
    storage: {
      from: (bucket: string) => {
        if (bucket !== 'property-photos') throw new Error(`unexpected bucket ${bucket}`);
        return { remove: (paths: string[]) => removeSpy(paths) };
      },
    },
  };

  return { supabase: supabase as unknown as SupabaseClient, removeSpy, deleteSpy, photosInSpy };
}

/** Mock for purgeDraftStorageForOwner — a single draft loaded by (id, owner). */
function makePurgeSupabase(opts: {
  draft: { photo_paths: Array<{ path?: string; url?: string }> } | null;
  referencedUrls?: string[];
  removeImpl?: (paths: string[]) => Promise<{ data: unknown; error: unknown }>;
}) {
  const removeSpy = vi.fn(
    opts.removeImpl ??
      (async (paths: string[]) => ({ data: paths.map((p) => ({ name: p })), error: null })),
  );
  const referenced = new Set(opts.referencedUrls ?? []);
  const maybeSingle = vi.fn(async () => ({ data: opts.draft, error: null }));

  const supabase = {
    from: (table: string) => {
      if (table === 'studio_drafts') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }) };
      }
      if (table === 'photos') {
        return {
          select: () => ({
            in: (_col: string, urls: string[]) =>
              Promise.resolve({
                data: urls.filter((u) => referenced.has(u)).map((u) => ({ file_url: u })),
                error: null,
              }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    storage: {
      from: (bucket: string) => {
        if (bucket !== 'property-photos') throw new Error(`unexpected bucket ${bucket}`);
        return { remove: (paths: string[]) => removeSpy(paths) };
      },
    },
  };

  return { supabase: supabase as unknown as SupabaseClient, removeSpy, maybeSingle };
}

describe('cleanupStaleDrafts', () => {
  it('deletes stale rows and their photo objects', async () => {
    const { supabase, removeSpy, deleteSpy } = makeSupabase({
      staleRows: [
        { id: 'd1', photo_paths: [{ path: 'd1/raw/a.jpg' }, { path: 'd1/raw/b.jpg' }] },
        { id: 'd2', photo_paths: [] },
      ],
    });

    const result = await cleanupStaleDrafts(supabase, new Date('2026-07-15T00:00:00Z'));

    expect(result.scanned).toBe(2);
    expect(result.deletedRows).toBe(2);
    expect(result.deletedPhotos).toBe(2);
    expect(result.failedPhotoDeletes).toBe(0);
    expect(result.rowErrors).toEqual([]);
    expect(removeSpy).toHaveBeenCalledWith(['d1/raw/a.jpg', 'd1/raw/b.jpg']);
    expect(removeSpy).toHaveBeenCalledTimes(1); // d2 has no photos — no remove() call
    expect(deleteSpy).toHaveBeenCalledWith('d1');
    expect(deleteSpy).toHaveBeenCalledWith('d2');
  });

  it('queries with the 14-day cutoff', async () => {
    let capturedCol: string | null = null;
    let capturedCutoff: string | null = null;
    const supabase = {
      from: () => ({
        select: () => ({
          lt: (col: string, cutoff: string) => {
            capturedCol = col;
            capturedCutoff = cutoff;
            return Promise.resolve({ data: [], error: null });
          },
        }),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
      storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
    } as unknown as SupabaseClient;

    const now = new Date('2026-07-15T00:00:00Z');
    await cleanupStaleDrafts(supabase, now);

    expect(capturedCol).toBe('updated_at');
    expect(capturedCutoff).toBe(new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString());
  });

  it('continues sweeping other rows when one storage remove fails', async () => {
    const { supabase, removeSpy } = makeSupabase({
      staleRows: [
        { id: 'd1', photo_paths: [{ path: 'd1/raw/a.jpg' }] },
        { id: 'd2', photo_paths: [{ path: 'd2/raw/b.jpg' }] },
      ],
      removeImpl: async (paths: string[]) => {
        if (paths[0].startsWith('d1')) return { data: null, error: { message: 'storage down' } };
        return { data: paths.map((p) => ({ name: p })), error: null };
      },
    });

    const result = await cleanupStaleDrafts(supabase, new Date());

    expect(result.deletedRows).toBe(2); // row delete still happens even when storage cleanup fails
    expect(result.failedPhotoDeletes).toBe(1);
    expect(result.deletedPhotos).toBe(1);
    expect(removeSpy).toHaveBeenCalledTimes(2);
  });

  it('continues sweeping other rows when one storage remove throws', async () => {
    const { supabase } = makeSupabase({
      staleRows: [{ id: 'd1', photo_paths: [{ path: 'd1/raw/a.jpg' }] }],
      removeImpl: async () => {
        throw new Error('network blip');
      },
    });

    const result = await cleanupStaleDrafts(supabase, new Date());

    expect(result.deletedRows).toBe(1);
    expect(result.failedPhotoDeletes).toBe(1);
  });

  it('continues sweeping other rows when one row delete fails', async () => {
    const { supabase } = makeSupabase({
      staleRows: [
        { id: 'd1', photo_paths: [] },
        { id: 'd2', photo_paths: [] },
      ],
      deleteImpl: async (id: string) => (id === 'd1' ? { error: { message: 'locked' } } : { error: null }),
    });

    const result = await cleanupStaleDrafts(supabase, new Date());

    expect(result.deletedRows).toBe(1);
    expect(result.rowErrors).toEqual([{ id: 'd1', error: 'locked' }]);
  });

  it('skips storage cleanup entirely when a row has no photos', async () => {
    const { supabase, removeSpy } = makeSupabase({ staleRows: [{ id: 'd1', photo_paths: [] }] });

    await cleanupStaleDrafts(supabase, new Date());

    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('returns a zeroed result when nothing is stale', async () => {
    const { supabase } = makeSupabase({ staleRows: [] });

    const result = await cleanupStaleDrafts(supabase, new Date());

    expect(result).toEqual({
      scanned: 0,
      deletedRows: 0,
      deletedPhotos: 0,
      failedPhotoDeletes: 0,
      skippedReferencedPhotos: 0,
      rowErrors: [],
    });
  });

  it('throws when the initial list query fails', async () => {
    const supabase = {
      from: () => ({
        select: () => ({ lt: () => Promise.resolve({ data: null, error: { message: 'query failed' } }) }),
      }),
      storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
    } as unknown as SupabaseClient;

    await expect(cleanupStaleDrafts(supabase, new Date())).rejects.toThrow(/query failed/);
  });

  // ─── data-loss guard: never delete a shipped property's photos ──────────────
  // A draft and the eventually-submitted property SHARE the same Storage
  // objects (ingest stores photos.file_url = toPublicPhotoUrl(path) without
  // re-keying). Deleting a still-referenced object would destroy a live
  // property's photo, so cleanup must skip any path whose URL is in photos.
  it('never removes a Storage object still referenced by a live property (photos.file_url)', async () => {
    const referencedUrl = 'https://cdn.example.com/x/live.jpg';
    const { supabase, removeSpy, deleteSpy } = makeSupabase({
      staleRows: [
        {
          id: 'd1',
          photo_paths: [
            { path: 'd1/raw/live.jpg', url: referencedUrl }, // shipped: a photos.file_url points here
            { path: 'd1/raw/orphan.jpg', url: 'https://cdn.example.com/x/orphan.jpg' }, // truly unreferenced
          ],
        },
      ],
      referencedUrls: [referencedUrl],
    });

    const result = await cleanupStaleDrafts(supabase, new Date());

    // Only the unreferenced orphan is removed; the shipped-property object is skipped.
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith(['d1/raw/orphan.jpg']);
    expect(result.skippedReferencedPhotos).toBe(1);
    expect(result.deletedPhotos).toBe(1);
    // The stale draft row is still deleted regardless.
    expect(deleteSpy).toHaveBeenCalledWith('d1');
    expect(result.deletedRows).toBe(1);
  });

  it('skips ALL storage deletes for a row when the photos reference check errors (fail-safe)', async () => {
    const { supabase, removeSpy, deleteSpy } = makeSupabase({
      staleRows: [{ id: 'd1', photo_paths: [{ path: 'd1/raw/a.jpg', url: 'https://cdn/a.jpg' }] }],
      photosErr: 'photos query down',
    });

    const result = await cleanupStaleDrafts(supabase, new Date());

    // When we can't confirm what's referenced, delete nothing from Storage.
    expect(removeSpy).not.toHaveBeenCalled();
    expect(result.skippedReferencedPhotos).toBe(1);
    expect(result.deletedPhotos).toBe(0);
    // The row is still swept (a stale pointer, not the shared object).
    expect(deleteSpy).toHaveBeenCalledWith('d1');
  });
});

describe('purgeDraftStorageForOwner', () => {
  it('removes only unreferenced objects, skipping any still referenced by photos.file_url', async () => {
    const referencedUrl = 'https://cdn.example.com/x/live.jpg';
    const { supabase, removeSpy } = makePurgeSupabase({
      draft: {
        photo_paths: [
          { path: 'u1/raw/live.jpg', url: referencedUrl },
          { path: 'u1/raw/orphan.jpg', url: 'https://cdn.example.com/x/orphan.jpg' },
        ],
      },
      referencedUrls: [referencedUrl],
    });

    const result = await purgeDraftStorageForOwner('d1', 'admin-1', supabase);

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith(['u1/raw/orphan.jpg']);
    expect(result.skippedReferencedPhotos).toBe(1);
    expect(result.deletedPhotos).toBe(1);
  });

  it('no-ops storage when the draft has no photos', async () => {
    const { supabase, removeSpy } = makePurgeSupabase({ draft: { photo_paths: [] } });

    const result = await purgeDraftStorageForOwner('d1', 'admin-1', supabase);

    expect(removeSpy).not.toHaveBeenCalled();
    expect(result.deletedPhotos).toBe(0);
  });

  it('no-ops when the draft is not found for this owner', async () => {
    const { supabase, removeSpy } = makePurgeSupabase({ draft: null });

    const result = await purgeDraftStorageForOwner('missing', 'admin-1', supabase);

    expect(removeSpy).not.toHaveBeenCalled();
    expect(result.deletedPhotos).toBe(0);
  });
});
