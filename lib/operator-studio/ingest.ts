// lib/operator-studio/ingest.ts
//
// Manual ingest — creates a property with order_mode=operator, links photos,
// and optionally seeds a director-notes revision row.
//
// ADAPTATION NOTE: The spec references a `property_photos` table with
// `storage_path` + `sequence` columns, but the actual schema uses the shared
// `photos` table with `file_url` + `file_name` columns. This implementation
// maps `photo_storage_paths` → `photos.file_url` (and derives `file_name`
// from the last path segment). `sequence` is not a column on `photos`;
// insertion order is preserved naturally.
//
// Pipeline trigger is intentionally absent — the React page (StudioNew.tsx)
// POSTs /api/pipeline/:id client-side, matching src/lib/api.ts:206.

import { getSupabase } from '../client';
import type { ManualIngestInput } from '../types/operator-studio';

export async function manualIngest(input: ManualIngestInput): Promise<string> {
  const {
    client_id,
    address,
    bedrooms,
    bathrooms,
    square_footage: _square_footage, // properties has no square_footage column; dropped silently
    price,
    photo_storage_paths,
    director_notes,
    selected_package,
    selected_duration,
    selected_orientation,
    add_voiceover,
    add_voice_clone,
    add_custom_request,
    custom_request_text,
    days_on_market,
    sold_price,
    mls_source,
  } = input;

  if (photo_storage_paths.length < 5) {
    throw new Error('At least 5 photos are required to ingest a property.');
  }
  if (!address || !address.trim()) {
    throw new Error('Address is required.');
  }

  const supabase = getSupabase();

  // 1. Insert the property row.
  const { data: property, error: propError } = await supabase
    .from('properties')
    .insert({
      order_mode: 'operator',
      client_id: client_id ?? null,
      ingest_source: mls_source ? 'mls' : 'manual',
      address,
      bedrooms,
      bathrooms,
      price,
      photo_count: photo_storage_paths.length,
      status: 'queued',
      selected_package: selected_package ?? null,
      selected_duration: selected_duration ?? null,
      selected_orientation: selected_orientation ?? null,
      add_voiceover: !!add_voiceover,
      add_voice_clone: !!add_voice_clone,
      add_custom_request: !!add_custom_request,
      custom_request_text: custom_request_text ?? null,
      days_on_market: days_on_market ?? null,
      sold_price: sold_price ?? null,
    })
    .select()
    .single();

  if (propError) throw propError;
  const propertyId: string = (property as { id: string }).id;

  // 2. Insert photo rows into the shared `photos` table.
  //    Adapted columns: file_url (= storage path), file_name (= last segment).
  const photoRows = photo_storage_paths.map((storagePath) => ({
    property_id: propertyId,
    file_url: storagePath,
    file_name: storagePath.split('/').pop() ?? storagePath,
  }));

  const { error: photosError } = await supabase.from('photos').insert(photoRows);
  if (photosError) throw photosError;

  // 3. Optionally insert a director-notes revision row.
  if (director_notes && director_notes.trim().length > 0) {
    const { error: notesError } = await supabase.from('property_revision_notes').insert({
      property_id: propertyId,
      source: 'operator',
      body: director_notes,
    });
    if (notesError) throw notesError;
  }

  return propertyId;
}
