import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Download, MessageSquare, Monitor, Smartphone } from 'lucide-react';
import { StudioNav } from '@/components/studio/StudioNav';
import { StudioShell } from '@/components/studio/StudioShell';
import LEPlayer from '@/components/preview/LEPlayer';
import SharePanel, {
  type PreviewLinkRow,
  type CapabilityField,
} from '@/components/studio/share/SharePanel';
import { getRelativeTime } from '@/lib/types';
import { authedFetch } from '@/lib/api';

// ─── Types (mirror GET /api/admin/studio/videos/[id]) ────────────────────────

type Orientation = 'horizontal' | 'vertical';

interface LinkAnalytics {
  total_plays: number;
  unique_viewers: number;
  avg_completion_pct: number;
}

interface HubLink {
  id: string;
  token: string;
  kind: 'client' | 'public';
  label: string | null;
  revoked_at: string | null;
  capabilities: { download: boolean; approve: boolean; revision: boolean };
  approved_at: string | null;
  viewed_count: number;
  last_viewed_at: string | null;
  created_at: string;
  expires_at: string | null;
  analytics: LinkAnalytics;
}

interface RevisionNote {
  id: string;
  source: string;
  body: string;
  created_at: string;
}

interface HubBundle {
  property: { id: string; address: string | null; videos: { horizontal: string | null; vertical: string | null } };
  client: { id: string; name: string } | null;
  hero_photo_url: string | null;
  links: HubLink[];
  revision_notes: RevisionNote[];
  totals: LinkAnalytics;
}

// ─── Mapping helpers ─────────────────────────────────────────────────────────

/** Flatten an API hub link into the SharePanel row shape (flat allow_* booleans). */
function toPanelRow(link: HubLink): PreviewLinkRow {
  return {
    id: link.id,
    token: link.token,
    kind: link.kind,
    label: link.label,
    allow_download: link.capabilities.download,
    allow_approve: link.capabilities.approve,
    allow_revision: link.capabilities.revision,
    approved_at: link.approved_at,
    revoked_at: link.revoked_at,
    expires_at: link.expires_at,
    viewed_count: link.viewed_count,
    last_viewed_at: link.last_viewed_at,
    created_at: link.created_at,
  };
}

/** Friendly label for a revision-note source value. */
const NOTE_SOURCE_LABEL: Record<string, string> = {
  client_approval: 'Approved',
  client_preview: 'Revision requested',
  client_revision: 'Revision requested',
  operator: 'Internal note',
};
function noteSourceLabel(source: string): string {
  return NOTE_SOURCE_LABEL[source] ?? 'Note';
}

function splitAddress(address: string | null): { street: string; locality: string } {
  if (!address) return { street: 'Untitled property', locality: '' };
  const idx = address.indexOf(',');
  if (idx === -1) return { street: address.trim(), locality: '' };
  return { street: address.slice(0, idx).trim(), locality: address.slice(idx + 1).trim() };
}

// ─── Analytics card ──────────────────────────────────────────────────────────

function StatCard({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId: string }) {
  return (
    <div className="studio-kpi-card">
      <div className="studio-kpi-head">
        <span className="studio-kpi-label">{label}</span>
      </div>
      <div className="studio-kpi-value" data-testid={testId}>
        {value}
      </div>
      {sub && <div className="studio-kpi-sub">{sub}</div>}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

const VideoHub = () => {
  const { propertyId } = useParams<{ propertyId: string }>();
  const [bundle, setBundle] = useState<HubBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<Orientation>('horizontal');

  const baseUrl = window.location.origin;

  const fetchBundle = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const res = await authedFetch(`/api/admin/studio/videos/${propertyId}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data: HubBundle = await res.json();
      setBundle(data);
      setError(null);
      // Default the player to whichever render exists (prefer horizontal).
      setOrientation(data.property.videos.horizontal ? 'horizontal' : 'vertical');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load video');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void fetchBundle();
  }, [fetchBundle]);

  // ── Share wiring — reuse the existing preview-link endpoints. ──────────────
  const onCreateLink = useCallback(
    async (kind: 'client' | 'public', label?: string) => {
      await authedFetch(`/api/admin/studio/properties/${propertyId}/preview-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, ...(label ? { label } : {}) }),
      });
      await fetchBundle();
    },
    [propertyId, fetchBundle],
  );

  const onToggle = useCallback(
    async (id: string, field: CapabilityField, value: boolean) => {
      await authedFetch(`/api/admin/studio/properties/${propertyId}/preview-links/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      await fetchBundle();
    },
    [propertyId, fetchBundle],
  );

  const onSetLabel = useCallback(
    async (id: string, label: string) => {
      await authedFetch(`/api/admin/studio/properties/${propertyId}/preview-links/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      await fetchBundle();
    },
    [propertyId, fetchBundle],
  );

  const onRevoke = useCallback(
    async (id: string, revoked: boolean) => {
      await authedFetch(`/api/admin/studio/properties/${propertyId}/preview-links/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revoked }),
      });
      await fetchBundle();
    },
    [propertyId, fetchBundle],
  );

  // ── Derived state ──────────────────────────────────────────────────────────
  const videos = bundle?.property.videos ?? { horizontal: null, vertical: null };
  const hasBoth = !!videos.horizontal && !!videos.vertical;
  const activeSrc = orientation === 'vertical' ? videos.vertical : videos.horizontal;

  const clientLinks = useMemo(
    () => (bundle?.links ?? []).filter((l) => l.kind === 'client').map(toPanelRow),
    [bundle],
  );
  const publicLinks = useMemo(
    () => (bundle?.links ?? []).filter((l) => l.kind === 'public').map(toPanelRow),
    [bundle],
  );

  // Token used for the per-orientation downloads: prefer a live client link
  // (full capabilities incl. download), else any live link, else the first.
  const downloadToken = useMemo(() => {
    const links = bundle?.links ?? [];
    const live = links.filter((l) => l.revoked_at === null);
    return (
      live.find((l) => l.kind === 'client')?.token ??
      live[0]?.token ??
      links[0]?.token ??
      null
    );
  }, [bundle]);

  const { street, locality } = splitAddress(bundle?.property.address ?? null);

  return (
    <StudioShell>
      {/* ─── Page heading ─── */}
      <div className="studio-page-heading">
        <div>
          <span className="studio-page-eyebrow">Studio · video hub</span>
          <h1 className="studio-page-h1">{loading ? 'Loading…' : street}</h1>
          {!loading && !error && (
            <p className="studio-page-sub">
              {locality ? `${locality} · ` : ''}
              {bundle?.client?.name ?? '—'}
            </p>
          )}
        </div>
        <div className="studio-page-actions">
          <Link to="/dashboard/studio/videos" className="studio-btn-ghost studio-btn-sm">
            <ArrowLeft size={13} strokeWidth={1.8} />
            All videos
          </Link>
        </div>
      </div>

      {/* ─── StudioNav ─── */}
      <StudioNav />

      {error ? (
        <div style={{ padding: '24px 0' }}>
          <div className="studio-error-strip">Failed to load this video — {error}</div>
        </div>
      ) : loading || !bundle ? (
        <div className="le-hub-skeleton" data-testid="hub-skeleton" aria-hidden="true">
          <div className="studio-card le-skeleton-shimmer" style={{ height: 360 }} />
        </div>
      ) : (
        <div className="le-hub-grid">
          {/* ─── Left column: player + analytics + activity ─── */}
          <div className="le-hub-main">
            {/* Player */}
            <section className="studio-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {hasBoth && (
                <div
                  className="le-hub-orient-switch"
                  role="group"
                  aria-label="Choose render orientation"
                >
                  <button
                    type="button"
                    className={`studio-btn-ghost studio-btn-sm${orientation === 'horizontal' ? ' is-active' : ''}`}
                    aria-pressed={orientation === 'horizontal'}
                    onClick={() => setOrientation('horizontal')}
                  >
                    <Monitor size={13} strokeWidth={1.8} />
                    Horizontal
                  </button>
                  <button
                    type="button"
                    className={`studio-btn-ghost studio-btn-sm${orientation === 'vertical' ? ' is-active' : ''}`}
                    aria-pressed={orientation === 'vertical'}
                    onClick={() => setOrientation('vertical')}
                  >
                    <Smartphone size={13} strokeWidth={1.8} />
                    Vertical
                  </button>
                </div>
              )}
              {activeSrc ? (
                <LEPlayer
                  key={orientation}
                  src={activeSrc}
                  poster={bundle.hero_photo_url ?? undefined}
                  orientation={orientation}
                />
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--le-muted-2)' }}>No render available.</p>
              )}

              {/* Downloads — per available orientation */}
              {downloadToken && (videos.horizontal || videos.vertical) && (
                <div className="le-hub-downloads">
                  <span className="studio-section-eyebrow" style={{ margin: 0 }}>
                    Download masters
                  </span>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {videos.horizontal && (
                      <a
                        className="studio-btn-ghost studio-btn-sm"
                        data-testid="hub-download-horizontal"
                        href={`/api/preview/${downloadToken}/download?orientation=horizontal`}
                      >
                        <Download size={12} strokeWidth={1.8} />
                        Horizontal (16:9)
                      </a>
                    )}
                    {videos.vertical && (
                      <a
                        className="studio-btn-ghost studio-btn-sm"
                        data-testid="hub-download-vertical"
                        href={`/api/preview/${downloadToken}/download?orientation=vertical`}
                      >
                        <Download size={12} strokeWidth={1.8} />
                        Vertical (9:16)
                      </a>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* Analytics */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span className="studio-section-eyebrow" style={{ margin: 0 }}>
                Analytics
              </span>
              <div className="le-hub-stats">
                <StatCard label="Total plays" value={bundle.totals.total_plays.toLocaleString()} testId="hub-total-plays" />
                <StatCard label="Unique viewers" value={bundle.totals.unique_viewers.toLocaleString()} testId="hub-unique-viewers" />
                <StatCard
                  label="Avg completion"
                  value={`${bundle.totals.avg_completion_pct}%`}
                  testId="hub-avg-completion"
                />
              </div>

              {/* Per-link table */}
              <div className="studio-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="le-hub-table" role="table" aria-label="Per-link analytics">
                  <div className="le-hub-table-head" role="row">
                    <span role="columnheader">Link</span>
                    <span role="columnheader" style={{ textAlign: 'right' }}>Plays</span>
                    <span role="columnheader" style={{ textAlign: 'right' }}>Unique</span>
                    <span role="columnheader" style={{ textAlign: 'right' }}>Completion</span>
                    <span role="columnheader" style={{ textAlign: 'right' }}>Page views</span>
                  </div>
                  {bundle.links.length === 0 ? (
                    <div className="le-hub-table-empty">No links yet — create one in the share panel.</div>
                  ) : (
                    bundle.links.map((link) => (
                      <div
                        className="le-hub-table-row"
                        role="row"
                        key={link.id}
                        data-testid={`hub-link-stats-${link.id}`}
                      >
                        <span role="cell" className="le-hub-table-link">
                          <span className={`le-hub-kind-chip le-hub-kind-${link.kind}`}>
                            {link.kind === 'client' ? 'Client' : 'Public'}
                          </span>
                          <span className="le-hub-table-label" title={link.label ?? undefined}>
                            {link.label || (link.kind === 'client' ? 'Client review' : 'Public link')}
                          </span>
                        </span>
                        <span role="cell" className="le-hub-num" data-testid={`hub-link-plays-${link.id}`}>
                          {link.analytics.total_plays.toLocaleString()}
                        </span>
                        <span role="cell" className="le-hub-num" data-testid={`hub-link-unique-${link.id}`}>
                          {link.analytics.unique_viewers.toLocaleString()}
                        </span>
                        <span role="cell" className="le-hub-num" data-testid={`hub-link-completion-${link.id}`}>
                          {link.analytics.avg_completion_pct}%
                        </span>
                        <span role="cell" className="le-hub-num" data-testid={`hub-link-pageviews-${link.id}`}>
                          {link.viewed_count.toLocaleString()}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>

            {/* Activity */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span className="studio-section-eyebrow" style={{ margin: 0 }}>
                Activity
              </span>
              <div className="studio-card" style={{ padding: 0, overflow: 'hidden' }}>
                {bundle.revision_notes.length === 0 ? (
                  <div className="le-hub-table-empty">No approvals or revision requests yet.</div>
                ) : (
                  bundle.revision_notes.map((note) => (
                    <div className="le-hub-activity-row" key={note.id} data-testid={`hub-note-${note.id}`}>
                      <span className={`le-hub-activity-icon le-hub-activity-${note.source}`} aria-hidden="true">
                        {note.source === 'client_approval' ? (
                          <Check size={13} strokeWidth={2.2} />
                        ) : (
                          <MessageSquare size={13} strokeWidth={1.8} />
                        )}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="le-hub-activity-meta">
                          <span className="le-hub-activity-source">{noteSourceLabel(note.source)}</span>
                          <span className="le-hub-activity-time">{getRelativeTime(note.created_at)}</span>
                        </div>
                        <p className="le-hub-activity-body">{note.body}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          {/* ─── Right column: share panel ─── */}
          <aside className="le-hub-side">
            <div className="studio-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <span className="studio-section-eyebrow" style={{ margin: 0 }}>
                  Share
                </span>
                <h3 className="studio-section-h3" style={{ margin: '6px 0 0' }}>
                  Links & access
                </h3>
              </div>
              <SharePanel
                baseUrl={baseUrl}
                mode="list"
                clientLinks={clientLinks}
                publicLinks={publicLinks}
                onCreateLink={onCreateLink}
                onToggle={onToggle}
                onSetLabel={onSetLabel}
                onRevoke={onRevoke}
              />
            </div>
          </aside>
        </div>
      )}
    </StudioShell>
  );
};

export default VideoHub;
