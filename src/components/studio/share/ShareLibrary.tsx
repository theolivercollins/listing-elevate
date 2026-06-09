import { Upload } from 'lucide-react';
import type { Creative } from '@/lib/share-api';
import { CreativeCard } from './CreativeCard';

/**
 * ShareLibrary — responsive grid of CreativeCards. Renders an empty state with
 * an upload CTA when there are no creatives yet.
 */
export function ShareLibrary({
  creatives,
  onSelect,
  onUploadClick,
}: {
  creatives: Creative[];
  onSelect: (creative: Creative) => void;
  onUploadClick: () => void;
}) {
  if (creatives.length === 0) {
    return (
      <div className="share-empty">
        <div className="share-empty-title">No creatives yet</div>
        <p className="share-empty-sub">
          Upload a video or image, or pull an existing rendered property video, then
          share it with a presentation link or embed.
        </p>
        <button type="button" className="studio-cta-primary" onClick={onUploadClick}>
          <Upload size={13} strokeWidth={2} />
          Upload a creative
        </button>
      </div>
    );
  }

  return (
    <div className="share-grid">
      {creatives.map((c) => (
        <CreativeCard key={c.id} creative={c} onSelect={onSelect} />
      ))}
    </div>
  );
}
