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
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth.js';
import {
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
  description: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    folderId?: string;
    folderName?: string;
  };
  if (!folderId || !folderName) {
    return res.status(400).json({ error: 'folderId and folderName required' });
  }

  // 3. Non-prod write guard (shared-resource safety per project convention)
  const writesAllowed =
    process.env.VERCEL_ENV === 'production' ||
    process.env.LE_ALLOW_NONPROD_WRITES === 'true';
  if (!writesAllowed) {
    return res.status(403).json({ error: 'writes disabled in this environment' });
  }

  try {
    // 4. Resolve image source folder — prefer "Final" subfolder, fall back to
    //    the property folder itself when none exists.
    const final = await findFinalSubfolder(folderId);
    const sourceId = final?.id ?? folderId;

    // 5. List images; listFinalImages already filters by image/* via the Drive
    //    query, but guard here for safety.
    const allFiles = await listFinalImages(sourceId);
    const images = allFiles.filter((f) => f.mimeType.startsWith('image/'));

    // 6. Download + upload each image in batches of 5.
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

    // 7. Redfin / MLS enrich — never let this fail the pull; photos are priority.
    let metadata: PullMetadata;
    let mlsError: string | undefined;

    try {
      const mls = await lookupMlsByAddress(folderName, null);
      metadata = {
        price: mls.price ?? null,
        bedrooms: mls.bedrooms ?? null,
        bathrooms: mls.bathrooms ?? null,
        sqft: mls.sqft ?? null,
        description: mls.description ?? null,
      };
    } catch (e) {
      metadata = {
        price: null,
        bedrooms: null,
        bathrooms: null,
        sqft: null,
        description: null,
      };
      const err = e as { name?: string };
      mlsError =
        err?.name === 'MlsProviderUnconfiguredError' ? 'unconfigured' : 'lookup_failed';
    }

    // 8. Return pre-fill payload
    const response: {
      address: string;
      metadata: PullMetadata;
      photos: PhotoResult[];
      photoCount: number;
      mlsError?: string;
    } = {
      address: folderName,
      metadata,
      photos,
      photoCount: photos.length,
    };
    if (mlsError !== undefined) {
      response.mlsError = mlsError;
    }

    return res.status(200).json(response);
  } catch (err) {
    // 9. Error handling — distinguish Drive misconfiguration from other failures
    if (err instanceof DriveUnconfiguredError) {
      return res.status(503).json({ error: 'Google Drive service account not configured' });
    }
    return res.status(502).json({ error: 'pull failed', detail: String(err) });
  }
}
