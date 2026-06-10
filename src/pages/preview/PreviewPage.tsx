import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, Loader2 } from 'lucide-react';
import '../../styles/studio-design.css';

type PreviewData = {
  address: string;
  /** Back-compat single-video field (horizontal ?? vertical). */
  video_url: string | null;
  /** Both formats when available. */
  videos?: { horizontal: string | null; vertical: string | null } | null;
  brand: { logo: string | null; agent_name: string | null; name: string } | null;
};

/**
 * PreviewPage — public-facing client preview viewer.
 * No TopNav, no StudioNav. Centered max-width 720px.
 * Uses the same .studio-scope tokens but in a stripped-down layout.
 * No emoji per design rules.
 */
export default function PreviewPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PreviewData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetch(`/api/preview/${token}`).then(async (r) => {
      if (r.status === 404) {
        setNotFound(true);
        return;
      }
      const d = await r.json();
      setData(d);
    });
  }, [token]);

  const submit = async () => {
    if (!note.trim() || submitting) return;
    setSubmitting(true);
    const r = await fetch(`/api/preview/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: note }),
    });
    setSubmitting(false);
    if (r.ok) {
      setSubmitted(true);
      setNote('');
    }
  };

  if (notFound) {
    return (
      <div
        className="studio-scope studio-preview"
        style={{ minHeight: '100vh', background: 'var(--le-bg)' }}
      >
        <div className="studio-bg-base" aria-hidden="true" />
        <div className="studio-grain" aria-hidden="true" />
        <div
          className="studio-preview-container"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60vh',
          }}
        >
          <p style={{ fontSize: 15, color: 'var(--le-muted)', textAlign: 'center' }}>
            This preview is no longer available.
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div
        className="studio-scope studio-preview"
        style={{ minHeight: '100vh', background: 'var(--le-bg)' }}
      >
        <div className="studio-bg-base" aria-hidden="true" />
        <div className="studio-grain" aria-hidden="true" />
        <div
          className="studio-preview-container"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60vh',
          }}
        >
          <Loader2
            size={20}
            className="studio-spinner"
            style={{ color: 'var(--le-muted)' }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="studio-scope studio-preview"
      style={{ minHeight: '100vh', background: 'var(--le-bg)', position: 'relative' }}
    >
      {/* Background layers */}
      <div className="studio-bg-base" aria-hidden="true" />
      <div className="studio-grain" aria-hidden="true" />

      {/* Content container */}
      <div
        className="studio-preview-container studio-fade-up"
        style={{ position: 'relative', zIndex: 2 }}
      >
        {/* Brand logo */}
        {data.brand?.logo && (
          <div style={{ marginBottom: 28 }}>
            <img
              src={data.brand.logo}
              alt={data.brand.name ?? 'Brand logo'}
              style={{ height: 40, maxWidth: 160, objectFit: 'contain' }}
            />
          </div>
        )}

        {/* Address heading */}
        <h1 className="studio-preview-h1">{data.address}</h1>

        {/* Video player(s) */}
        {(() => {
          const hUrl = data.videos?.horizontal ?? null;
          const vUrl = data.videos?.vertical ?? null;
          const hasHorizontal = Boolean(hUrl);
          const hasVertical = Boolean(vUrl);

          if (!hasHorizontal && !hasVertical) {
            return (
              <div
                className="studio-kanban-empty"
                style={{ padding: 48, textAlign: 'center', marginBottom: 16 }}
              >
                <p style={{ fontSize: 14, color: 'var(--le-muted)' }}>
                  Video not yet available.
                </p>
              </div>
            );
          }

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 16 }}>
              {hasHorizontal && (
                <div>
                  {hasVertical && (
                    <p style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--le-muted)', marginBottom: 8 }}>
                      Horizontal (16:9)
                    </p>
                  )}
                  <video
                    src={hUrl!}
                    controls
                    playsInline
                    className="studio-video"
                  />
                </div>
              )}
              {hasVertical && (
                <div>
                  {hasHorizontal && (
                    <p style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--le-muted)', marginBottom: 8 }}>
                      Vertical (9:16)
                    </p>
                  )}
                  <video
                    src={vUrl!}
                    controls
                    playsInline
                    className="studio-video studio-video--vertical"
                  />
                </div>
              )}
            </div>
          );
        })()}

        {/* Agent caption */}
        {data.brand?.agent_name && (
          <p
            style={{
              fontSize: 13.5,
              color: 'var(--le-muted)',
              marginBottom: 32,
            }}
          >
            {data.brand.agent_name}
            {data.brand.name ? ` · ${data.brand.name}` : ''}
          </p>
        )}

        {/* Request a change card */}
        <div
          className="studio-card"
          style={{ padding: 24 }}
        >
          <h3
            style={{
              margin: '0 0 6px 0',
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: '-0.015em',
              color: 'var(--le-ink)',
            }}
          >
            Request a change
          </h3>
          <p
            style={{
              margin: '0 0 16px 0',
              fontSize: 13.5,
              color: 'var(--le-muted)',
              lineHeight: 1.5,
            }}
          >
            One revision is included. Describe what you'd like adjusted.
          </p>
          <textarea
            className="studio-textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="Anything you'd like adjusted?"
            disabled={submitted}
            style={{ marginBottom: 12 }}
          />
          <button
            className="studio-cta-primary"
            onClick={submit}
            disabled={submitting || !note.trim() || submitted}
          >
            {submitted ? (
              <>
                <Check size={13} strokeWidth={2} />
                Submitted
              </>
            ) : submitting ? (
              <>
                <Loader2 size={13} className="studio-spinner" />
                Submitting…
              </>
            ) : (
              'Submit'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
