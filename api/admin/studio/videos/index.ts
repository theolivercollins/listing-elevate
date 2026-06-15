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
 * plus uploaded hosted video creatives in the default All videos view. Property rows are
 * joined with client name + hero photo + per-property link/view aggregates.
 * Filters: ?client_id= ?q= (case-insensitive address search) ?page= (size 24)
 *   ?folder=<id> (only that folder) ?folder=none (only unfiled)
 *   ?archived=1 (only archived; default = only not-archived).
 * The library_management sidecar (video_library_meta, migration 085) supplies
 * folder/archive/soft-delete state; deleted rows are ALWAYS excluded. Pre-migration
 * (meta table absent, 42P01) the whole library renders as unfiled / not-archived.
 * Returns { items, total, page, pageSize }.
 */
interface MetaRow {
  folder_id: string | null;
  archived_at: string | null;
  library_deleted_at: string | null;
}

interface HostedCreativeRow {
  id: string;
  title: string;
  description: string | null;
  public_url: string | null;
  thumbnail_url: string | null;
  created_at: string;
  share_token: string;
  view_count: number | null;
}

interface LibraryItem {
  id: string;
  address: string | null;
  title?: string;
  description?: string | null;
  videos: { horizontal: string | null; vertical: string | null };
  approved_at: string | null;
  created_at: string;
  client: { id: string; name: string } | null;
  hero_photo_url: string | null;
  link_count: number;
  total_views: number;
  folder_id: string | null;
  archived_at: string | null;
  library_source: 'property' | 'upload';
  share_token?: string;
  shareUrl?: string;
  embedUrl?: string;
  manageUrl?: string;
}

function publicBase(): string {
  return (process.env.PUBLIC_SITE_URL ?? process.env.VITE_PUBLIC_SITE_URL ?? 'https://listingelevate.com')
    .replace(/\/$/, '');
}

function isMissingOptionalCreativeSurface(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === '42703';
}
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const db = getSupabase();

  const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : undefined;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const folder = typeof req.query.folder === 'string' ? req.query.folder : undefined;
  const archivedOnly = req.query.archived === '1';
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // Overfetch properties through the requested page, then merge uploaded hosted
  // creatives and slice the combined feed so both sources share one sort order.
  let qb = db
    .from('properties')
    .select(
      'id, address, horizontal_video_url, vertical_video_url, created_at, client:client_id(id, name)',
      { count: 'exact' },
    )
    // At least one video render delivered.
    .or('horizontal_video_url.not.is.null,vertical_video_url.not.is.null')
    .order('created_at', { ascending: false })
    .range(0, to);

  if (clientId) qb = qb.eq('client_id', clientId);
  // Case-insensitive address search; escape % and _ so user input is literal.
  if (q) qb = qb.ilike('address', `%${q.replace(/[%_]/g, '\\$&')}%`);

  const { data, error, count } = await qb;
  if (error) return res.status(500).json({ error: error.message });

  const allRows = (data ?? []) as PropertyRow[];

  let hostedRows: HostedCreativeRow[] = [];
  let hostedTotal = 0;
  const includeHostedUploads = !clientId && !folder && !archivedOnly;
  if (includeHostedUploads) {
    let hostedQb = db
      .from('creatives')
      .select('id, title, description, public_url, thumbnail_url, created_at, share_token, view_count', { count: 'exact' })
      .eq('kind', 'video')
      .eq('source', 'upload')
      .order('created_at', { ascending: false })
      .range(0, to);

    if (q) hostedQb = hostedQb.ilike('title', `%${q.replace(/[%_]/g, '\\$&')}%`);

    const { data: creativeData, error: creativeError, count: creativeCount } = await hostedQb;
    if (creativeError && !isMissingOptionalCreativeSurface(creativeError)) {
      return res.status(500).json({ error: creativeError.message });
    }
    if (!creativeError) {
      hostedRows = (creativeData ?? []) as HostedCreativeRow[];
      hostedTotal = creativeCount ?? hostedRows.length;
    }
  }

  // Library-management sidecar: folder / archive / soft-delete state lives in
  // video_library_meta (migration 085), a separate table — NOT embeddable in the
  // properties select (it has no FK child relationship to the properties row).
  // Fetch the page's meta rows in one query and bucket by property_id, mirroring
  // the property_previews aggregate below. Pre-migration the table is absent
  // (42P01); we leave the map empty so every property reads as unfiled /
  // not-archived / not-deleted and the library still fully renders.
  const metaByProperty = new Map<string, MetaRow>();
  if (allRows.length > 0) {
    const ids = allRows.map((r) => r.id);
    const { data: metaData, error: metaError } = await db
      .from('video_library_meta')
      .select('property_id, folder_id, archived_at, library_deleted_at')
      .in('property_id', ids);
    if (metaError && metaError.code !== '42P01') {
      return res.status(500).json({ error: metaError.message });
    }
    if (!metaError) {
      for (const m of (metaData ?? []) as Array<{ property_id: string } & MetaRow>) {
        metaByProperty.set(m.property_id, {
          folder_id: m.folder_id,
          archived_at: m.archived_at,
          library_deleted_at: m.library_deleted_at,
        });
      }
    }
  }

  // Apply meta-derived exclusions in JS (the spec accepts post-fetch filtering for
  // this sub-project): always drop soft-deleted; honour the archived + folder params.
  const rows = allRows.filter((r) => {
    const meta = metaByProperty.get(r.id);
    if (meta?.library_deleted_at != null) return false;
    const isArchived = meta?.archived_at != null;
    if (archivedOnly ? !isArchived : isArchived) return false;
    if (folder === 'none') {
      if (meta != null && meta.folder_id != null) return false;
    } else if (folder) {
      if (meta?.folder_id !== folder) return false;
    }
    return true;
  });

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

  const propertyItems = await Promise.all<LibraryItem>(
    rows.map(async (r): Promise<LibraryItem> => {
      const client = Array.isArray(r.client) ? r.client[0] ?? null : r.client;
      const agg = byProperty.get(r.id) ?? { link_count: 0, total_views: 0, approved_at: null };
      const meta = metaByProperty.get(r.id);
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
        // Library-management state from the video_library_meta sidecar (null pre-migration).
        folder_id: meta?.folder_id ?? null,
        archived_at: meta?.archived_at ?? null,
        library_source: 'property',
      };
    }),
  );

  const base = publicBase();
  const hostedItems: LibraryItem[] = hostedRows.map((row) => ({
    id: row.id,
    address: row.title,
    title: row.title,
    description: row.description,
    videos: { horizontal: row.public_url, vertical: null },
    approved_at: null,
    created_at: row.created_at,
    client: null,
    hero_photo_url: row.thumbnail_url,
    link_count: 1,
    total_views: row.view_count ?? 0,
    folder_id: null,
    archived_at: null,
    library_source: 'upload',
    share_token: row.share_token,
    shareUrl: `${base}/v/${row.share_token}`,
    embedUrl: `${base}/embed/${row.share_token}`,
    manageUrl: `/dashboard/studio/video/share?creative=${row.id}`,
  }));

  const items = [...propertyItems, ...hostedItems]
    .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0))
    .slice(from, from + PAGE_SIZE);

  // total starts from the DB exact count over properties, less the rows excluded by
  // the JS-side meta filters on THIS page. The cross-page residue (meta exclusions on
  // pages other than the current one) is a known limitation the spec accepts for this
  // sub-project rather than a DB-level filtered count. Floors at the page's item count.
  const excludedOnPage = allRows.length - propertyItems.length;
  const propertyTotal = Math.max(propertyItems.length, (count ?? propertyItems.length) - excludedOnPage);
  const total = Math.max(items.length, propertyTotal + hostedTotal);
  return res.status(200).json({ items, total, page, pageSize: PAGE_SIZE });
}
