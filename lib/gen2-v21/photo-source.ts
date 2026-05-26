/**
 * lib/gen2-v21/photo-source.ts
 *
 * Dual-source photo resolver for V2.1 (gen2-v21).
 *
 * V2 operates on two kinds of listings:
 *   1. Real customer listings  → photos in `photos(property_id, file_url, id)`
 *   2. Prompt-lab listings     → photos in `prompt_lab_listing_photos(listing_id, id, image_url)`
 *
 * Strategy: try `photos.property_id = listingId` first. If that returns zero
 * rows, fall back to `prompt_lab_listing_photos.listing_id = listingId`.
 * Returns an empty array only when both sources are empty.
 *
 * This is the single place in the V2 codebase that knows about the dual-source
 * shape; all callers (extract-scene-graph, pair-queue, outcome-feedback worker)
 * delegate here.
 */

import { getSupabase } from "../db.js";

export interface V21PhotoRef {
  id: string;
  url: string;
}

export async function getPhotosForV21Listing(listingId: string): Promise<V21PhotoRef[]> {
  const supabase = getSupabase();

  // ── Primary: real property photos ─────────────────────────────────────────
  const { data: propertyPhotos, error: propErr } = await supabase
    .from("photos")
    .select("id, file_url")
    .eq("property_id", listingId)
    .order("created_at");

  if (propErr) {
    // Log but don't throw — fall through to lab source
    console.warn("[photo-source] photos query error, trying lab fallback:", propErr.message);
  }

  if (propertyPhotos && propertyPhotos.length > 0) {
    return propertyPhotos.map((p: { id: string; file_url: string }) => ({
      id: p.id,
      url: p.file_url,
    }));
  }

  // ── Fallback: prompt-lab listing photos ────────────────────────────────────
  const { data: labPhotos, error: labErr } = await supabase
    .from("prompt_lab_listing_photos")
    .select("id, image_url")
    .eq("listing_id", listingId)
    .order("photo_index");

  if (labErr) {
    console.warn("[photo-source] prompt_lab_listing_photos query error:", labErr.message);
    return [];
  }

  if (labPhotos && labPhotos.length > 0) {
    return labPhotos.map((p: { id: string; image_url: string }) => ({
      id: p.id,
      url: p.image_url,
    }));
  }

  return [];
}
