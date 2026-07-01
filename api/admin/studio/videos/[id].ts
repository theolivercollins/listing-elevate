import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth.js';
import { getSupabase } from '../../../../lib/client.js';
import {
  resolveHeroPhotoUrl,
  aggregateViewEvents,
  type ViewEventRow,
} from '../../../../lib/operator-studio/preview.js';

interface PropertyRow {
  id: string;
  address: string | null;
  horizontal_video_url: string | null;
  vertical_video_url: string | null;
  // Migration-102 columns (Bunny adaptive HLS, additive/nullable). Absent
  // (undefined) when the fallback select below fires pre-migration.
  horizontal_hls_url?: string | null;
  vertical_hls_url?: string | null;
  client: { id: string; name: string } | { id: string; name: string }[] | null;
}

/** A property_previews row as the hub needs it. label/revoked_at are migration-084
 *  columns and show_branding is a migration-087 column — absent (undefined) on a
 *  pre-migration DB → normalised to null/true below. */
interface PreviewRow {
  id: string;
  token: string;
  kind: string;
  allow_download: boolean;
  allow_approve: boolean;
  allow_revision: boolean;
  approved_at: string | null;
  label?: string | null;
  revoked_at?: string | null;
  show_branding?: boolean;
  viewed_count: number | null;
  last_viewed_at: string | null;
  created_at: string;
  expires_at: string | null;
}

/**
 * GET /api/admin/studio/videos/[id] — the video hub bundle (spec §2).
 * Returns: property (address + both video URLs), client, hero photo, ALL preview
 * links for the property (NOT newest-per-kind) each with per-link event aggregates,
 * revision notes (newest-first), and top-level totals across every link's events.
 *
 * Pre-migration tolerant: when preview_view_events is absent the events query errors;
 * we swallow it and every aggregate is zeroed (never a 500). label/revoked_at absent
 * on rows fall back to null.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const propertyId = String(req.query.id);
  const db = getSupabase();

  // horizontal_hls_url/vertical_hls_url are migration-102 columns (Bunny adaptive
  // HLS, additive/nullable). Try the full select first; on 42703 (undefined_column
  // — migration 102 not yet applied on this env's shared DB) retry with the
  // pre-102 column list so the hub never 500s mid-rollout. Mirrors the identical
  // 42703-retry pattern used below for property_previews label/revoked_at/show_branding.
  let propResult = await db
    .from('properties')
    .select('id, address, horizontal_video_url, vertical_video_url, horizontal_hls_url, vertical_hls_url, client:client_id(id, name)')
    .eq('id', propertyId)
    .maybeSingle();
  if (propResult.error && (propResult.error as { code?: string }).code === '42703') {
    propResult = await db
      .from('properties')
      .select('id, address, horizontal_video_url, vertical_video_url, client:client_id(id, name)')
      .eq('id', propertyId)
      .maybeSingle();
  }
  const { data: propData, error: propError } = propResult;
  if (propError) return res.status(500).json({ error: propError.message });
  if (!propData) return res.status(404).json({ error: 'not_found' });
  const property = propData as PropertyRow;

  // ALL links for this property, newest-first — the hub manages every link, not
  // just the newest of each kind (that's what the v2 preview-links endpoint does).
  // Pre-migration-084: label/revoked_at columns don't exist yet. PostgREST returns
  // error code 42703 (undefined_column) if we request them. On that error, retry
  // without the migration-084 columns so the hub still renders (label/revoked_at
  // fall back to undefined → null in the map below). Any other error is a real 500.
  let { data: pvData, error: pvError } = await db
    .from('property_previews')
    .select(
      'id, token, kind, allow_download, allow_approve, allow_revision, approved_at, label, revoked_at, show_branding, viewed_count, last_viewed_at, created_at, expires_at',
    )
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false });
  if (pvError) {
    if ((pvError as { code?: string }).code === '42703') {
      // Migration-084/087 columns absent — retry without new columns; label/revoked_at
      // fall back to null, show_branding falls back to true (default). Do NOT add
      // show_branding to the fallback select — it is the migration-087 column.
      const fallback = await db
        .from('property_previews')
        .select(
          'id, token, kind, allow_download, allow_approve, allow_revision, approved_at, viewed_count, last_viewed_at, created_at, expires_at',
        )
        .eq('property_id', propertyId)
        .order('created_at', { ascending: false });
      if (fallback.error) return res.status(500).json({ error: fallback.error.message });
      pvData = fallback.data;
    } else {
      return res.status(500).json({ error: pvError.message });
    }
  }
  const previews = (pvData ?? []) as PreviewRow[];

  // Per-link event rows, bucketed by preview_id. Pre-migration-084 the table is
  // absent → error set; swallow and leave every bucket empty (zeroed aggregates).
  const eventsByPreview = new Map<string, ViewEventRow[]>();
  const allEvents: ViewEventRow[] = [];
  if (previews.length > 0) {
    const ids = previews.map((p) => p.id);
    const { data: evData, error: evError } = await db
      .from('preview_view_events')
      .select('preview_id, session_id, event')
      .in('preview_id', ids);
    if (!evError) {
      for (const ev of (evData ?? []) as Array<ViewEventRow & { preview_id: string }>) {
        const row: ViewEventRow = { session_id: ev.session_id, event: ev.event };
        const bucket = eventsByPreview.get(ev.preview_id);
        if (bucket) bucket.push(row);
        else eventsByPreview.set(ev.preview_id, [row]);
        allEvents.push(row);
      }
    }
  }

  // Revision notes — approvals + revision requests, newest-first.
  const { data: noteData } = await db
    .from('property_revision_notes')
    .select('id, source, body, created_at')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false });
  const revision_notes = (noteData ?? []) as Array<{ id: string; source: string; body: string; created_at: string }>;

  const hero_photo_url = await resolveHeroPhotoUrl(db, property.id);

  const links = previews.map((p) => ({
    id: p.id,
    token: p.token,
    kind: p.kind,
    label: p.label ?? null,
    revoked_at: p.revoked_at ?? null,
    // show_branding is a migration-087 column; absent rows fall back to true (DB default).
    show_branding: p.show_branding ?? true,
    capabilities: {
      download: p.allow_download,
      approve: p.allow_approve,
      revision: p.allow_revision,
    },
    approved_at: p.approved_at,
    viewed_count: p.viewed_count ?? 0,
    last_viewed_at: p.last_viewed_at,
    created_at: p.created_at,
    expires_at: p.expires_at,
    analytics: aggregateViewEvents(eventsByPreview.get(p.id) ?? []),
  }));

  const client = Array.isArray(property.client) ? property.client[0] ?? null : property.client;

  return res.status(200).json({
    property: {
      id: property.id,
      address: property.address,
      videos: { horizontal: property.horizontal_video_url, vertical: property.vertical_video_url },
      // Bunny adaptive HLS playlists (migration 102) — LEPlayer prefers these
      // over the mp4 in `videos` when present; null on legacy/fallback renders
      // or pre-migration (fallback select above omits the columns → undefined ?? null).
      hls: { horizontal: property.horizontal_hls_url ?? null, vertical: property.vertical_hls_url ?? null },
    },
    client: client ? { id: client.id, name: client.name } : null,
    hero_photo_url,
    links,
    revision_notes,
    totals: aggregateViewEvents(allEvents),
  });
}
