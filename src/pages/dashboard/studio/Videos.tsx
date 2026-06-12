import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Search, ChevronDown, ChevronLeft, ChevronRight, Play, Check, Film } from 'lucide-react';
import { StudioNav } from '@/components/studio/StudioNav';
import { StudioShell } from '@/components/studio/StudioShell';
import { getRelativeTime } from '@/lib/types';
import { authedFetch } from '@/lib/api';

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 300;

// ─── Types (mirror GET /api/admin/studio/videos item shape) ─────────────────────

interface VideoItem {
  id: string;
  address: string | null;
  videos: { horizontal: string | null; vertical: string | null };
  approved_at: string | null;
  created_at: string;
  client: { id: string; name: string } | null;
  hero_photo_url: string | null;
  link_count: number;
  total_views: number;
}

interface VideosResponse {
  items: VideoItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface ClientOption {
  id: string;
  name: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Split an address into a street line and a locality line for the two-tier card
 * label. We split on the first comma: everything before is the street, the rest is
 * city/region. Falls back gracefully when there's no comma or no address at all.
 */
function splitAddress(address: string | null): { street: string; locality: string } {
  if (!address) return { street: 'Untitled property', locality: '' };
  const idx = address.indexOf(',');
  if (idx === -1) return { street: address.trim(), locality: '' };
  return {
    street: address.slice(0, idx).trim(),
    locality: address.slice(idx + 1).trim(),
  };
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function VideoCard({ item }: { item: VideoItem }) {
  const { street, locality } = splitAddress(item.address);
  const hasH = !!item.videos.horizontal;
  const hasV = !!item.videos.vertical;

  return (
    <Link
      to={`/dashboard/studio/videos/${item.id}`}
      className="le-video-card"
      aria-label={item.address ?? 'Untitled property'}
    >
      {/* Poster */}
      <div className="le-video-card-poster">
        {item.hero_photo_url ? (
          <img src={item.hero_photo_url} alt="" loading="lazy" />
        ) : (
          <div className="le-video-card-poster-empty" aria-hidden="true">
            <Film size={26} strokeWidth={1.4} />
          </div>
        )}
        {/* Hover play affordance — the showcase moment */}
        <div className="le-video-card-scrim" aria-hidden="true">
          <span className="le-video-card-play">
            <Play size={18} strokeWidth={2} fill="currentColor" />
          </span>
        </div>
        {/* Orientation badges, top-left */}
        <div className="le-video-card-badges" aria-hidden="true">
          {hasH && <span className="le-video-orient-badge">16:9</span>}
          {hasV && <span className="le-video-orient-badge">9:16</span>}
        </div>
        {/* Approved badge, top-right */}
        {item.approved_at && (
          <span className="le-video-approved-badge">
            <Check size={10} strokeWidth={2.4} />
            Approved
          </span>
        )}
      </div>

      {/* Meta */}
      <div className="le-video-card-meta">
        <div className="le-video-card-title">{street}</div>
        {locality && <div className="le-video-card-locality">{locality}</div>}
        <div className="le-video-card-footer">
          <span className="le-video-card-client">{item.client?.name ?? '—'}</span>
          <span className="le-video-card-stats">
            <span className="le-video-card-views" title={`${item.total_views} views`}>
              {item.total_views.toLocaleString()}
              <span className="le-video-card-views-label"> views</span>
            </span>
            <span className="le-video-card-dot" aria-hidden="true">·</span>
            <span className="le-video-card-date">{getRelativeTime(item.created_at)}</span>
          </span>
        </div>
      </div>
    </Link>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────────

function VideosSkeleton() {
  return (
    <div className="le-video-grid" data-testid="videos-skeleton" aria-hidden="true">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="le-video-card le-video-card-skeleton">
          <div className="le-video-card-poster le-skeleton-shimmer" />
          <div className="le-video-card-meta">
            <div className="le-skeleton-line le-skeleton-shimmer" style={{ width: '70%' }} />
            <div className="le-skeleton-line le-skeleton-shimmer" style={{ width: '45%', marginTop: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────────

const Videos = () => {
  const [items, setItems] = useState<VideoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientId, setClientId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);

  // Load the client dropdown once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch('/api/admin/studio/clients');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setClients((data.clients ?? []).map((c: ClientOption) => ({ id: c.id, name: c.name })));
      } catch {
        /* dropdown is non-essential; ignore */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Debounce the search input → debouncedSearch.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset to page 1 whenever a filter changes.
  useEffect(() => {
    setPage(1);
  }, [clientId, fromDate, toDate, debouncedSearch]);

  // Fetch the library whenever a query input changes.
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (clientId) params.set('client_id', clientId);
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    if (page > 1) params.set('page', String(page));
    const qs = params.toString();
    const url = `/api/admin/studio/videos${qs ? `?${qs}` : ''}`;

    setLoading(true);
    (async () => {
      try {
        const res = await authedFetch(url);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data: VideosResponse = await res.json();
        if (!cancelled) {
          setItems(data.items ?? []);
          setTotal(data.total ?? 0);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load videos');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, debouncedSearch, fromDate, toDate, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = !!(clientId || debouncedSearch || fromDate || toDate);

  return (
    <StudioShell>
      {/* ─── Page heading ─── */}
      <div className="studio-page-heading">
        <div>
          <span className="studio-page-eyebrow">Studio · videos</span>
          <h1 className="studio-page-h1">Videos</h1>
          {!loading && !error && (
            <p className="studio-page-sub" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {total} {total === 1 ? 'film' : 'films'} delivered.
            </p>
          )}
        </div>
        <div className="studio-page-actions">
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search
              size={13}
              strokeWidth={1.8}
              style={{ position: 'absolute', left: 11, color: 'var(--le-muted)', pointerEvents: 'none' }}
            />
            <input
              className="studio-input"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search address…"
              aria-label="Search videos by address"
              style={{ paddingLeft: 30, width: 200, height: 38 }}
            />
          </div>
        </div>
      </div>

      {/* ─── StudioNav ─── */}
      <StudioNav />

      {/* ─── Filter bar ─── */}
      <div className="le-video-filters">
        <label className="le-video-filter">
          <span className="le-video-filter-label">Client</span>
          <span className="le-video-select-wrap">
            <select
              className="studio-input le-video-select"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              aria-label="Filter by client"
            >
              <option value="">All clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <ChevronDown size={14} strokeWidth={1.8} className="le-video-select-chevron" aria-hidden="true" />
          </span>
        </label>

        <label className="le-video-filter">
          <span className="le-video-filter-label">From</span>
          <input
            type="date"
            className="studio-input le-video-date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="From date"
          />
        </label>

        <label className="le-video-filter">
          <span className="le-video-filter-label">To</span>
          <input
            type="date"
            className="studio-input le-video-date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="To date"
          />
        </label>

        {hasFilters && (
          <button
            type="button"
            className="studio-btn-ghost studio-btn-sm"
            onClick={() => { setClientId(''); setFromDate(''); setToDate(''); setSearchInput(''); }}
            style={{ marginLeft: 'auto' }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ─── Grid / states ─── */}
      {loading ? (
        <VideosSkeleton />
      ) : error ? (
        <div style={{ padding: '24px 0' }}>
          <div className="studio-error-strip">{error}</div>
        </div>
      ) : items.length === 0 ? (
        <div className="le-video-empty">
          <span className="le-video-empty-icon" aria-hidden="true">
            <Film size={28} strokeWidth={1.4} />
          </span>
          <p className="le-video-empty-title">
            {hasFilters ? 'No videos match these filters.' : 'No videos delivered yet.'}
          </p>
          <p className="le-video-empty-sub">
            {hasFilters
              ? 'Try widening the date range or clearing the client filter.'
              : 'Delivered films will appear here as a managed library.'}
          </p>
        </div>
      ) : (
        <>
          <div className="le-video-grid">
            {items.map((item) => (
              <VideoCard key={item.id} item={item} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="le-video-pagination">
              <button
                type="button"
                className="studio-btn-ghost studio-btn-sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="Previous page"
              >
                <ChevronLeft size={13} strokeWidth={1.8} />
                Previous
              </button>
              <span className="le-video-page-indicator" style={{ fontVariantNumeric: 'tabular-nums' }}>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="studio-btn-ghost studio-btn-sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                aria-label="Next page"
              >
                Next
                <ChevronRight size={13} strokeWidth={1.8} />
              </button>
            </div>
          )}
        </>
      )}
    </StudioShell>
  );
};

export default Videos;
