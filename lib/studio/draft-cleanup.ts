// lib/studio/draft-cleanup.ts
//
// Testable core for the daily studio-draft-cleanup cron
// (api/cron/studio-draft-cleanup.ts) AND the discard-purge path
// (api/admin/studio/drafts/[id].ts?purge=1). Deletes studio_drafts rows that
// haven't been touched in STALE_DAYS days, and best-effort deletes each row's
// uploaded photo objects from the property-photos Storage bucket.
//
// DATA-LOSS GUARD (critical): a draft and the eventually-submitted property
// SHARE the same Storage objects — on submit, ingest stores
// photos.file_url = toPublicPhotoUrl(path) WITHOUT copying/re-keying the blob.
// So a draft's photo_paths[].url and a live property's photos.file_url can point
// at the identical object. Before removing ANYTHING we therefore skip every path
// whose public URL is still referenced by a row in public.photos — otherwise a
// stale-draft sweep (or a discard) would delete a shipped property's photos.
//
// A per-row Storage failure never blocks that row's DB delete (an orphaned
// blob is a cheap, boring failure mode); a per-row DB-delete failure never
// stops the sweep of the remaining rows.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '../client.js';

const STALE_DAYS = 14;
const BUCKET = 'property-photos';

export interface CleanupResult {
  scanned: number;
  deletedRows: number;
  deletedPhotos: number;
  failedPhotoDeletes: number;
  /** Objects NOT deleted because they're still referenced by a live property
   *  (photos.file_url), or because the reference check itself failed (fail-safe). */
  skippedReferencedPhotos: number;
  rowErrors: Array<{ id: string; error: string }>;
}

interface DraftPhotoRef {
  path?: string;
  url?: string | null;
}

interface StaleDraftRow {
  id: string;
  photo_paths: DraftPhotoRef[] | null;
}

/**
 * Public URL for a bucket-relative Storage path. Mirrors
 * lib/operator-studio/ingest.ts:toPublicPhotoUrl exactly — the transform that
 * writes photos.file_url on submit — so the reference join below matches what
 * ingest actually stored. Kept inline (rather than imported) so the cleanup
 * cron stays self-contained and doesn't pull the ingest/atlas module graph
 * into its bundle.
 */
function toPublicUrl(path: string): string {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

/** Normalize a row's photo_paths into non-empty {path,url} candidates. */
function extractCandidates(photoPaths: DraftPhotoRef[] | null): Array<{ path: string; url: string | null }> {
  return (photoPaths ?? [])
    .map((p) => ({ path: p?.path, url: p?.url ?? null }))
    .filter((c): c is { path: string; url: string | null } => typeof c.path === 'string' && c.path.length > 0);
}

/**
 * Split candidate paths into those safe to delete (unreferenced) and a count of
 * those that MUST be kept because a live property's photos.file_url still points
 * at the same object. On ANY lookup error we fail safe: treat every candidate as
 * referenced (delete nothing) rather than risk destroying a shipped property's
 * photos.
 */
async function partitionByReference(
  supabase: SupabaseClient,
  candidates: Array<{ path: string; url: string | null }>,
): Promise<{ unreferenced: string[]; referencedCount: number }> {
  if (candidates.length === 0) return { unreferenced: [], referencedCount: 0 };

  // Match against BOTH the canonical recomputed URL and the URL stored on the
  // draft — either equalling a photos.file_url means the object is still in use.
  const urlSet = new Set<string>();
  for (const c of candidates) {
    urlSet.add(toPublicUrl(c.path));
    if (c.url) urlSet.add(c.url);
  }

  const { data, error } = await supabase
    .from('photos')
    .select('file_url')
    .in('file_url', [...urlSet]);

  if (error) {
    console.warn(
      '[studio-draft-cleanup] photos reference check failed; skipping storage delete for safety:',
      error.message,
    );
    return { unreferenced: [], referencedCount: candidates.length };
  }

  const referenced = new Set((data ?? []).map((r) => (r as { file_url: string }).file_url));
  const unreferenced = candidates
    .filter((c) => !referenced.has(toPublicUrl(c.path)) && !(c.url && referenced.has(c.url)))
    .map((c) => c.path);

  return { unreferenced, referencedCount: candidates.length - unreferenced.length };
}

/** Remove the unreferenced subset of a row's objects, updating result counters. */
async function removeUnreferenced(
  supabase: SupabaseClient,
  candidates: Array<{ path: string; url: string | null }>,
  result: Pick<CleanupResult, 'deletedPhotos' | 'failedPhotoDeletes' | 'skippedReferencedPhotos'>,
  ctx: string,
): Promise<void> {
  const { unreferenced, referencedCount } = await partitionByReference(supabase, candidates);
  result.skippedReferencedPhotos += referencedCount;
  if (unreferenced.length === 0) return;

  try {
    const { data: removed, error: removeErr } = await supabase.storage.from(BUCKET).remove(unreferenced);
    if (removeErr) {
      result.failedPhotoDeletes += unreferenced.length;
      console.warn(`[studio-draft-cleanup] storage remove failed for ${ctx}:`, removeErr.message);
    } else {
      result.deletedPhotos += removed?.length ?? unreferenced.length;
    }
  } catch (err) {
    result.failedPhotoDeletes += unreferenced.length;
    console.warn(
      `[studio-draft-cleanup] storage remove threw for ${ctx}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Deletes every studio_drafts row whose updated_at is older than STALE_DAYS,
 * best-effort-cleaning each row's UNreferenced Storage objects first (referenced
 * ones — shared with a shipped property — are left untouched).
 *
 * @param supabase  injectable for tests; defaults to the shared service-role client
 * @param now       injectable clock for tests; defaults to `new Date()`
 */
export async function cleanupStaleDrafts(
  supabase: SupabaseClient = getSupabase(),
  now: Date = new Date(),
): Promise<CleanupResult> {
  const cutoff = new Date(now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('studio_drafts')
    .select('id, photo_paths')
    .lt('updated_at', cutoff);

  if (error) throw new Error(`cleanupStaleDrafts: list failed: ${error.message}`);

  const rows = (data ?? []) as StaleDraftRow[];
  const result: CleanupResult = {
    scanned: rows.length,
    deletedRows: 0,
    deletedPhotos: 0,
    failedPhotoDeletes: 0,
    skippedReferencedPhotos: 0,
    rowErrors: [],
  };

  for (const row of rows) {
    const candidates = extractCandidates(row.photo_paths);
    if (candidates.length > 0) {
      await removeUnreferenced(supabase, candidates, result, `draft ${row.id}`);
    }

    const { error: delErr } = await supabase.from('studio_drafts').delete().eq('id', row.id);
    if (delErr) {
      result.rowErrors.push({ id: row.id, error: delErr.message });
      console.error(`[studio-draft-cleanup] row delete failed for draft ${row.id}:`, delErr.message);
      continue;
    }
    result.deletedRows += 1;
  }

  return result;
}

/**
 * Purge a single draft's UNreferenced Storage objects, scoped to its owner.
 * Used by the DELETE …/drafts/[id]?purge=1 (explicit Discard) path. Applies the
 * SAME "skip any path still referenced by photos.file_url" guard as the cron
 * (defense-in-depth). Service-role only. Never throws for a per-object failure;
 * only a failure to load the draft row propagates.
 *
 * Does NOT delete the draft row itself — the caller deletes the row separately
 * (submit deletes the row WITHOUT purging storage; discard purges then deletes).
 */
export async function purgeDraftStorageForOwner(
  id: string,
  submittedBy: string,
  supabase: SupabaseClient = getSupabase(),
): Promise<Pick<CleanupResult, 'deletedPhotos' | 'failedPhotoDeletes' | 'skippedReferencedPhotos'>> {
  const { data, error } = await supabase
    .from('studio_drafts')
    .select('photo_paths')
    .eq('id', id)
    .eq('submitted_by', submittedBy)
    .maybeSingle();

  if (error) throw new Error(`purgeDraftStorageForOwner: ${error.message}`);

  const candidates = extractCandidates(
    (data as { photo_paths?: DraftPhotoRef[] } | null)?.photo_paths ?? null,
  );
  const result = { deletedPhotos: 0, failedPhotoDeletes: 0, skippedReferencedPhotos: 0 };
  if (candidates.length > 0) {
    await removeUnreferenced(supabase, candidates, result, `discard ${id}`);
  }
  return result;
}
