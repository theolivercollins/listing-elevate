/**
 * PreviewPage component tests — TDD, failing first, then green.
 *
 * Spec §4: capability-conditional rendering, orientation toggle,
 * approved_at state, public kind hiding all action controls,
 * rendering-in-progress state, 404/expired state.
 *
 * Tests use MSW-free fetch stubbing (vi.stubGlobal) consistent with
 * the rest of the src/ test suite.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PreviewPage from '../PreviewPage';

// ---------------------------------------------------------------------------
// LEPlayer mock — exposes one button per playback callback so the watch-page
// beacon wiring can be driven deterministically without a real <video>.
// onView is invoked on mount (mirrors the real player's fire-once-on-mount).
// ---------------------------------------------------------------------------
const leViewSpy = vi.fn();
vi.mock('../../../components/preview/LEPlayer', () => ({
  __esModule: true,
  default: (props: {
    src: string;
    poster?: string;
    orientation?: 'horizontal' | 'vertical';
    onView?: () => void;
    onPlayFirst?: () => void;
    onProgress?: (m: 25 | 50 | 75) => void;
    onComplete?: () => void;
  }) => {
    leViewSpy(props.src, props.orientation);
    props.onView?.();
    return (
      <div data-testid="le-player" data-src={props.src} data-orientation={props.orientation}>
        <button data-testid="mock-play" onClick={() => props.onPlayFirst?.()}>play</button>
        <button data-testid="mock-p25" onClick={() => props.onProgress?.(25)}>p25</button>
        <button data-testid="mock-p50" onClick={() => props.onProgress?.(50)}>p50</button>
        <button data-testid="mock-p75" onClick={() => props.onProgress?.(75)}>p75</button>
        <button data-testid="mock-complete" onClick={() => props.onComplete?.()}>complete</button>
      </div>
    );
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PreviewApiPayload = {
  address: string;
  address_parts: { street: string; locality: string };
  video_url: string | null;
  videos: { horizontal: string | null; vertical: string | null };
  thumbnail_url: string | null;
  brand: {
    logo: string | null;
    agent_name: string | null;
    name: string;
    headshot: string | null;
    brokerage: string | null;
  } | null;
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

function renderPreview(token = 'sometoken123') {
  return render(
    <MemoryRouter initialEntries={[`/preview/${token}`]}>
      <Routes>
        <Route path="/preview/:token" element={<PreviewPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  leViewSpy.mockClear();
  // Default: a no-op sendBeacon so beacons never hit the real network in
  // tests that don't explicitly assert on them. Tests that DO assert override
  // this stub with their own spy.
  vi.stubGlobal('navigator', { ...navigator, sendBeacon: vi.fn().mockReturnValue(true) });
  // Each test starts with a clean session so per-session dedupe is deterministic.
  try {
    window.sessionStorage.clear();
  } catch {
    /* sessionStorage may be unavailable in some envs — ignore */
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Loading / 404 / expired states
// ---------------------------------------------------------------------------

describe('PreviewPage — 404 / expired state', () => {
  it('renders the expired/not-found state on 404 response', async () => {
    vi.stubGlobal('fetch', mockFetch(404, {}));
    renderPreview();
    await waitFor(() => {
      expect(screen.getByTestId('preview-not-found')).toBeTruthy();
    });
  });

  it('expired state does not show action buttons', async () => {
    vi.stubGlobal('fetch', mockFetch(404, {}));
    renderPreview();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /request/i })).toBeNull();
    });
  });
});

describe('PreviewPage — rendering-in-progress state', () => {
  it('renders the in-progress state when video_url and videos are null', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        200,
        makePayload({ video_url: null, videos: { horizontal: null, vertical: null } }),
      ),
    );
    renderPreview();
    await waitFor(() => {
      expect(screen.getByTestId('preview-rendering')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Capability flags — Download
// ---------------------------------------------------------------------------

describe('PreviewPage — Download capability', () => {
  it('shows Download button when capabilities.download is true', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));
    renderPreview();
    await waitFor(() => {
      expect(screen.getByTestId('btn-download')).toBeTruthy();
    });
  });

  it('hides Download button when capabilities.download is false', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, makePayload({ capabilities: { download: false, approve: true, revision: true } })),
    );
    renderPreview();
    await waitFor(() => {
      expect(screen.queryByTestId('btn-download')).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Capability flags — Approve
// ---------------------------------------------------------------------------

describe('PreviewPage — Approve capability', () => {
  it('shows Approve button when capabilities.approve is true and not yet approved', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));
    renderPreview();
    await waitFor(() => {
      expect(screen.getByTestId('btn-approve')).toBeTruthy();
    });
  });

  it('hides Approve button when capabilities.approve is false', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, makePayload({ capabilities: { download: true, approve: false, revision: true } })),
    );
    renderPreview();
    await waitFor(() => {
      expect(screen.queryByTestId('btn-approve')).toBeNull();
    });
  });

  it('shows "Approved" confirmed state instead of button when approved_at is set', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        200,
        makePayload({ approved_at: '2026-06-11T10:00:00Z', capabilities: { download: true, approve: true, revision: true } }),
      ),
    );
    renderPreview();
    await waitFor(() => {
      // Approve button replaced by a confirmed state
      expect(screen.queryByTestId('btn-approve')).toBeNull();
      expect(screen.getByTestId('approved-badge')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Capability flags — Request a change
// ---------------------------------------------------------------------------

describe('PreviewPage — Revision capability', () => {
  it('shows Request-a-change button when capabilities.revision is true', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));
    renderPreview();
    await waitFor(() => {
      expect(screen.getByTestId('btn-request-change')).toBeTruthy();
    });
  });

  it('hides Request-a-change button when capabilities.revision is false', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, makePayload({ capabilities: { download: true, approve: true, revision: false } })),
    );
    renderPreview();
    await waitFor(() => {
      expect(screen.queryByTestId('btn-request-change')).toBeNull();
    });
  });

  it('reveals the note textarea when Request-a-change is clicked', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));
    renderPreview();
    await waitFor(() => screen.getByTestId('btn-request-change'));

    // Note box is hidden initially
    expect(screen.queryByTestId('change-note-box')).toBeNull();

    fireEvent.click(screen.getByTestId('btn-request-change'));
    expect(screen.getByTestId('change-note-box')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 5. Public kind — zero action buttons
// ---------------------------------------------------------------------------

describe('PreviewPage — public kind', () => {
  it('shows no action buttons (download/approve/request-change) for public links', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        200,
        makePayload({
          kind: 'public',
          capabilities: { download: false, approve: false, revision: false },
        }),
      ),
    );
    renderPreview();
    await waitFor(() => {
      // Page has loaded (has content)
      expect(screen.getByTestId('preview-address')).toBeTruthy();
    });
    // None of the action controls present
    expect(screen.queryByTestId('btn-download')).toBeNull();
    expect(screen.queryByTestId('btn-approve')).toBeNull();
    expect(screen.queryByTestId('btn-request-change')).toBeNull();
    expect(screen.queryByTestId('approved-badge')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Orientation toggle
// ---------------------------------------------------------------------------

describe('PreviewPage — orientation toggle', () => {
  it('does NOT show the orientation toggle when only horizontal exists', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, makePayload({ videos: { horizontal: 'https://cdn/h.mp4', vertical: null } })),
    );
    renderPreview();
    await waitFor(() => screen.getByTestId('preview-address'));
    expect(screen.queryByTestId('orientation-toggle')).toBeNull();
  });

  it('does NOT show the orientation toggle when only vertical exists', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, makePayload({ videos: { horizontal: null, vertical: 'https://cdn/v.mp4' }, video_url: 'https://cdn/v.mp4' })),
    );
    renderPreview();
    await waitFor(() => screen.getByTestId('preview-address'));
    expect(screen.queryByTestId('orientation-toggle')).toBeNull();
  });

  it('shows the orientation toggle when both horizontal and vertical exist', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        200,
        makePayload({ videos: { horizontal: 'https://cdn/h.mp4', vertical: 'https://cdn/v.mp4' } }),
      ),
    );
    renderPreview();
    await waitFor(() => {
      expect(screen.getByTestId('orientation-toggle')).toBeTruthy();
    });
  });

  it('swaps the video player src when toggle is clicked from Wide to Vertical', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        200,
        makePayload({ videos: { horizontal: 'https://cdn/h.mp4', vertical: 'https://cdn/v.mp4' } }),
      ),
    );
    renderPreview();
    await waitFor(() => screen.getByTestId('orientation-toggle'));

    // Initially shows horizontal — the LEPlayer mock exposes src via data-src
    expect(screen.getByTestId('le-player').getAttribute('data-src')).toContain('h.mp4');

    // Click the Vertical pill
    fireEvent.click(screen.getByTestId('toggle-vertical'));
    await waitFor(() => {
      expect(screen.getByTestId('le-player').getAttribute('data-src')).toContain('v.mp4');
    });

    // Click Wide again
    fireEvent.click(screen.getByTestId('toggle-wide'));
    await waitFor(() => {
      expect(screen.getByTestId('le-player').getAttribute('data-src')).toContain('h.mp4');
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Layout content — address, brand row, footer
// ---------------------------------------------------------------------------

describe('PreviewPage — layout', () => {
  it('renders the street address as the headline', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));
    renderPreview();
    await waitFor(() => {
      expect(screen.getByTestId('preview-address')).toBeTruthy();
      expect(screen.getByTestId('preview-address').textContent).toContain('123 Main St');
    });
  });

  it('renders the locality as a quiet sub-line', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));
    renderPreview();
    await waitFor(() => {
      expect(screen.getByTestId('preview-locality').textContent).toContain('Springfield, IL 62701');
    });
  });

  it('renders brand logo when brand.logo is present', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        200,
        makePayload({ brand: { logo: 'https://cdn/logo.png', agent_name: 'Abby', name: 'Helgemo Team', headshot: null, brokerage: null } }),
      ),
    );
    renderPreview();
    await waitFor(() => {
      const logo = screen.getByTestId('brand-logo') as HTMLImageElement;
      expect(logo.src).toContain('logo.png');
    });
  });

  it('renders typographic agent-name lockup when no logo', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        200,
        makePayload({ brand: { logo: null, agent_name: 'Abby Smith', name: 'Helgemo Team', headshot: null, brokerage: null } }),
      ),
    );
    renderPreview();
    await waitFor(() => {
      expect(screen.queryByTestId('brand-logo')).toBeNull();
      expect(screen.getByTestId('brand-name-lockup').textContent).toContain('Abby Smith');
    });
  });

  it('renders "Crafted with Listing Elevate" footer', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));
    renderPreview();
    await waitFor(() => {
      expect(screen.getByTestId('footer-attribution').textContent).toContain('Listing Elevate');
    });
  });
});

// ---------------------------------------------------------------------------
// 8. Presented-by row
// ---------------------------------------------------------------------------

describe('PreviewPage — presented-by row', () => {
  it('shows headshot when brand.headshot is present', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        200,
        makePayload({
          brand: { logo: null, agent_name: 'Abby', name: 'Helgemo', headshot: 'https://cdn/head.jpg', brokerage: 'RE/MAX' },
        }),
      ),
    );
    renderPreview();
    await waitFor(() => {
      const img = screen.getByTestId('agent-headshot') as HTMLImageElement;
      expect(img.src).toContain('head.jpg');
    });
  });

  it('shows brokerage name in presented-by row', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        200,
        makePayload({
          brand: { logo: null, agent_name: 'Abby', name: 'Helgemo', headshot: null, brokerage: 'Keller Williams' },
        }),
      ),
    );
    renderPreview();
    await waitFor(() => {
      expect(screen.getByTestId('presented-by-row').textContent).toContain('Keller Williams');
    });
  });

  it('does not render presented-by row when brand is null', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makePayload({ brand: null })));
    renderPreview();
    await waitFor(() => screen.getByTestId('preview-address'));
    expect(screen.queryByTestId('presented-by-row')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. Proprietary player + watch-page beacons (T10)
// ---------------------------------------------------------------------------

/** Parse the JSON body passed to sendBeacon (string | Blob | object). */
async function readBeacon(arg: unknown): Promise<Record<string, unknown>> {
  if (typeof arg === 'string') return JSON.parse(arg);
  if (arg instanceof Blob) return JSON.parse(await arg.text());
  return arg as Record<string, unknown>;
}

/** Collect the (url, parsedBody) pairs from every sendBeacon call. */
async function beaconCalls(spy: ReturnType<typeof vi.fn>) {
  return Promise.all(
    spy.mock.calls.map(async ([url, body]) => ({ url: String(url), body: await readBeacon(body) })),
  );
}

describe('PreviewPage — proprietary player', () => {
  it('renders LEPlayer and leaves NO native <video controls> in the DOM', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));
    const { container } = renderPreview();
    await waitFor(() => screen.getByTestId('le-player'));
    // No raw native-controls <video> remains on the page.
    expect(container.querySelector('video[controls]')).toBeNull();
    expect(screen.queryByTestId('video-player')).toBeNull();
  });
});

describe('PreviewPage — watch-page beacons', () => {
  it('fires a "view" beacon on mount carrying a stable session_id', async () => {
    const beacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));

    renderPreview('viewtok');
    await waitFor(() => screen.getByTestId('le-player'));

    const calls = await beaconCalls(beacon);
    const view = calls.find((c) => c.body.event === 'view');
    expect(view).toBeTruthy();
    expect(view!.url).toContain('/api/preview/viewtok/events');
    expect(typeof view!.body.session_id).toBe('string');
    expect((view!.body.session_id as string).length).toBeGreaterThan(0);
  });

  it('the same session_id is reused across view + play + progress + complete', async () => {
    const beacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));

    renderPreview();
    await waitFor(() => screen.getByTestId('le-player'));

    fireEvent.click(screen.getByTestId('mock-play'));
    fireEvent.click(screen.getByTestId('mock-p25'));
    fireEvent.click(screen.getByTestId('mock-complete'));

    const calls = await beaconCalls(beacon);
    const ids = new Set(calls.map((c) => c.body.session_id));
    expect(ids.size).toBe(1);
  });

  it('fires play / progress_25 / progress_50 / progress_75 / complete beacons via callbacks', async () => {
    const beacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));

    renderPreview();
    await waitFor(() => screen.getByTestId('le-player'));

    fireEvent.click(screen.getByTestId('mock-play'));
    fireEvent.click(screen.getByTestId('mock-p25'));
    fireEvent.click(screen.getByTestId('mock-p50'));
    fireEvent.click(screen.getByTestId('mock-p75'));
    fireEvent.click(screen.getByTestId('mock-complete'));

    const events = (await beaconCalls(beacon)).map((c) => c.body.event);
    expect(events).toContain('play');
    expect(events).toContain('progress_25');
    expect(events).toContain('progress_50');
    expect(events).toContain('progress_75');
    expect(events).toContain('complete');
  });

  it('fires each milestone AT MOST ONCE per session (refires are suppressed)', async () => {
    const beacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));

    renderPreview();
    await waitFor(() => screen.getByTestId('le-player'));

    // Click play + progress_25 twice each — only one beacon each must go out.
    fireEvent.click(screen.getByTestId('mock-play'));
    fireEvent.click(screen.getByTestId('mock-play'));
    fireEvent.click(screen.getByTestId('mock-p25'));
    fireEvent.click(screen.getByTestId('mock-p25'));

    const events = (await beaconCalls(beacon)).map((c) => c.body.event);
    expect(events.filter((e) => e === 'play')).toHaveLength(1);
    expect(events.filter((e) => e === 'progress_25')).toHaveLength(1);
  });

  it('does NOT refire view/play after a remount in the same session', async () => {
    const beacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));

    const first = renderPreview();
    await waitFor(() => screen.getByTestId('le-player'));
    fireEvent.click(screen.getByTestId('mock-play'));
    first.unmount();

    // Remount within the SAME session (sessionStorage not cleared between).
    renderPreview();
    await waitFor(() => screen.getByTestId('le-player'));
    fireEvent.click(screen.getByTestId('mock-play'));

    const events = (await beaconCalls(beacon)).map((c) => c.body.event);
    expect(events.filter((e) => e === 'view')).toHaveLength(1);
    expect(events.filter((e) => e === 'play')).toHaveLength(1);
  });

  it('a thrown sendBeacon is swallowed and never breaks render', async () => {
    const beacon = vi.fn(() => {
      throw new Error('beacon boom');
    });
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));

    renderPreview();
    // Render survives despite the throwing beacon on mount.
    await waitFor(() => screen.getByTestId('le-player'));
    expect(screen.getByTestId('preview-address')).toBeTruthy();

    // Callback-driven beacons also swallow throws and never break the UI.
    expect(() => fireEvent.click(screen.getByTestId('mock-play'))).not.toThrow();
    expect(screen.getByTestId('le-player')).toBeTruthy();
  });

  it('falls back to fetch(keepalive) when sendBeacon is unavailable', async () => {
    // Page-load GET returns the payload; the events POST returns 204.
    const fetchSpy = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve({ status: 204, ok: true, json: async () => ({}) });
      }
      return Promise.resolve({ status: 200, ok: true, json: async () => makePayload() });
    });
    vi.stubGlobal('fetch', fetchSpy);
    // navigator without sendBeacon
    const { sendBeacon: _omit, ...navNoBeacon } = navigator as Navigator & { sendBeacon?: unknown };
    vi.stubGlobal('navigator', navNoBeacon);

    renderPreview('fbtok');
    await waitFor(() => screen.getByTestId('le-player'));

    await waitFor(() => {
      const eventPost = fetchSpy.mock.calls.find(
        ([url, init]) =>
          String(url).includes('/api/preview/fbtok/events') &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(eventPost).toBeTruthy();
      expect((eventPost![1] as RequestInit).keepalive).toBe(true);
    });
  });

  it('beacon body maps the wide orientation to "horizontal"', async () => {
    const beacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    vi.stubGlobal(
      'fetch',
      mockFetch(200, makePayload({ videos: { horizontal: 'https://cdn/h.mp4', vertical: null } })),
    );

    renderPreview();
    await waitFor(() => screen.getByTestId('le-player'));
    fireEvent.click(screen.getByTestId('mock-play'));

    const play = (await beaconCalls(beacon)).find((c) => c.body.event === 'play');
    expect(play!.body.orientation).toBe('horizontal');
  });
});

// ---------------------------------------------------------------------------
// 10. Revoked link renders the expired state (T2 behavior on the watch page)
// ---------------------------------------------------------------------------

describe('PreviewPage — revoked link', () => {
  it('shows the expired/not-found state for a revoked link (API returns 404)', async () => {
    // T2: fetchByToken treats revoked_at as expired -> the API returns 404.
    vi.stubGlobal('fetch', mockFetch(404, {}));
    renderPreview('revokedtok');
    await waitFor(() => {
      expect(screen.getByTestId('preview-not-found')).toBeTruthy();
    });
    // No player, no beacons fire for a revoked link.
    expect(screen.queryByTestId('le-player')).toBeNull();
  });
});
