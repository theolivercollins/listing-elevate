import { getSupabase } from '../client.js';
import { generatePreviewToken } from './preview-tokens.js';
import { toPublicPhotoUrl } from './ingest.js';

/** Preview-link metadata including the capability columns added in migration 083.
 * When those columns are absent (pre-migration DB), the field is null and callers
 * should fall back to client-kind / all-capabilities-on / no approved_at. */
export interface PreviewMeta {
  kind: string;
  allow_download: boolean;
  allow_approve: boolean;
  allow_revision: boolean;
  approved_at: string | null;
}

export async function createPreviewLink(
  propertyId: string,
  expiresAt: string | null = null,
  kind: 'client' | 'public' = 'client',
) {
  const token = generatePreviewToken();
  // Kind-based capability defaults (spec §1 / §5):
  //   client → all true  (full review experience)
  //   public → all false (view-only showcase)
  const isClient = kind === 'client';
  const { data, error } = await getSupabase()
    .from('property_previews')
    .insert({
      property_id: propertyId,
      token,
      expires_at: expiresAt,
      kind,
      allow_download: isClient,
      allow_approve: isClient,
      allow_revision: isClient,
    })
    .select('*')
    .single();
  if (error) throw new Error(`createPreviewLink: ${error.message}`);
  return data;
}

/** Attempts to select the migration-083 capability columns from property_previews.
 * Returns null (not throws) when the columns are absent so callers can fall back gracefully. */
async function fetchPreviewMeta(db: ReturnType<typeof getSupabase>, token: string): Promise<PreviewMeta | null> {
  try {
    const { data, error } = await db
      .from('property_previews')
      .select('kind, allow_download, allow_approve, allow_revision, approved_at')
      .eq('token', token)
      .maybeSingle();
    // If Postgres errors because the columns don't exist, error.code will be '42703'
    // (undefined_column). Any column-missing error → return null for fallback.
    if (error) return null;
    if (!data) return null;
    return {
      kind: (data as { kind?: string }).kind ?? 'client',
      allow_download: (data as { allow_download?: boolean }).allow_download ?? true,
      allow_approve: (data as { allow_approve?: boolean }).allow_approve ?? true,
      allow_revision: (data as { allow_revision?: boolean }).allow_revision ?? true,
      approved_at: (data as { approved_at?: string | null }).approved_at ?? null,
    };
  } catch {
    // Unexpected error (network, parse) — treat as pre-migration to avoid 500s
    return null;
  }
}

/**
 * Returns true if the URL is clearly a video file and must NOT be used as a
 * hero image. Guards both extension-based and bucket-based detection.
 */
export function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  // Reject known video extensions
  if (/\.(mp4|webm|mov)(\?|$)/.test(lower)) return true;
  // Reject anything from the property-videos storage bucket
  if (lower.includes('/property-videos/')) return true;
  return false;
}

/**
 * Resolve the best listing photo URL for a given property.
 * Preference order: selected=true first, then highest quality_score; limit 1.
 * file_url may be a storage path or an absolute URL — normalised via toPublicPhotoUrl.
 * Returns null on any failure or if no photo is found.
 *
 * NEVER returns a video URL (isVideoUrl guard applied after resolution).
 */
export async function resolveHeroPhotoUrl(
  db: ReturnType<typeof getSupabase>,
  propertyId: string,
): Promise<string | null> {
  try {
    // Query: prefer selected, then best quality_score, limit 1.
    // Two separate queries so we can fall back from selected→any without
    // complex Postgres ordering on a boolean column.
    const { data: selectedRows, error: selectedErr } = await db
      .from('photos')
      .select('file_url, quality_score')
      .eq('property_id', propertyId)
      .eq('selected', true)
      .order('quality_score', { ascending: false })
      .limit(1);

    if (!selectedErr && selectedRows && (selectedRows as Array<{ file_url: string | null }>).length > 0) {
      const row = (selectedRows as Array<{ file_url: string | null }>)[0];
      const url = row.file_url ? toPublicPhotoUrl(row.file_url) : null;
      if (url && !isVideoUrl(url)) return url;
    }

    // Fall back to any photo for this property ordered by quality_score
    const { data: anyRows, error: anyErr } = await db
      .from('photos')
      .select('file_url, quality_score')
      .eq('property_id', propertyId)
      .order('quality_score', { ascending: false })
      .limit(1);

    if (anyErr || !anyRows || (anyRows as Array<{ file_url: string | null }>).length === 0) return null;
    const row = (anyRows as Array<{ file_url: string | null }>)[0];
    const url = row.file_url ? toPublicPhotoUrl(row.file_url) : null;
    if (url && !isVideoUrl(url)) return url;
    return null;
  } catch {
    // Never let a photo-lookup failure break the preview API
    return null;
  }
}

export async function fetchByToken(token: string) {
  const db = getSupabase();
  const { data: pv } = await db.from('property_previews').select('*').eq('token', token).maybeSingle();
  if (!pv) return null;
  const expired = pv.expires_at ? new Date(pv.expires_at) < new Date() : false;
  const { data: property } = await db
    .from('properties')
    .select('id, address, horizontal_video_url, vertical_video_url, client_id, brokerage')
    .eq('id', pv.property_id)
    .maybeSingle();
  if (!property) return null;
  let client = null;
  if (property.client_id) {
    const { data: c } = await db
      .from('clients')
      .select('name, brand_logo_url, agent_name, agent_headshot_url, brokerage')
      .eq('id', property.client_id)
      .maybeSingle();
    client = c;
  }
  const preview = await fetchPreviewMeta(db, token);
  // Resolve hero image from photos table — never a video file.
  const hero_photo_url = await resolveHeroPhotoUrl(db, (property as { id: string }).id);
  return { property, client, expired, preview, hero_photo_url };
}

export async function recordPreviewView(token: string) {
  // increment_preview_view RPC is defined in migration 062 and is atomic.
  await getSupabase().rpc('increment_preview_view', { p_token: token });
}

export async function insertClientNote(args: { property_id: string; source: 'client_preview'; body: string }) {
  const { error } = await getSupabase().from('property_revision_notes').insert(args);
  if (error) throw new Error(`insertClientNote: ${error.message}`);
}

/** Insert a property_revision_notes row for any preview-originated source.
 * Accepts 'client_preview' (revision note) or 'client_approval' (approval stamp). */
export async function insertPreviewNote(args: {
  property_id: string;
  source: 'client_preview' | 'client_approval';
  body: string;
}) {
  const { error } = await getSupabase().from('property_revision_notes').insert(args);
  if (error) throw new Error(`insertPreviewNote: ${error.message}`);
}

/** Idempotently stamp approved_at on the property_previews row identified by token.
 * Returns { approved_at, already_approved }:
 *   - already_approved = true  → row was already stamped; approved_at is the original timestamp.
 *   - already_approved = false → we just stamped it; approved_at is the new timestamp.
 * Callers should only insert the client_approval revision note when already_approved is false. */
export async function stampApproval(token: string): Promise<{ approved_at: string; already_approved: boolean }> {
  const db = getSupabase();

  // Read current approved_at first (idempotency check).
  const { data: existing } = await db
    .from('property_previews')
    .select('approved_at')
    .eq('token', token)
    .maybeSingle();

  const existingTs = (existing as { approved_at?: string | null } | null)?.approved_at ?? null;
  if (existingTs) {
    return { approved_at: existingTs, already_approved: true };
  }

  // Not yet approved — stamp now.
  const now = new Date().toISOString();
  const { data: updated, error } = await db
    .from('property_previews')
    .update({ approved_at: now })
    .eq('token', token)
    .select('approved_at')
    .maybeSingle();

  if (error) throw new Error(`stampApproval: ${error.message}`);

  const stamped = (updated as { approved_at?: string | null } | null)?.approved_at ?? now;
  return { approved_at: stamped, already_approved: false };
}
