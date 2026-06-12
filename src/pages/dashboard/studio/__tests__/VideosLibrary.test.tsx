/**
 * TDD tests for LE Video v2 Sub-project A library management UI (spec §3).
 *
 * Layered on top of the existing Videos library page: a folder rail
 * (All videos · folders with counts · Archived · ＋ New folder), a per-card ⋯
 * menu (Move to folder ▸ · Archive/Restore · Delete…), and a delete-confirm
 * dialog. This file asserts the interaction contract that the task hinges on:
 *   - ⋯ menu shows Archive in the default view, Restore in the Archived view
 *   - delete-confirm is required before the library action fetch fires
 *   - selecting a folder issues a videos fetch with ?folder=
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Videos from '../Videos';

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
  folder_id: string | null;
  archived_at: string | null;
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
    folder_id: null,
    archived_at: null,
    ...overrides,
  };
}

type Folder = { id: string; name: string; position: number; video_count: number };

/** Resolve authedFetch by URL: videos library + clients dropdown + folders. */
function mockFetch(opts: {
  items?: VideoItem[];
  total?: number;
  clients?: Array<{ id: string; name: string }>;
  folders?: Folder[];
} = {}) {
  const items = opts.items ?? [makeItem()];
  const total = opts.total ?? items.length;
  const clients = opts.clients ?? [{ id: 'c-1', name: 'Brian Vance' }];
  const folders = opts.folders ?? [{ id: 'f-1', name: 'Listings', position: 0, video_count: 3 }];
  authedFetch.mockImplementation((path: string) => {
    if (path.startsWith('/api/admin/studio/video-folders')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ folders }) });
    }
    if (path.startsWith('/api/admin/studio/clients')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ clients }) });
    }
    // videos/[id]/library action
    if (/\/api\/admin\/studio\/videos\/[^/]+\/library$/.test(path)) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    }
    // default: videos library list
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ items, total, page: 1, pageSize: 24 }),
    });
  });
}

/** Last videos-LIST request URL (excludes folder + library-action endpoints). */
function lastVideosListUrl(): string {
  const calls = authedFetch.mock.calls
    .map((c) => c[0] as string)
    .filter(
      (u) =>
        u.startsWith('/api/admin/studio/videos') &&
        !/\/api\/admin\/studio\/videos\/[^/]+\/library$/.test(u),
    );
  return calls[calls.length - 1] ?? '';
}

/** All library-action POST calls (videos/[id]/library). */
function libraryActionCalls(): Array<[string, RequestInit | undefined]> {
  return authedFetch.mock.calls.filter((c) =>
    /\/api\/admin\/studio\/videos\/[^/]+\/library$/.test(c[0] as string),
  ) as Array<[string, RequestInit | undefined]>;
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

/** Open the ⋯ card menu for the first card. */
async function openCardMenu() {
  const trigger = await screen.findByRole('button', { name: /more actions/i });
  fireEvent.click(trigger);
  return screen.findByRole('menu');
}

describe('Videos library — folder rail', () => {
  it('renders the folder rail with All videos, folders + counts, and Archived', async () => {
    mockFetch({ folders: [{ id: 'f-1', name: 'Listings', position: 0, video_count: 3 }] });
    renderPage();

    expect(await screen.findByRole('tab', { name: /all videos/i })).toBeTruthy();
    const listingsPill = await screen.findByRole('tab', { name: /listings/i });
    expect(within(listingsPill).getByText('3')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /archived/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /new folder/i })).toBeTruthy();
  });

  it('selecting a folder issues a videos fetch with ?folder=', async () => {
    mockFetch({ folders: [{ id: 'f-1', name: 'Listings', position: 0, video_count: 3 }] });
    renderPage();
    await screen.findByText('123 Ocean Drive');

    fireEvent.click(await screen.findByRole('tab', { name: /listings/i }));

    await waitFor(() => expect(lastVideosListUrl()).toContain('folder=f-1'));
  });

  it('selecting Archived issues a videos fetch with archived=1', async () => {
    mockFetch();
    renderPage();
    await screen.findByText('123 Ocean Drive');

    fireEvent.click(screen.getByRole('tab', { name: /archived/i }));

    await waitFor(() => expect(lastVideosListUrl()).toContain('archived=1'));
  });
});

describe('Videos library — card ⋯ menu', () => {
  it('shows Archive (not Restore) in the default view', async () => {
    mockFetch({ items: [makeItem()] });
    renderPage();
    await screen.findByText('123 Ocean Drive');

    const menu = await openCardMenu();
    expect(within(menu).getByRole('menuitem', { name: /^archive$/i })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: /^restore$/i })).toBeNull();
  });

  it('shows Restore (not Archive) in the Archived view', async () => {
    mockFetch({ items: [makeItem({ archived_at: '2026-06-10T00:00:00Z' })] });
    renderPage();
    await screen.findByText('123 Ocean Drive');

    // switch to Archived view
    fireEvent.click(screen.getByRole('tab', { name: /archived/i }));
    await waitFor(() => expect(lastVideosListUrl()).toContain('archived=1'));

    const menu = await openCardMenu();
    expect(within(menu).getByRole('menuitem', { name: /^restore$/i })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: /^archive$/i })).toBeNull();
  });
});

describe('Videos library — delete confirmation', () => {
  it('does NOT fire the delete action until the dialog is confirmed', async () => {
    mockFetch({ items: [makeItem()] });
    renderPage();
    await screen.findByText('123 Ocean Drive');

    const menu = await openCardMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /delete/i }));

    // The confirm dialog is shown but no library action has fired yet.
    expect(await screen.findByText(/permanently delete this video/i)).toBeTruthy();
    expect(libraryActionCalls().length).toBe(0);

    // Cancel → still no action.
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(libraryActionCalls().length).toBe(0);
  });

  it('fires the delete action only after confirming', async () => {
    mockFetch({ items: [makeItem({ id: 'prop-77' })] });
    renderPage();
    await screen.findByText('123 Ocean Drive');

    const menu = await openCardMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /delete/i }));
    await screen.findByText(/permanently delete this video/i);

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(libraryActionCalls().length).toBe(1));
    const [url, init] = libraryActionCalls()[0];
    expect(url).toBe('/api/admin/studio/videos/prop-77/library');
    expect(JSON.parse((init?.body as string) ?? '{}').action).toBe('delete');
  });
});
