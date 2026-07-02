import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth.js';
import {
  listPropertyFolders,
  findFinalSubfolder,
  countFinalImages,
  DriveUnconfiguredError,
} from '../../../../lib/drive/client.js';

/** Process this many property folders in parallel to stay within Drive rate limits. */
const FOLDER_BATCH_SIZE = 5;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const parentId = process.env.DRIVE_PARENT_FOLDER_ID || process.env.DRIVE_WATCHED_FOLDER_ID;
  if (!parentId) {
    return res.status(503).json({ error: 'Drive parent folder not configured' });
  }

  try {
    const folders = await listPropertyFolders(parentId);

    // Process folders in batches of FOLDER_BATCH_SIZE to avoid saturating the
    // Drive quota and hitting Vercel function timeout on large folder lists.
    const withCounts: { id: string; name: string; photoCount: number | null }[] = [];
    for (let i = 0; i < folders.length; i += FOLDER_BATCH_SIZE) {
      const batch = folders.slice(i, i + FOLDER_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (folder) => {
          let photoCount: number | null = null;
          try {
            const final = await findFinalSubfolder(folder.id);
            if (final) {
              photoCount = await countFinalImages(final.id);
            }
          } catch {
            // best-effort: one folder failure must not fail the whole request
            photoCount = null;
          }
          return { id: folder.id, name: folder.name, photoCount };
        }),
      );
      withCounts.push(...batchResults);
    }

    withCounts.sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json({ folders: withCounts });
  } catch (err) {
    if (err instanceof DriveUnconfiguredError) {
      return res.status(503).json({ error: 'Google Drive service account not configured' });
    }
    // Never echo internal error detail (may include Google API bodies / URLs).
    console.error('[drive/folders] ', err);
    return res.status(502).json({ error: 'Drive request failed' });
  }
}
