import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Readable } from 'node:stream';
import { requireAdmin } from '../../../../../lib/auth.js';
import { getSupabase } from '../../../../../lib/client.js';
import { bunnyCdnHeaders } from '../../../../../lib/providers/bunny-stream.js';

/** Convert a property address to a safe filename slug (lowercase, alphanum+dash). */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const format = req.query.format;
  if (format !== 'horizontal' && format !== 'vertical') {
    return res.status(400).json({ error: 'format must be horizontal or vertical' });
  }

  const id = String(req.query.id);
  const db = getSupabase();
  const { data: property, error } = await db
    .from('properties')
    .select('id, address, horizontal_video_url, vertical_video_url')
    .eq('id', id)
    .maybeSingle();

  if (error || !property) return res.status(404).json({ error: 'not_found' });

  const videoUrl: string | null =
    format === 'horizontal' ? property.horizontal_video_url : property.vertical_video_url;

  if (!videoUrl) return res.status(404).json({ error: `${format}_video_not_ready` });

  const slug = property.address ? slugify(String(property.address)) : String(id);
  const filename = `${slug}-${format}.mp4`;

  let upstream: Response;
  try {
    // 60 s timeout — CDN videos are large; without a cap a stalled upstream
    // holds the Vercel function slot indefinitely.
    // Include the Referer header for Bunny CDN URLs — library 679131 has
    // referrer allow-listing ON; server-side fetches send no Referer by
    // default and would 403. bunnyCdnHeaders() is a no-op for non-Bunny URLs.
    upstream = await fetch(videoUrl, {
      signal: AbortSignal.timeout(60_000),
      headers: bunnyCdnHeaders(videoUrl),
    });
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
    // transfer rather than an apparently-complete file (Content-Length was set).
    res.destroy();
  });
  // If the client disconnects mid-download, destroy the upstream readable so
  // the fetch body doesn't keep draining bytes into a dead socket.
  res.on('close', () => {
    nodeReadable.destroy();
  });
}
