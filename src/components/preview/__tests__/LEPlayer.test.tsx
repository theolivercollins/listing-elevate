/**
 * LEPlayer component tests — TDD, failing first, then green.
 *
 * Spec §3: proprietary hand-rolled player over native <video>, ZERO
 * default-browser controls chrome, LE-styled control bar, auto-hiding
 * controls, keyboard (space / arrows / f / m), playsInline.
 *
 * The player is PURE/reusable: it tracks elapsed/duration and fires
 * playback callbacks (onView, onPlayFirst, onProgress, onComplete).
 * Each milestone fires at most once per MOUNT here; per-session-once +
 * sessionStorage lives in the watch-page wiring, NOT in this component.
 *
 * happy-dom does not implement HTMLMediaElement play/pause/requestFullscreen,
 * so we stub them on the prototype and drive currentTime/duration manually,
 * dispatching real timeupdate/ended events to simulate playback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import LEPlayer from '../LEPlayer';

// ---------------------------------------------------------------------------
// HTMLMediaElement / fullscreen stubs (happy-dom has none)
// ---------------------------------------------------------------------------

let playSpy: ReturnType<typeof vi.fn>;
let pauseSpy: ReturnType<typeof vi.fn>;
let requestFullscreenSpy: ReturnType<typeof vi.fn>;
let exitFullscreenSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  playSpy = vi.fn().mockResolvedValue(undefined);
  pauseSpy = vi.fn();
  requestFullscreenSpy = vi.fn().mockResolvedValue(undefined);
  exitFullscreenSpy = vi.fn().mockResolvedValue(undefined);

  HTMLMediaElement.prototype.play = playSpy as unknown as HTMLMediaElement['play'];
  HTMLMediaElement.prototype.pause = pauseSpy as unknown as HTMLMediaElement['pause'];
  // requestFullscreen lives on Element in spec; happy-dom omits it.
  (Element.prototype as unknown as { requestFullscreen: unknown }).requestFullscreen =
    requestFullscreenSpy;
  (document as unknown as { exitFullscreen: unknown }).exitFullscreen = exitFullscreenSpy;
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    writable: true,
    value: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getVideo(): HTMLVideoElement {
  return screen.getByTestId('le-player-video') as HTMLVideoElement;
}

/** Force a duration + currentTime on the stubbed video and dispatch timeupdate. */
function drive(video: HTMLVideoElement, currentTime: number, duration = 100) {
  Object.defineProperty(video, 'duration', { configurable: true, value: duration });
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    writable: true,
    value: currentTime,
  });
  act(() => {
    video.dispatchEvent(new Event('timeupdate'));
  });
}

function renderPlayer(props: Partial<React.ComponentProps<typeof LEPlayer>> = {}) {
  return render(
    <LEPlayer
      src="https://cdn/film.mp4"
      poster="https://cdn/poster.jpg"
      orientation="horizontal"
      {...props}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LEPlayer', () => {
  it('renders a native <video> WITHOUT the default controls attribute', () => {
    renderPlayer();
    const video = getVideo();
    expect(video.tagName).toBe('VIDEO');
    expect(video.hasAttribute('controls')).toBe(false);
    expect(video.hasAttribute('playsinline')).toBe(true);
  });

  it('play/pause toggle invokes the media element play() then pause()', () => {
    renderPlayer();
    const toggle = screen.getByTestId('le-player-playpause');

    fireEvent.click(toggle);
    expect(playSpy).toHaveBeenCalledTimes(1);

    // Simulate the element entering the playing state. happy-dom's stub
    // never flips `paused`, so set it explicitly before dispatching play.
    Object.defineProperty(getVideo(), 'paused', { configurable: true, value: false });
    act(() => {
      getVideo().dispatchEvent(new Event('play'));
    });

    fireEvent.click(toggle);
    expect(pauseSpy).toHaveBeenCalledTimes(1);
  });

  it('seeking via the scrubber updates the video currentTime', () => {
    renderPlayer();
    const video = getVideo();
    Object.defineProperty(video, 'duration', { configurable: true, value: 100 });
    act(() => {
      video.dispatchEvent(new Event('loadedmetadata'));
    });

    const scrubber = screen.getByTestId('le-player-scrubber') as HTMLInputElement;
    fireEvent.change(scrubber, { target: { value: '42' } });

    expect(video.currentTime).toBe(42);
  });

  it('mute button toggles the video muted property', () => {
    renderPlayer();
    const video = getVideo();
    const muteBtn = screen.getByTestId('le-player-mute');

    expect(video.muted).toBe(false);
    fireEvent.click(muteBtn);
    expect(video.muted).toBe(true);
    fireEvent.click(muteBtn);
    expect(video.muted).toBe(false);
  });

  it('fullscreen button requests fullscreen', () => {
    renderPlayer();
    fireEvent.click(screen.getByTestId('le-player-fullscreen'));
    expect(requestFullscreenSpy).toHaveBeenCalledTimes(1);
  });

  it('keyboard: Space toggles play/pause', () => {
    renderPlayer();
    const surface = screen.getByTestId('le-player');
    fireEvent.keyDown(surface, { key: ' ' });
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('keyboard: ArrowRight seeks +5s and ArrowLeft seeks -5s', () => {
    renderPlayer();
    const video = getVideo();
    const surface = screen.getByTestId('le-player');
    Object.defineProperty(video, 'duration', { configurable: true, value: 100 });
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      writable: true,
      value: 10,
    });

    fireEvent.keyDown(surface, { key: 'ArrowRight' });
    expect(video.currentTime).toBe(15);

    fireEvent.keyDown(surface, { key: 'ArrowLeft' });
    expect(video.currentTime).toBe(10);
  });

  it('keyboard: f requests fullscreen and m toggles mute', () => {
    renderPlayer();
    const video = getVideo();
    const surface = screen.getByTestId('le-player');

    fireEvent.keyDown(surface, { key: 'f' });
    expect(requestFullscreenSpy).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(surface, { key: 'm' });
    expect(video.muted).toBe(true);
  });

  it('fires onView exactly once on mount', () => {
    const onView = vi.fn();
    const { rerender } = renderPlayer({ onView });
    expect(onView).toHaveBeenCalledTimes(1);
    // A re-render must not re-fire it.
    rerender(
      <LEPlayer src="https://cdn/film.mp4" poster="x" orientation="horizontal" onView={onView} />,
    );
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('fires onPlayFirst exactly once even across multiple plays', () => {
    const onPlayFirst = vi.fn();
    renderPlayer({ onPlayFirst });
    const video = getVideo();

    act(() => video.dispatchEvent(new Event('play')));
    act(() => video.dispatchEvent(new Event('pause')));
    act(() => video.dispatchEvent(new Event('play')));

    expect(onPlayFirst).toHaveBeenCalledTimes(1);
  });

  it('fires each progress milestone exactly once at its threshold', () => {
    const onProgress = vi.fn();
    renderPlayer({ onProgress });
    const video = getVideo();

    drive(video, 10); // 10% — below first threshold
    expect(onProgress).not.toHaveBeenCalled();

    drive(video, 25); // 25%
    expect(onProgress).toHaveBeenCalledWith(25);

    drive(video, 30); // still past 25 — must not re-fire 25
    expect(onProgress).toHaveBeenCalledTimes(1);

    drive(video, 50);
    expect(onProgress).toHaveBeenCalledWith(50);

    drive(video, 75);
    expect(onProgress).toHaveBeenCalledWith(75);

    // 100% is delivered via onComplete, not onProgress.
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([25, 50, 75]);
  });

  it('fires onComplete once when the video ends', () => {
    const onComplete = vi.fn();
    renderPlayer({ onComplete });
    const video = getVideo();

    act(() => video.dispatchEvent(new Event('ended')));
    expect(onComplete).toHaveBeenCalledTimes(1);

    // Re-ending (e.g. loop) must not re-fire within the same mount.
    act(() => video.dispatchEvent(new Event('ended')));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('renders elapsed and total time with the tabular-nums class', () => {
    renderPlayer();
    const time = screen.getByTestId('le-player-time');
    expect(time).toHaveClass('le-player__time');
  });
});
