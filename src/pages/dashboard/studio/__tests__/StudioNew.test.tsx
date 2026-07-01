/**
 * StudioNew — draft resume-banner tests.
 *
 * Scope: the highest-value, most isolated new behavior — restoring (or
 * discarding) an autosaved draft on mount. File-upload / eager-upload
 * behavior is covered separately by src/lib/studio/draft.test.ts and
 * lib/studio/__tests__/drafts.test.ts; this file focuses on the page-level
 * wiring (getLatestDraft on mount -> banner -> Resume hydrates fields /
 * Discard clears it), matching the mocking style established in
 * PropertyCommandCenter.test.tsx (mock @/lib/api + heavy child components).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Network seam — authedFetch / lookupMls.
// ---------------------------------------------------------------------------
const mockAuthedFetch = vi.fn();
const mockLookupMls = vi.fn();

vi.mock('@/lib/api', () => ({
  authedFetch: (...args: unknown[]) => mockAuthedFetch(...args),
  lookupMls: (...args: unknown[]) => mockLookupMls(...args),
}));

// ---------------------------------------------------------------------------
// Draft client lib — controllable per test.
// ---------------------------------------------------------------------------
const mockGetLatestDraft = vi.fn();
const mockSaveDraft = vi.fn();
const mockDeleteDraft = vi.fn();

vi.mock('@/lib/studio/draft', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/studio/draft')>();
  return {
    ...actual,
    getLatestDraft: (...args: unknown[]) => mockGetLatestDraft(...args),
    saveDraft: (...args: unknown[]) => mockSaveDraft(...args),
    deleteDraft: (...args: unknown[]) => mockDeleteDraft(...args),
  };
});

// ---------------------------------------------------------------------------
// Mock heavy/irrelevant child components (matches PropertyCommandCenter.test.tsx).
// ---------------------------------------------------------------------------
vi.mock('@/components/studio/StudioNav', () => ({
  StudioNav: () => <div data-testid="studio-nav" />,
}));
vi.mock('@/components/studio/StudioShell', () => ({
  StudioShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="studio-shell">{children}</div>
  ),
}));
vi.mock('@/components/studio/ClientPicker', () => ({
  ClientPicker: () => <div data-testid="client-picker" />,
}));
vi.mock('@/components/studio/DriveUploadButton', () => ({
  DriveUploadButton: () => <div data-testid="drive-upload-button" />,
}));
vi.mock('@/components/AddressAutocomplete', () => ({
  AddressAutocomplete: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
  }) => (
    <input aria-label="address" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import StudioNew from '../StudioNew';

function renderPage() {
  return render(
    <MemoryRouter>
      <StudioNew />
    </MemoryRouter>,
  );
}

const baseDraft = {
  id: 'draft-1',
  submitted_by: 'admin-1',
  client_id: null,
  address: '470 Sorrento Ct',
  bedrooms: 4,
  bathrooms: 2.5,
  square_footage: 2200,
  price: 950000,
  director_notes: 'Golden hour on the patio',
  selected_duration: 30,
  video_type: 'just_listed',
  video_model_sku: null,
  auto_run: false,
  photo_paths: [
    { path: 'draft-1/raw/a.jpg', url: 'https://cdn.example.com/a.jpg', name: 'a.jpg' },
  ],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

beforeEach(() => {
  mockAuthedFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
  mockLookupMls.mockReset();
  mockGetLatestDraft.mockReset().mockResolvedValue(null);
  mockSaveDraft.mockReset().mockResolvedValue(null);
  mockDeleteDraft.mockReset().mockResolvedValue(true);
});

describe('StudioNew — draft resume banner', () => {
  it('does not show the resume banner when there is no draft', async () => {
    renderPage();
    await waitFor(() => expect(mockGetLatestDraft).toHaveBeenCalled());
    expect(screen.queryByText(/resume your unsaved order/i)).not.toBeInTheDocument();
  });

  it('does not show the resume banner for an empty/stale draft row', async () => {
    mockGetLatestDraft.mockResolvedValue({
      ...baseDraft,
      address: null,
      bedrooms: null,
      bathrooms: null,
      square_footage: null,
      price: null,
      director_notes: null,
      photo_paths: [],
    });
    renderPage();
    await waitFor(() => expect(mockGetLatestDraft).toHaveBeenCalled());
    expect(screen.queryByText(/resume your unsaved order/i)).not.toBeInTheDocument();
  });

  it('shows the resume banner and hydrates the form on Resume', async () => {
    mockGetLatestDraft.mockResolvedValue(baseDraft);

    renderPage();

    await screen.findByText(/resume your unsaved order/i);
    expect(screen.getByText(/470 Sorrento Ct/i)).toBeInTheDocument();
    expect(screen.getByText(/1 photo saved/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^resume$/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('470 Sorrento Ct')).toBeInTheDocument();
    });
    expect(screen.queryByText(/resume your unsaved order/i)).not.toBeInTheDocument();
    // Director notes should also be hydrated.
    expect(screen.getByDisplayValue(/golden hour on the patio/i)).toBeInTheDocument();
  });

  it('discards the draft and hides the banner on Discard, without touching the form', async () => {
    mockGetLatestDraft.mockResolvedValue(baseDraft);

    renderPage();
    await screen.findByText(/resume your unsaved order/i);

    fireEvent.click(screen.getByRole('button', { name: /discard/i }));

    // Discard reclaims Storage too (purge=1) — distinct from the submit-path
    // delete, which is row-only (see src/lib/studio/draft.ts deleteDraft).
    await waitFor(() =>
      expect(mockDeleteDraft).toHaveBeenCalledWith('draft-1', { purge: true }),
    );
    expect(screen.queryByText(/resume your unsaved order/i)).not.toBeInTheDocument();
    // The address field was never hydrated from the discarded draft.
    expect(screen.queryByDisplayValue('470 Sorrento Ct')).not.toBeInTheDocument();
  });
});
