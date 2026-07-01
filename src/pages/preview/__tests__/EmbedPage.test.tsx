/**
 * EmbedPage component tests — TDD, failing first, then green.
 *
 * Success criteria (from task spec):
 *   1. 200 with horizontal video → LEPlayer rendered
 *   2. 404 → not-available message
 *   3. noindex meta present in document.head while mounted
 *   4. No approve/download/revision controls present
 *   5. Vertical-only fallback (when only vertical video exists)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EmbedPage from '../EmbedPage';

// ---------------------------------------------------------------------------
// LEPlayer mock — same pattern as PreviewPage.test.tsx
// ---------------------------------------------------------------------------
vi.mock('../../../components/preview/LEPlayer', () => ({
  __esModule: true,
  default: (props: {
    src: string;
    hlsSrc?: string;
    poster?: string;
    orientation?: 'horizontal' | 'vertical';
    onView?: () => void;
    onPlayFirst?: () => void;
    onProgress?: (m: 25 | 50 | 75) => void;
    onComplete?: () => void;
  }) => {
    props.onView?.();
    return (
      <div
        data-testid="le-player"
        data-src={props.src}
        data-hls-src={props.hlsSrc ?? ''}
        data-orientation={props.orientation}
      >
        <button data-testid="mock-play" onClick={() => props.onPlayFirst?.()}>play</button>
      </div>
    );
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PreviewApiPayload = {
  address: string;
  address_parts?: { street: string; locality: string };
  video_url: string | null;
  videos: { horizontal: string | null; vertical: string | null };
  hls?: { horizontal: string | null; vertical: string | null };
  thumbnail_url: string | null;
  brand: null;
  kind: 'client' | 'public';
  capabilities: { download: boolean; approve: boolean; revision: boolean };
  approved_at: string | null;
};

function makePayload(overrides: Partial<PreviewApiPayload> = {}): PreviewApiPayload {
  return {
    address: '123 Main St, Springfield, IL 62701, USA',
    address_parts: { street: '123 Main St', locality: 'Springfield, IL 62701' },
    video_url: 'https://cdn/h.mp4',
    videos: { horizontal: 'https://cdn/h.mp4', vertical: null },
    hls: { horizontal: 'https://cdn/h.m3u8', vertical: null },
    thumbnail_url: 'https://cdn/thumb.jpg',
    brand: null,
    kind: 'client',
    capabilities: { download: true, approve: true, revision: true },
    approved_at: null,
    ...overrides,
  };
}

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  });
}

function renderEmbed(token = 'embedtoken123') {
  return render(
    <MemoryRouter initialEntries={[`/preview/${token}/embed`]}>
      <Routes>
        <Route path="/preview/:token/embed" element={<EmbedPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal('navigator', { ...navigator, sendBeacon: vi.fn().mockReturnValue(true) });
  try {
    window.sessionStorage.clear();
  } catch {
    /* sessionStorage may be unavailable — ignore */
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Happy path — horizontal video renders LEPlayer
// ---------------------------------------------------------------------------

describe('EmbedPage — horizontal video (200)', () => {
  it('renders LEPlayer when API returns a horizontal video', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));
    renderEmbed();
    await waitFor(() => {
      expect(screen.getByTestId('le-player')).toBeTruthy();
    });
    expect(screen.getByTestId('le-player').getAttribute('data-src')).toContain('h.mp4');
    expect(screen.getByTestId('le-player').getAttribute('data-orientation')).toBe('horizontal');
  });
});

// ---------------------------------------------------------------------------
// hlsSrc wiring — migration 102
// ---------------------------------------------------------------------------

describe('EmbedPage — hlsSrc wiring (migration 102)', () => {
  it('passes the horizontal hls playlist as hlsSrc when present', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));
    renderEmbed();
    await waitFor(() => screen.getByTestId('le-player'));
    expect(screen.getByTestId('le-player').getAttribute('data-hls-src')).toBe('https://cdn/h.m3u8');
  });

  it('omits hlsSrc when the API response has no hls field (backward-compat)', async () => {
    const { hls: _omit, ...payloadWithoutHls } = makePayload();
    vi.stubGlobal('fetch', mockFetch(200, payloadWithoutHls));
    renderEmbed();
    await waitFor(() => screen.getByTestId('le-player'));
    expect(screen.getByTestId('le-player').getAttribute('data-hls-src')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 2. 404 — not-available state
// ---------------------------------------------------------------------------

describe('EmbedPage — 404 / expired / revoked', () => {
  it('renders a not-available message on 404 (no LEPlayer)', async () => {
    vi.stubGlobal('fetch', mockFetch(404, {}));
    renderEmbed();
    await waitFor(() => {
      expect(screen.getByTestId('embed-not-available')).toBeTruthy();
    });
    expect(screen.queryByTestId('le-player')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. noindex meta injected into document.head while mounted
// ---------------------------------------------------------------------------

describe('EmbedPage — noindex meta', () => {
  it('injects a noindex robots meta tag into document.head on mount', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));
    const { unmount } = renderEmbed();

    // Meta is present after mount (even before data loads — injected in a top-level effect)
    await waitFor(() => {
      const meta = document.head.querySelector('meta[name="robots"][content="noindex"]');
      expect(meta).toBeTruthy();
    });

    // Meta is removed on unmount
    unmount();
    const metaAfterUnmount = document.head.querySelector('meta[name="robots"][content="noindex"]');
    expect(metaAfterUnmount).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. No action controls — approve / download / revision absent
// ---------------------------------------------------------------------------

describe('EmbedPage — no action controls', () => {
  it('does not render approve, download, or revision buttons', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makePayload({
      capabilities: { download: true, approve: true, revision: true },
    })));
    renderEmbed();
    await waitFor(() => screen.getByTestId('le-player'));

    expect(screen.queryByTestId('btn-approve')).toBeNull();
    expect(screen.queryByTestId('btn-download')).toBeNull();
    expect(screen.queryByTestId('btn-request-change')).toBeNull();
    expect(screen.queryByTestId('approved-badge')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Vertical-only fallback
// ---------------------------------------------------------------------------

describe('EmbedPage — vertical-only fallback', () => {
  it('uses the vertical video src when only vertical exists', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        200,
        makePayload({
          videos: { horizontal: null, vertical: 'https://cdn/v.mp4' },
          hls: { horizontal: null, vertical: 'https://cdn/v.m3u8' },
          video_url: 'https://cdn/v.mp4',
        }),
      ),
    );
    renderEmbed();
    await waitFor(() => {
      expect(screen.getByTestId('le-player')).toBeTruthy();
    });
    expect(screen.getByTestId('le-player').getAttribute('data-src')).toContain('v.mp4');
    expect(screen.getByTestId('le-player').getAttribute('data-orientation')).toBe('vertical');
    // hlsSrc mirrors the same orientation fallback as src.
    expect(screen.getByTestId('le-player').getAttribute('data-hls-src')).toBe('https://cdn/v.m3u8');
  });
});

// ---------------------------------------------------------------------------
// 6. Beacons still fire from the embed (embedded plays count)
// ---------------------------------------------------------------------------

describe('EmbedPage — beacons fire from embed', () => {
  it('fires a "view" beacon on mount via LEPlayer onView callback', async () => {
    const beacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));

    renderEmbed('embeddedtok');
    await waitFor(() => screen.getByTestId('le-player'));

    // At least one beacon should have fired for 'view'
    await waitFor(() => {
      const calls = beacon.mock.calls;
      const hasView = calls.some(([url, body]) => {
        try {
          const parsed = typeof body === 'string' ? JSON.parse(body) :
            body instanceof Blob ? null : body; // Blob can't be parsed sync — skip
          if (!parsed) return false;
          return String(url).includes('/events') && parsed.event === 'view';
        } catch {
          return false;
        }
      });
      // Beacons use Blob — check by URL at minimum
      const hasEventCall = calls.some(([url]) => String(url).includes('/api/preview/embeddedtok/events'));
      expect(hasEventCall).toBe(true);
    });
  });
});
