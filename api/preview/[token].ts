import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isWellFormedToken } from '../../lib/operator-studio/preview-tokens.js';
import { fetchByToken, recordPreviewView, insertClientNote } from '../../lib/operator-studio/preview.js';

/** Split an address string at the first comma.
 * - street: everything before the first comma (trimmed)
 * - locality: everything after the first comma (trimmed), with any trailing ", USA" removed
 * If there is no comma the street is the full address and locality is ''. */
function parseAddressParts(address: string): { street: string; locality: string } {
  const commaIdx = address.indexOf(',');
  if (commaIdx === -1) return { street: address, locality: '' };
  const street = address.slice(0, commaIdx).trim();
  // Strip trailing ", USA" (case-sensitive per spec; the US MLS format is exactly ", USA")
  const locality = address.slice(commaIdx + 1).trim().replace(/, USA$/, '');
  return { street, locality };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = String(req.query.token ?? '');
  if (!isWellFormedToken(token)) return res.status(404).json({ error: 'not_found' });

  if (req.method === 'GET') {
    const result = await fetchByToken(token);
    if (!result || result.expired) return res.status(404).json({ error: 'not_found' });
    void recordPreviewView(token);

    const { property, client, preview } = result;

    // Pre-migration fallback: when capability columns are absent, treat as client/all-on
    const kind = preview?.kind ?? 'client';
    const capabilities = {
      download: preview?.allow_download ?? true,
      approve: preview?.allow_approve ?? true,
      revision: preview?.allow_revision ?? true,
    };
    const approvedAt = preview?.approved_at ?? null;
    // show_branding: pre-087 the column is absent on the row → fall back to TRUE (preserves current behavior)
    const showBranding = (preview as { show_branding?: boolean } | null | undefined)?.show_branding ?? true;

    // Extended brand — headshot and brokerage are new in migration 083 client columns
    const brand = client
      ? {
          logo: (client as { brand_logo_url: string | null }).brand_logo_url ?? null,
          agent_name: (client as { agent_name: string | null }).agent_name ?? null,
          name: (client as { name: string }).name,
          headshot: (client as { agent_headshot_url?: string | null }).agent_headshot_url ?? null,
          brokerage: (client as { brokerage?: string | null }).brokerage ?? null,
        }
      : null;

    return res.status(200).json({
      address: property.address,
      address_parts: parseAddressParts(property.address),
      // Back-compat: single video_url — prefer horizontal for primary display
      video_url: (property as { horizontal_video_url: string | null }).horizontal_video_url
        ?? (property as { vertical_video_url: string | null }).vertical_video_url,
      // Both formats for multi-player rendering
      videos: {
        horizontal: (property as { horizontal_video_url: string | null }).horizontal_video_url ?? null,
        vertical: (property as { vertical_video_url: string | null }).vertical_video_url ?? null,
      },
      // hero_photo_url resolved from photos table — never a video file (bug fix: property.thumbnail_url was an .mp4)
      thumbnail_url: result.hero_photo_url ?? null,
      brand,
      kind,
      capabilities,
      approved_at: approvedAt,
      show_branding: showBranding,
    });
  }

  if (req.method === 'POST') {
    const body = String(req.body?.body ?? '').trim();
    if (!body) return res.status(400).json({ error: 'body required' });
    if (body.length > 2000) return res.status(400).json({ error: 'note too long' });
    const result = await fetchByToken(token);
    if (!result || result.expired) return res.status(404).json({ error: 'not_found' });
    // Capability check — pre-migration fallback: null preview → treat as all-on
    const allowRevision = result.preview?.allow_revision ?? true;
    if (!allowRevision) return res.status(403).json({ error: 'not_allowed' });
    await insertClientNote({ property_id: result.property.id, source: 'client_preview', body });
    return res.status(201).json({ ok: true });
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}
