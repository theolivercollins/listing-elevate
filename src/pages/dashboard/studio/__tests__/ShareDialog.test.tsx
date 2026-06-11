/**
 * TDD tests for the Share dialog in PropertyCommandCenter.
 *
 * The dialog is extracted as a separate component (ShareDialog) so it can be
 * unit-tested in isolation without mounting the full PropertyCommandCenter.
 *
 * Spec §5: two sections (Client review / Public sharing), create-if-none / copy,
 * view stats, live-editable capability toggles, Approved badge when approved_at set.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ShareDialog from '../ShareDialog';

// ---------------------------------------------------------------------------
// Types mirroring the component's expected props
// ---------------------------------------------------------------------------

type PreviewLinkRow = {
  id: string;
  token: string;
  kind: 'client' | 'public';
  allow_download: boolean;
  allow_approve: boolean;
  allow_revision: boolean;
  approved_at: string | null;
  viewed_count: number;
  last_viewed_at: string | null;
  created_at: string;
};

type ShareLinks = {
  client: PreviewLinkRow | null;
  public: PreviewLinkRow | null;
};

function makeClientLink(overrides: Partial<PreviewLinkRow> = {}): PreviewLinkRow {
  return {
    id: 'pv-client-1',
    token: 'clienttoken111111111111111111111',
    kind: 'client',
    allow_download: true,
    allow_approve: true,
    allow_revision: true,
    approved_at: null,
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
    allow_download: false,
    allow_approve: false,
    allow_revision: false,
    approved_at: null,
    viewed_count: 12,
    last_viewed_at: '2026-06-11T10:00:00Z',
    created_at: '2026-06-10T08:00:00Z',
    ...overrides,
  };
}

const noop = vi.fn();

function renderDialog(
  links: ShareLinks,
  overrides: {
    onCreateLink?: (kind: 'client' | 'public') => Promise<void>;
    onToggle?: (id: string, field: 'allow_download' | 'allow_approve' | 'allow_revision', value: boolean) => Promise<void>;
    onClose?: () => void;
    propertyId?: string;
    baseUrl?: string;
  } = {},
) {
  return render(
    <ShareDialog
      propertyId={overrides.propertyId ?? 'prop-abc'}
      baseUrl={overrides.baseUrl ?? 'https://listingelevate.com'}
      links={links}
      onCreateLink={overrides.onCreateLink ?? noop}
      onToggle={overrides.onToggle ?? noop}
      onClose={overrides.onClose ?? noop}
    />,
  );
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// 1. Two sections always rendered
// ---------------------------------------------------------------------------

describe('ShareDialog — sections', () => {
  it('renders the Client review link section', () => {
    renderDialog({ client: null, public: null });
    expect(screen.getByTestId('share-section-client')).toBeTruthy();
  });

  it('renders the Public sharing link section', () => {
    renderDialog({ client: null, public: null });
    expect(screen.getByTestId('share-section-public')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. Create-if-none
// ---------------------------------------------------------------------------

describe('ShareDialog — create-if-none', () => {
  it('shows a create button for the client section when no client link exists', () => {
    renderDialog({ client: null, public: null });
    expect(screen.getByTestId('create-client-link')).toBeTruthy();
  });

  it('shows a create button for the public section when no public link exists', () => {
    renderDialog({ client: null, public: null });
    expect(screen.getByTestId('create-public-link')).toBeTruthy();
  });

  it('calls onCreateLink with kind=client when client create button is clicked', async () => {
    const onCreateLink = vi.fn().mockResolvedValue(undefined);
    renderDialog({ client: null, public: null }, { onCreateLink });
    fireEvent.click(screen.getByTestId('create-client-link'));
    await waitFor(() => expect(onCreateLink).toHaveBeenCalledWith('client'));
  });

  it('calls onCreateLink with kind=public when public create button is clicked', async () => {
    const onCreateLink = vi.fn().mockResolvedValue(undefined);
    renderDialog({ client: null, public: null }, { onCreateLink });
    fireEvent.click(screen.getByTestId('create-public-link'));
    await waitFor(() => expect(onCreateLink).toHaveBeenCalledWith('public'));
  });

  it('hides the create button when a client link already exists', () => {
    renderDialog({ client: makeClientLink(), public: null });
    expect(screen.queryByTestId('create-client-link')).toBeNull();
  });

  it('hides the create button when a public link already exists', () => {
    renderDialog({ client: null, public: makePublicLink() });
    expect(screen.queryByTestId('create-public-link')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Copy URL
// ---------------------------------------------------------------------------

describe('ShareDialog — copy URL', () => {
  it('shows the copy button for a client link when one exists', () => {
    renderDialog({ client: makeClientLink(), public: null });
    expect(screen.getByTestId('copy-client-link')).toBeTruthy();
  });

  it('shows the copy button for a public link when one exists', () => {
    renderDialog({ client: null, public: makePublicLink() });
    expect(screen.getByTestId('copy-public-link')).toBeTruthy();
  });

  it('calls navigator.clipboard.writeText with the correct URL on copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    renderDialog({ client: makeClientLink(), public: null });
    fireEvent.click(screen.getByTestId('copy-client-link'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('clienttoken111111111111111111111'),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 4. View stats
// ---------------------------------------------------------------------------

describe('ShareDialog — view stats', () => {
  it('shows the viewed_count for the client link', () => {
    renderDialog({ client: makeClientLink({ viewed_count: 7 }), public: null });
    expect(screen.getByTestId('client-view-count').textContent).toContain('7');
  });

  it('shows last_viewed_at text for the client link when set', () => {
    renderDialog({
      client: makeClientLink({ last_viewed_at: '2026-06-10T09:00:00Z' }),
      public: null,
    });
    expect(screen.getByTestId('client-last-viewed')).toBeTruthy();
  });

  it('does not show last-viewed when last_viewed_at is null', () => {
    renderDialog({ client: makeClientLink({ last_viewed_at: null }), public: null });
    expect(screen.queryByTestId('client-last-viewed')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Capability toggles
// ---------------------------------------------------------------------------

describe('ShareDialog — capability toggles', () => {
  it('renders download toggle for client link', () => {
    renderDialog({ client: makeClientLink(), public: null });
    expect(screen.getByTestId('toggle-client-allow_download')).toBeTruthy();
  });

  it('renders approve toggle for client link', () => {
    renderDialog({ client: makeClientLink(), public: null });
    expect(screen.getByTestId('toggle-client-allow_approve')).toBeTruthy();
  });

  it('renders revision toggle for client link', () => {
    renderDialog({ client: makeClientLink(), public: null });
    expect(screen.getByTestId('toggle-client-allow_revision')).toBeTruthy();
  });

  it('renders download toggle for public link', () => {
    renderDialog({ client: null, public: makePublicLink() });
    expect(screen.getByTestId('toggle-public-allow_download')).toBeTruthy();
  });

  it('toggle reflects current allow_download value (checked when true)', () => {
    renderDialog({ client: makeClientLink({ allow_download: true }), public: null });
    const toggle = screen.getByTestId('toggle-client-allow_download') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it('toggle reflects current allow_approve value (unchecked when false)', () => {
    renderDialog({ client: makeClientLink({ allow_approve: false }), public: null });
    const toggle = screen.getByTestId('toggle-client-allow_approve') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it('calls onToggle with correct args when download toggle is clicked', async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    renderDialog({ client: makeClientLink({ allow_download: true }), public: null }, { onToggle });
    const toggle = screen.getByTestId('toggle-client-allow_download');
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(onToggle).toHaveBeenCalledWith('pv-client-1', 'allow_download', false),
    );
  });

  it('calls onToggle with correct args when approve toggle is flipped on', async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    renderDialog({ client: makeClientLink({ allow_approve: false }), public: null }, { onToggle });
    const toggle = screen.getByTestId('toggle-client-allow_approve');
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(onToggle).toHaveBeenCalledWith('pv-client-1', 'allow_approve', true),
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Approved badge
// ---------------------------------------------------------------------------

describe('ShareDialog — Approved badge', () => {
  it('shows the Approved badge when client link has approved_at set', () => {
    renderDialog({
      client: makeClientLink({ approved_at: '2026-06-11T10:00:00Z' }),
      public: null,
    });
    expect(screen.getByTestId('client-approved-badge')).toBeTruthy();
  });

  it('does NOT show the Approved badge when approved_at is null', () => {
    renderDialog({ client: makeClientLink({ approved_at: null }), public: null });
    expect(screen.queryByTestId('client-approved-badge')).toBeNull();
  });

  it('does NOT show Approved badge for the public link (public has no approval concept)', () => {
    renderDialog({
      client: null,
      public: makePublicLink({ approved_at: '2026-06-11T10:00:00Z' } as Partial<PreviewLinkRow>),
    });
    // Public section should not render the client-approved-badge
    expect(screen.queryByTestId('client-approved-badge')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. Close callback
// ---------------------------------------------------------------------------

describe('ShareDialog — close', () => {
  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    renderDialog({ client: null, public: null }, { onClose });
    fireEvent.click(screen.getByTestId('share-dialog-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
