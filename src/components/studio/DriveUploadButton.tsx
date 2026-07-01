import { useState } from 'react';
import { Cloud, Loader2 } from 'lucide-react';
import {
  requestDriveAccessToken,
  openPicker,
  expandFoldersToImages,
  downloadDriveFile,
  DRIVE_AUTH_CANCELLED,
} from '@/lib/google-picker';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ImportedFile {
  file: File;
  preview: string;
  id: string;
}

/**
 * Transient progress/error text this button reports upward. Rendered by the
 * caller in a single shared status line — this component no longer renders
 * its own inline text, so it can never pop a message under just itself and
 * skew a multi-button row's height.
 */
export type DriveStatus = { kind: 'progress' | 'error'; text: string } | null;

interface DriveUploadButtonProps {
  onFilesImported: (files: ImportedFile[]) => void;
  /** Called whenever progress/error text changes, including with `null` to
   *  clear it. Optional so the component still degrades gracefully without
   *  a listener (no visible progress/error, but no crash either). */
  onStatusChange?: (status: DriveStatus) => void;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/** How many Drive files to download concurrently. */
const BATCH_SIZE = 12;

// ─── Feature gate ──────────────────────────────────────────────────────────────

/**
 * Whether the "Upload from Drive" feature is configured for this deployment
 * (both required env vars present). Exported so callers (StudioNew) can
 * decide layout — e.g. collapse a 2-column button grid to one full-width
 * button — without duplicating this gate condition.
 */
export function isDriveUploadConfigured(): boolean {
  return Boolean(
    (import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined) &&
      (import.meta.env.VITE_GOOGLE_PICKER_API_KEY as string | undefined),
  );
}

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
 *      If the operator closes the popup, this resolves to DRIVE_AUTH_CANCELLED
 *      — treated as a silent no-op, never an error (see google-picker.ts).
 *   2. Opens the Google Picker so the operator selects photos / folders.
 *   3. Expands any selected folders into their child image files.
 *   4. Downloads each image in batches of BATCH_SIZE.
 *   5. Calls onFilesImported with real File objects, deduped by Drive file ID.
 *
 * The files land in the same UploadedFile shape used by the rest of the form
 * so they flow through the existing uploadPhotosToStorage path unchanged.
 */
export function DriveUploadButton({ onFilesImported, onStatusChange }: DriveUploadButtonProps) {
  // Read env vars inside the component body so vi.stubEnv works in tests.
  const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined;
  const apiKey = import.meta.env.VITE_GOOGLE_PICKER_API_KEY as string | undefined;
  const appId = import.meta.env.VITE_GOOGLE_PROJECT_NUMBER as string | undefined;

  const [busy, setBusy] = useState(false);

  // Feature is off when either required credential is absent.
  if (!clientId || !apiKey) return null;

  const handleClick = async () => {
    setBusy(true);
    onStatusChange?.(null);

    try {
      // Step 1 — OAuth
      const accessToken = await requestDriveAccessToken({ clientId });
      if (accessToken === DRIVE_AUTH_CANCELLED) return; // closed the popup — not a failure

      // Step 2 — Picker
      const picked = await openPicker({ accessToken, apiKey, appId: appId ?? '' });
      if (picked.length === 0) return; // user cancelled or picked nothing

      // Step 3 — Expand folders
      const images = await expandFoldersToImages(picked, accessToken);
      if (images.length === 0) return;

      onStatusChange?.({
        kind: 'progress',
        text: `Importing ${images.length} photo${images.length !== 1 ? 's' : ''} from Drive…`,
      });

      // Step 4 — Download in batches (allSettled so a single 403 doesn't abort
      // the whole import — successes are kept, failures counted).
      const imported: ImportedFile[] = [];
      let totalFailures = 0;
      for (let i = 0; i < images.length; i += BATCH_SIZE) {
        const batch = images.slice(i, i + BATCH_SIZE);
        const settled = await Promise.allSettled(
          batch.map((img) => downloadDriveFile(img, accessToken)),
        );
        for (let j = 0; j < settled.length; j++) {
          const result = settled[j];
          if (result.status === 'fulfilled') {
            const file = result.value;
            imported.push({
              file,
              preview: URL.createObjectURL(file),
              id: images[i + j].id,
            });
          } else {
            totalFailures++;
          }
        }
        onStatusChange?.({
          kind: 'progress',
          text: `Importing ${imported.length} / ${images.length} photo${images.length !== 1 ? 's' : ''} from Drive…`,
        });
      }

      // Step 5 — Deduplicate within the batch (e.g. same image picked directly
      // AND via its parent folder) then hand off. A dropped duplicate owns an
      // objectURL preview that never reaches the caller's files state, so
      // revoke it here so the blob URL doesn't leak.
      const seen = new Set<string>();
      const deduped: ImportedFile[] = [];
      for (const f of imported) {
        if (seen.has(f.id)) {
          URL.revokeObjectURL(f.preview);
          continue;
        }
        seen.add(f.id);
        deduped.push(f);
      }

      if (deduped.length === 0) {
        // Every download failed — surface as a hard error.
        throw new Error(
          `All ${images.length} photo download${images.length !== 1 ? 's' : ''} failed. Check your Drive permissions.`,
        );
      }

      onFilesImported(deduped);

      if (totalFailures > 0) {
        // Partial success — import the winners, show a non-fatal notice.
        onStatusChange?.({
          kind: 'progress',
          text: `Imported ${deduped.length} photo${deduped.length !== 1 ? 's' : ''}; ${totalFailures} failed to download.`,
        });
      } else {
        onStatusChange?.(null);
      }
    } catch (err) {
      onStatusChange?.({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Drive import failed',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={handleClick}
      className="studio-btn-ghost"
      aria-label="Upload photos from Google Drive"
      style={{ justifyContent: 'center', width: '100%' }}
    >
      <span
        style={{
          display: 'inline-flex',
          width: 16,
          height: 16,
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {busy ? (
          <Loader2 size={14} strokeWidth={1.8} className="studio-spinner" />
        ) : (
          <Cloud size={14} strokeWidth={1.8} />
        )}
      </span>
      {busy ? 'Importing…' : 'Upload from Drive'}
    </button>
  );
}
