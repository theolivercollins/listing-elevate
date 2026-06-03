// lib/operator-studio/ingest.ts
//
// Manual ingest — creates a property with order_mode=operator, links photos,
// and optionally seeds a director-notes revision row.
//
// History:
// - 2026-05-20: fixed "[object Object]" by extracting messages from PostgrestError
//   instead of throwing the bare object. Also fills listing_agent + submitted_by
//   (both NOT NULL in prod) — pulled from the client record when one is picked,
//   or sensible defaults otherwise. Without these the insert was 500ing silently.

import { getSupabase } from '../client.js';
import type { ManualIngestInput } from '../types/operator-studio.js';

// Extract a useful string from PostgrestError-shaped objects (which are NOT
// JS Error instances, so `err.message` works but `instanceof Error` doesn't).
export function stringifyDbError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    const parts: string[] = [];
    if (e.message) parts.push(e.message);
    if (e.details) parts.push(e.details);
    if (e.hint) parts.push(`(hint: ${e.hint})`);
    if (e.code) parts.push(`[code ${e.code}]`);
    if (parts.length > 0) return parts.join(' — ');
  }
  return String(err);
}

export type ManualIngestWithActor = ManualIngestInput & {
  submitted_by: string;
};

export async function manualIngest(input: ManualIngestWithActor): Promise<string> {
  const {
    client_id,
    address,
    bedrooms,
    bathrooms,
    square_footage: _square_footage, // not a column on properties — accepted for future migration
    price,
    photo_storage_paths,
    director_notes,
    submitted_by,
    selected_package,
    selected_duration,
    selected_orientation,
    add_voiceover,
    add_voice_clone,
    add_custom_request,
    custom_request_text,
    days_on_market,
    sold_price,
    listing_agent: explicit_listing_agent,
    brokerage: explicit_brokerage,
  } = input as ManualIngestWithActor & {
    listing_agent?: string | null;
    brokerage?: string | null;
  };

  if (photo_storage_paths.length < 5) {
    throw new Error('At least 5 photos are required to ingest a property.');
  }
  if (!address || !address.trim()) {
    throw new Error('Address is required.');
  }
  if (!submitted_by) {
    throw new Error('submitted_by is required (admin session lost).');
  }

  const supabase = getSupabase();

  // Look up the client (when provided) to populate listing_agent + brokerage
  // from the brand kit, mirroring how the customer flow gets these from the
  // signed-in user's profile.
  let agentFromClient: string | null = null;
  let brokerageFromClient: string | null = null;
  if (client_id) {
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('agent_name, name')
      .eq('id', client_id)
      .maybeSingle();
    if (clientErr) throw new Error(`client lookup failed: ${stringifyDbError(clientErr)}`);
    agentFromClient = (client as { agent_name?: string | null } | null)?.agent_name ?? null;
    brokerageFromClient = (client as { name?: string | null } | null)?.name ?? null;
  }

  // Fallback chain for listing_agent (NOT NULL in prod):
  //   explicit form value → client.agent_name → operator email/handle → 'Operator'
  const listing_agent =
    explicit_listing_agent?.trim() ||
    agentFromClient ||
    'Operator';

  const brokerage = explicit_brokerage?.trim() || brokerageFromClient || null;

  // 1. Insert the property row.
  const { data: property, error: propError } = await supabase
    .from('properties')
    .insert({
      order_mode: 'operator',
      client_id: client_id ?? null,
      ingest_source: 'manual',
      address,
      bedrooms,
      bathrooms,
      price,
      photo_count: photo_storage_paths.length,
      status: 'queued',
      submitted_by,
      listing_agent,
      brokerage,
      selected_package: selected_package ?? 'just_listed',
      selected_duration: selected_duration ?? 30,
      selected_orientation: selected_orientation ?? 'horizontal',
      add_voiceover: !!add_voiceover,
      add_voice_clone: !!add_voice_clone,
      add_custom_request: !!add_custom_request,
      custom_request_text: custom_request_text ?? null,
      days_on_market: days_on_market ?? null,
      sold_price: sold_price ?? null,
    })
    .select()
    .single();

  if (propError) {
    throw new Error(`property insert failed: ${stringifyDbError(propError)}`);
  }
  const propertyId: string = (property as { id: string }).id;

  // 2. Insert photo rows into the shared `photos` table.
  //    file_url MUST be a fully-qualified URL — the Gemini/Claude analyzers
  //    fetch() it directly, and Node's URL parser rejects bare object paths
  //    with "Failed to parse URL". Mirror the customer flow in
  //    api/properties/index.ts which runs each path through getPublicUrl().
  const photoRows = photo_storage_paths.map((storagePath) => {
    const { data: urlData } = supabase.storage
      .from('property-photos')
      .getPublicUrl(storagePath);
    return {
      property_id: propertyId,
      file_url: urlData.publicUrl,
      file_name: storagePath.split('/').pop() ?? storagePath,
    };
  });

  const { error: photosError } = await supabase.from('photos').insert(photoRows);
  if (photosError) {
    throw new Error(`photos insert failed: ${stringifyDbError(photosError)}`);
  }

  // 3. Optionally insert a director-notes revision row.
  if (director_notes && director_notes.trim().length > 0) {
    const { error: notesError } = await supabase.from('property_revision_notes').insert({
      property_id: propertyId,
      source: 'operator',
      body: director_notes,
    });
    if (notesError) {
      throw new Error(`revision notes insert failed: ${stringifyDbError(notesError)}`);
    }
  }

  return propertyId;
}
