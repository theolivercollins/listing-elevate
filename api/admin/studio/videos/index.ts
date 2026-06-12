import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth.js';
import { getSupabase } from '../../../../lib/client.js';
import { resolveHeroPhotoUrl } from '../../../../lib/operator-studio/preview.js';

const PAGE_SIZE = 24;

/** A property that has at least one delivered video render. */
interface PropertyRow {
  id: string;
  address: string | null;
  horizontal_video_url: string | null;
  vertical_video_url: string | null;
  // NOTE: approved_at does NOT exist on the properties table (it lives on
  // property_previews, added in migration 083). It is NOT selected here —
  // it is derived from the previews query below. Do not add it back here.
  created_at: string;
  // Embedded clients(id, name) via client_id FK. Supabase returns an object for a
  // to-one relationship, but can surface an array in some shapes — normalise both.
  client: { id: string; name: string } | { id: string; name: string }[] | null;
}

/**
 * GET /api/admin/studio/videos — the LE Video library (spec §1).
 * Lists every property with a delivered video (horizontal OR vertical URL non-null),
 * joined with client name + hero photo + per-property link/view aggregates.
 * Filters: ?client_id= ?q= (case-insensitive address search) ?page= (size 24).
 * Returns { items, total, page, pageSize }.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const db = getSupabase();

  const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : undefined;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let qb = db
    .from('properties')
    .select(
      'id, address, horizontal_video_url, vertical_video_url, created_at, client:client_id(id, name)',
      { count: 'exact' },
    )
    // At least one video render delivered.
    .or('horizontal_video_url.not.is.null,vertical_video_url.not.is.null')
    .order('created_at', { ascending: false })
    .range(from, to);

  if (clientId) qb = qb.eq('client_id', clientId);
  // Case-insensitive address search; escape % and _ so user input is literal.
  if (q) qb = qb.ilike('address', `%${q.replace(/[%_]/g, '\\$&')}%`);

  const { data, error, count } = await qb;
  if (error) return res.status(500).json({ error: error.message });

  const rows = (data ?? []) as PropertyRow[];

  // Per-property link count, total page-views, and approved state — fetched in one
  // query and bucketed. approved_at lives on property_previews (migration 083), NOT
  // on properties. A property is considered approved when ANY of its preview links
  // has a non-null approved_at; we surface the most recent such timestamp.
  // viewed_count exists pre-084 (migration 062); on any error we fall back to zeros
  // so the library still renders against a partially-migrated DB.
  const byProperty = new Map<string, { link_count: number; total_views: number; approved_at: string | null }>();
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const { data: pvData, error: pvError } = await db
      .from('property_previews')
      .select('property_id, viewed_count, approved_at')
      .in('property_id', ids);
    if (!pvError) {
      for (const pv of (pvData ?? []) as Array<{ property_id: string; viewed_count: number | null; approved_at: string | null }>) {
        const agg = byProperty.get(pv.property_id) ?? { link_count: 0, total_views: 0, approved_at: null };
        agg.link_count += 1;
        agg.total_views += pv.viewed_count ?? 0;
        // Keep the most recent non-null approved_at among all links for this property.
        if (pv.approved_at != null) {
          agg.approved_at =
            agg.approved_at == null || pv.approved_at > agg.approved_at
              ? pv.approved_at
              : agg.approved_at;
        }
        byProperty.set(pv.property_id, agg);
      }
    }
  }

  const items = await Promise.all(
    rows.map(async (r) => {
      const client = Array.isArray(r.client) ? r.client[0] ?? null : r.client;
      const agg = byProperty.get(r.id) ?? { link_count: 0, total_views: 0, approved_at: null };
      return {
        id: r.id,
        address: r.address,
        videos: { horizontal: r.horizontal_video_url, vertical: r.vertical_video_url },
        // Derived from property_previews, NOT the properties table (see PropertyRow note).
        approved_at: agg.approved_at,
        created_at: r.created_at,
        client: client ? { id: client.id, name: client.name } : null,
        hero_photo_url: await resolveHeroPhotoUrl(db, r.id),
        link_count: agg.link_count,
        total_views: agg.total_views,
      };
    }),
  );

  return res.status(200).json({ items, total: count ?? 0, page, pageSize: PAGE_SIZE });
}
