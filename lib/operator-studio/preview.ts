import { getSupabase } from '../client.js';
import { generatePreviewToken } from './preview-tokens.js';

/** Preview-link metadata including the capability columns added in migration 082.
 * When those columns are absent (pre-migration DB), the field is null and callers
 * should fall back to client-kind / all-capabilities-on / no approved_at. */
export interface PreviewMeta {
  kind: string;
  allow_download: boolean;
  allow_approve: boolean;
  allow_revision: boolean;
  approved_at: string | null;
}

export async function createPreviewLink(propertyId: string, expiresAt: string | null = null) {
  const token = generatePreviewToken();
  const { data, error } = await getSupabase()
    .from('property_previews')
    .insert({ property_id: propertyId, token, expires_at: expiresAt })
    .select('*')
    .single();
  if (error) throw new Error(`createPreviewLink: ${error.message}`);
  return data;
}

/** Attempts to select the migration-082 capability columns from property_previews.
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

export async function fetchByToken(token: string) {
  const db = getSupabase();
  const { data: pv } = await db.from('property_previews').select('*').eq('token', token).maybeSingle();
  if (!pv) return null;
  const expired = pv.expires_at ? new Date(pv.expires_at) < new Date() : false;
  const { data: property } = await db
    .from('properties')
    .select('id, address, horizontal_video_url, vertical_video_url, client_id, brokerage, thumbnail_url')
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
  return { property, client, expired, preview };
}

export async function recordPreviewView(token: string) {
  // increment_preview_view RPC is defined in migration 056 and is atomic.
  await getSupabase().rpc('increment_preview_view', { p_token: token });
}

export async function insertClientNote(args: { property_id: string; source: 'client_preview'; body: string }) {
  const { error } = await getSupabase().from('property_revision_notes').insert(args);
  if (error) throw new Error(`insertClientNote: ${error.message}`);
}
