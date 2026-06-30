/**
 * Clip proxy — fetches a Bunny CDN clip with the required Referer header so
 * Creatomate's render server can retrieve clips from Bunny library 679131,
 * which blocks no-Referer requests with HTTP 403.
 *
 * UNAUTHENTICATED — Creatomate fetches this endpoint server-to-server with no
 * credentials. Safety comes from a strict host allowlist: only the configured
 * BUNNY_STREAM_CDN_HOSTNAME is ever fetched. Two SSRF guard layers:
 *   1. protocol must be https: AND hostname must exactly equal
 *      BUNNY_STREAM_CDN_HOSTNAME (fail-closed if env var unset).
 *   2. assertAllowedMediaUrl() blocks IP literals + internal/loopback hostnames
 *      as defence-in-depth.
 *
 * Range requests are forwarded so video players and render servers that issue
 * byte-range requests work correctly.
 *
 * Usage (pipeline.ts proxifyClipUrl):
 *   https://listingelevate.com/api/clip-proxy?url=<encoded-bunny-url>
 *
 * No Content-Disposition — this is inline media, not a download.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Readable } from 'node:stream';
import { bunnyCdnHeaders } from '../lib/providers/bunny-stream.js';
import { assertAllowedMediaUrl, DisallowedUrlError } from '../lib/security/url-guard.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const rawUrl = req.query.url;
  if (!rawUrl || typeof rawUrl !== 'string') {
    return res.status(400).json({ error: 'missing_url' });
  }

  // ── SSRF guard — layer 1: https scheme + exact Bunny CDN host only ────────
  // Fail-closed: if BUNNY_STREAM_CDN_HOSTNAME is not configured we reject all
  // requests rather than operating as an open proxy.
  const bunnyHostname = process.env.BUNNY_STREAM_CDN_HOSTNAME;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return res.status(400).json({ error: 'invalid_url' });
  }

  if (parsed.protocol !== 'https:') {
    return res.status(403).json({ error: 'forbidden_scheme' });
  }

  if (!bunnyHostname || parsed.hostname !== bunnyHostname) {
    return res.status(403).json({ error: 'forbidden_host' });
  }

  // ── SSRF guard — layer 2: block IP literals + internal/loopback hostnames ─
  try {
    assertAllowedMediaUrl(rawUrl);
  } catch (err) {
    if (err instanceof DisallowedUrlError) {
      return res.status(403).json({ error: 'forbidden_host' });
    }
    throw err;
  }

  // ── Forward request to Bunny CDN with Referer + optional Range ───────────
  const range = req.headers['range'];
  const fetchHeaders: Record<string, string> = {
    ...bunnyCdnHeaders(rawUrl),
    ...(range ? { Range: String(range) } : {}),
  };

  let upstream: Response;
  try {
    upstream = await fetch(rawUrl, {
      headers: fetchHeaders,
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return res.status(502).json({ error: 'upstream_fetch_failed' });
  }

  if (!upstream.ok) {
    // Pass the status through so callers see the real Bunny error code.
    return res.status(upstream.status).end();
  }

  if (!upstream.body) {
    return res.status(502).json({ error: 'empty_upstream_body' });
  }

  // ── Copy safe response headers ───────────────────────────────────────────
  const passHeaders = [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'cache-control',
  ] as const;

  for (const header of passHeaders) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }

  // Preserve the upstream status (200 or 206 for Range responses).
  res.status(upstream.status);

  // ── Stream body without buffering the whole clip in memory ──────────────
  const nodeReadable = Readable.fromWeb(
    upstream.body as import('stream/web').ReadableStream<Uint8Array>,
  );
  nodeReadable.pipe(res as unknown as import('node:stream').Writable);
  nodeReadable.on('error', () => {
    // Headers already sent; destroy signals an abrupt close to the client.
    res.destroy();
  });
  // If Creatomate disconnects mid-stream, stop draining the upstream body.
  res.on('close', () => {
    nodeReadable.destroy();
  });
}
