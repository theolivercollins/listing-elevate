import { getSupabase } from '../client.js';
import { generatePreviewToken } from './preview-tokens.js';

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
      .select('name, brand_logo_url, agent_name')
      .eq('id', property.client_id)
      .maybeSingle();
    client = c;
  }
  return { property, client, expired };
}

export async function recordPreviewView(token: string) {
  // increment_preview_view RPC is defined in migration 056 and is atomic.
  await getSupabase().rpc('increment_preview_view', { p_token: token });
}

export async function insertClientNote(args: { property_id: string; source: 'client_preview'; body: string }) {
  const { error } = await getSupabase().from('property_revision_notes').insert(args);
  if (error) throw new Error(`insertClientNote: ${error.message}`);
}
