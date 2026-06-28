/**
 * SSRF guard for media URLs fetched server-side.
 *
 * Only URLs whose hostname belongs to the explicit media-CDN allowlist are
 * permitted.  IP-literal hosts (v4 and v6) are unconditionally rejected —
 * they can never appear in the allowlist and would bypass hostname checks
 * for addresses like 169.254.169.254, 127.0.0.1, or any private range.
 */

/** Thrown when a URL fails the media-host allowlist check. */
export class DisallowedUrlError extends Error {
  constructor(reason: string) {
    super(`Disallowed media URL: ${reason}`);
    this.name = 'DisallowedUrlError';
  }
}

/**
 * Returns true for hostnames that are allowlisted as valid media CDN origins.
 *
 * Allowed:
 *  - any subdomain of `b-cdn.net`          (Bunny Pull/Storage CDN)
 *  - `iframe.mediadelivery.net`             (Bunny Stream embed/mp4)
 *  - `video.bunnycdn.com`                   (Bunny Stream direct)
 *  - any subdomain of `supabase.co`         (Supabase Storage CDN)
 */
function isAllowedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'iframe.mediadelivery.net') return true;
  if (h === 'video.bunnycdn.com') return true;
  // Require at least one label before the suffix (bare b-cdn.net / supabase.co alone
  // would be unusual, but the `.` prefix guarantees a subdomain is present).
  if (h.endsWith('.b-cdn.net')) return true;
  if (h.endsWith('.supabase.co')) return true;
  return false;
}

/**
 * Returns true when the hostname is an IP address literal (v4 or v6).
 *
 * The WHATWG URL parser keeps IPv6 brackets in `.hostname`, e.g. `[::1]`.
 * IPv4 looks like `127.0.0.1` — all-digit octets separated by dots.
 */
function isIpLiteral(hostname: string): boolean {
  // IPv6: URL spec includes the brackets in hostname for IPv6 literals.
  if (hostname.startsWith('[')) return true;
  // IPv4: four decimal groups separated by dots.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return true;
  return false;
}

/**
 * Asserts that `raw` is a safe media URL eligible for server-side streaming.
 *
 * Rules (in order):
 *  1. Must be a well-formed URL (parseable by `new URL()`).
 *  2. Scheme must be `https:`.
 *  3. Hostname must NOT be an IP literal.
 *  4. Hostname must appear in the media-CDN allowlist.
 *
 * @returns The parsed `URL` object on success.
 * @throws  `DisallowedUrlError` on any violation.
 */
export function assertAllowedMediaUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new DisallowedUrlError('not a valid URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new DisallowedUrlError(`scheme '${parsed.protocol}' is not https`);
  }

  if (isIpLiteral(parsed.hostname)) {
    throw new DisallowedUrlError('IP-literal hosts are not allowed');
  }

  if (!isAllowedHostname(parsed.hostname)) {
    throw new DisallowedUrlError(`host is not on the media allowlist`);
  }

  return parsed;
}
