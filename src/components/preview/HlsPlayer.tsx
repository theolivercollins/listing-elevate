import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type Hls from 'hls.js';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// HlsPlayer — a drop-in replacement for <video src controls> that adds HLS
// playback, an instant poster, and a leak-free hls.js lifecycle. Built for
// operator surfaces (Studio scene review, video hubs) — keeps native browser
// controls rather than a custom skin. For the branded public-facing player
// with a fully custom control bar, see LEPlayer.tsx in this same folder.
//
// Source handling:
//   - Plain files (.mp4 etc)       -> native <video src> attribute, no hls.js.
//   - .m3u8 on native-HLS browsers -> same: native <video src> attribute
//                                     (Safari plays HLS manifests directly).
//   - .m3u8 everywhere else        -> dynamic import('hls.js'); MediaSource-
//                                     backed playback via an Hls instance.
//
// The Hls instance is destroyed both on unmount AND on every src change —
// both are handled by the same effect (keyed on `src`), since React always
// runs an effect's cleanup before re-running it on a dep change. This is the
// fix for the classic hls.js "multi-mount" memory leak.
//
// Always renders a real <video> with `poster` so a thumbnail frame shows
// instantly instead of a blank box, plus the given `preload`. Styled with the
// existing `studio-video` class + --le-* tokens — no new CSS, no monospace.
// ---------------------------------------------------------------------------

export type HlsPlayerProps = {
  src: string;
  poster?: string;
  preload?: 'none' | 'metadata' | 'auto';
  controls?: boolean;
  muted?: boolean;
  playsInline?: boolean;
  loop?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onError?: () => void;
};

// Native HLS support (Safari + some mobile browsers) is a fixed browser
// capability that never changes mid-session, so detect it once per page load
// rather than once per mount — avoids creating a throwaway <video> element
// for every player in a grid/list.
let nativeHlsSupportCache: boolean | null = null;
function supportsNativeHls(): boolean {
  if (nativeHlsSupportCache !== null) return nativeHlsSupportCache;
  if (typeof document === 'undefined') return false;
  const probe = document.createElement('video');
  nativeHlsSupportCache =
    typeof probe.canPlayType === 'function' &&
    probe.canPlayType('application/vnd.apple.mpegurl') !== '';
  return nativeHlsSupportCache;
}

export default function HlsPlayer({
  src,
  poster,
  preload = 'none',
  controls = true,
  muted,
  playsInline,
  loop,
  className,
  style,
  onError,
}: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onErrorRef = useRef(onError);

  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const [usingHlsJs, setUsingHlsJs] = useState(false);

  // Keep the latest onError available to the hls.js error listener below
  // without making it a dependency of the attach/teardown effect — that
  // effect must only re-run when `src` actually changes, never on every
  // parent re-render that happens to pass a fresh inline callback.
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const isHlsSource = src.endsWith('.m3u8');
  // Plain files and Safari's native HLS both just need the `src` attribute —
  // only non-Safari + .m3u8 needs the hls.js/MediaSource path below.
  const direct = !isHlsSource || supportsNativeHls();

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    setMetadataLoaded(false);
    setUsingHlsJs(false);

    if (direct) return undefined;

    let hls: Hls | null = null;
    let cancelled = false;

    import('hls.js')
      .then((mod) => {
        if (cancelled) return;
        const HlsCtor = mod.default;
        if (!HlsCtor.isSupported()) {
          // No native HLS, no MediaSource — last-resort attempt so playback
          // at least tries, and surface it as an error to the caller.
          video.src = src;
          onErrorRef.current?.();
          return;
        }
        hls = new HlsCtor();
        hls.on(HlsCtor.Events.ERROR, (_event, data) => {
          if (data?.fatal) onErrorRef.current?.();
        });
        hls.loadSource(src);
        hls.attachMedia(video);
        setUsingHlsJs(true);
      })
      .catch(() => {
        if (!cancelled) {
          video.src = src;
          onErrorRef.current?.();
        }
      });

    // CRITICAL: destroy the hls.js instance on cleanup AND on src change.
    // This effect re-runs (cleanup, then re-setup) every time `src` changes,
    // so this one return covers both cases — the fix for the known hls.js
    // multi-mount memory leak.
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [src, direct]);

  const handleLoadedMetadata = useCallback(() => setMetadataLoaded(true), []);

  const handleVideoError = useCallback(() => {
    setMetadataLoaded(true); // stop showing the loading overlay on a broken source too
    onError?.();
  }, [onError]);

  // Only show the loading overlay when something is actually being fetched.
  // hls.js always loads eagerly once attached, but a plain/native <video>
  // with preload="none" (the default) never fetches until the user presses
  // play — showing a spinner in that idle state would look permanently
  // stuck, which is worse than the blank box this component exists to avoid.
  const showLoadingOverlay = !metadataLoaded && (usingHlsJs || preload !== 'none');

  return (
    <div style={{ position: 'relative', width: '100%', display: 'block' }} data-testid="hls-player">
      <video
        ref={videoRef}
        className={cn('studio-video', className)}
        style={style}
        data-testid="hls-player-video"
        poster={poster}
        controls={controls}
        muted={muted}
        playsInline={playsInline}
        loop={loop}
        preload={preload}
        src={direct ? src : undefined}
        onLoadedMetadata={handleLoadedMetadata}
        onError={handleVideoError}
      />
      {showLoadingOverlay && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          {/* Media chrome is always a dark surface regardless of app theme
              (see "Media chrome stays dark" in studio-design.css), so the
              spinner uses a fixed light color rather than a theme token. */}
          <Loader2 size={22} className="studio-spinner" style={{ color: 'rgba(255,255,255,0.85)' }} />
        </div>
      )}
    </div>
  );
}
