import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Readable } from 'node:stream';
import { isWellFormedToken } from '../../../lib/operator-studio/preview-tokens.js';
import { fetchByToken } from '../../../lib/operator-studio/preview.js';

/** Convert an address string to a safe filename slug (lowercase, alphanum+dash). */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Map orientation to the suffix used in the download filename per spec §2. */
const ORIENTATION_SUFFIX = {
  horizontal: 'wide',
  vertical: 'vertical',
} as const;

type Orientation = keyof typeof ORIENTATION_SUFFIX;

function isOrientation(v: unknown): v is Orientation {
  return v === 'horizontal' || v === 'vertical';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = String(req.query.token ?? '');
  if (!isWellFormedToken(token)) return res.status(404).json({ error: 'not_found' });

  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const orientation = req.query.orientation;
  if (!isOrientation(orientation)) {
    return res.status(400).json({ error: 'orientation must be horizontal or vertical' });
  }

  const result = await fetchByToken(token);
  if (!result || result.expired) return res.status(404).json({ error: 'not_found' });

  // Capability check — pre-migration fallback: null preview → treat as all-on
  const allowDownload = result.preview?.allow_download ?? true;
  if (!allowDownload) return res.status(403).json({ error: 'not_allowed' });

  const { property } = result;
  const videoUrl: string | null =
    orientation === 'horizontal'
      ? (property as { horizontal_video_url: string | null }).horizontal_video_url
      : (property as { vertical_video_url: string | null }).vertical_video_url;

  if (!videoUrl) return res.status(404).json({ error: 'no_url' });

  const slug = property.address ? slugify(String(property.address)) : token.slice(0, 16);
  const suffix = ORIENTATION_SUFFIX[orientation];
  const filename = `${slug}-${suffix}.mp4`;

  let upstream: Response;
  try {
    // 60 s timeout — CDN videos are large; without a cap a stalled upstream
    // holds the Vercel function slot indefinitely.
    upstream = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) });
  } catch {
    return res.status(502).json({ error: 'upstream_fetch_failed' });
  }

  if (!upstream.ok) {
    return res.status(502).json({ error: `upstream_${upstream.status}` });
  }

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const length = upstream.headers.get('content-length');
  if (length) res.setHeader('Content-Length', length);

  // Stream the body without buffering the whole MP4 in memory.
  // upstream.body is a Web ReadableStream; convert to Node Readable and pipe.
  if (!upstream.body) {
    return res.status(502).json({ error: 'empty_upstream_body' });
  }

  const nodeReadable = Readable.fromWeb(
    upstream.body as import('stream/web').ReadableStream<Uint8Array>,
  );
  nodeReadable.pipe(res as unknown as import('node:stream').Writable);
  nodeReadable.on('error', () => {
    // Headers already sent; cannot change status code.
    // destroy() signals an abrupt close so the client sees a truncated
    // transfer rather than an apparently-complete file.
    res.destroy();
  });
  // If the client disconnects mid-download, destroy the upstream readable so
  // the fetch body doesn't keep draining bytes into a dead socket.
  res.on('close', () => {
    nodeReadable.destroy();
  });
}
