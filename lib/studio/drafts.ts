// lib/studio/drafts.ts
//
// Server-side data layer for the Studio New Order autosave/resume feature
// (migration 099). One row per admin — unique on submitted_by — so every
// save is an upsert, never a plain insert; an admin can never accumulate
// more than one in-progress draft.

import { getSupabase } from '../client.js';

export type StudioDraftPhoto = {
  /** Supabase Storage bucket-relative path, e.g. "<draftId>/raw/172..._a1b2c3d4_photo.jpg" */
  path: string;
  /** Absolute public URL in the property-photos bucket. */
  url: string;
  /** Original filename, for display + re-derivation. */
  name: string;
};

export type StudioDraftRow = {
  id: string;
  submitted_by: string;
  client_id: string | null;
  address: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_footage: number | null;
  price: number | null;
  director_notes: string | null;
  selected_duration: number | null;
  video_type: string | null;
  video_model_sku: string | null;
  auto_run: boolean;
  photo_paths: StudioDraftPhoto[];
  created_at: string;
  updated_at: string;
};

/**
 * Fields the client may set on save. Everything is optional — the client
 * sends the current StudioNew form snapshot, which may be sparse right after
 * the draft is first minted (e.g. an address typed before any photo lands).
 */
export type StudioDraftInput = Partial<{
  client_id: string | null;
  address: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_footage: number | null;
  price: number | null;
  director_notes: string | null;
  selected_duration: number | null;
  video_type: string | null;
  video_model_sku: string | null;
  auto_run: boolean;
  photo_paths: StudioDraftPhoto[];
}>;

/**
 * Returns the newest draft for this admin (there is at most one — unique on
 * submitted_by, migration 099), or null when they have none.
 */
export async function getLatestDraft(submittedBy: string): Promise<StudioDraftRow | null> {
  const { data, error } = await getSupabase()
    .from('studio_drafts')
    .select('*')
    .eq('submitted_by', submittedBy)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLatestDraft: ${error.message}`);
  return (data as StudioDraftRow | null) ?? null;
}

/**
 * Every draft photo must live under the SAME `{uuid}/raw/{filename}` folder —
 * the Storage prefix StudioNew mints once per draft (property-photos/{draftId}/raw/…).
 * A path with exactly three segments, a 36-char uuid folder, a literal `raw`
 * segment, and a slash-free filename.
 */
const RAW_PATH_RE = /^([0-9a-f-]{36})\/raw\/[^/]+$/;

/**
 * Reject a write whose photo_paths don't all share one `{uuid}/raw/` folder.
 * Defense-in-depth: the cron + discard purge derive Storage-delete targets
 * from a draft's photo_paths, so a crafted draft that pointed those paths at
 * arbitrary bucket keys could aim a service-role delete at another property's
 * objects. Constraining every path to a single `{uuid}/raw/` prefix (with no
 * extra path segments) removes that lever. An empty array is always allowed
 * (a draft with no photos yet).
 */
function validatePhotoPaths(photoPaths: StudioDraftPhoto[]): void {
  let folder: string | null = null;
  for (const p of photoPaths) {
    const match = typeof p?.path === 'string' ? p.path.match(RAW_PATH_RE) : null;
    if (!match) {
      throw new Error(
        `upsertDraft: invalid photo path ${JSON.stringify(p?.path)} — must be "{uuid}/raw/{filename}"`,
      );
    }
    if (folder === null) {
      folder = match[1];
    } else if (folder !== match[1]) {
      throw new Error(
        `upsertDraft: photo paths span multiple folders ("${folder}" vs "${match[1]}") — all must share one {uuid}/raw/ prefix`,
      );
    }
  }
}

/**
 * Upsert the single draft row for this admin. Deliberately never includes
 * `id` in the payload — Postgres leaves the existing primary key untouched
 * on conflict, so the row's identity survives every autosave tick.
 */
export async function upsertDraft(
  submittedBy: string,
  input: StudioDraftInput,
): Promise<StudioDraftRow> {
  validatePhotoPaths(input.photo_paths ?? []);

  const payload = {
    submitted_by: submittedBy,
    client_id: input.client_id ?? null,
    address: input.address ?? null,
    bedrooms: input.bedrooms ?? null,
    bathrooms: input.bathrooms ?? null,
    square_footage: input.square_footage ?? null,
    price: input.price ?? null,
    director_notes: input.director_notes ?? null,
    selected_duration: input.selected_duration ?? null,
    video_type: input.video_type ?? null,
    video_model_sku: input.video_model_sku ?? null,
    auto_run: !!input.auto_run,
    photo_paths: input.photo_paths ?? [],
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await getSupabase()
    .from('studio_drafts')
    .upsert(payload, { onConflict: 'submitted_by' })
    .select('*')
    .single();
  if (error) throw new Error(`upsertDraft: ${error.message}`);
  return data as StudioDraftRow;
}

/**
 * Delete a draft by id, scoped to its owner. Silently no-ops (no thrown
 * error, no row affected) when the id doesn't exist or belongs to a
 * different admin — matches the "delete-my-own-thing" scoping style used
 * elsewhere in this codebase (e.g. archiveClient), which doesn't need a
 * 404/403 distinction for this kind of best-effort cleanup action.
 */
export async function deleteDraft(id: string, submittedBy: string): Promise<void> {
  const { error } = await getSupabase()
    .from('studio_drafts')
    .delete()
    .eq('id', id)
    .eq('submitted_by', submittedBy);
  if (error) throw new Error(`deleteDraft: ${error.message}`);
}
