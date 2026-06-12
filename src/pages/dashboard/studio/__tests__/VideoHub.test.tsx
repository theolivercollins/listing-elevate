/**
 * TDD tests for the LE Video hub page (spec §2).
 *
 * Route: /dashboard/studio/videos/[propertyId]. The management page for one
 * video. Composes:
 *   1. <LEPlayer> with an orientation switcher when both renders exist.
 *   2. <SharePanel> (list mode) wired to GET /api/admin/studio/videos/[id] links
 *      and the existing POST/PATCH preview-link endpoints (label, revoke, caps).
 *   3. Analytics — top cards (total plays, unique viewers, avg completion %) from
 *      `totals`; a per-link table (plays / unique sessions / completion / last
 *      viewed, legacy viewed_count shown as "page views").
 *   4. Activity — property_revision_notes, newest-first.
 *   5. Downloads — per-orientation via the public preview download endpoint.
 *
 * LEPlayer and SharePanel are mocked to keep these tests about the hub's
 * composition + data mapping, not the children (which have their own suites).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import VideoHub from '../VideoHub';

// ---------------------------------------------------------------------------
// Network seam — authedFetch.
// ---------------------------------------------------------------------------

const authedFetch = vi.fn();
vi.mock('@/lib/api', () => ({
  authedFetch: (...args: unknown[]) => authedFetch(...args),
}));

// ---------------------------------------------------------------------------
// Mock LEPlayer — record the src/poster/orientation it's rendered with.
// ---------------------------------------------------------------------------

vi.mock('@/components/preview/LEPlayer', () => ({
  default: (props: { src: string; poster?: string; orientation?: string }) => (
    <div
      data-testid="le-player"
      data-src={props.src}
      data-poster={props.poster ?? ''}
      data-orientation={props.orientation ?? 'horizontal'}
    />
  ),
}));

// ---------------------------------------------------------------------------
// Mock SharePanel — surface the links it received so the hub's mapping is
// observable, plus expose its callbacks for label/revoke/create/toggle wiring.
// ---------------------------------------------------------------------------

type PanelLink = {
  id: string;
  kind: string;
  label: string | null;
  allow_download: boolean;
  allow_approve: boolean;
  allow_revision: boolean;
  revoked_at: string | null;
};

const panelCallbacks: Record<string, unknown> = {};

vi.mock('@/components/studio/share/SharePanel', () => ({
  default: (props: {
    clientLinks: PanelLink[];
    publicLinks: PanelLink[];
    mode?: string;
    onCreateLink: unknown;
    onToggle: unknown;
    onSetLabel: unknown;
    onRevoke: unknown;
  }) => {
    panelCallbacks.onCreateLink = props.onCreateLink;
    panelCallbacks.onToggle = props.onToggle;
    panelCallbacks.onSetLabel = props.onSetLabel;
    panelCallbacks.onRevoke = props.onRevoke;
    const all = [...props.clientLinks, ...props.publicLinks];
    return (
      <div data-testid="share-panel" data-mode={props.mode ?? 'list'}>
        {all.map((l) => (
          <div key={l.id} data-testid={`panel-link-${l.id}`} data-kind={l.kind} data-label={l.label ?? ''}>
            <span data-testid={`panel-link-${l.id}-download`}>{String(l.allow_download)}</span>
          </div>
        ))}
      </div>
    );
  },
}));

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

type HubLink = {
  id: string;
  token: string;
  kind: string;
  label: string | null;
  revoked_at: string | null;
  capabilities: { download: boolean; approve: boolean; revision: boolean };
  approved_at: string | null;
  viewed_count: number;
  last_viewed_at: string | null;
  created_at: string;
  expires_at: string | null;
  analytics: { total_plays: number; unique_viewers: number; avg_completion_pct: number };
};

function makeLink(overrides: Partial<HubLink> = {}): HubLink {
  return {
    id: 'pv-client',
    token: 'a'.repeat(43),
    kind: 'client',
    label: 'Sent to Brian',
    revoked_at: null,
    capabilities: { download: true, approve: true, revision: true },
    approved_at: '2026-06-09T08:00:00Z',
    viewed_count: 9,
    last_viewed_at: '2026-06-10T08:00:00Z',
    created_at: '2026-06-08T08:00:00Z',
    expires_at: null,
    analytics: { total_plays: 4, unique_viewers: 6, avg_completion_pct: 62 },
    ...overrides,
  };
}

type HubBundle = {
  property: { id: string; address: string | null; videos: { horizontal: string | null; vertical: string | null } };
  client: { id: string; name: string } | null;
  hero_photo_url: string | null;
  links: HubLink[];
  revision_notes: Array<{ id: string; source: string; body: string; created_at: string }>;
  totals: { total_plays: number; unique_viewers: number; avg_completion_pct: number };
};

function makeBundle(overrides: Partial<HubBundle> = {}): HubBundle {
  return {
    property: {
      id: 'prop-1',
      address: '123 Ocean Drive, Malibu CA',
      videos: { horizontal: 'https://cdn/h.mp4', vertical: 'https://cdn/v.mp4' },
    },
    client: { id: 'c-1', name: 'Brian Vance' },
    hero_photo_url: 'https://cdn/hero.jpg',
    links: [
      makeLink(),
      makeLink({
        id: 'pv-public',
        token: 'b'.repeat(43),
        kind: 'public',
        label: 'IG bio',
        capabilities: { download: false, approve: false, revision: false },
        approved_at: null,
        viewed_count: 31,
        analytics: { total_plays: 12, unique_viewers: 20, avg_completion_pct: 48 },
      }),
    ],
    revision_notes: [
      { id: 'n-1', source: 'client_approval', body: 'Approved — looks great', created_at: '2026-06-10T09:00:00Z' },
      { id: 'n-2', source: 'client_revision', body: 'Trim the intro', created_at: '2026-06-09T09:00:00Z' },
    ],
    totals: { total_plays: 16, unique_viewers: 26, avg_completion_pct: 55 },
    ...overrides,
  };
}

function mockHub(bundle: HubBundle = makeBundle()) {
  authedFetch.mockImplementation((path: string) => {
    if (path.startsWith('/api/admin/studio/videos/')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(bundle) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

function renderHub(propertyId = 'prop-1') {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/studio/videos/${propertyId}`]}>
      <Routes>
        <Route path="/dashboard/studio/videos/:propertyId" element={<VideoHub />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  authedFetch.mockReset();
  for (const k of Object.keys(panelCallbacks)) delete panelCallbacks[k];
});

describe('Video hub page', () => {
  it('fetches the hub bundle by property id and renders the player', async () => {
    mockHub();
    renderHub('prop-1');

    const player = await screen.findByTestId('le-player');
    // default orientation is horizontal → horizontal url + hero poster
    expect(player.getAttribute('data-src')).toBe('https://cdn/h.mp4');
    expect(player.getAttribute('data-poster')).toBe('https://cdn/hero.jpg');
    // fetched the right endpoint
    expect(authedFetch.mock.calls.some((c) => (c[0] as string) === '/api/admin/studio/videos/prop-1')).toBe(true);
  });

  it('shows an orientation switcher only when BOTH renders exist, and switches src', async () => {
    mockHub();
    renderHub();

    await screen.findByTestId('le-player');
    const vertBtn = screen.getByRole('button', { name: /vertical/i });
    expect(vertBtn).toBeTruthy();

    fireEvent.click(vertBtn);
    await waitFor(() =>
      expect(screen.getByTestId('le-player').getAttribute('data-src')).toBe('https://cdn/v.mp4'),
    );
    expect(screen.getByTestId('le-player').getAttribute('data-orientation')).toBe('vertical');
  });

  it('hides the orientation switcher when only one render exists', async () => {
    mockHub(makeBundle({
      property: {
        id: 'prop-1',
        address: '123 Ocean Drive, Malibu CA',
        videos: { horizontal: 'https://cdn/h.mp4', vertical: null },
      },
    }));
    renderHub();

    await screen.findByTestId('le-player');
    expect(screen.queryByRole('button', { name: /vertical/i })).toBeNull();
  });

  it('passes ALL links to SharePanel (list mode) with flattened capabilities + labels', async () => {
    mockHub();
    renderHub();

    const panel = await screen.findByTestId('share-panel');
    expect(panel.getAttribute('data-mode')).toBe('list');

    const clientRow = within(panel).getByTestId('panel-link-pv-client');
    expect(clientRow.getAttribute('data-kind')).toBe('client');
    expect(clientRow.getAttribute('data-label')).toBe('Sent to Brian');
    // capabilities.download → allow_download
    expect(within(clientRow).getByTestId('panel-link-pv-client-download').textContent).toBe('true');

    const publicRow = within(panel).getByTestId('panel-link-pv-public');
    expect(publicRow.getAttribute('data-kind')).toBe('public');
    expect(within(publicRow).getByTestId('panel-link-pv-public-download').textContent).toBe('false');
  });

  it('renders analytics top cards from totals', async () => {
    mockHub();
    renderHub();

    const plays = await screen.findByTestId('hub-total-plays');
    expect(plays.textContent).toContain('16');
    expect(screen.getByTestId('hub-unique-viewers').textContent).toContain('26');
    expect(screen.getByTestId('hub-avg-completion').textContent).toContain('55');
  });

  it('renders a per-link analytics table with plays / unique / completion / page views', async () => {
    mockHub();
    renderHub();

    const row = await screen.findByTestId('hub-link-stats-pv-client');
    // plays, unique sessions, completion, legacy viewed_count as page views
    expect(within(row).getByTestId('hub-link-plays-pv-client').textContent).toContain('4');
    expect(within(row).getByTestId('hub-link-unique-pv-client').textContent).toContain('6');
    expect(within(row).getByTestId('hub-link-completion-pv-client').textContent).toContain('62');
    expect(within(row).getByTestId('hub-link-pageviews-pv-client').textContent).toContain('9');
    // public row present too
    expect(screen.getByTestId('hub-link-stats-pv-public')).toBeTruthy();
  });

  it('renders the activity list (revision notes) newest-first', async () => {
    mockHub();
    renderHub();

    expect(await screen.findByText('Approved — looks great')).toBeTruthy();
    expect(screen.getByText('Trim the intro')).toBeTruthy();
  });

  it('renders a download link per available orientation pointing at the preview download endpoint', async () => {
    mockHub();
    renderHub();

    const wide = await screen.findByTestId('hub-download-horizontal');
    const vertical = screen.getByTestId('hub-download-vertical');
    // download uses a real link token + orientation param
    const token = 'a'.repeat(43);
    expect(wide.getAttribute('href')).toBe(`/api/preview/${token}/download?orientation=horizontal`);
    expect(vertical.getAttribute('href')).toBe(`/api/preview/${token}/download?orientation=vertical`);
  });

  it('renders only the download link for the orientation that exists', async () => {
    mockHub(makeBundle({
      property: {
        id: 'prop-1',
        address: '123 Ocean Drive, Malibu CA',
        videos: { horizontal: 'https://cdn/h.mp4', vertical: null },
      },
    }));
    renderHub();

    await screen.findByTestId('hub-download-horizontal');
    expect(screen.queryByTestId('hub-download-vertical')).toBeNull();
  });

  it('shows an error strip when the bundle fails to load', async () => {
    authedFetch.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 500, statusText: 'Server Error', json: () => Promise.resolve({}) }),
    );
    renderHub();
    expect(await screen.findByText(/failed to load/i)).toBeTruthy();
  });
});
