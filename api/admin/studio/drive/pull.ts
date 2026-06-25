/**
 * POST /api/admin/studio/drive/pull
 *
 * Admin-only endpoint. Given a Google Drive folder, downloads all photos
 * server-side into Supabase Storage (`property-photos` bucket) and enriches
 * the listing with Redfin MLS data. Returns a payload the New Order form can
 * pre-fill with. Does NOT create a property row.
 *
 * Write guard: storage uploads only happen when
 *   VERCEL_ENV === 'production' OR LE_ALLOW_NONPROD_WRITES === 'true'
 * (same convention used across the codebase).
 *
 * Security hardening:
 *   - folderId is validated against a strict character/length pattern.
 *   - folderId must be a direct child of DRIVE_PARENT_FOLDER_ID (scope check).
 *   - The authoritative folder name from Drive is used as the address; the
 *     client-supplied folderName is accepted as a display-only fallback.
 *   - Error details are never echoed back to the client.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth.js';
import {
  listPropertyFolders,
  findFinalSubfolder,
  listFinalImages,
  downloadFile,
  DriveUnconfiguredError,
} from '../../../../lib/drive/client.js';
import { lookupMlsByAddress } from '../../../../lib/mls/lookup.js';
import { getSupabase } from '../../../../lib/client.js';
import { toPublicPhotoUrl } from '../../../../lib/operator-studio/ingest.js';

// ── Types ──────────────────────────────────────────────────────────────────────

interface PhotoResult {
  path: string;
  url: string;
}

interface PullMetadata {
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────

/** Maximum number of images to download in a single pull. */
const MAX_PULL_IMAGES = 200;

/** Per-file byte ceiling — images larger than this are skipped (not failed). */
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Validates a Google Drive resource ID.
 * Drive IDs are alphanumeric + underscore/dash and at least 10 characters long.
 * This guard rejects injected values like path traversal attempts before any
 * Drive API call is made.
 */
const isValidDriveId = (s: unknown): s is string =>
  typeof s === 'string' && /^[A-Za-z0-9_-]{10,}$/.test(s);

/** Strip characters unsafe for a Supabase storage object key. */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. Admin guard
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // 2. Parse + validate body
  const { folderId, folderName } = (req.body ?? {}) as {
    folderId?: unknown;
    folderName?: string;
  };
  if (!isValidDriveId(folderId)) {
    return res.status(400).json({ error: 'invalid folderId' });
  }

  // 3. Non-prod write guard (shared-resource safety per project convention)
  const writesAllowed =
    process.env.VERCEL_ENV === 'production' ||
    process.env.LE_ALLOW_NONPROD_WRITES === 'true';
  if (!writesAllowed) {
    return res.status(403).json({ error: 'writes disabled in this environment' });
  }

  // 4. Scope check prerequisites — DRIVE_PARENT_FOLDER_ID must be set to verify
  //    that the requested folder is actually under the configured root.
  const parentId = process.env.DRIVE_PARENT_FOLDER_ID;
  if (!parentId) {
    return res.status(503).json({ error: 'Drive parent folder not configured' });
  }

  try {
    // 4a. Verify folderId is a direct child of the configured parent.
    //     The matched folder's name is authoritative for the address; the
    //     client-supplied folderName is kept only as a display-side fallback.
    const allFolders = await listPropertyFolders(parentId);
    const matchedFolder = allFolders.find((f) => f.id === folderId);
    if (!matchedFolder) {
      return res.status(403).json({ error: 'folder not under the configured parent' });
    }
    const address = matchedFolder.name;

    // 5. Resolve image source folder — prefer "Final" subfolder, fall back to
    //    the property folder itself when none exists.
    const final = await findFinalSubfolder(folderId);
    const sourceId = final?.id ?? folderId;

    // 6. List images; apply the 200-image cap and the 25 MB per-file ceiling.
    //    listFinalImages already filters by image/* via the Drive query.
    const allFiles = await listFinalImages(sourceId);
    const imageFiles = allFiles.filter((f) => f.mimeType.startsWith('image/'));

    const truncated = imageFiles.length > MAX_PULL_IMAGES;
    const capped = imageFiles.slice(0, MAX_PULL_IMAGES);

    let skippedTooLarge = 0;
    const images = capped.filter((f) => {
      if (Number(f.size) > MAX_FILE_BYTES) {
        skippedTooLarge++;
        return false;
      }
      return true;
    });

    // 7. Download + upload each image in batches of 5.
    //    Individual failures are tolerated — skip + log, collect the rest.
    const supabase = getSupabase();
    const timestamp = Date.now();
    const photos: PhotoResult[] = [];

    for (let batchStart = 0; batchStart < images.length; batchStart += 5) {
      const batch = images.slice(batchStart, batchStart + 5);

      const results = await Promise.allSettled(
        batch.map(async (file, batchIndex) => {
          const index = batchStart + batchIndex;
          const { bytes, name, mimeType } = await downloadFile(file.id);
          const safeName = sanitizeName(name);
          const path = `drive-pull/${folderId}/${timestamp}_${index}_${safeName}`;
          const body = Buffer.from(bytes);

          const { error: uploadError } = await supabase.storage
            .from('property-photos')
            .upload(path, body, { contentType: mimeType });

          if (uploadError) {
            throw uploadError;
          }

          return { path, url: toPublicPhotoUrl(path) };
        }),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          photos.push(result.value);
        } else {
          console.warn('[drive/pull] photo upload failed, skipping:', result.reason);
        }
      }
    }

    if (photos.length === 0) {
      return res.status(502).json({ error: 'no photos could be pulled' });
    }

    // 8. Redfin / MLS enrich — never let this fail the pull; photos are priority.
    //    Use the Drive-authoritative address (not the client-supplied folderName).
    let metadata: PullMetadata;
    let mlsError: string | undefined;

    try {
      const mls = await lookupMlsByAddress(address, null);
      metadata = {
        price: mls.price ?? null,
        bedrooms: mls.bedrooms ?? null,
        bathrooms: mls.bathrooms ?? null,
        sqft: mls.sqft ?? null,
      };
    } catch (e) {
      metadata = {
        price: null,
        bedrooms: null,
        bathrooms: null,
        sqft: null,
      };
      const err = e as { name?: string };
      mlsError =
        err?.name === 'MlsProviderUnconfiguredError' ? 'unconfigured' : 'lookup_failed';
    }

    // 9. Return pre-fill payload.
    //    folderName from the body is accepted but not used here; the Drive-
    //    authoritative name is what the form should display.
    void folderName; // accepted for API compat; prefer address from Drive

    const response: {
      address: string;
      metadata: PullMetadata;
      photos: PhotoResult[];
      photoCount: number;
      truncated?: boolean;
      skippedTooLarge?: number;
      mlsError?: string;
    } = {
      address,
      metadata,
      photos,
      photoCount: photos.length,
    };
    if (truncated) response.truncated = true;
    if (skippedTooLarge > 0) response.skippedTooLarge = skippedTooLarge;
    if (mlsError !== undefined) response.mlsError = mlsError;

    return res.status(200).json(response);
  } catch (err) {
    // 10. Error handling — distinguish Drive misconfiguration from other failures.
    //     Never echo internal error detail back to the caller.
    if (err instanceof DriveUnconfiguredError) {
      return res.status(503).json({ error: 'Google Drive service account not configured' });
    }
    console.error('[drive/pull] ', err);
    return res.status(502).json({ error: 'pull failed' });
  }
}
