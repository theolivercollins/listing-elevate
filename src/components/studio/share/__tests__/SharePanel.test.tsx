/**
 * TDD tests for the shared SharePanel component.
 *
 * SharePanel is extracted from the v2 ShareDialog and EXTENDED for the LE Video
 * hub: a full LIST of links per kind, an inline editable label per link, a
 * revoke/restore control, expiry display, and create-with-label.
 *
 * The dialog renders SharePanel in newest-per-kind mode (one link per kind);
 * the hub renders it with every link. This suite covers the extended behaviour;
 * the back-compat single-link behaviour is covered by ShareDialog.test.tsx.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SharePanel, { type PreviewLinkRow } from '../SharePanel';

// ---------------------------------------------------------------------------

function makeClientLink(overrides: Partial<PreviewLinkRow> = {}): PreviewLinkRow {
  return {
    id: 'pv-client-1',
    token: 'clienttoken111111111111111111111',
    kind: 'client',
    label: null,
    allow_download: true,
    allow_approve: true,
    allow_revision: true,
    approved_at: null,
    revoked_at: null,
    expires_at: null,
    viewed_count: 3,
    last_viewed_at: '2026-06-10T09:00:00Z',
    created_at: '2026-06-09T08:00:00Z',
    ...overrides,
  };
}

function makePublicLink(overrides: Partial<PreviewLinkRow> = {}): PreviewLinkRow {
  return {
    id: 'pv-public-1',
    token: 'publictoken111111111111111111111',
    kind: 'public',
    label: null,
    allow_download: false,
    allow_approve: false,
    allow_revision: false,
    approved_at: null,
    revoked_at: null,
    expires_at: null,
    viewed_count: 12,
    last_viewed_at: '2026-06-11T10:00:00Z',
    created_at: '2026-06-10T08:00:00Z',
    ...overrides,
  };
}

const noop = vi.fn();

function renderPanel(
  overrides: {
    clientLinks?: PreviewLinkRow[];
    publicLinks?: PreviewLinkRow[];
    onCreateLink?: (kind: 'client' | 'public', label?: string) => Promise<void>;
    onToggle?: (id: string, field: 'allow_download' | 'allow_approve' | 'allow_revision', value: boolean) => Promise<void>;
    onSetLabel?: (id: string, label: string) => Promise<void>;
    onRevoke?: (id: string, revoked: boolean) => Promise<void>;
    baseUrl?: string;
  } = {},
) {
  return render(
    <SharePanel
      baseUrl={overrides.baseUrl ?? 'https://listingelevate.com'}
      clientLinks={overrides.clientLinks ?? []}
      publicLinks={overrides.publicLinks ?? []}
      onCreateLink={overrides.onCreateLink ?? noop}
      onToggle={overrides.onToggle ?? noop}
      onSetLabel={overrides.onSetLabel ?? noop}
      onRevoke={overrides.onRevoke ?? noop}
    />,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Sections + multiple links
// ---------------------------------------------------------------------------

describe('SharePanel — sections', () => {
  it('renders both the client and public sections', () => {
    renderPanel();
    expect(screen.getByTestId('share-section-client')).toBeTruthy();
    expect(screen.getByTestId('share-section-public')).toBeTruthy();
  });

  it('renders a row per link when multiple links exist in a kind', () => {
    renderPanel({
      clientLinks: [
        makeClientLink({ id: 'pv-client-1' }),
        makeClientLink({ id: 'pv-client-2', token: 'clienttoken222222222222222222222' }),
      ],
    });
    expect(screen.getByTestId('share-link-pv-client-1')).toBeTruthy();
    expect(screen.getByTestId('share-link-pv-client-2')).toBeTruthy();
  });

  it('shows an empty hint when a kind has no links', () => {
    renderPanel({ clientLinks: [], publicLinks: [] });
    expect(screen.getByTestId('share-empty-client')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Create with label
// ---------------------------------------------------------------------------

describe('SharePanel — create with label', () => {
  it('calls onCreateLink with kind and no label when New link is clicked blank', async () => {
    const onCreateLink = vi.fn().mockResolvedValue(undefined);
    renderPanel({ onCreateLink });
    fireEvent.click(screen.getByTestId('create-client-link'));
    await waitFor(() => expect(onCreateLink).toHaveBeenCalledWith('client', undefined));
  });

  it('passes the typed label through to onCreateLink', async () => {
    const onCreateLink = vi.fn().mockResolvedValue(undefined);
    renderPanel({ onCreateLink });
    fireEvent.change(screen.getByTestId('new-link-label-client'), {
      target: { value: 'Sent to Brian' },
    });
    fireEvent.click(screen.getByTestId('create-client-link'));
    await waitFor(() => expect(onCreateLink).toHaveBeenCalledWith('client', 'Sent to Brian'));
  });
});

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

describe('SharePanel — copy', () => {
  it('copies the link URL to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    renderPanel({ clientLinks: [makeClientLink()] });
    fireEvent.click(screen.getByTestId('copy-client-link'));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('clienttoken111111111111111111111'),
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Label editing
// ---------------------------------------------------------------------------

describe('SharePanel — label editing', () => {
  it('renders the current label for a link', () => {
    renderPanel({ clientLinks: [makeClientLink({ label: 'IG bio' })] });
    const row = screen.getByTestId('share-link-pv-client-1');
    expect(within(row).getByText('IG bio')).toBeTruthy();
  });

  it('calls onSetLabel with the edited value on save', async () => {
    const onSetLabel = vi.fn().mockResolvedValue(undefined);
    renderPanel({ clientLinks: [makeClientLink({ label: null })], onSetLabel });
    fireEvent.click(screen.getByTestId('edit-label-pv-client-1'));
    fireEvent.change(screen.getByTestId('label-input-pv-client-1'), {
      target: { value: 'Sent to Brian' },
    });
    fireEvent.click(screen.getByTestId('save-label-pv-client-1'));
    await waitFor(() =>
      expect(onSetLabel).toHaveBeenCalledWith('pv-client-1', 'Sent to Brian'),
    );
  });
});

// ---------------------------------------------------------------------------
// Revoke + restore
// ---------------------------------------------------------------------------

describe('SharePanel — revoke / restore', () => {
  it('calls onRevoke(id, true) when revoke is clicked on an active link', async () => {
    const onRevoke = vi.fn().mockResolvedValue(undefined);
    renderPanel({ clientLinks: [makeClientLink()], onRevoke });
    fireEvent.click(screen.getByTestId('revoke-pv-client-1'));
    await waitFor(() => expect(onRevoke).toHaveBeenCalledWith('pv-client-1', true));
  });

  it('renders a revoked link in the revoked state with a restore control', () => {
    renderPanel({
      clientLinks: [makeClientLink({ revoked_at: '2026-06-11T10:00:00Z' })],
    });
    expect(screen.getByTestId('revoked-state-pv-client-1')).toBeTruthy();
    expect(screen.getByTestId('restore-pv-client-1')).toBeTruthy();
    // Revoked links hide their capability toggles.
    expect(screen.queryByTestId('toggle-client-allow_download')).toBeNull();
  });

  it('calls onRevoke(id, false) when restore is clicked on a revoked link', async () => {
    const onRevoke = vi.fn().mockResolvedValue(undefined);
    renderPanel({
      clientLinks: [makeClientLink({ revoked_at: '2026-06-11T10:00:00Z' })],
      onRevoke,
    });
    fireEvent.click(screen.getByTestId('restore-pv-client-1'));
    await waitFor(() => expect(onRevoke).toHaveBeenCalledWith('pv-client-1', false));
  });
});

// ---------------------------------------------------------------------------
// Expiry display
// ---------------------------------------------------------------------------

describe('SharePanel — expiry', () => {
  it('shows expiry text when expires_at is set', () => {
    renderPanel({
      clientLinks: [makeClientLink({ expires_at: '2099-01-01T00:00:00Z' })],
    });
    expect(screen.getByTestId('expiry-pv-client-1')).toBeTruthy();
  });

  it('does not show expiry text when expires_at is null', () => {
    renderPanel({ clientLinks: [makeClientLink({ expires_at: null })] });
    expect(screen.queryByTestId('expiry-pv-client-1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Capability toggles (first link keeps canonical testids)
// ---------------------------------------------------------------------------

describe('SharePanel — capability toggles', () => {
  it('renders capability toggles for an active link and fires onToggle', async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    renderPanel({ clientLinks: [makeClientLink({ allow_download: true })], onToggle });
    const toggle = screen.getByTestId('toggle-client-allow_download');
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(onToggle).toHaveBeenCalledWith('pv-client-1', 'allow_download', false),
    );
  });

  it('shows the Approved badge for an approved client link', () => {
    renderPanel({
      clientLinks: [makeClientLink({ approved_at: '2026-06-11T10:00:00Z' })],
    });
    expect(screen.getByTestId('client-approved-badge')).toBeTruthy();
  });
});
