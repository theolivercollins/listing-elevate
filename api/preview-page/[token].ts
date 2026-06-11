/**
 * OG unfurl shim for /preview/:token
 *
 * Spec §3: serves the SPA entry point (index.html) with injected Open Graph
 * meta tags so social crawlers can display a rich preview card for listing
 * film share links.
 *
 * Route must be registered in vercel.json BEFORE the SPA catch-all:
 *   { "src": "/preview/([^/]+)", "dest": "/api/preview-page/[token]?token=$1" }
 *
 * Flow:
 *  1. Validate token shape (isWellFormedToken).
 *  2. Fetch the listing data (fetchByToken) — same logic reused from T2.
 *  3. Fetch /index.html from the deployment origin (so the SPA gets the
 *     correct hashed asset paths for the current deploy).
 *  4a. Valid, non-expired token → inject four meta tags into <head> and return.
 *  4b. Invalid / expired / not-found → return index.html untouched so the SPA
 *      can render its own 404 state.
 *
 * No SSR of any content; the SPA hydrates normally after initial render.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isWellFormedToken } from '../../lib/operator-studio/preview-tokens.js';
import { fetchByToken } from '../../lib/operator-studio/preview.js';

/** Split address at first comma, strip trailing ", USA" from locality. */
function parseAddressParts(address: string): { street: string; locality: string } {
  const commaIdx = address.indexOf(',');
  if (commaIdx === -1) return { street: address, locality: '' };
  const street = address.slice(0, commaIdx).trim();
  const locality = address.slice(commaIdx + 1).trim().replace(/, USA$/, '');
  return { street, locality };
}

/** Escape a string for use in an HTML attribute (double-quoted). */
function escAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Build the four OG/twitter meta tag block to inject. */
function buildMetaTags(opts: {
  street: string;
  description: string;
  thumbnailUrl: string | null;
}): string {
  const lines: string[] = [
    `<meta property="og:title" content="${escAttr(opts.street)}" />`,
    `<meta property="og:description" content="${escAttr(opts.description)}" />`,
  ];
  if (opts.thumbnailUrl) {
    lines.push(`<meta property="og:image" content="${escAttr(opts.thumbnailUrl)}" />`);
  }
  lines.push(`<meta name="twitter:card" content="summary_large_image" />`);
  return lines.join('\n    ');
}

/**
 * Strip any existing og:title, og:description, og:type, and twitter:card meta tags
 * from the HTML so injected per-listing values are always the FIRST occurrence.
 * (OG spec: first occurrence wins — the static index.html carries generic site values.)
 */
function stripExistingOgTags(html: string): string {
  // Matches <meta property="og:title" ... /> or <meta property="og:description" ... />
  // and <meta name="twitter:card" ... /> in both self-closing and open-tag forms.
  // Uses a non-greedy match to avoid eating multiple tags in one swallow.
  return html
    .replace(/<meta\s+property="og:title"[^>]*\/?>/gi, '')
    .replace(/<meta\s+property="og:description"[^>]*\/?>/gi, '')
    .replace(/<meta\s+name="twitter:card"[^>]*\/?>/gi, '');
}

/** Inject meta tags just before </head>. Falls back to appending if </head> absent. */
function injectMeta(html: string, metaBlock: string): string {
  const stripped = stripExistingOgTags(html);
  const insertBefore = '</head>';
  const idx = stripped.indexOf(insertBefore);
  if (idx === -1) return stripped + '\n' + metaBlock;
  return stripped.slice(0, idx) + '    ' + metaBlock + '\n  ' + stripped.slice(idx);
}

/** Derive the origin for fetching index.html from the incoming request. */
function originFromRequest(req: VercelRequest): string {
  const host = (req.headers as Record<string, string | string[] | undefined>)['host'];
  const hostStr = Array.isArray(host) ? host[0] : (host ?? 'localhost');
  // On Vercel, x-forwarded-proto is always present; in local dev fall back to http.
  const proto =
    (req.headers as Record<string, string | string[] | undefined>)['x-forwarded-proto'] ??
    (hostStr.startsWith('localhost') ? 'http' : 'https');
  const protoStr = Array.isArray(proto) ? proto[0] : proto;
  return `${protoStr}://${hostStr}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = String(req.query.token ?? '');

  // Derive origin early so we can always fetch index.html regardless of token validity.
  const origin = originFromRequest(req);

  // Fetch index.html from the deployment itself (shares the same hashed asset manifest).
  // On failure (e.g., local dev) fall back to a bare shell so the SPA can still boot.
  let indexHtml: string;
  try {
    const r = await fetch(`${origin}/index.html`);
    indexHtml = r.ok ? await r.text() : '<!doctype html><html><head></head><body><div id="root"></div></body></html>';
  } catch {
    indexHtml = '<!doctype html><html><head></head><body><div id="root"></div></body></html>';
  }

  // --- Token validation + DB lookup ---
  if (!isWellFormedToken(token)) {
    // Malformed token → serve bare SPA (it will show its 404 route).
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(indexHtml);
  }

  const result = await fetchByToken(token);
  if (!result || result.expired) {
    // Not found or expired → serve bare SPA.
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(indexHtml);
  }

  // --- Valid listing — build OG meta ---
  const { property, client } = result;
  const { street, locality } = parseAddressParts(property.address as string);

  // og:description: agent name if present, otherwise "Listing film · <locality>"
  const agentName = (client as { agent_name?: string | null } | null)?.agent_name ?? null;
  const description = agentName ?? `Listing film · ${locality}`;

  // hero_photo_url resolved from photos table — never a video file (bug fix: property.thumbnail_url was an .mp4)
  const thumbnailUrl = result.hero_photo_url ?? null;

  const metaBlock = buildMetaTags({ street, description, thumbnailUrl });
  const injectedHtml = injectMeta(indexHtml, metaBlock);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(injectedHtml);
}
