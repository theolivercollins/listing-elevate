/**
 * TDD tests for the LE Video library page (spec §1).
 *
 * Route: /dashboard/studio/videos. Cinematic poster grid of every property with a
 * delivered video, wired to GET /api/admin/studio/videos. Filters (client + date
 * range + debounced address search) update the request query; pagination changes
 * the page param; styled empty + loading states; each card links to the hub
 * (/dashboard/studio/videos/[propertyId]).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Videos from '../Videos';

// ---------------------------------------------------------------------------
// API mocks — authedFetch is the single network seam used by the page.
// ---------------------------------------------------------------------------

const authedFetch = vi.fn();
vi.mock('@/lib/api', () => ({
  authedFetch: (...args: unknown[]) => authedFetch(...args),
}));

type VideoItem = {
  id: string;
  address: string | null;
  videos: { horizontal: string | null; vertical: string | null };
  approved_at: string | null;
  created_at: string;
  client: { id: string; name: string } | null;
  hero_photo_url: string | null;
  link_count: number;
  total_views: number;
};

function makeItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'prop-1',
    address: '123 Ocean Drive, Malibu CA',
    videos: { horizontal: 'https://cdn/h.mp4', vertical: 'https://cdn/v.mp4' },
    approved_at: '2026-06-09T08:00:00Z',
    created_at: '2026-06-08T08:00:00Z',
    client: { id: 'c-1', name: 'Brian Vance' },
    hero_photo_url: 'https://cdn/hero.jpg',
    link_count: 2,
    total_views: 17,
    ...overrides,
  };
}

/** Resolve authedFetch by URL: videos library + clients dropdown source. */
function mockFetch(opts: { items?: VideoItem[]; total?: number; clients?: Array<{ id: string; name: string }> } = {}) {
  const items = opts.items ?? [makeItem()];
  const total = opts.total ?? items.length;
  const clients = opts.clients ?? [{ id: 'c-1', name: 'Brian Vance' }, { id: 'c-2', name: 'Dana Lee' }];
  authedFetch.mockImplementation((path: string) => {
    if (path.startsWith('/api/admin/studio/clients')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ clients }) });
    }
    // default: videos library
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ items, total, page: 1, pageSize: 24 }),
    });
  });
}

/** Last videos-library request URL passed to authedFetch. */
function lastVideosUrl(): string {
  const calls = authedFetch.mock.calls.map((c) => c[0] as string).filter((u) => u.startsWith('/api/admin/studio/videos'));
  return calls[calls.length - 1] ?? '';
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/dashboard/studio/videos']}>
      <Videos />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  authedFetch.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('Videos library page', () => {
  it('renders cards from the API with address, client, views and orientation badges', async () => {
    mockFetch({ items: [makeItem()] });
    renderPage();

    expect(await screen.findByText('123 Ocean Drive')).toBeTruthy();
    // Scope card assertions to the card link (client name also appears in the
    // filter dropdown, so query within the card, not the whole document).
    const card = await screen.findByRole('link', { name: /123 Ocean Drive/i });
    expect(within(card).getByText('Brian Vance')).toBeTruthy();
    // locality line rendered separately from the street
    expect(within(card).getByText('Malibu CA')).toBeTruthy();
    // view count rendered (tabular-nums)
    expect(within(card).getByText('17')).toBeTruthy();
    // both orientation badges present when both urls exist
    expect(within(card).getByText('16:9')).toBeTruthy();
    expect(within(card).getByText('9:16')).toBeTruthy();
    // approved badge
    expect(within(card).getByText(/approved/i)).toBeTruthy();
  });

  it('links each card to the video hub route', async () => {
    mockFetch({ items: [makeItem({ id: 'prop-42' })] });
    renderPage();

    const link = await screen.findByRole('link', { name: /123 Ocean Drive/i });
    expect(link.getAttribute('href')).toBe('/dashboard/studio/videos/prop-42');
  });

  it('renders only the badge whose video url exists', async () => {
    mockFetch({ items: [makeItem({ videos: { horizontal: 'https://cdn/h.mp4', vertical: null } })] });
    renderPage();

    await screen.findByText('123 Ocean Drive');
    expect(screen.getByText('16:9')).toBeTruthy();
    expect(screen.queryByText('9:16')).toBeNull();
  });

  it('shows a styled empty state when the API returns no items', async () => {
    mockFetch({ items: [], total: 0 });
    renderPage();

    expect(await screen.findByText(/no videos/i)).toBeTruthy();
  });

  it('shows a loading skeleton before the first response resolves', async () => {
    // Never-resolving fetch keeps the page in the loading state.
    authedFetch.mockImplementation(() => new Promise(() => {}));
    const { container } = renderPage();
    expect(container.querySelector('[data-testid="videos-skeleton"]')).toBeTruthy();
  });

  it('filters by client — selecting a client adds client_id to the request', async () => {
    mockFetch();
    renderPage();
    await screen.findByText('123 Ocean Drive');

    const select = screen.getByLabelText(/client/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'c-2' } });

    await waitFor(() => expect(lastVideosUrl()).toContain('client_id=c-2'));
  });

  it('debounces address search then queries with q=', async () => {
    mockFetch();
    renderPage();
    await screen.findByText('123 Ocean Drive');

    const callsBefore = authedFetch.mock.calls.filter((c) => (c[0] as string).startsWith('/api/admin/studio/videos')).length;

    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: 'ocean' } });

    // No immediate refetch (debounced).
    const callsImmediate = authedFetch.mock.calls.filter((c) => (c[0] as string).startsWith('/api/admin/studio/videos')).length;
    expect(callsImmediate).toBe(callsBefore);

    // Advance past the debounce window.
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await waitFor(() => expect(lastVideosUrl()).toContain('q=ocean'));
  });

  it('filters by date range — choosing a from date adds from= to the request', async () => {
    mockFetch();
    renderPage();
    await screen.findByText('123 Ocean Drive');

    const fromInput = screen.getByLabelText(/from/i);
    fireEvent.change(fromInput, { target: { value: '2026-06-01' } });

    await waitFor(() => expect(lastVideosUrl()).toContain('from=2026-06-01'));
  });

  it('paginates — next page adds page=2 to the request', async () => {
    // 30 items total across two pages of 24.
    const items = Array.from({ length: 24 }, (_, i) => makeItem({ id: `p-${i}`, address: `Addr ${i}` }));
    mockFetch({ items, total: 30 });
    renderPage();
    await screen.findByText('Addr 0');

    const next = screen.getByRole('button', { name: /next/i });
    fireEvent.click(next);

    await waitFor(() => expect(lastVideosUrl()).toContain('page=2'));
  });
});
