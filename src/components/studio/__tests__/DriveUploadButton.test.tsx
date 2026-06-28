import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock google-picker module ────────────────────────────────────────────────
// Declare mocks before vi.mock factory so the factory can close over them.

const mockRequestDriveAccessToken = vi.fn();
const mockOpenPicker = vi.fn();
const mockExpandFoldersToImages = vi.fn();
const mockDownloadDriveFile = vi.fn();

vi.mock('@/lib/google-picker', () => ({
  requestDriveAccessToken: (...args: unknown[]) => mockRequestDriveAccessToken(...args),
  openPicker: (...args: unknown[]) => mockOpenPicker(...args),
  expandFoldersToImages: (...args: unknown[]) => mockExpandFoldersToImages(...args),
  downloadDriveFile: (...args: unknown[]) => mockDownloadDriveFile(...args),
}));

// Import AFTER vi.mock so it receives the mocked module.
import { DriveUploadButton } from '../DriveUploadButton';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stubEnvs() {
  vi.stubEnv('VITE_GOOGLE_OAUTH_CLIENT_ID', 'test-client-id');
  vi.stubEnv('VITE_GOOGLE_PICKER_API_KEY', 'test-api-key');
  vi.stubEnv('VITE_GOOGLE_PROJECT_NUMBER', '123456789');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DriveUploadButton', () => {
  beforeEach(() => {
    mockRequestDriveAccessToken.mockReset();
    mockOpenPicker.mockReset();
    mockExpandFoldersToImages.mockReset();
    mockDownloadDriveFile.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── Feature gate ─────────────────────────────────────────────────────────────

  it('renders nothing when VITE_GOOGLE_OAUTH_CLIENT_ID is absent', () => {
    // No env stubbing — both vars are undefined by default in the test env.
    const { container } = render(<DriveUploadButton onFilesImported={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when VITE_GOOGLE_PICKER_API_KEY is absent', () => {
    vi.stubEnv('VITE_GOOGLE_OAUTH_CLIENT_ID', 'test-client-id');
    // No apiKey stubbed → should still hide the button.
    const { container } = render(<DriveUploadButton onFilesImported={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the button when both required env vars are set', () => {
    stubEnvs();
    render(<DriveUploadButton onFilesImported={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: /upload photos from google drive/i }),
    ).toBeInTheDocument();
  });

  // ── Happy-path PICKED flow ───────────────────────────────────────────────────

  it('calls onFilesImported with File objects after a full PICKED flow', async () => {
    stubEnvs();

    const fakeFile = new File(['img-data'], 'photo.jpg', { type: 'image/jpeg' });

    mockRequestDriveAccessToken.mockResolvedValue('tok-abc');
    mockOpenPicker.mockResolvedValue([
      { id: 'drive-file-1', name: 'photo.jpg', mimeType: 'image/jpeg' },
    ]);
    mockExpandFoldersToImages.mockResolvedValue([
      { id: 'drive-file-1', name: 'photo.jpg', mimeType: 'image/jpeg' },
    ]);
    mockDownloadDriveFile.mockResolvedValue(fakeFile);

    const origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:fake-preview');

    const onFilesImported = vi.fn();
    render(<DriveUploadButton onFilesImported={onFilesImported} />);

    fireEvent.click(screen.getByRole('button', { name: /upload photos from google drive/i }));

    await waitFor(() => expect(onFilesImported).toHaveBeenCalledTimes(1));

    const imported = onFilesImported.mock.calls[0][0] as Array<{
      file: File;
      preview: string;
      id: string;
    }>;
    expect(imported).toHaveLength(1);
    expect(imported[0].file).toBe(fakeFile);
    expect(imported[0].id).toBe('drive-file-1');
    expect(imported[0].preview).toBe('blob:fake-preview');

    URL.createObjectURL = origCreateObjectURL;
  });

  // ── Cancel / empty picker ────────────────────────────────────────────────────

  it('does not call onFilesImported when the user cancels the picker', async () => {
    stubEnvs();
    mockRequestDriveAccessToken.mockResolvedValue('tok-abc');
    mockOpenPicker.mockResolvedValue([]); // user cancelled

    const onFilesImported = vi.fn();
    render(<DriveUploadButton onFilesImported={onFilesImported} />);

    fireEvent.click(screen.getByRole('button', { name: /upload photos from google drive/i }));

    // Give async handlers time to settle.
    await waitFor(() => expect(mockOpenPicker).toHaveBeenCalledTimes(1));
    expect(onFilesImported).not.toHaveBeenCalled();
  });

  // ── Error handling ───────────────────────────────────────────────────────────

  it('shows an inline error message when requestDriveAccessToken rejects', async () => {
    stubEnvs();
    mockRequestDriveAccessToken.mockRejectedValue(new Error('Popup blocked'));

    render(<DriveUploadButton onFilesImported={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /upload photos from google drive/i }));

    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Popup blocked');
  });

  // ── Deduplication within a batch ─────────────────────────────────────────────

  it('deduplicates files with the same Drive id within the imported batch', async () => {
    stubEnvs();

    const fakeFile = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });

    mockRequestDriveAccessToken.mockResolvedValue('tok');
    // expandFoldersToImages returns the same file id twice (e.g., picked via
    // folder AND directly).
    mockOpenPicker.mockResolvedValue([
      { id: 'dup-id', name: 'photo.jpg', mimeType: 'image/jpeg' },
      { id: 'dup-id', name: 'photo.jpg', mimeType: 'image/jpeg' },
    ]);
    mockExpandFoldersToImages.mockResolvedValue([
      { id: 'dup-id', name: 'photo.jpg', mimeType: 'image/jpeg' },
      { id: 'dup-id', name: 'photo.jpg', mimeType: 'image/jpeg' },
    ]);
    mockDownloadDriveFile.mockResolvedValue(fakeFile);

    const origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:preview');

    const onFilesImported = vi.fn();
    render(<DriveUploadButton onFilesImported={onFilesImported} />);
    fireEvent.click(screen.getByRole('button', { name: /upload photos from google drive/i }));

    await waitFor(() => expect(onFilesImported).toHaveBeenCalledTimes(1));

    const imported = onFilesImported.mock.calls[0][0] as { id: string }[];
    expect(imported).toHaveLength(1);

    URL.createObjectURL = origCreateObjectURL;
  });
});
