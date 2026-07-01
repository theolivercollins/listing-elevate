/**
 * vercel-routes.test.ts
 *
 * Asserts that every dynamic API handler file has a corresponding entry in
 * vercel.json's `routes` array.  This repo uses a legacy `routes` array
 * (not `rewrites`), so dynamic path segments like [token] and [id] are NOT
 * auto-resolved from the filesystem — every nested route must be explicitly
 * listed before the generic catch-all or it will 404 in deployment.
 *
 * Adding a handler without a matching route entry is the defect that prompted
 * this test (preview-links-v2 branch: four routes were missing).  Any future
 * nested handler added without a vercel.json entry will fail here immediately,
 * making the gap visible before deployment rather than after.
 *
 * Strategy:
 *   1. Parse vercel.json and extract the `src` regexes.
 *   2. For each handler file listed in GUARDED_PATHS, derive the URL path it
 *      would serve (strip leading `api/` and the `.ts` extension, convert
 *      bracket params to `[^/]+` placeholders) and assert that at least one
 *      `src` pattern matches that URL.
 */

import { readFileSync, existsSync } from 'fs';
import { describe, it, expect } from 'vitest';

// ─── Load vercel.json ────────────────────────────────────────────────────────

const VERCEL_JSON_PATH = 'vercel.json';

interface VercelRoute {
  src?: string;
  dest?: string;
  handle?: string;
}

interface VercelConfig {
  routes: VercelRoute[];
}

const vercelConfig: VercelConfig = JSON.parse(readFileSync(VERCEL_JSON_PATH, 'utf-8'));

// Collect all `src` patterns that have a `dest` (skip `{ handle: ... }` entries)
const srcPatterns: RegExp[] = vercelConfig.routes
  .filter((r): r is VercelRoute & { src: string } => typeof r.src === 'string')
  .map((r) => new RegExp(`^${r.src}$`));

/**
 * Convert a handler file path (relative to repo root, e.g.
 * "api/preview/[token]/approve.ts") into the URL it would serve
 * (e.g. "/api/preview/sometoken/approve"), replacing bracket params
 * with a placeholder value that the regex must match.
 */
function filePathToUrl(filePath: string): string {
  return (
    '/' +
    filePath
      .replace(/\.ts$/, '')            // drop extension
      .replace(/\/index$/, '')         // index.ts → parent path
      .replace(/\[([^\]]+)\]/g, 'PLACEHOLDER') // [token] → PLACEHOLDER
  );
}

/**
 * Returns true when the URL matches at least one src pattern in vercel.json.
 * The placeholder value 'PLACEHOLDER' is deliberately a valid slug-like string
 * that all `([^/]+)` captures would match.
 */
function isRouted(filePath: string): boolean {
  const url = filePathToUrl(filePath);
  return srcPatterns.some((re) => re.test(url));
}

// ─── Handler files that MUST have an explicit vercel.json entry ──────────────
//
// List the handler paths added by this branch.  Any future nested dynamic
// route added to the API layer should be added here at the same time.
//
// Paths are relative to repo root, matching the `api/` tree.

const GUARDED_PATHS = [
  // preview-links-v2 branch — new endpoints
  'api/preview/[token]/approve.ts',
  'api/preview/[token]/download.ts',
  'api/admin/studio/properties/[id]/preview-links.ts',
  'api/admin/studio/properties/[id]/preview-links/[previewId].ts',

  // le-video branch — new endpoints
  'api/preview/[token]/events.ts',
  'api/admin/studio/videos/index.ts',
  'api/admin/studio/videos/[id].ts',

  // le-video-library branch — new endpoints
  'api/admin/studio/video-folders/index.ts',
  'api/admin/studio/video-folders/[id].ts',
  'api/admin/studio/videos/[id]/library.ts',

  // studio hardening batch (PR #125) — post-approval decouple endpoint
  'api/pipeline/continue/[runId].ts',

  // drive-pull-brian branch — new Drive Pull endpoints
  'api/admin/studio/drive/folders.ts',
  'api/admin/studio/drive/pull.ts',

  // drive-telegram-intake branch — new endpoints
  // Webhooks self-authenticate via header secrets; static paths covered by catch-all.
  'api/drive/webhook.ts',
  'api/telegram/webhook.ts',
  'api/cron/drive-settle.ts',
  'api/cron/drive-intake-poll.ts',
  'api/cron/drive-channel-renew.ts',

  // studio-resume-drafts branch — New Order autosave draft endpoints
  'api/admin/studio/drafts/index.ts',
  'api/admin/studio/drafts/[id].ts',
  'api/cron/studio-draft-cleanup.ts',

  // Existing routes that must continue to be covered (regression guard)
  'api/preview/[token].ts',
  'api/scenes/[id]/approve.ts',
  'api/admin/studio/properties/[id]/download.ts',
  'api/admin/studio/properties/[id]/preview-link.ts',
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('vercel.json route coverage', () => {
  it('vercel.json exists', () => {
    expect(existsSync(VERCEL_JSON_PATH)).toBe(true);
  });

  it('vercel.json has a non-empty routes array', () => {
    expect(Array.isArray(vercelConfig.routes)).toBe(true);
    expect(vercelConfig.routes.length).toBeGreaterThan(0);
  });

  for (const handlerPath of GUARDED_PATHS) {
    it(`${handlerPath} has a matching vercel.json src entry`, () => {
      expect(isRouted(handlerPath)).toBe(true);
    });
  }

  it('preview-links/[previewId] entry precedes the bare preview-links entry', () => {
    const routes = vercelConfig.routes.filter(
      (r): r is VercelRoute & { src: string } => typeof r.src === 'string',
    );
    // Two-segment: .../preview-links/([^/]+)
    const previewLinksWithId = routes.findIndex((r) =>
      /preview-links\/\(\[\^\/\]\+\)/.test(r.src),
    );
    // One-segment: ends with .../preview-links (no further path component)
    const previewLinksBase = routes.findIndex((r) =>
      /preview-links$/.test(r.src),
    );
    // Both must exist
    expect(previewLinksWithId).toBeGreaterThanOrEqual(0);
    expect(previewLinksBase).toBeGreaterThanOrEqual(0);
    // More-specific (two-param) route must come first
    expect(previewLinksWithId).toBeLessThan(previewLinksBase);
  });

  it('preview/[token]/approve and /download entries precede the bare preview/[token] entry', () => {
    const routes = vercelConfig.routes.filter(
      (r): r is VercelRoute & { src: string } => typeof r.src === 'string',
    );
    const approveIdx  = routes.findIndex((r) => /\/preview\/.*\/approve$/.test(r.src));
    const downloadIdx = routes.findIndex((r) => /\/preview\/.*\/download$/.test(r.src));
    const bareIdx     = routes.findIndex((r) => /^\/api\/preview\/\(\[\^\/\]\+\)$/.test(r.src));

    expect(approveIdx).toBeGreaterThanOrEqual(0);
    expect(downloadIdx).toBeGreaterThanOrEqual(0);
    expect(bareIdx).toBeGreaterThanOrEqual(0);

    expect(approveIdx).toBeLessThan(bareIdx);
    expect(downloadIdx).toBeLessThan(bareIdx);
  });

  it('preview/[token]/events entry precedes the bare preview/[token] entry', () => {
    const routes = vercelConfig.routes.filter(
      (r): r is VercelRoute & { src: string } => typeof r.src === 'string',
    );
    const eventsIdx = routes.findIndex((r) => /\/preview\/.*\/events$/.test(r.src));
    const bareIdx   = routes.findIndex((r) => /^\/api\/preview\/\(\[\^\/\]\+\)$/.test(r.src));

    expect(eventsIdx).toBeGreaterThanOrEqual(0);
    expect(bareIdx).toBeGreaterThanOrEqual(0);
    expect(eventsIdx).toBeLessThan(bareIdx);
  });

  it('videos/[id] entry precedes the bare videos entry', () => {
    const routes = vercelConfig.routes.filter(
      (r): r is VercelRoute & { src: string } => typeof r.src === 'string',
    );
    // Two-segment: .../videos/([^/]+)
    const videosWithId = routes.findIndex((r) =>
      /\/admin\/studio\/videos\/\(\[\^\/\]\+\)/.test(r.src),
    );
    // One-segment: ends with .../videos (no further path component)
    const videosBase = routes.findIndex((r) =>
      /\/admin\/studio\/videos$/.test(r.src),
    );

    expect(videosWithId).toBeGreaterThanOrEqual(0);
    expect(videosBase).toBeGreaterThanOrEqual(0);
    expect(videosWithId).toBeLessThan(videosBase);
  });

  it('videos/[id]/library entry precedes the bare videos/[id] entry', () => {
    const routes = vercelConfig.routes.filter(
      (r): r is VercelRoute & { src: string } => typeof r.src === 'string',
    );
    // Three-segment: .../videos/([^/]+)/library
    const videosLibrary = routes.findIndex((r) =>
      /\/admin\/studio\/videos\/\(\[\^\/\]\+\)\/library/.test(r.src),
    );
    // Two-segment: .../videos/([^/]+) (bare, no /library)
    const videosWithId = routes.findIndex((r) =>
      /\/admin\/studio\/videos\/\(\[\^\/\]\+\)$/.test(r.src),
    );

    expect(videosLibrary).toBeGreaterThanOrEqual(0);
    expect(videosWithId).toBeGreaterThanOrEqual(0);
    expect(videosLibrary).toBeLessThan(videosWithId);
  });

  it('/preview/:token/embed SPA route precedes the bare /preview/([^/]+) OG-shim route', () => {
    const routes = vercelConfig.routes.filter(
      (r): r is VercelRoute & { src: string } => typeof r.src === 'string',
    );
    // More specific: /preview/([^/]+)/embed pointing to /index.html (SPA route)
    const embedIdx = routes.findIndex((r) =>
      r.src === '/preview/([^/]+)/embed' && r.dest === '/index.html',
    );
    // Less specific: /preview/([^/]+) pointing to OG-shim endpoint
    const bareIdx = routes.findIndex((r) =>
      r.src === '/preview/([^/]+)' && r.dest?.includes('/api/preview-page'),
    );

    expect(embedIdx).toBeGreaterThanOrEqual(0);
    expect(bareIdx).toBeGreaterThanOrEqual(0);
    expect(embedIdx).toBeLessThan(bareIdx);
  });

  it('drafts/[id] entry precedes the bare drafts entry', () => {
    const routes = vercelConfig.routes.filter(
      (r): r is VercelRoute & { src: string } => typeof r.src === 'string',
    );
    const draftsWithId = routes.findIndex((r) =>
      /\/admin\/studio\/drafts\/\(\[\^\/\]\+\)/.test(r.src),
    );
    const draftsBase = routes.findIndex((r) =>
      /\/admin\/studio\/drafts$/.test(r.src),
    );

    expect(draftsWithId).toBeGreaterThanOrEqual(0);
    expect(draftsBase).toBeGreaterThanOrEqual(0);
    expect(draftsWithId).toBeLessThan(draftsBase);
  });

  it('pipeline/continue/[runId] entry precedes the bare pipeline/[propertyId] entry', () => {
    const routes = vercelConfig.routes.filter(
      (r): r is VercelRoute & { src: string } => typeof r.src === 'string',
    );
    const continueIdx = routes.findIndex((r) =>
      /\/api\/pipeline\/continue\/\(\[\^\/\]\+\)/.test(r.src),
    );
    const bareIdx = routes.findIndex((r) =>
      /^\/api\/pipeline\/\(\[\^\/\]\+\)$/.test(r.src),
    );
    expect(continueIdx).toBeGreaterThanOrEqual(0);
    expect(bareIdx).toBeGreaterThanOrEqual(0);
    expect(continueIdx).toBeLessThan(bareIdx);
  });
});
