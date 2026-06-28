import { useState } from 'react';
import { Cloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  requestDriveAccessToken,
  openPicker,
  expandFoldersToImages,
  downloadDriveFile,
} from '@/lib/google-picker';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ImportedFile {
  file: File;
  preview: string;
  id: string;
}

interface DriveUploadButtonProps {
  onFilesImported: (files: ImportedFile[]) => void;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/** How many Drive files to download concurrently. */
const BATCH_SIZE = 5;

// ─── Component ─────────────────────────────────────────────────────────────────

/**
 * "Upload from Drive" button for the Operator Studio New Order photo area.
 *
 * Reads VITE_GOOGLE_OAUTH_CLIENT_ID and VITE_GOOGLE_PICKER_API_KEY from the
 * Vite env.  If either is missing the component renders nothing — the feature
 * is simply off, with no visible trace in the UI.
 *
 * On click the button:
 *   1. Requests a short-lived Drive read-only access token (interactive OAuth).
 *   2. Opens the Google Picker so the operator selects photos / folders.
 *   3. Expands any selected folders into their child image files.
 *   4. Downloads each image in batches of BATCH_SIZE.
 *   5. Calls onFilesImported with real File objects, deduped by Drive file ID.
 *
 * The files land in the same UploadedFile shape used by the rest of the form
 * so they flow through the existing uploadPhotosToStorage path unchanged.
 */
export function DriveUploadButton({ onFilesImported }: DriveUploadButtonProps) {
  // Read env vars inside the component body so vi.stubEnv works in tests.
  const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined;
  const apiKey = import.meta.env.VITE_GOOGLE_PICKER_API_KEY as string | undefined;
  const appId = import.meta.env.VITE_GOOGLE_PROJECT_NUMBER as string | undefined;

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Feature is off when either required credential is absent.
  if (!clientId || !apiKey) return null;

  const handleClick = async () => {
    setBusy(true);
    setError(null);
    setProgress(null);

    try {
      // Step 1 — OAuth
      const accessToken = await requestDriveAccessToken({ clientId });

      // Step 2 — Picker
      const picked = await openPicker({ accessToken, apiKey, appId: appId ?? '' });
      if (picked.length === 0) return; // user cancelled or picked nothing

      // Step 3 — Expand folders
      const images = await expandFoldersToImages(picked, accessToken);
      if (images.length === 0) return;

      setProgress(`Importing ${images.length} photo${images.length !== 1 ? 's' : ''} from Drive…`);

      // Step 4 — Download in batches
      const imported: ImportedFile[] = [];
      for (let i = 0; i < images.length; i += BATCH_SIZE) {
        const batch = images.slice(i, i + BATCH_SIZE);
        const files = await Promise.all(
          batch.map((img) => downloadDriveFile(img, accessToken)),
        );
        for (let j = 0; j < files.length; j++) {
          imported.push({
            file: files[j],
            preview: URL.createObjectURL(files[j]),
            id: images[i + j].id,
          });
        }
        setProgress(
          `Importing ${imported.length} / ${images.length} photo${images.length !== 1 ? 's' : ''} from Drive…`,
        );
      }

      // Step 5 — Deduplicate within the batch (e.g. same image picked directly
      // AND via its parent folder) then hand off.
      const seen = new Set<string>();
      const deduped = imported.filter((f) => {
        if (seen.has(f.id)) return false;
        seen.add(f.id);
        return true;
      });

      onFilesImported(deduped);
      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Drive import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={handleClick}
        className="gap-1.5 text-[12px] h-8 px-3"
        aria-label="Upload photos from Google Drive"
      >
        <Cloud size={13} strokeWidth={1.8} />
        {busy ? 'Connecting…' : 'Upload from Drive'}
      </Button>
      {progress && (
        <p
          style={{ marginTop: 4, fontSize: 11.5, color: 'var(--le-muted)' }}
          aria-live="polite"
        >
          {progress}
        </p>
      )}
      {error && (
        <p
          style={{ marginTop: 4, fontSize: 11.5, color: 'var(--le-bad)' }}
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
