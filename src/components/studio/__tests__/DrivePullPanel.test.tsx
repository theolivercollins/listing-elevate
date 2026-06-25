import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DrivePullPanel } from '../DrivePullPanel';
import type { DrivePullResult } from '../DrivePullPanel';

// ── Mock authedFetch ──────────────────────────────────────────────────────────

const authedFetch = vi.fn();

vi.mock('@/lib/api', () => ({
  authedFetch: (...args: unknown[]) => authedFetch(...args),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function jsonResp(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    text: async () => (ok ? '' : String(status)),
    json: async () => body,
  };
}

const MOCK_FOLDERS = [
  { id: 'folder-1', name: '123 Main St', photoCount: 42 },
  { id: 'folder-2', name: '456 Elm Ave', photoCount: null },
];

const MOCK_PULL: DrivePullResult & { photoCount: number; mlsError?: string } = {
  address: '123 Main St, Minneapolis MN',
  metadata: {
    price: 450000,
    bedrooms: 3,
    bathrooms: 2,
    sqft: 1800,
  },
  photos: [{ path: 'photos/1.jpg', url: 'https://cdn.test/1.jpg' }],
  photoCount: 42,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DrivePullPanel', () => {
  beforeEach(() => {
    authedFetch.mockReset();
  });

  it('renders the card title, subtitle, and browse button in idle state', () => {
    render(<DrivePullPanel onPulled={vi.fn()} />);
    expect(screen.getByText('Pull from Google Drive')).toBeInTheDocument();
    expect(screen.getByText("Brian's 2026 listing photos")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Browse Google Drive folders/i })).toBeInTheDocument();
  });

  it('shows loading state while fetching then renders the folder list', async () => {
    authedFetch.mockResolvedValueOnce(jsonResp({ folders: MOCK_FOLDERS }));
    render(<DrivePullPanel onPulled={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Browse Google Drive folders/i }));
    expect(screen.getByText('Loading…')).toBeInTheDocument();

    await screen.findByText('123 Main St');
    expect(screen.getByText('456 Elm Ave')).toBeInTheDocument();
    expect(screen.getByText('42 photos')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows "No folders found." when the list is empty', async () => {
    authedFetch.mockResolvedValueOnce(jsonResp({ folders: [] }));
    render(<DrivePullPanel onPulled={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Browse Google Drive folders/i }));
    await screen.findByText('No folders found.');
  });

  it('clicking a folder calls the pull endpoint and then calls onPulled with parsed result', async () => {
    authedFetch
      .mockResolvedValueOnce(jsonResp({ folders: MOCK_FOLDERS }))
      .mockResolvedValueOnce(jsonResp(MOCK_PULL));

    const onPulled = vi.fn();
    render(<DrivePullPanel onPulled={onPulled} />);

    fireEvent.click(screen.getByRole('button', { name: /Browse Google Drive folders/i }));
    await screen.findByText('123 Main St');
    fireEvent.click(screen.getByRole('button', { name: /Pull folder 123 Main St/i }));

    await waitFor(() => expect(onPulled).toHaveBeenCalledTimes(1));

    const result: DrivePullResult = onPulled.mock.calls[0][0];
    expect(result.address).toBe('123 Main St, Minneapolis MN');
    expect(result.metadata.price).toBe(450000);
    expect(result.metadata.bedrooms).toBe(3);
    expect(result.photos).toHaveLength(1);
    expect(result.photos[0].url).toBe('https://cdn.test/1.jpg');

    // Verify pull endpoint received correct payload
    const pullCall = authedFetch.mock.calls[1];
    expect(pullCall[0]).toBe('/api/admin/studio/drive/pull');
    const body = JSON.parse(String(pullCall[1]?.body));
    expect(body).toEqual({ folderId: 'folder-1', folderName: '123 Main St' });
  });

  it('shows success line "enriched from Redfin" when mlsError is absent', async () => {
    authedFetch
      .mockResolvedValueOnce(jsonResp({ folders: MOCK_FOLDERS }))
      .mockResolvedValueOnce(jsonResp(MOCK_PULL));

    render(<DrivePullPanel onPulled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Browse Google Drive folders/i }));
    await screen.findByText('123 Main St');
    fireEvent.click(screen.getByRole('button', { name: /Pull folder 123 Main St/i }));

    await screen.findByText(/Pulled 42 photos · enriched from Redfin/);
  });

  it('shows degraded success text "Redfin enrichment unavailable" when mlsError is present', async () => {
    authedFetch
      .mockResolvedValueOnce(jsonResp({ folders: MOCK_FOLDERS }))
      .mockResolvedValueOnce(
        jsonResp({ ...MOCK_PULL, mlsError: 'Redfin returned no results' }),
      );

    render(<DrivePullPanel onPulled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Browse Google Drive folders/i }));
    await screen.findByText('123 Main St');
    fireEvent.click(screen.getByRole('button', { name: /Pull folder 123 Main St/i }));

    await screen.findByText(/Redfin enrichment unavailable/);
  });

  it('shows folders fetch error with a Retry button that re-fetches on click', async () => {
    authedFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'upstream error',
        json: async () => ({}),
      })
      .mockResolvedValueOnce(jsonResp({ folders: MOCK_FOLDERS }));

    render(<DrivePullPanel onPulled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Browse Google Drive folders/i }));

    // Error message appears
    await screen.findByText(/500/);
    const retryBtn = screen.getByRole('button', { name: /Retry loading folders/i });
    expect(retryBtn).toBeInTheDocument();

    // Retry loads folders successfully
    fireEvent.click(retryBtn);
    await screen.findByText('123 Main St');
  });

  it('shows pull error inline and keeps the folder list rendered for reselect', async () => {
    authedFetch
      .mockResolvedValueOnce(jsonResp({ folders: MOCK_FOLDERS }))
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => 'service down',
        json: async () => ({}),
      });

    const onPulled = vi.fn();
    render(<DrivePullPanel onPulled={onPulled} />);
    fireEvent.click(screen.getByRole('button', { name: /Browse Google Drive folders/i }));
    await screen.findByText('123 Main St');
    fireEvent.click(screen.getByRole('button', { name: /Pull folder 123 Main St/i }));

    // Error message appears under the row
    await screen.findByText(/503/);
    expect(onPulled).not.toHaveBeenCalled();

    // Other folders still present — user can pick a different one
    expect(screen.getByRole('button', { name: /Pull folder 456 Elm Ave/i })).toBeInTheDocument();
  });
});
