/**
 * Clip proxy — fetches a Bunny CDN clip with the required Referer header so
 * Creatomate's render server can retrieve clips from Bunny library 679131,
 * which blocks no-Referer requests with HTTP 403.
 *
 * UNAUTHENTICATED — Creatomate fetches this endpoint server-to-server with no
 * credentials. Safety comes from a strict host allowlist: only the configured
 * BUNNY_STREAM_CDN_HOSTNAME is ever fetched. SSRF guard layers:
 *   1. Protocol must be https:, hostname must exactly equal
 *      BUNNY_STREAM_CDN_HOSTNAME (fail-closed if env var unset), port must be
 *      '' (default 443) or '443'.
 *   2. assertAllowedMediaUrl() blocks IP literals + internal/loopback hostnames
 *      as defence-in-depth.
 *   3. redirect: 'manual' — 3xx responses are NOT auto-followed; the Location
 *      is re-validated against the same allowlist before a single follow hop.
 *      A second redirect or a cross-host redirect → 502.
 *
 * Range requests are forwarded so byte-range fetches from Creatomate work.
 *
 * maxDuration: 300 so the Vercel function outlives even a slow large-clip
 * stream (avoids Creatomate receiving a truncated body → failed render).
 *
 * Usage (pipeline.ts proxifyClipUrl):
 *   https://listingelevate.com/api/clip-proxy?url=<encoded-bunny-url>
 *
 * No Content-Disposition — inline media, not a download.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Readable } from 'node:stream';
import { bunnyCdnHeaders } from '../lib/providers/bunny-stream.js';
import { assertAllowedMediaUrl, DisallowedUrlError } from '../lib/security/url-guard.js';

/** Pin the function budget so a slow clip stream never gets truncated. */
export const config = { maxDuration: 300 };

/**
 * Validates that `url` is safe to fetch: https, exactly the Bunny CDN host,
 * default port ('' or '443'), and not an IP/internal hostname.
 * Returns the parsed URL on success, `null` on any violation.
 */
function assertBunnySafe(url: string, bunnyHostname: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.hostname !== bunnyHostname) return null;
  if (parsed.port !== '' && parsed.port !== '443') return null;
  try {
    assertAllowedMediaUrl(url);
  } catch (err) {
    if (err instanceof DisallowedUrlError) return null;
    throw err;
  }
  return parsed;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const rawUrl = req.query.url;
  if (!rawUrl || typeof rawUrl !== 'string') {
    return res.status(400).json({ error: 'missing_url' });
  }

  // ── SSRF guard — fail-closed when env var unset ───────────────────────────
  const bunnyHostname = process.env.BUNNY_STREAM_CDN_HOSTNAME;
  if (!bunnyHostname) {
    return res.status(403).json({ error: 'forbidden_host' });
  }

  // Validate original URL (layer 1 + 2 via assertBunnySafe).
  if (!assertBunnySafe(rawUrl, bunnyHostname)) {
    return res.status(403).json({ error: 'forbidden_host' });
  }

  // ── Forward request with Referer + optional Range ─────────────────────────
  const range = req.headers['range'];
  const buildHeaders = (url: string): Record<string, string> => ({
    ...bunnyCdnHeaders(url),
    ...(range ? { Range: String(range) } : {}),
  });

  let upstream: Response;
  try {
    upstream = await fetch(rawUrl, {
      headers: buildHeaders(rawUrl),
      redirect: 'manual',          // ← never auto-follow; re-validate first
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    return res.status(502).json({ error: 'upstream_fetch_failed' });
  }

  // ── Redirect handling — re-validate Location, follow exactly once ─────────
  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get('location');
    if (!location || !assertBunnySafe(location, bunnyHostname)) {
      // Redirect to a non-Bunny host or missing/invalid Location → refuse.
      return res.status(502).json({ error: 'redirect_forbidden' });
    }

    try {
      upstream = await fetch(location, {
        headers: buildHeaders(location),
        redirect: 'manual',
        signal: AbortSignal.timeout(90_000),
      });
    } catch {
      return res.status(502).json({ error: 'upstream_fetch_failed' });
    }

    // Second redirect — bail (no infinite hop chains).
    if (upstream.status >= 300 && upstream.status < 400) {
      return res.status(502).json({ error: 'too_many_redirects' });
    }
  }

  if (!upstream.ok) {
    // Pass the Bunny error code through so callers can debug.
    return res.status(upstream.status).end();
  }

  if (!upstream.body) {
    return res.status(502).json({ error: 'empty_upstream_body' });
  }

  // ── Copy safe response headers ────────────────────────────────────────────
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

  // ── Stream body without buffering the whole clip in memory ───────────────
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
