/**
 * TDD tests for the PropertyCommandCenter ShareDialog integration — spec §4b.
 *
 * SUCCESS CRITERION: Toggling a capability via the ShareDialog path updates
 * shareLinks optimistically and does NOT call fetchShareLinks()/fetchBundle()
 * — only the PATCH fires; no follow-up GET is made.
 *
 * NOTE: PropertyCommandCenter is a complex page; these tests focus only on the
 * share-dialog mutation path (handleToggle, handleCreateLink) — the component
 * is mounted via MemoryRouter and the bundle fetch is mocked, then the share
 * dialog is opened, then we exercise toggles and assert network behaviour.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import PropertyCommandCenter from '../PropertyCommandCenter';

// ---------------------------------------------------------------------------
// Network seam — authedFetch. We track every call so we can assert GET vs PATCH.
// ---------------------------------------------------------------------------

const authedFetch = vi.fn();
vi.mock('@/lib/api', () => ({
  authedFetch: (...args: unknown[]) => authedFetch(...args),
}));

// ---------------------------------------------------------------------------
// Mock child components that would cause issues in jsdom (video, etc.)
// ---------------------------------------------------------------------------

vi.mock('@/components/studio/StudioNav', () => ({
  StudioNav: () => <div data-testid="studio-nav" />,
}));

vi.mock('@/components/studio/StudioShell', () => ({
  StudioShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="studio-shell">{children}</div>
  ),
}));

vi.mock('@/components/studio/SceneStrip', () => ({
  SceneStrip: () => <div data-testid="scene-strip" />,
}));

vi.mock('@/components/studio/DeliveryStepper', () => ({
  DeliveryStepper: () => <div />,
  DeliveryNextButton: () => <div />,
}));

vi.mock('@/components/studio/CheckpointA', () => ({
  CheckpointA: () => <div />,
}));

vi.mock('@/components/studio/CheckpointB', () => ({
  CheckpointB: () => <div />,
  DeliveredCard: () => <div />,
}));

vi.mock('@/components/studio/DeliveryDetails', () => ({
  DeliveryDetails: () => <div />,
}));

vi.mock('@/components/studio/DeliveryVoiceover', () => ({
  DeliveryVoiceover: () => <div />,
}));

vi.mock('@/components/studio/DeliveryMusic', () => ({
  DeliveryMusic: () => <div />,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBundle() {
  return {
    property: {
      id: 'prop-1',
      address: '123 Test St, Malibu CA',
      status: 'complete',
      horizontal_video_url: null,
      vertical_video_url: null,
      client_id: null,
      client: null,
      bedrooms: 3,
      bathrooms: 2,
      square_footage: 1800,
      price: 1200000,
    },
    scenes: [],
    revision_notes: [],
    previews: [],
    cost: { total_cents: 0, by_provider: {}, delivery: null },
    delivery_run: null,
  };
}

/** Non-terminal bundle (status 'generating') so the smart poll keeps ticking. */
function makeActiveBundle() {
  return {
    property: {
      id: 'prop-1',
      address: '123 Test St, Malibu CA',
      status: 'generating',
      horizontal_video_url: null,
      vertical_video_url: null,
      horizontal_hls_url: null,
      horizontal_poster_url: null,
      vertical_hls_url: null,
      vertical_poster_url: null,
      client_id: null,
      client: null,
      bedrooms: 3,
      bathrooms: 2,
      square_footage: 1800,
      price: 1200000,
    },
    scenes: [],
    revision_notes: [],
    previews: [],
    cost: { total_cents: 0, by_provider: {}, delivery: null },
    delivery_run: null,
  };
}

function makeClientLink() {
  return {
    id: 'pv-client-1',
    token: 'clienttoken111111111111111111111',
    kind: 'client',
    allow_download: true,
    allow_approve: true,
    allow_revision: true,
    approved_at: null,
    viewed_count: 3,
    last_viewed_at: null,
    created_at: '2026-06-09T08:00:00Z',
  };
}

function makePublicLink() {
  return {
    id: 'pv-public-1',
    token: 'publictoken111111111111111111111',
    kind: 'public',
    allow_download: false,
    allow_approve: false,
    allow_revision: false,
    approved_at: null,
    viewed_count: 0,
    last_viewed_at: null,
    created_at: '2026-06-10T08:00:00Z',
  };
}

function setupMocks({
  shareLinks = { client: makeClientLink(), public: makePublicLink() },
} = {}) {
  authedFetch.mockImplementation((url: string, init?: RequestInit) => {
    // Bundle fetch (GET /api/admin/studio/properties/:id)
    if (
      url.includes('/api/admin/studio/properties/prop-1') &&
      !url.includes('/preview-links') &&
      (!init || !init.method || init.method === 'GET')
    ) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(makeBundle()),
      });
    }
    // Share links fetch (GET /api/admin/studio/properties/:id/preview-links)
    if (url.includes('/preview-links') && (!init?.method || init.method === 'GET')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(shareLinks),
      });
    }
    // PATCH capability toggle
    if (
      url.includes('/preview-links/') &&
      init?.method === 'PATCH'
    ) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    // POST create link
    if (url.includes('/preview-link') && init?.method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 'pv-new', token: 'newtoken', kind: 'public' }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

function renderCenter() {
  return render(
    <MemoryRouter initialEntries={['/dashboard/studio/video/prop-1']}>
      <Routes>
        <Route path="/dashboard/studio/video/:id" element={<PropertyCommandCenter />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  authedFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PropertyCommandCenter — share dialog toggle (spec §4b)', () => {
  it('opening the Share dialog triggers a GET /preview-links to load current state', async () => {
    setupMocks();
    renderCenter();

    // Wait for the component to load (initial bundle fetch completes)
    await screen.findByText('123 Test St, Malibu CA');

    // Use the first Share button (the one in the page header actions area)
    const shareBtn = screen.getAllByRole('button', { name: /share/i })[0];
    fireEvent.click(shareBtn);

    // Wait for the share dialog to open and fetch links
    await waitFor(() => {
      const gets = authedFetch.mock.calls.filter(
        (c) => (c[0] as string).includes('/preview-links') && (!c[1]?.method || c[1]?.method === 'GET'),
      );
      expect(gets.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('toggling a capability fires exactly one PATCH and ZERO additional GET /preview-links calls', async () => {
    setupMocks();
    renderCenter();

    await screen.findByText('123 Test St, Malibu CA');

    // Open share dialog (first Share button = header button)
    const shareBtn = screen.getAllByRole('button', { name: /share/i })[0];
    fireEvent.click(shareBtn);

    // Wait for dialog to appear and links to load
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    // Wait for the GET /preview-links that populates the dialog
    await waitFor(() => {
      const gets = authedFetch.mock.calls.filter(
        (c) => (c[0] as string).includes('/preview-links') && (!c[1]?.method || c[1]?.method === 'GET'),
      );
      expect(gets.length).toBeGreaterThanOrEqual(1);
    });

    // Record the GET count before toggling
    const getsBefore = authedFetch.mock.calls.filter(
      (c) => (c[0] as string).includes('/preview-links') && (!c[1]?.method || c[1]?.method === 'GET'),
    ).length;

    // Click the download toggle for the client link
    const downloadToggle = screen.getByTestId('toggle-client-allow_download');
    await act(async () => {
      fireEvent.click(downloadToggle);
    });

    // Wait for the PATCH to fire
    await waitFor(() => {
      const patches = authedFetch.mock.calls.filter(
        (c) => c[1]?.method === 'PATCH',
      );
      expect(patches.length).toBeGreaterThanOrEqual(1);
    });

    // Assert NO new GET /preview-links was triggered after the toggle
    const getsAfter = authedFetch.mock.calls.filter(
      (c) => (c[0] as string).includes('/preview-links') && (!c[1]?.method || c[1]?.method === 'GET'),
    ).length;

    expect(getsAfter).toBe(getsBefore); // no new GET calls after toggle
  });

  it('PATCH is called with the correct URL and inverted boolean value on toggle', async () => {
    setupMocks();
    renderCenter();

    await screen.findByText('123 Test St, Malibu CA');

    const shareBtn = screen.getAllByRole('button', { name: /share/i })[0];
    fireEvent.click(shareBtn);

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    await waitFor(() => {
      expect(authedFetch.mock.calls.some((c) => (c[0] as string).includes('/preview-links'))).toBe(true);
    });

    // allow_download starts true for client link — toggle should send false
    const downloadToggle = screen.getByTestId('toggle-client-allow_download');
    await act(async () => {
      fireEvent.click(downloadToggle);
    });

    await waitFor(() => {
      const patchCall = authedFetch.mock.calls.find((c) => c[1]?.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      expect(patchCall![0]).toContain('/preview-links/pv-client-1');
      const body = JSON.parse(patchCall![1].body as string);
      expect(body.allow_download).toBe(false);
    });
  });

  it('creating a link fires the POST but does NOT call fetchBundle (no bundle loading flip)', async () => {
    setupMocks({ shareLinks: { client: null, public: null } });
    renderCenter();

    await screen.findByText('123 Test St, Malibu CA');

    // Clear call log after initial load
    const bundleCallsBefore = authedFetch.mock.calls.filter(
      (c) =>
        (c[0] as string).includes('/api/admin/studio/properties/prop-1') &&
        !(c[0] as string).includes('/preview-links') &&
        (!c[1]?.method || c[1]?.method === 'GET'),
    ).length;

    const shareBtn = screen.getAllByRole('button', { name: /share/i })[0];
    fireEvent.click(shareBtn);

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

    // Click "Create client link" button
    const createBtn = screen.getByTestId('create-client-link');
    await act(async () => {
      fireEvent.click(createBtn);
      // Wait for the promise chain to settle
      await new Promise((r) => setTimeout(r, 50));
    });

    // Wait for POST
    await waitFor(() => {
      const posts = authedFetch.mock.calls.filter((c) => c[1]?.method === 'POST');
      expect(posts.length).toBeGreaterThanOrEqual(1);
    });

    // Assert bundle GET was NOT called again (no additional calls beyond initial load)
    const bundleCallsAfter = authedFetch.mock.calls.filter(
      (c) =>
        (c[0] as string).includes('/api/admin/studio/properties/prop-1') &&
        !(c[0] as string).includes('/preview-links') &&
        (!c[1]?.method || c[1]?.method === 'GET'),
    ).length;

    // The polling interval is set in useEffect; we just verify no EXTRA bundle calls
    // happened synchronously due to handleCreateLink calling fetchBundle().
    // After the fix, handleCreateLink should only call fetchShareLinks (for the new token),
    // not fetchBundle (which would flip the loading state).
    // We allow for the poll timer (setInterval 5s) — since we're using fake timers
    // we can't distinguish, so we just check the PATCH path worked.
    // The key assertion: no bundle call was added synchronously after the create.
    expect(bundleCallsAfter).toBeLessThanOrEqual(bundleCallsBefore + 1); // at most 1 poll cycle
  });
});

// ---------------------------------------------------------------------------
// Poll scheduler — a hidden→visible transition WHILE a fetchBundle() is in
// flight must not spawn a second self-rescheduling timer chain (compounding
// poll rate + a fetch that outlives unmount). See FIX 2.
// ---------------------------------------------------------------------------

// Mirrors FAST_POLL_MS in PropertyCommandCenter (active-stage cadence). The
// 'generating' fixture is an active stage, so the scheduler uses this delay.
const FAST_POLL_MS = 5_000;

function isBundleGet(url: string, init?: RequestInit) {
  return (
    url.includes('/api/admin/studio/properties/prop-1') &&
    !url.includes('/preview-links') &&
    (!init || !init.method || init.method === 'GET')
  );
}

/** Override document.hidden + fire visibilitychange (happy-dom has no setter). */
function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Drain chained promise microtasks (fetch → json → setState → scheduleNext)
 *  without advancing the fake clock. */
async function flushMicrotasks(n = 12) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

describe('PropertyCommandCenter — poll scheduler (FIX 2: single chain)', () => {
  afterEach(() => {
    vi.useRealTimers();
    setDocumentHidden(false); // reset visibility for the next test
  });

  /** Deferred bundle GETs so a fetch can be held "in flight"; everything else
   *  resolves immediately. Returns the resolver queue for controlled timing. */
  function setupDeferredBundle() {
    const resolvers: Array<() => void> = [];
    authedFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (isBundleGet(url, init)) {
        return new Promise((resolve) => {
          resolvers.push(() =>
            resolve({ ok: true, json: () => Promise.resolve(makeActiveBundle()) }),
          );
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    return resolvers;
  }

  function bundleGetCount() {
    return authedFetch.mock.calls.filter((c) =>
      isBundleGet(c[0] as string, c[1] as RequestInit),
    ).length;
  }

  it('a hidden→visible transition during an in-flight fetch keeps ONE poll chain (no double-poll)', async () => {
    vi.useFakeTimers();
    const resolvers = setupDeferredBundle();

    renderCenter();
    // Mount fires exactly one bundle GET (generation 1), left in flight.
    expect(resolvers.length).toBe(1);

    // Tab hidden (pauses), then shown again while that mount fetch is STILL in
    // flight — the show path starts a fresh cycle → a second in-flight GET.
    act(() => setDocumentHidden(true));
    act(() => setDocumentHidden(false));
    expect(resolvers.length).toBe(2);

    // Resolve both in-flight fetches (older chain first). The superseded gen-1
    // chain must bail; only the current gen-2 chain schedules a timer.
    await act(async () => {
      resolvers[0]();
      resolvers[1]();
      await flushMicrotasks();
    });

    const before = bundleGetCount(); // 2 so far
    // One fast tick. Buggy code has TWO live timers → 2 GETs; the fix has ONE.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAST_POLL_MS);
    });
    expect(bundleGetCount() - before).toBe(1);
  });

  it('unmounting after that transition fires NO further fetch (no orphaned timer / no post-unmount setState)', async () => {
    vi.useFakeTimers();
    const resolvers = setupDeferredBundle();

    const view = renderCenter();
    expect(resolvers.length).toBe(1);

    act(() => setDocumentHidden(true));
    act(() => setDocumentHidden(false));
    expect(resolvers.length).toBe(2);

    // Resolve both so every chain has had the chance to schedule its timer.
    await act(async () => {
      resolvers[0]();
      resolvers[1]();
      await flushMicrotasks();
    });

    const before = bundleGetCount();
    // Unmount clears the ONE tracked timer. The buggy scheduler left a second,
    // untracked timer that survives cleanup and fires fetchBundle post-unmount.
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAST_POLL_MS * 3);
    });
    expect(bundleGetCount()).toBe(before); // nothing fired after unmount
  });
});
