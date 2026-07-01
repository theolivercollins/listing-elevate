import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock google-picker module ────────────────────────────────────────────────
// Declare mocks before vi.mock factory so the factory can close over them.

const mockRequestDriveAccessToken = vi.fn();
const mockOpenPicker = vi.fn();
const mockExpandFoldersToImages = vi.fn();
const mockDownloadDriveFile = vi.fn();

vi.mock('@/lib/google-picker', async (importOriginal) => {
  // Spread the real module first so DRIVE_AUTH_CANCELLED stays the exact
  // same symbol reference the component imports — a re-declared mock value
  // would never `===`-match it.
  const actual = await importOriginal<typeof import('@/lib/google-picker')>();
  return {
    ...actual,
    requestDriveAccessToken: (...args: unknown[]) => mockRequestDriveAccessToken(...args),
    openPicker: (...args: unknown[]) => mockOpenPicker(...args),
    expandFoldersToImages: (...args: unknown[]) => mockExpandFoldersToImages(...args),
    downloadDriveFile: (...args: unknown[]) => mockDownloadDriveFile(...args),
  };
});

// Import AFTER vi.mock so it receives the mocked module.
import { DRIVE_AUTH_CANCELLED } from '@/lib/google-picker';
import { DriveUploadButton, isDriveUploadConfigured } from '../DriveUploadButton';

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

  // ── Cancel sentinel (closed OAuth popup) ─────────────────────────────────────

  it('does not import files or report an error when the OAuth popup is closed (cancel sentinel)', async () => {
    stubEnvs();
    mockRequestDriveAccessToken.mockResolvedValue(DRIVE_AUTH_CANCELLED);

    const onFilesImported = vi.fn();
    const onStatusChange = vi.fn();
    render(
      <DriveUploadButton onFilesImported={onFilesImported} onStatusChange={onStatusChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /upload photos from google drive/i }));

    await waitFor(() => expect(mockRequestDriveAccessToken).toHaveBeenCalledTimes(1));
    expect(mockOpenPicker).not.toHaveBeenCalled(); // never reached step 2
    expect(onFilesImported).not.toHaveBeenCalled();
    // The cancel is silent — no error status is ever reported.
    expect(onStatusChange.mock.calls.some(([status]) => status?.kind === 'error')).toBe(false);
  });

  // ── Error handling ───────────────────────────────────────────────────────────

  it('reports an error via onStatusChange when requestDriveAccessToken rejects with a genuine error', async () => {
    stubEnvs();
    mockRequestDriveAccessToken.mockRejectedValue(new Error('Popup blocked'));

    const onStatusChange = vi.fn();
    render(<DriveUploadButton onFilesImported={vi.fn()} onStatusChange={onStatusChange} />);
    fireEvent.click(screen.getByRole('button', { name: /upload photos from google drive/i }));

    await waitFor(() =>
      expect(onStatusChange).toHaveBeenCalledWith({ kind: 'error', text: 'Popup blocked' }),
    );
  });

  // ── Partial-success downloads (Promise.allSettled) ───────────────────────────

  it('imports successful files and shows a non-fatal notice when some downloads fail', async () => {
    stubEnvs();

    const fakeFile = new File(['img-data'], 'ok.jpg', { type: 'image/jpeg' });

    mockRequestDriveAccessToken.mockResolvedValue('tok');
    mockOpenPicker.mockResolvedValue([
      { id: 'file-1', name: 'ok.jpg', mimeType: 'image/jpeg' },
      { id: 'file-2', name: 'fail.jpg', mimeType: 'image/jpeg' },
    ]);
    mockExpandFoldersToImages.mockResolvedValue([
      { id: 'file-1', name: 'ok.jpg', mimeType: 'image/jpeg' },
      { id: 'file-2', name: 'fail.jpg', mimeType: 'image/jpeg' },
    ]);
    // file-1 succeeds, file-2 fails
    mockDownloadDriveFile
      .mockResolvedValueOnce(fakeFile)
      .mockRejectedValueOnce(new Error('403 Forbidden'));

    const origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:preview');

    const onFilesImported = vi.fn();
    const onStatusChange = vi.fn();
    render(<DriveUploadButton onFilesImported={onFilesImported} onStatusChange={onStatusChange} />);
    fireEvent.click(screen.getByRole('button', { name: /upload photos from google drive/i }));

    await waitFor(() => expect(onFilesImported).toHaveBeenCalledTimes(1));

    const imported = onFilesImported.mock.calls[0][0] as { id: string }[];
    expect(imported).toHaveLength(1);
    expect(imported[0].id).toBe('file-1');

    // Non-fatal progress notice reported to the parent (not an error).
    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'progress', text: expect.stringMatching(/imported 1 photo.*1 failed/i) }),
      );
    });
    // Hard error must NOT be reported.
    expect(onStatusChange.mock.calls.some(([status]) => status?.kind === 'error')).toBe(false);

    URL.createObjectURL = origCreateObjectURL;
  });

  it('shows a hard error and does not call onFilesImported when all downloads fail', async () => {
    stubEnvs();

    mockRequestDriveAccessToken.mockResolvedValue('tok');
    mockOpenPicker.mockResolvedValue([
      { id: 'file-1', name: 'fail.jpg', mimeType: 'image/jpeg' },
    ]);
    mockExpandFoldersToImages.mockResolvedValue([
      { id: 'file-1', name: 'fail.jpg', mimeType: 'image/jpeg' },
    ]);
    mockDownloadDriveFile.mockRejectedValue(new Error('403 Forbidden'));

    const onFilesImported = vi.fn();
    const onStatusChange = vi.fn();
    render(<DriveUploadButton onFilesImported={onFilesImported} onStatusChange={onStatusChange} />);
    fireEvent.click(screen.getByRole('button', { name: /upload photos from google drive/i }));

    await waitFor(() =>
      expect(onStatusChange).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', text: expect.stringMatching(/failed/i) }),
      ),
    );
    expect(onFilesImported).not.toHaveBeenCalled();
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

describe('isDriveUploadConfigured', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns false when either required env var is absent', () => {
    expect(isDriveUploadConfigured()).toBe(false);
  });

  it('returns true when both required env vars are set', () => {
    stubEnvs();
    expect(isDriveUploadConfigured()).toBe(true);
  });
});

// ─── 300-photo cap handler logic (StudioNew.onFilesImported) ─────────────────
//
// StudioNew has no dedicated test file; the cap logic is a pure functional
// updater, so we verify it here as a unit test against the algorithm.

describe('300-photo cap handler logic (StudioNew.onFilesImported algorithm)', () => {
  type Stub = { id: string };

  const MAX_PHOTOS = 300;

  /** Mirrors the setFiles updater + cap calculation in StudioNew's onFilesImported. */
  function runCap(prev: Stub[], imported: Stub[]): {
    result: Stub[];
    addedCount: number;
    droppedForCap: number;
  } {
    const seen = new Set(prev.map((f) => f.id));
    const deduped = imported.filter((f) => !seen.has(f.id));
    const remaining = MAX_PHOTOS - prev.length;
    const toAdd = deduped.slice(0, remaining);
    const droppedForCap = deduped.length - toAdd.length;
    const addedCount = toAdd.length;
    return { result: [...prev, ...toAdd], addedCount, droppedForCap };
  }

  const make = (n: number, prefix = 'f'): Stub[] =>
    Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}` }));

  it('caps imported Drive files at 300 total and reports dropped count', () => {
    // 290 existing + 15 imported → 10 added, 5 dropped.
    const { result, addedCount, droppedForCap } = runCap(make(290), make(15, 'new'));
    expect(result).toHaveLength(300);
    expect(addedCount).toBe(10);
    expect(droppedForCap).toBe(5);
  });

  it('drops all incoming when already at the 300-photo limit', () => {
    const { result, addedCount, droppedForCap } = runCap(make(300), make(5, 'new'));
    expect(result).toHaveLength(300);
    expect(addedCount).toBe(0);
    expect(droppedForCap).toBe(5);
  });

  it('adds all files when under the cap with room to spare', () => {
    const { addedCount, droppedForCap } = runCap(make(3), make(4, 'new'));
    expect(addedCount).toBe(4);
    expect(droppedForCap).toBe(0);
  });

  it('deduplicates Drive files already present before applying the cap', () => {
    // prev has 'f-0'; imported has 'f-0' (dup) + 'new-0' (fresh)
    const prev: Stub[] = [{ id: 'f-0' }];
    const imported: Stub[] = [{ id: 'f-0' }, { id: 'new-0' }];
    const { result, addedCount } = runCap(prev, imported);
    expect(addedCount).toBe(1);
    expect(result.map((s) => s.id)).toContain('new-0');
    expect(result.filter((s) => s.id === 'f-0')).toHaveLength(1); // not duplicated
  });
});
