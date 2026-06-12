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
  /** Migration-084 columns. null when absent (pre-migration DB). */
  label: string | null;
  revoked_at: string | null;
}

export async function createPreviewLink(
  propertyId: string,
  expiresAt: string | null = null,
  kind: 'client' | 'public' = 'client',
  label: string | null = null,
) {
  const token = generatePreviewToken();
  // Kind-based capability defaults (spec §1 / §5):
  //   client → all true  (full review experience)
  //   public → all false (view-only showcase)
  const isClient = kind === 'client';
  // Only include `label` in the insert payload when provided, so the call still
  // succeeds against a pre-migration DB where the column does not exist yet.
  const payload: Record<string, unknown> = {
    property_id: propertyId,
    token,
    expires_at: expiresAt,
    kind,
    allow_download: isClient,
    allow_approve: isClient,
    allow_revision: isClient,
  };
  if (label != null) payload.label = label;
  const { data, error } = await getSupabase()
    .from('property_previews')
    .insert(payload)
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
      .select('kind, allow_download, allow_approve, allow_revision, approved_at, label, revoked_at')
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
      // Migration-084 columns — null when absent (pre-migration DB).
      label: (data as { label?: string | null }).label ?? null,
      revoked_at: (data as { revoked_at?: string | null }).revoked_at ?? null,
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
  const baseExpired = pv.expires_at ? new Date(pv.expires_at) < new Date() : false;
  // A revoked link renders as the existing expired state on the watch page.
  // `revoked_at` only exists post-migration-084; guard for its absence (pre-migration
  // rows have no such property → undefined → treated as not revoked).
  const revokedAt = (pv as { revoked_at?: string | null }).revoked_at ?? null;
  const expired = baseExpired || revokedAt != null;
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

/** The watch-page beacon events, in milestone order. `view` = page load,
 * `play` = first play of the session, progress_* = scrub milestones, `complete` = ended. */
export type ViewEventType = 'view' | 'play' | 'progress_25' | 'progress_50' | 'progress_75' | 'complete';

export interface ViewEventInput {
  preview_id: string;
  session_id: string;
  event: ViewEventType;
  position_seconds?: number | null;
  orientation?: 'horizontal' | 'vertical' | null;
  referrer?: string | null;
  user_agent?: string | null;
}

const VIEW_EVENT_STRING_CLAMP = 512;

/** Append a row to preview_view_events for analytics. Fire-and-forget:
 * SWALLOWS every error (including the table not existing pre-migration-084) and
 * returns void — it must NEVER throw, so the beacon endpoint can always 204 and
 * the watch page is never affected. Mirrors the fetchPreviewMeta null-on-error guard. */
export async function insertViewEvent(args: ViewEventInput): Promise<void> {
  try {
    const clamp = (s: string | null | undefined): string | null =>
      s == null ? null : s.slice(0, VIEW_EVENT_STRING_CLAMP);
    const { error } = await getSupabase()
      .from('preview_view_events')
      .insert({
        preview_id: args.preview_id,
        session_id: args.session_id,
        event: args.event,
        position_seconds: args.position_seconds ?? null,
        orientation: args.orientation ?? null,
        referrer: clamp(args.referrer),
        user_agent: clamp(args.user_agent),
      });
    // Pre-migration the table is absent → error is set; swallow it silently.
    if (error) return;
  } catch {
    // Network/parse/unknown — never propagate to the beacon endpoint.
    return;
  }
}

/** A single view-event row as needed for aggregation (session + event only). */
export interface ViewEventRow {
  session_id: string;
  event: ViewEventType;
}

export interface ViewEventAggregate {
  /** Distinct sessions that fired at least one `play`. */
  total_plays: number;
  /** Distinct session_id across all events (anyone who loaded the page). */
  unique_viewers: number;
  /** Average of each engaged session's furthest completion milestone, rounded to an int. */
  avg_completion_pct: number;
}

/** Map a milestone event to its completion percentage. `play`/`view` = 0; progress_* /
 * complete carry the percentage. Used to find each session's furthest point. */
const EVENT_COMPLETION_PCT: Record<ViewEventType, number> = {
  view: 0,
  play: 0,
  progress_25: 25,
  progress_50: 50,
  progress_75: 75,
  complete: 100,
};

/** Events that signal a session actually engaged with playback (so it counts toward the
 * completion average). A pure `view` (page load with no play) is excluded. */
const ENGAGEMENT_EVENTS = new Set<ViewEventType>([
  'play', 'progress_25', 'progress_50', 'progress_75', 'complete',
]);

/**
 * Pure aggregation over preview_view_events rows — no DB, fully unit-testable.
 *
 *  - total_plays    = count of distinct sessions that have a `play` event.
 *  - unique_viewers = count of distinct session_id across all events.
 *  - avg_completion_pct = average, over sessions with any engagement event, of that
 *    session's MAX milestone percentage (e.g. a session that reached progress_75 = 75).
 *    Rounded to the nearest integer; 0 when there are no engaged sessions.
 */
export function aggregateViewEvents(events: ReadonlyArray<ViewEventRow>): ViewEventAggregate {
  const allSessions = new Set<string>();
  const playSessions = new Set<string>();
  // session_id → furthest completion % among that session's engagement events.
  const maxPctBySession = new Map<string, number>();

  for (const e of events) {
    allSessions.add(e.session_id);
    if (e.event === 'play') playSessions.add(e.session_id);
    if (ENGAGEMENT_EVENTS.has(e.event)) {
      const pct = EVENT_COMPLETION_PCT[e.event];
      const prev = maxPctBySession.get(e.session_id) ?? 0;
      if (pct > prev || !maxPctBySession.has(e.session_id)) {
        maxPctBySession.set(e.session_id, Math.max(pct, prev));
      }
    }
  }

  let avg_completion_pct = 0;
  if (maxPctBySession.size > 0) {
    let sum = 0;
    for (const pct of maxPctBySession.values()) sum += pct;
    avg_completion_pct = Math.round(sum / maxPctBySession.size);
  }

  return {
    total_plays: playSessions.size,
    unique_viewers: allSessions.size,
    avg_completion_pct,
  };
}

/** Fetch the UUID primary key of a property_previews row by token.
 * Returns null (not throws) on any error or when the row is absent —
 * callers can skip the insert and still return 204 on the events endpoint. */
export async function lookupPreviewId(token: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabase()
      .from('property_previews')
      .select('id')
      .eq('token', token)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { id: string }).id ?? null;
  } catch {
    return null;
  }
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
