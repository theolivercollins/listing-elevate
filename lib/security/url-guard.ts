/**
 * SSRF guard for media URLs fetched server-side.
 *
 * Video URLs are server-set pipeline outputs across multiple CDNs (Bunny,
 * Backblaze B2, Supabase Storage, Creatomate, Shotstack, and future render
 * providers). A strict host allowlist breaks legitimate downloads whenever
 * a new provider is added, and buys little security when the URL is not
 * attacker-controlled. Instead this guard targets the actual SSRF risk:
 * requests that would resolve to private / internal infrastructure.
 *
 * Rules (in order):
 *  1. Must be a well-formed URL.
 *  2. Scheme must be `https:`.
 *  3. Hostname must NOT be an IP literal — blocks direct-to-internal-IP and
 *     the cloud metadata address 169.254.169.254.
 *  4. Hostname must NOT be a loopback or internal name (`localhost`, any name
 *     ending in `.local` / `.internal` / `.lan`, or the GCE metadata FQDN
 *     `metadata.google.internal` / bare `metadata`).
 *  5. All other public hostnames are allowed.
 */

/** Thrown when a URL fails the SSRF safety check. */
export class DisallowedUrlError extends Error {
  constructor(reason: string) {
    super(`Disallowed media URL: ${reason}`);
    this.name = 'DisallowedUrlError';
  }
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

/** Suffixes whose presence anywhere in a hostname indicates internal infra. */
const INTERNAL_SUFFIXES = ['.local', '.internal', '.lan'] as const;

/** Exact hostnames (lowercased) that must never be fetched. */
const INTERNAL_EXACT = new Set(['localhost', 'metadata.google.internal', 'metadata']);

/**
 * Returns true when the hostname is or is likely to resolve to loopback,
 * link-local, or cloud-metadata infrastructure.
 */
function isInternalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (INTERNAL_EXACT.has(h)) return true;
  return INTERNAL_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

/**
 * Asserts that `raw` is a safe media URL eligible for server-side streaming.
 *
 * Blocks SSRF-to-internal (private IPs, loopback, link-local/metadata,
 * internal hostnames) rather than allowlisting hosts — video URLs span
 * multiple CDNs and are server-set pipeline outputs, not attacker-supplied.
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

  if (isInternalHostname(parsed.hostname)) {
    throw new DisallowedUrlError('internal/loopback hostnames are not allowed');
  }

  return parsed;
}
