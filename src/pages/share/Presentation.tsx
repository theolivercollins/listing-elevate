import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { useShareData } from './useShareData';
import '../../styles/share-public.css';

/**
 * Presentation — public viewer for /v/:token. No auth, no site shell.
 * Dark full-screen stage with the video/image, title, description, and an
 * optional download button. Renders a password gate, expired, and not-found
 * states. No emoji (project rule), sans-serif only.
 */
export default function Presentation() {
  const { token } = useParams<{ token: string }>();
  const { status, data, passwordError, submitPassword } = useShareData(token);
  const [pw, setPw] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (status === 'loading') {
    return (
      <div className="share-public le-dark">
        <div className="share-spinner" role="status" aria-label="Loading" />
      </div>
    );
  }

  if (status === 'expired') {
    return (
      <div className="share-public le-dark">
        <div className="share-card">
          <h1>This link has expired</h1>
          <p>The share link is no longer available. Ask the sender for a new one.</p>
        </div>
      </div>
    );
  }

  if (status === 'notfound' || status === 'embed_disabled' || status === 'error') {
    return (
      <div className="share-public le-dark">
        <div className="share-card">
          <h1>Not available</h1>
          <p>This share link could not be found.</p>
        </div>
      </div>
    );
  }

  if (status === 'password') {
    const onSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!pw || submitting) return;
      setSubmitting(true);
      await submitPassword(pw);
      setSubmitting(false);
    };
    return (
      <div className="share-public le-dark">
        <div className="share-card">
          <h1>Password required</h1>
          <p>This content is protected. Enter the password to continue.</p>
          <form className="share-form" onSubmit={onSubmit}>
            <input
              className="share-input"
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="Password"
              autoFocus
              autoComplete="current-password"
            />
            {passwordError && (
              <p className="share-error">Incorrect password. Please try again.</p>
            )}
            <button
              className="share-submit"
              type="submit"
              disabled={submitting || !pw}
            >
              {submitting ? 'Checking…' : 'Unlock'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // status === 'ok'
  if (!data) return null;

  return (
    <div className="share-public le-dark">
      <div className="share-stage">
        <div className="share-media">
          {data.kind === 'video' ? (
            <video
              src={data.playbackUrl}
              poster={data.posterUrl ?? undefined}
              controls
              playsInline
            />
          ) : (
            <img src={data.playbackUrl} alt={data.title} />
          )}
        </div>

        <div className="share-meta">
          <div className="share-meta-text">
            <h1 className="share-title">{data.title}</h1>
            {data.description && (
              <p className="share-description">{data.description}</p>
            )}
          </div>

          {data.downloadUrl && (
            <a
              className="share-download"
              href={data.downloadUrl}
              download
              rel="noopener"
            >
              <Download size={15} strokeWidth={2} />
              Download
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
