import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, Download, Loader2, Monitor, Smartphone } from 'lucide-react';
import '../../styles/preview-design.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Brand = {
  logo: string | null;
  agent_name: string | null;
  name: string;
  headshot: string | null;
  brokerage: string | null;
};

type PreviewData = {
  address: string;
  address_parts: { street: string; locality: string };
  /** Back-compat single-video field. */
  video_url: string | null;
  videos: { horizontal: string | null; vertical: string | null };
  thumbnail_url: string | null;
  brand: Brand | null;
  kind: 'client' | 'public';
  capabilities: { download: boolean; approve: boolean; revision: boolean };
  approved_at: string | null;
};

type Orientation = 'wide' | 'vertical';

// ---------------------------------------------------------------------------
// Helper: derive address parts from raw address when API is pre-migration
// ---------------------------------------------------------------------------
function deriveAddressParts(address: string): { street: string; locality: string } {
  const commaIdx = address.indexOf(',');
  if (commaIdx === -1) return { street: address, locality: '' };
  const street = address.slice(0, commaIdx);
  let locality = address.slice(commaIdx + 1).trim();
  if (locality.endsWith(', USA')) locality = locality.slice(0, -5);
  return { street, locality };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LoadingScreen() {
  return (
    <div className="preview-scope pd-state-page">
      <div className="pd-state-inner">
        <Loader2 size={22} className="pd-spinner" style={{ color: '#9aa0aa' }} aria-hidden="true" />
        <p className="pd-state-body">Loading your preview...</p>
      </div>
    </div>
  );
}

function NotFoundScreen() {
  return (
    <div className="preview-scope pd-state-page" data-testid="preview-not-found">
      <div className="pd-state-inner">
        <p className="pd-state-title">Preview not available</p>
        <p className="pd-state-body">
          This preview link has expired or no longer exists. Contact the agent who sent it to you for an updated link.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * PreviewPage — public-facing client preview viewer.
 *
 * Light warm-white gallery (dashboard L2 soft-shell design language).
 * No TopNav, no studio-scope, no monospace. Mobile-first.
 * Server enforces all capability gates; UI hides controls only.
 */
export default function PreviewPage() {
  const { token } = useParams<{ token: string }>();

  const [data, setData] = useState<PreviewData | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Orientation toggle state
  const [orientation, setOrientation] = useState<Orientation>('wide');

  // Approve action state
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState<string | null>(null);

  // Request-a-change state
  const [revealNoteBox, setRevealNoteBox] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!token) return;
    fetch(`/api/preview/${token}`).then(async (r) => {
      if (r.status === 404) {
        setNotFound(true);
        return;
      }
      const d = await r.json();
      const payload: PreviewData = {
        address: d.address,
        address_parts: d.address_parts ?? deriveAddressParts(d.address),
        video_url: d.video_url ?? null,
        videos: d.videos ?? { horizontal: d.video_url ?? null, vertical: null },
        thumbnail_url: d.thumbnail_url ?? null,
        brand: d.brand ?? null,
        kind: d.kind ?? 'client',
        capabilities: d.capabilities ?? { download: true, approve: true, revision: true },
        approved_at: d.approved_at ?? null,
      };
      setData(payload);
      setApproved(payload.approved_at);
    });
  }, [token]);

  // ---------------------------------------------------------------------------

  const handleApprove = async () => {
    if (approving || !token) return;
    setApproving(true);
    try {
      const r = await fetch(`/api/preview/${token}/approve`, { method: 'POST' });
      if (r.ok) {
        const body = await r.json().catch(() => ({}));
        setApproved(body.approved_at ?? new Date().toISOString());
      }
    } finally {
      setApproving(false);
    }
  };

  const handleSubmitNote = async () => {
    if (!note.trim() || submitting || !token) return;
    setSubmitting(true);
    try {
      const r = await fetch(`/api/preview/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: note }),
      });
      if (r.ok) {
        setSubmitted(true);
        setNote('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // States
  // ---------------------------------------------------------------------------

  if (notFound) return <NotFoundScreen />;
  if (!data) return <LoadingScreen />;

  const { address_parts, videos, thumbnail_url, brand, kind, capabilities } = data;

  const hasHorizontal = Boolean(videos.horizontal);
  const hasVertical = Boolean(videos.vertical);
  const hasBothOrientations = hasHorizontal && hasVertical;

  // Default to wide; if only vertical exists, use vertical
  const activeOrientation: Orientation =
    !hasHorizontal && hasVertical ? 'vertical' : orientation;

  const activeVideoUrl =
    activeOrientation === 'vertical' && hasVertical
      ? videos.vertical!
      : hasHorizontal
      ? videos.horizontal!
      : null;

  // Download URL hits the T3 download route
  const downloadUrl = activeVideoUrl
    ? `/api/preview/${token}/download?orientation=${activeOrientation === 'vertical' ? 'vertical' : 'horizontal'}`
    : null;

  const isVideoRendering = !hasHorizontal && !hasVertical;
  const isApproved = Boolean(approved);

  return (
    <div className="preview-scope pd-page">
      <main className="pd-container pd-fade-up">

        {/* ── Brand row ── */}
        {brand && (
          <div className="pd-brand-row">
            {brand.logo ? (
              <img
                src={brand.logo}
                alt={brand.name ?? 'Agent logo'}
                className="pd-brand-logo"
                data-testid="brand-logo"
              />
            ) : brand.agent_name ? (
              <span className="pd-brand-name-lockup" data-testid="brand-name-lockup">
                {brand.agent_name}
              </span>
            ) : null}
          </div>
        )}

        {/* ── Address headline ── */}
        <section className="pd-address-section" aria-label="Property address">
          <h1 className="pd-address-headline" data-testid="preview-address">
            {address_parts.street}
          </h1>
          {address_parts.locality && (
            <p className="pd-address-locality" data-testid="preview-locality">
              {address_parts.locality}
            </p>
          )}
        </section>

        {/* ── Video card ── */}
        <div className="pd-video-card">
          {isVideoRendering ? (
            <div className="pd-video-placeholder" data-testid="preview-rendering">
              <Loader2 size={20} className="pd-spinner" style={{ color: '#9aa0aa' }} aria-hidden="true" />
              <p className="pd-video-placeholder-label">
                This listing film is still rendering — check back shortly.
              </p>
            </div>
          ) : (
            <>
              {/* Orientation pill toggle — only when both exist */}
              {hasBothOrientations && (
                <div
                  className="pd-orientation-toggle"
                  role="group"
                  aria-label="Video orientation"
                  data-testid="orientation-toggle"
                >
                  <button
                    type="button"
                    className={`pd-toggle-pill${activeOrientation === 'wide' ? ' active' : ''}`}
                    aria-pressed={activeOrientation === 'wide'}
                    data-testid="toggle-wide"
                    onClick={() => setOrientation('wide')}
                  >
                    <Monitor size={13} strokeWidth={2} aria-hidden="true" />
                    Wide
                  </button>
                  <button
                    type="button"
                    className={`pd-toggle-pill${activeOrientation === 'vertical' ? ' active' : ''}`}
                    aria-pressed={activeOrientation === 'vertical'}
                    data-testid="toggle-vertical"
                    onClick={() => setOrientation('vertical')}
                  >
                    <Smartphone size={13} strokeWidth={2} aria-hidden="true" />
                    Vertical
                  </button>
                </div>
              )}

              {/* Single player — src swaps on toggle */}
              <div className="pd-video-wrap">
                <video
                  key={activeVideoUrl ?? 'no-video'}
                  src={activeVideoUrl ?? undefined}
                  poster={thumbnail_url ?? undefined}
                  controls
                  playsInline
                  data-testid="video-player"
                  className={`pd-video-player${activeOrientation === 'vertical' ? ' pd-video-player--vertical' : ''}`}
                />
              </div>
            </>
          )}
        </div>

        {/* ── Presented-by row ── */}
        {brand && (brand.agent_name || brand.headshot || brand.brokerage) && (
          <div className="pd-presented-by" data-testid="presented-by-row" aria-label="Presented by">
            {brand.headshot && (
              <img
                src={brand.headshot}
                alt={brand.agent_name ?? 'Agent'}
                className="pd-agent-headshot"
                data-testid="agent-headshot"
              />
            )}
            <div className="pd-presented-by-text">
              {brand.agent_name && (
                <span className="pd-agent-name">{brand.agent_name}</span>
              )}
              {brand.brokerage && (
                <span className="pd-brokerage-name">{brand.brokerage}</span>
              )}
            </div>
          </div>
        )}

        {/* ── Action row ── (hidden entirely for public links via capabilities) */}
        {(capabilities.download || capabilities.approve || capabilities.revision) && (
          <div className="pd-action-row">

            {/* Download */}
            {capabilities.download && downloadUrl && (
              <a
                href={downloadUrl}
                download
                className="pd-btn-ghost"
                data-testid="btn-download"
                aria-label="Download video"
              >
                <Download size={14} strokeWidth={2} aria-hidden="true" />
                Download
              </a>
            )}

            {/* Approve / Approved */}
            {capabilities.approve && (
              isApproved ? (
                <span className="pd-approved-badge" data-testid="approved-badge">
                  <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                  Approved
                </span>
              ) : (
                <button
                  type="button"
                  className="pd-btn-approve"
                  data-testid="btn-approve"
                  onClick={handleApprove}
                  disabled={approving}
                  aria-live="polite"
                >
                  {approving ? (
                    <>
                      <Loader2 size={14} className="pd-spinner" aria-hidden="true" />
                      Approving...
                    </>
                  ) : (
                    <>
                      <Check size={14} strokeWidth={2} aria-hidden="true" />
                      Approve
                    </>
                  )}
                </button>
              )
            )}

            {/* Request a change — toggle */}
            {capabilities.revision && !revealNoteBox && (
              <button
                type="button"
                className="pd-btn-ghost"
                data-testid="btn-request-change"
                onClick={() => setRevealNoteBox(true)}
                aria-expanded="false"
                aria-controls="change-note-box"
              >
                Request a change
              </button>
            )}
          </div>
        )}

        {/* ── Note box (revealed on click) ── */}
        {revealNoteBox && capabilities.revision && (
          <div
            className="pd-note-box"
            id="change-note-box"
            data-testid="change-note-box"
            role="region"
            aria-label="Request a change"
          >
            <p className="pd-note-label">
              {submitted
                ? 'Your note has been sent.'
                : 'Describe what you\'d like adjusted. One revision is included.'}
            </p>
            {!submitted && (
              <>
                <textarea
                  className="pd-note-textarea"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={2000}
                  rows={4}
                  placeholder="e.g. The music feels too upbeat for this property..."
                  disabled={submitting}
                  aria-label="Change request note"
                />
                <div className="pd-note-submit-row">
                  <button
                    type="button"
                    className="pd-btn-approve"
                    onClick={handleSubmitNote}
                    disabled={submitting || !note.trim()}
                  >
                    {submitting ? (
                      <>
                        <Loader2 size={14} className="pd-spinner" aria-hidden="true" />
                        Sending...
                      </>
                    ) : (
                      'Send note'
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Footer ── */}
        <footer className="pd-footer" role="contentinfo">
          <p className="pd-footer-attribution" data-testid="footer-attribution">
            Crafted with Listing Elevate
          </p>
        </footer>

      </main>
    </div>
  );
}
