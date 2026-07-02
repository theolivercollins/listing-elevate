/**
 * Client helpers for the Studio New Order autosave/resume feature.
 *
 * Thin wrappers over `authedFetch`, mirroring src/lib/studio/library-api.ts.
 * The server enforces "one draft per admin" (migration 101, unique on
 * submitted_by) — getLatestDraft() always resolves that single row, or null.
 */

import { authedFetch } from '@/lib/api';

export interface DraftPhoto {
  /** Supabase Storage bucket-relative path. */
  path: string;
  /** Absolute public URL in the property-photos bucket. */
  url: string;
  /** Original filename. */
  name: string;
}

export interface Draft {
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
  photo_paths: DraftPhoto[];
  created_at: string;
  updated_at: string;
}

export type DraftInput = Partial<
  Omit<Draft, 'id' | 'submitted_by' | 'created_at' | 'updated_at'>
>;

const DRAFTS_URL = '/api/admin/studio/drafts';

/**
 * Fetch the calling admin's own in-progress draft, or null when there is
 * none — including on any non-2xx response. A resume-banner check that
 * fails to load degrades to "no draft"; it's never worth surfacing as an
 * error to the operator.
 */
export async function getLatestDraft(): Promise<Draft | null> {
  const res = await authedFetch(DRAFTS_URL);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return (data?.draft as Draft | null) ?? null;
}

/**
 * Upsert the calling admin's single draft row. Returns the saved row, or
 * null on failure — a debounced autosave caller doesn't need to react to a
 * dropped tick; the next tick (or the next photo finishing upload) retries.
 *
 * Accepts an optional AbortSignal so the caller can supersede an older in-flight
 * autosave with a newer one (prevents a slow older PUT from clobbering a newer
 * one — see StudioNew's autosave sequence guard).
 */
export async function saveDraft(payload: DraftInput, signal?: AbortSignal): Promise<Draft | null> {
  const init: RequestInit = {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
  if (signal) init.signal = signal;
  const res = await authedFetch(DRAFTS_URL, init);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return (data?.draft as Draft | null) ?? null;
}

/**
 * Delete a draft by id. Returns true on success (best-effort caller).
 *
 * With `{ purge: true }` the server also reclaims the draft's Storage objects
 * (service-role, skipping any object still referenced by a live property's
 * photos.file_url). Discard purges; submit deletes the row only (fast + safe —
 * a just-submitted property still points at those shared objects).
 */
export async function deleteDraft(id: string, opts?: { purge?: boolean }): Promise<boolean> {
  const qs = opts?.purge ? '?purge=1' : '';
  const res = await authedFetch(`${DRAFTS_URL}/${id}${qs}`, { method: 'DELETE' });
  return res.ok;
}

/**
 * True when a form snapshot has enough content to be worth persisting as a
 * draft, or worth showing a resume banner for: an address, at least one
 * user-entered field, or at least one uploaded photo. Guards against
 * autosaving (or offering to resume) a "draft" that's really just an
 * untouched form — selected_duration/video_type/auto_run/video_model_sku
 * always carry a default value even on a blank form, so they're
 * deliberately NOT part of this check.
 */
export function isDraftMeaningful(input: {
  address?: string | null;
  client_id?: string | null;
  bedrooms?: number | string | null;
  bathrooms?: number | string | null;
  square_footage?: number | string | null;
  price?: number | string | null;
  director_notes?: string | null;
  photo_paths?: DraftPhoto[] | null;
}): boolean {
  const hasValue = (v: number | string | null | undefined): boolean =>
    v !== null && v !== undefined && v !== '';

  return !!(
    input.address?.trim() ||
    input.client_id ||
    hasValue(input.bedrooms) ||
    hasValue(input.bathrooms) ||
    hasValue(input.square_footage) ||
    hasValue(input.price) ||
    input.director_notes?.trim() ||
    (input.photo_paths && input.photo_paths.length > 0)
  );
}
