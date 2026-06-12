import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import '../../styles/preview-design.css';

// ---------------------------------------------------------------------------
// LEPlayer — proprietary hand-rolled video player ("Vimeo inside LE").
//
// A pure, reusable controls layer over a native <video> with ZERO
// default-browser <video controls> chrome. Shared by the public watch page
// AND the Studio video hub. Styled entirely within preview-design.css
// (--pd-* tokens, Inter only, no monospace).
//
// The component is PURE: it tracks elapsed/duration and fires playback
// callbacks. Each callback fires at most once per MOUNT. Per-session-once
// dedupe + sessionStorage + sendBeacon live in the watch-page wiring, NOT
// here — keep the player reusable.
// ---------------------------------------------------------------------------

export type LEPlayerProps = {
  src: string;
  poster?: string;
  orientation?: 'horizontal' | 'vertical';
  /** Fired once on mount (page/player view). */
  onView?: () => void;
  /** Fired once, the first time playback starts in this mount. */
  onPlayFirst?: () => void;
  /** Fired once per threshold (25 | 50 | 75) when playback crosses it. */
  onProgress?: (milestone: 25 | 50 | 75) => void;
  /** Fired once when playback reaches the end. */
  onComplete?: () => void;
};

const PROGRESS_THRESHOLDS = [25, 50, 75] as const;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function LEPlayer({
  src,
  poster,
  orientation = 'horizontal',
  onView,
  onPlayFirst,
  onProgress,
  onComplete,
}: LEPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [started, setStarted] = useState(false);

  // Fire-once guards (per mount). Refs so re-renders never re-arm them.
  const viewedRef = useRef(false);
  const playFiredRef = useRef(false);
  const completeFiredRef = useRef(false);
  const milestonesRef = useRef<Set<number>>(new Set());
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── onView once on mount ──────────────────────────────────────────────
  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    onView?.();
    // onView is captured once; intentionally not in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-hide controls during playback ────────────────────────────────
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (playing) {
      hideTimer.current = setTimeout(() => setControlsVisible(false), 2600);
    }
  }, [playing]);

  useEffect(() => {
    revealControls();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [playing, revealControls]);

  // ── Fullscreen change listener ────────────────────────────────────────
  useEffect(() => {
    const onFsChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // ── Controls ──────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play?.();
    } else {
      v.pause?.();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const next = !v.muted;
    v.muted = next;
    setMuted(next);
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const v = videoRef.current;
    if (!v) return;
    const dur = Number.isFinite(v.duration) ? v.duration : duration;
    const clamped = Math.max(0, Math.min(seconds, dur || seconds));
    v.currentTime = clamped;
    setCurrent(clamped);
  }, [duration]);

  const nudge = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    seekTo((v.currentTime || 0) + delta);
  }, [seekTo]);

  const toggleFullscreen = useCallback(() => {
    const el = surfaceRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void el.requestFullscreen?.();
    }
  }, []);

  // ── Keyboard ──────────────────────────────────────────────────────────
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          nudge(5);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          nudge(-5);
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        default:
          return;
      }
      revealControls();
    },
    [togglePlay, nudge, toggleFullscreen, toggleMute, revealControls],
  );

  // ── Media element event handlers ──────────────────────────────────────
  const handlePlay = useCallback(() => {
    setPlaying(true);
    setStarted(true);
    if (!playFiredRef.current) {
      playFiredRef.current = true;
      onPlayFirst?.();
    }
  }, [onPlayFirst]);

  const handlePause = useCallback(() => setPlaying(false), []);

  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (v && Number.isFinite(v.duration)) setDuration(v.duration);
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const dur = Number.isFinite(v.duration) ? v.duration : 0;
    setCurrent(v.currentTime);
    if (dur > 0) {
      setDuration(dur);
      const pct = (v.currentTime / dur) * 100;
      for (const t of PROGRESS_THRESHOLDS) {
        if (pct >= t && !milestonesRef.current.has(t)) {
          milestonesRef.current.add(t);
          onProgress?.(t);
        }
      }
    }
  }, [onProgress]);

  const handleProgress = useCallback(() => {
    const v = videoRef.current;
    if (!v || v.buffered.length === 0) return;
    try {
      setBuffered(v.buffered.end(v.buffered.length - 1));
    } catch {
      /* buffered ranges can throw mid-load; ignore */
    }
  }, []);

  const handleEnded = useCallback(() => {
    setPlaying(false);
    if (!completeFiredRef.current) {
      completeFiredRef.current = true;
      onComplete?.();
    }
  }, [onComplete]);

  const handleVolumeChange = useCallback(() => {
    const v = videoRef.current;
    if (v) setMuted(v.muted);
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────
  const dur = duration || 0;
  const pct = dur > 0 ? (current / dur) * 100 : 0;
  const bufferedPct = dur > 0 ? Math.min(100, (buffered / dur) * 100) : 0;

  return (
    <div
      ref={surfaceRef}
      className={`le-player le-player--${orientation}${
        controlsVisible || !playing ? ' le-player--controls' : ''
      }${fullscreen ? ' le-player--fs' : ''}`}
      data-testid="le-player"
      data-orientation={orientation}
      tabIndex={0}
      role="region"
      aria-label="Video player"
      onKeyDown={onKeyDown}
      onMouseMove={revealControls}
    >
      <video
        ref={videoRef}
        className="le-player__video"
        data-testid="le-player-video"
        src={src}
        poster={poster}
        playsInline
        preload="metadata"
        onClick={togglePlay}
        onPlay={handlePlay}
        onPause={handlePause}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onProgress={handleProgress}
        onEnded={handleEnded}
        onVolumeChange={handleVolumeChange}
      />

      {/* Center play affordance — over the poster until first play. */}
      {!started && (
        <button
          type="button"
          className="le-player__center-play"
          data-testid="le-player-center-play"
          aria-label="Play video"
          onClick={togglePlay}
        >
          <Play size={28} strokeWidth={2.25} fill="currentColor" aria-hidden="true" />
        </button>
      )}

      {/* Control bar */}
      <div className="le-player__bar" data-testid="le-player-bar" aria-hidden={!controlsVisible}>
        <button
          type="button"
          className="le-player__btn"
          data-testid="le-player-playpause"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={togglePlay}
        >
          {playing ? (
            <Pause size={16} strokeWidth={2.25} fill="currentColor" aria-hidden="true" />
          ) : (
            <Play size={16} strokeWidth={2.25} fill="currentColor" aria-hidden="true" />
          )}
        </button>

        <div className="le-player__scrub" data-testid="le-player-scrub-track">
          <span className="le-player__scrub-buffered" style={{ width: `${bufferedPct}%` }} />
          <span className="le-player__scrub-played" style={{ width: `${pct}%` }} />
          <input
            type="range"
            className="le-player__scrubber"
            data-testid="le-player-scrubber"
            min={0}
            max={dur || 0}
            step="any"
            value={Math.min(current, dur || current)}
            aria-label="Seek"
            onChange={(e) => seekTo(Number(e.target.value))}
          />
        </div>

        <span className="le-player__time" data-testid="le-player-time">
          {formatTime(current)} / {formatTime(dur)}
        </span>

        <button
          type="button"
          className="le-player__btn"
          data-testid="le-player-mute"
          aria-label={muted ? 'Unmute' : 'Mute'}
          aria-pressed={muted}
          onClick={toggleMute}
        >
          {muted ? (
            <VolumeX size={16} strokeWidth={2.25} aria-hidden="true" />
          ) : (
            <Volume2 size={16} strokeWidth={2.25} aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          className="le-player__btn"
          data-testid="le-player-fullscreen"
          aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          onClick={toggleFullscreen}
        >
          {fullscreen ? (
            <Minimize size={16} strokeWidth={2.25} aria-hidden="true" />
          ) : (
            <Maximize size={16} strokeWidth={2.25} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
