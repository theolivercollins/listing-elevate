import { useParams } from 'react-router-dom';
import { useShareData } from './useShareData';
import '../../styles/share-public.css';

/**
 * Embed — bare, chrome-less iframe viewer for /embed/:token. No site shell, no
 * title chrome. Just the video/image filling a responsive frame. Fetches with
 * ?ctx=embed so the API enforces allow_embed (403 → 'embed_disabled').
 */
export default function Embed() {
  const { token } = useParams<{ token: string }>();
  const { status, data } = useShareData(token, { embed: true });

  if (status === 'loading') {
    return (
      <div className="share-embed le-dark">
        <div className="share-spinner" role="status" aria-label="Loading" />
      </div>
    );
  }

  if (status === 'embed_disabled') {
    return (
      <div className="share-embed le-dark">
        <p className="share-embed-message">Embedding is disabled for this video.</p>
      </div>
    );
  }

  // Password-protected creatives are not unlocked inside an iframe — point the
  // viewer at the full share page rather than showing a generic error.
  if (status === 'password') {
    return (
      <div className="share-embed le-dark">
        <p className="share-embed-message">
          {token ? (
            <a href={`/v/${token}`} target="_blank" rel="noreferrer">
              This video is password-protected — open it here.
            </a>
          ) : (
            'This video is password-protected.'
          )}
        </p>
      </div>
    );
  }

  if (status === 'expired') {
    return (
      <div className="share-embed le-dark">
        <p className="share-embed-message">This link has expired.</p>
      </div>
    );
  }

  if (status !== 'ok' || !data) {
    return (
      <div className="share-embed le-dark">
        <p className="share-embed-message">This content is not available.</p>
      </div>
    );
  }

  return (
    <div className="share-embed le-dark">
      <div className="share-embed-frame">
        {data.embedUrl ? (
          <iframe
            src={data.embedUrl}
            title={data.title}
            loading="lazy"
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : data.kind === 'video' ? (
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
    </div>
  );
}
