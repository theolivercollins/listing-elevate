import { useState, useEffect, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Plus } from 'lucide-react';
import { StudioNav } from '@/components/studio/StudioNav';
import { formatCents, getRelativeTime } from '@/lib/types';
import '@/v2/styles/v2.css';

const EYEBROW: CSSProperties = {
  fontFamily: 'var(--le-font-mono)',
  fontSize: 10,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.45)',
};

const GHOST_BTN: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  fontSize: 11,
  fontWeight: 500,
  background: 'transparent',
  color: '#fff',
  border: '1px solid rgba(220,230,255,0.18)',
  borderRadius: 2,
  cursor: 'pointer',
  fontFamily: 'var(--le-font-sans)',
};

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

const COLUMNS: { key: keyof Buckets; label: string; emptyText: string }[] = [
  { key: 'inbox', label: 'Inbox', emptyText: 'No listings here yet' },
  { key: 'rendering', label: 'Rendering', emptyText: 'No listings here yet' },
  { key: 'needs_review', label: 'Needs Review', emptyText: 'No listings here yet' },
  { key: 'delivered', label: 'Delivered', emptyText: 'No listings here yet' },
];

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

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <span style={EYEBROW}>— Operator Studio</span>
          <h2
            className="mt-3"
            style={{
              fontFamily: 'var(--le-font-sans)',
              fontSize: 'clamp(28px, 4vw, 44px)',
              fontWeight: 500,
              letterSpacing: '-0.035em',
              lineHeight: 0.98,
              color: '#fff',
              margin: 0,
            }}
          >
            Queue
          </h2>
        </div>
        <Link to="/dashboard/studio/new" style={GHOST_BTN}>
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          New Listing
        </Link>
      </div>

      <StudioNav />

      {loading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="py-12 text-center text-sm text-destructive">{error}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map(col => {
            const rows = buckets?.[col.key] ?? [];
            return (
              <div key={col.key} className="flex flex-col bg-secondary/30 border border-border p-4 min-h-[320px]">
                <div className="flex items-center justify-between mb-4">
                  <span style={EYEBROW}>{col.label}</span>
                  <span
                    className="text-xs"
                    style={{ fontFamily: 'var(--le-font-mono)', color: 'rgba(255,255,255,0.55)' }}
                  >
                    {rows.length}
                  </span>
                </div>

                <div className="flex-1 space-y-2">
                  {rows.length === 0 ? (
                    <div className="border border-dashed border-border py-8 text-center flex flex-col items-center gap-3">
                      <p className="text-[11px] text-muted-foreground/60">{col.emptyText}</p>
                      {col.key === 'inbox' && (
                        <Link
                          to="/dashboard/studio/new"
                          style={{
                            ...GHOST_BTN,
                            fontSize: 10,
                            padding: '4px 10px',
                          }}
                        >
                          <Plus className="h-3 w-3" strokeWidth={1.5} />
                          Add listing
                        </Link>
                      )}
                    </div>
                  ) : (
                    rows.map(row => (
                      <Link
                        key={row.id}
                        to={`/dashboard/studio/properties/${row.id}`}
                        className="block border border-border bg-background/50 p-3 transition-colors duration-300 hover:border-foreground/40 hover:bg-secondary"
                      >
                        <div className="flex items-start gap-2">
                          {row.client?.brand_primary_hex && (
                            <span
                              className="mt-0.5 h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ background: row.client.brand_primary_hex }}
                              title={row.client.name}
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium leading-snug">{row.address}</p>
                            {row.client && (
                              <p className="truncate text-[10px] text-muted-foreground/70 mt-0.5">
                                {row.client.name}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="tabular text-[10px] text-muted-foreground">
                            {formatCents(row.total_cost_cents)}
                          </span>
                          <span
                            className="text-[10px] text-muted-foreground/60"
                            style={{ fontFamily: 'var(--le-font-mono)' }}
                          >
                            {getRelativeTime(row.created_at)}
                          </span>
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default StudioHome;
