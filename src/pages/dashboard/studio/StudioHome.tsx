import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Plus } from 'lucide-react';
import { StudioNav } from '@/components/studio/StudioNav';
import { StudioShell } from '@/components/studio/StudioShell';
import { formatCents, getRelativeTime } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type Client = {
  id: string;
  name: string;
  brand_primary_hex: string | null;
};

type QueueRow = {
  id: string;
  address: string;
  status: string;
  total_cost_cents: number;
  created_at: string;
  client: Client | null;
};

type Buckets = {
  inbox: QueueRow[];
  rendering: QueueRow[];
  needs_review: QueueRow[];
  delivered: QueueRow[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derive a consistent hue for a property thumbnail from its id. */
function thumbHue(id: string): number {
  const n = parseInt(id.replace(/-/g, '').slice(0, 6), 16) || 0;
  return n % 360;
}

/** Status → pill class suffix */
function statusClass(status: string): string {
  const map: Record<string, string> = {
    complete: 'complete',
    queued: 'queued',
    needs_review: 'needs_review',
    failed: 'failed',
    generating: 'generating',
    analyzing: 'analyzing',
    scripting: 'scripting',
    qc: 'qc',
    assembling: 'assembling',
    ingesting: 'ingesting',
  };
  return map[status] ?? 'queued';
}

/** Friendly status label */
function statusLabel(status: string): string {
  const map: Record<string, string> = {
    complete: 'Delivered',
    queued: 'Queued',
    needs_review: 'Review',
    failed: 'Failed',
    generating: 'Generating',
    analyzing: 'Analyzing',
    scripting: 'Scripting',
    qc: 'QC',
    assembling: 'Assembling',
    ingesting: 'Ingesting',
  };
  return map[status] ?? status;
}

// ─── PropertyThumb ─────────────────────────────────────────────────────────────

function PropertyThumb({ id, size = 40 }: { id: string; size?: number }) {
  const hue = thumbHue(id);
  return (
    <div
      className="studio-prop-thumb"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${hue}, 10%, 78%), hsl(${hue + 30}, 10%, 62%))`,
      }}
    >
      <svg
        width={size * 0.5}
        height={size * 0.5}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
      >
        <path d="M3 11l9-7 9 7v9a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2z" />
      </svg>
    </div>
  );
}

// ─── Column config ─────────────────────────────────────────────────────────────

const COLUMNS: { key: keyof Buckets; label: string }[] = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'rendering', label: 'Rendering' },
  { key: 'needs_review', label: 'Needs review' },
  { key: 'delivered', label: 'Delivered' },
];

// ─── Main component ────────────────────────────────────────────────────────────

const StudioHome = () => {
  const [buckets, setBuckets] = useState<Buckets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/admin/studio/queue');
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { buckets: Buckets };
        if (cancelled) return;
        setBuckets(data.buckets);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load queue');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const b = buckets ?? { inbox: [], rendering: [], needs_review: [], delivered: [] };
  const totalIn = b.inbox.length + b.rendering.length;
  const needsReview = b.needs_review.length;
  const deliveredCount = b.delivered.length;
  const totalAll = b.inbox.length + b.rendering.length + b.needs_review.length + b.delivered.length;

  return (
    <StudioShell>
      {/* ─── Page heading ─── */}
      <div className="studio-page-heading">
        <div>
          <span className="studio-page-eyebrow">Studio · queue</span>
          <h1 className="studio-page-h1">New listings</h1>
          {!loading && (
            <p className="studio-page-sub">
              {totalIn} in production.{' '}
              {needsReview} need{needsReview === 1 ? 's' : ''} review.{' '}
              {deliveredCount} delivered this week.
            </p>
          )}
        </div>
        <div className="studio-page-actions">
          <Link to="/dashboard/studio" className="studio-btn-ghost">
            View pipeline
          </Link>
          <Link to="/dashboard/studio/new" className="studio-cta-primary">
            <Plus size={13} strokeWidth={2} />
            New listing
          </Link>
        </div>
      </div>

      {/* ─── StudioNav ─── */}
      <StudioNav />

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 0' }}>
          <Loader2 size={20} className="studio-spinner" style={{ color: 'var(--le-muted)' }} />
        </div>
      ) : error ? (
        <div className="studio-error-strip">{error}</div>
      ) : (
        <>
          {/* ─── KPI strip ─── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 16,
              marginBottom: 24,
            }}
          >
            <div className="studio-kpi-card">
              <div className="studio-kpi-head">
                <span className="studio-kpi-label">Inbox</span>
              </div>
              <div className="studio-kpi-value studio-tabnum">{b.inbox.length}</div>
              <div className="studio-kpi-sub">Awaiting pipeline</div>
            </div>

            <div className="studio-kpi-card">
              <div className="studio-kpi-head">
                <span className="studio-kpi-label">Rendering</span>
              </div>
              <div className="studio-kpi-value studio-tabnum">{b.rendering.length}</div>
              <div className="studio-kpi-sub">In progress</div>
            </div>

            <div className="studio-kpi-card">
              <div className="studio-kpi-head">
                <span className="studio-kpi-label">Needs review</span>
              </div>
              <div
                className="studio-kpi-value studio-tabnum"
                style={{ color: needsReview > 0 ? 'var(--le-warn)' : 'var(--le-ink)' }}
              >
                {needsReview}
              </div>
              <div className="studio-kpi-sub">Flagged for attention</div>
            </div>

            <div className="studio-kpi-card">
              <div className="studio-kpi-head">
                <span className="studio-kpi-label">Delivered</span>
              </div>
              <div
                className="studio-kpi-value studio-tabnum"
                style={{ color: deliveredCount > 0 ? 'var(--le-good)' : 'var(--le-ink)' }}
              >
                {deliveredCount}
              </div>
              <div className="studio-kpi-sub">This week</div>
            </div>
          </div>

          {/* ─── Kanban ─── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 16,
            }}
          >
            {COLUMNS.map((col) => {
              const rows = b[col.key];
              return (
                <div key={col.key} style={{ display: 'flex', flexDirection: 'column' }}>
                  {/* Column header */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 12,
                      padding: '0 2px',
                    }}
                  >
                    <span className="studio-label">{col.label}</span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--le-muted-2)',
                        fontVariantNumeric: 'tabular-nums',
                        background: 'rgba(11,11,16,0.05)',
                        borderRadius: 99,
                        padding: '1px 7px',
                        minWidth: 20,
                        textAlign: 'center',
                      }}
                    >
                      {rows.length}
                    </span>
                  </div>

                  {/* Cards */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                    {rows.length === 0 ? (
                      <div className="studio-kanban-empty">
                        No listings here
                        {col.key === 'inbox' && (
                          <div style={{ marginTop: 12 }}>
                            <Link to="/dashboard/studio/new" className="studio-btn-ghost" style={{ fontSize: 11, padding: '5px 12px' }}>
                              <Plus size={11} strokeWidth={2} />
                              Add listing
                            </Link>
                          </div>
                        )}
                      </div>
                    ) : (
                      rows.map((row) => (
                        <Link
                          key={row.id}
                          to={`/dashboard/studio/properties/${row.id}`}
                          className="studio-kanban-card"
                        >
                          {/* Top row: thumb + status pill */}
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              justifyContent: 'space-between',
                              gap: 8,
                              marginBottom: 10,
                            }}
                          >
                            <PropertyThumb id={row.id} size={40} />
                            <span className={`studio-status-pill ${statusClass(row.status)}`}>
                              <span className="studio-status-dot" />
                              {statusLabel(row.status)}
                            </span>
                          </div>

                          {/* Address */}
                          <p
                            style={{
                              margin: '0 0 6px',
                              fontSize: 13.5,
                              fontWeight: 600,
                              letterSpacing: '-0.012em',
                              color: 'var(--le-ink)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {row.address}
                          </p>

                          {/* Meta row */}
                          <p
                            style={{
                              margin: 0,
                              fontSize: 12,
                              color: 'var(--le-muted)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              overflow: 'hidden',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {row.client?.name && (
                              <>
                                <span
                                  style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: '50%',
                                    background: row.client.brand_primary_hex ?? 'var(--le-muted-2)',
                                    flexShrink: 0,
                                    display: 'inline-block',
                                  }}
                                />
                                <span
                                  style={{
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    maxWidth: 80,
                                  }}
                                >
                                  {row.client.name}
                                </span>
                                <span style={{ color: 'var(--le-line)' }}>·</span>
                              </>
                            )}
                            <span className="studio-tabnum">{formatCents(row.total_cost_cents)}</span>
                            <span style={{ color: 'var(--le-line)' }}>·</span>
                            <span style={{ flexShrink: 0 }}>{getRelativeTime(row.created_at)}</span>
                          </p>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ─── Footer: total count strip ─── */}
          {totalAll > 0 && (
            <p
              style={{
                marginTop: 32,
                fontSize: 12,
                color: 'var(--le-muted-2)',
                textAlign: 'center',
              }}
            >
              {totalAll} listing{totalAll !== 1 ? 's' : ''} in queue
            </p>
          )}
        </>
      )}
    </StudioShell>
  );
};

export default StudioHome;
