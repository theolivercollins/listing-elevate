import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth.js';
import {
  createBunnyVideo,
  bunnyTusAuth,
  isBunnyConfigured,
} from '../../../../lib/providers/bunny-stream.js';

/**
 * POST /api/admin/studio/creatives/bunny-upload
 * Creates an empty Bunny Stream video and mints a short-lived TUS upload
 * authorization. The browser then uploads the file directly to Bunny via
 * tus-js-client (resumable, real progress) — the Bunny API key never leaves
 * the server. Returns { videoId, libraryId, signature, expiration, endpoint }.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const writesAllowed =
    process.env.VERCEL_ENV === 'production' ||
    process.env.LE_ALLOW_NONPROD_WRITES === 'true';
  if (!writesAllowed) {
    return res.status(403).json({ error: 'writes disabled in this environment' });
  }
  if (!isBunnyConfigured()) {
    return res.status(503).json({ error: 'Bunny Stream is not configured' });
  }

  const title = (req.body?.title ? String(req.body.title) : 'Untitled').slice(0, 200);
  try {
    const { guid } = await createBunnyVideo(title);
    const auth = bunnyTusAuth(guid);
    return res.status(200).json({ videoId: guid, ...auth });
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'bunny error' });
  }
}
