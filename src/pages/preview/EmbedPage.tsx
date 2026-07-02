import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import LEPlayer from '../../components/preview/LEPlayer';
import '../../styles/preview-design.css';

// ---------------------------------------------------------------------------
// EmbedPage — chrome-less LE Video embed at /preview/:token/embed
//
// Design rules (spec §4, DESIGN-GUIDE.md ship-gate):
//   - No site chrome, no action buttons (view-only by nature).
//   - noindex injected via document.head useEffect (no react-helmet in repo).
//   - LEPlayer fills the viewport; dark/neutral backdrop via --pd-* tokens.
//   - Inter only, no monospace, no default-browser <video controls>.
//   - Orientation: default horizontal; fall back to vertical when only vertical
//     exists. No user-facing switcher — embeds are single-orientation.
//   - Beacon helpers copied from PreviewPage (module-private there; copying keeps
//     blast radius zero). Same fire-once-per-session + navigator.sendBeacon logic
//     so embedded plays count in analytics exactly like watch-page plays.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Beacon helpers (copied from PreviewPage.tsx — keep PreviewPage untouched)
// ---------------------------------------------------------------------------

type BeaconEvent =
  | 'view'
  | 'play'
  | 'progress_25'
  | 'progress_50'
  | 'progress_75'
  | 'complete';

const SESSION_KEY = 'le-preview-session-id';

function getSessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

function markFiredOnce(token: string, sessionId: string, event: BeaconEvent): boolean {
  try {
    const key = `le-preview-fired:${token}:${sessionId}`;
    const raw = window.sessionStorage.getItem(key);
    const set: string[] = raw ? JSON.parse(raw) : [];
    if (set.includes(event)) return true;
    set.push(event);
    window.sessionStorage.setItem(key, JSON.stringify(set));
    return false;
  } catch {
    return false;
  }
}

function sendBeaconEvent(token: string, body: Record<string, unknown>): void {
  try {
    const url = `/api/preview/${token}/events`;
    const payload = JSON.stringify(body);
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav && typeof nav.sendBeacon === 'function') {
      nav.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      return;
    }
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => { /* fire-and-forget */ });
  } catch {
    /* beacons never throw */
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EmbedData = {
  video_url: string | null;
  videos: { horizontal: string | null; vertical: string | null };
  // Bunny adaptive HLS playlists (migration 102). Always normalized to a
  // {horizontal,vertical} shape in the fetch effect below (null slots when
  // the API omits the field pre-migration or a render fell back to mp4-only).
  hls: { horizontal: string | null; vertical: string | null };
  thumbnail_url: string | null;
};

// ---------------------------------------------------------------------------
// Not-available screen (chrome-less — no site chrome, minimal message)
// ---------------------------------------------------------------------------

function NotAvailableScreen() {
  return (
    <div
      className="le-embed le-embed--not-available preview-scope"
      data-testid="embed-not-available"
      role="main"
    >
      <div className="le-embed__not-available-inner">
        <p className="le-embed__not-available-title">Video not available</p>
        <p className="le-embed__not-available-body">
          This video link has expired or no longer exists.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmbedPage
// ---------------------------------------------------------------------------

/**
 * EmbedPage — chrome-less, view-only embed for /preview/:token/embed.
 *
 * Fetches GET /api/preview/:token (same endpoint as the watch page).
 * On 404 (expired OR revoked — API already treats revoked_at as expired)
 * renders a minimal not-available message. On success mounts LEPlayer
 * filling the viewport. No orientation switcher; defaults to horizontal,
 * falls back to vertical when horizontal is absent.
 */
export default function EmbedPage() {
  const { token } = useParams<{ token: string }>();

  const [data, setData] = useState<EmbedData | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Stable per-tab analytics session id.
  const sessionIdRef = useRef<string | null>(null);
  if (sessionIdRef.current === null) sessionIdRef.current = getSessionId();

  // ── noindex: inject on mount, remove on unmount ──────────────────────
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  // ── Data fetch ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    fetch(`/api/preview/${token}`).then(async (r) => {
      if (r.status === 404) {
        setNotFound(true);
        return;
      }
      const d = await r.json();
      setData({
        video_url: d.video_url ?? null,
        videos: d.videos ?? { horizontal: d.video_url ?? null, vertical: null },
        hls: d.hls ?? { horizontal: null, vertical: null },
        thumbnail_url: d.thumbnail_url ?? null,
      });
    });
  }, [token]);

  // ── Emit once per session ─────────────────────────────────────────────
  const emit = (event: BeaconEvent, orientation: 'horizontal' | 'vertical') => {
    if (!token) return;
    const sessionId = sessionIdRef.current!;
    if (markFiredOnce(token, sessionId, event)) return;
    sendBeaconEvent(token, { session_id: sessionId, event, orientation });
  };

  // ── States ────────────────────────────────────────────────────────────
  if (notFound) return <NotAvailableScreen />;

  // Loading: render full-viewport dark shell while fetching (no spinner chrome)
  if (!data) {
    return <div className="le-embed preview-scope" aria-hidden="true" />;
  }

  const { videos, hls, thumbnail_url } = data;
  const hasHorizontal = Boolean(videos.horizontal);
  const hasVertical = Boolean(videos.vertical);

  // Default horizontal; fall back to vertical only; if neither — not available
  const orientation: 'horizontal' | 'vertical' =
    hasHorizontal ? 'horizontal' : hasVertical ? 'vertical' : 'horizontal';
  const activeVideoUrl =
    orientation === 'horizontal' && hasHorizontal
      ? videos.horizontal!
      : hasVertical
      ? videos.vertical!
      : null;
  // Mirrors activeVideoUrl's orientation selection — null when absent (legacy
  // mp4-only render or pre-migration API response); LEPlayer falls back to `src`.
  const activeHlsUrl =
    orientation === 'horizontal' && hasHorizontal
      ? hls.horizontal
      : hasVertical
      ? hls.vertical
      : null;

  if (!activeVideoUrl) return <NotAvailableScreen />;

  return (
    <div className="le-embed preview-scope" role="main">
      <LEPlayer
        src={activeVideoUrl}
        hlsSrc={activeHlsUrl ?? undefined}
        poster={thumbnail_url ?? undefined}
        orientation={orientation}
        onView={() => emit('view', orientation)}
        onPlayFirst={() => emit('play', orientation)}
        onProgress={(m) => emit(`progress_${m}` as BeaconEvent, orientation)}
        onComplete={() => emit('complete', orientation)}
      />
    </div>
  );
}
