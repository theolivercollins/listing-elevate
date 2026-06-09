import { Eye, Film, Image as ImageIcon } from 'lucide-react';
import type { Creative } from '@/lib/share-api';

/**
 * CreativeCard — a single tile in the Share library grid.
 * Shows a poster/thumbnail, title, kind icon, view count and a visibility
 * badge. Clicking selects the creative (opens the settings drawer).
 */
export function CreativeCard({
  creative,
  onSelect,
}: {
  creative: Creative;
  onSelect: (creative: Creative) => void;
}) {
  const poster = creative.thumbnail_url ?? (creative.kind === 'image' ? creative.public_url : null);
  const KindIcon = creative.kind === 'image' ? ImageIcon : Film;

  return (
    <button
      type="button"
      className="share-card"
      onClick={() => onSelect(creative)}
      aria-label={`Open settings for ${creative.title}`}
    >
      <div className="share-card-poster">
        {poster ? (
          <img src={poster} alt="" loading="lazy" />
        ) : (
          <KindIcon size={28} strokeWidth={1.4} aria-hidden="true" />
        )}
        <span className="share-card-kind">
          <KindIcon size={11} strokeWidth={2} aria-hidden="true" />
          {creative.kind === 'image' ? 'Image' : 'Video'}
        </span>
      </div>
      <div className="share-card-body">
        <p className="share-card-title">{creative.title}</p>
        <div className="share-card-meta">
          <span
            className={`share-badge ${creative.visibility === 'public' ? 'public' : 'unlisted'}`}
          >
            {creative.visibility === 'public' ? 'Public' : 'Unlisted'}
          </span>
          <span className="share-card-views">
            <Eye size={12} strokeWidth={2} aria-hidden="true" />
            {creative.view_count}
          </span>
        </div>
      </div>
    </button>
  );
}
