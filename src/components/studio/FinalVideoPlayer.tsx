/**
 * FinalVideoPlayer — the single source of truth for rendering a finished
 * property video anywhere in Studio (Checkpoint B review, the Output card).
 *
 * Prefers the Bunny Stream iframe embed when the video was hosted on Bunny
 * (built-in adaptive-quality menu up to 1080p — this is the "load full
 * quality" affordance the founder asked for). Falls back to a direct
 * HlsPlayer for legacy/un-rehosted rows, preferring the progressive MP4 over
 * the HLS playlist: hls.js's zero-config ABR starts at a low rendition and
 * looks blurry, while the MP4 is always the sharp, fixed-quality source.
 *
 * Callers are responsible for only rendering ONE FinalVideoPlayer per video
 * on a page at a time — see PropertyCommandCenter's dedupe logic between the
 * Checkpoint B card and the Output card.
 */

import type { CSSProperties } from 'react';
import HlsPlayer from '@/components/preview/HlsPlayer';

export interface FinalVideoPlayerProps {
  /** Bunny iframe embed URL (from the bundle's final_video.{horizontal,vertical}.embed_url). Null when the video isn't Bunny-hosted. */
  embedUrl: string | null;
  /** Progressive mp4 fallback — always the safe, directly-fetchable source. */
  mp4Url: string | null;
  /** Bunny adaptive HLS playlist fallback — only used when mp4Url is absent. */
  hlsUrl?: string | null;
  posterUrl?: string | null;
  /** Accessible iframe title; also doubles as an aria-label for the fallback video. */
  title: string;
  /** Aspect ratio for the responsive iframe container. Default 16:9. */
  aspect?: '16:9' | '9:16';
  style?: CSSProperties;
}

export function FinalVideoPlayer({
  embedUrl,
  mp4Url,
  hlsUrl,
  posterUrl,
  title,
  aspect = '16:9',
  style,
}: FinalVideoPlayerProps) {
  if (embedUrl) {
    const paddingTop = aspect === '9:16' ? '177.78%' : '56.25%';
    return (
      <div
        style={{
          position: 'relative',
          width: '100%',
          paddingTop,
          borderRadius: 'var(--le-r-sm)',
          overflow: 'hidden',
          background: '#000',
          ...style,
        }}
      >
        <iframe
          src={embedUrl}
          title={title}
          loading="lazy"
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
        />
      </div>
    );
  }

  // Fallback: no Bunny embed available (non-Bunny provider URL — see
  // deriveBunnyGuid in lib/providers/bunny-stream.ts). Prefer the
  // progressive mp4 over HLS so this path is always sharp.
  const fallbackSrc = mp4Url ?? hlsUrl ?? null;
  if (fallbackSrc) {
    return (
      <HlsPlayer
        src={fallbackSrc}
        poster={posterUrl ?? undefined}
        preload="metadata"
        playsInline
        style={{ width: '100%', maxHeight: 400, borderRadius: 'var(--le-r-sm)', background: '#000', ...style }}
      />
    );
  }

  return (
    <div
      style={{
        height: 160,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--le-surface-2, rgba(0,0,0,.04))',
        borderRadius: 'var(--le-r-sm)',
        fontSize: 12.5,
        color: 'var(--le-muted)',
        ...style,
      }}
    >
      Video processing — refresh in a moment.
    </div>
  );
}

export default FinalVideoPlayer;
