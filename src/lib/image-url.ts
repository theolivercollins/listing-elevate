// src/lib/image-url.ts
//
// Shared Supabase Storage image-transform helper for property (and general)
// photos across the app. Mirrors the proven pattern in
// src/lib/blog/image-url.ts (thumbUrl), which is scoped to the blog engine's
// cover images — this is the general-purpose sibling for property photos,
// scene stills, and anything else stored in a Supabase Storage public bucket.
//
// Supabase Storage public URLs come back as
//   /storage/v1/object/public/<bucket>/<path>
// Swap "/object/public/" → "/render/image/public/" + append a transform
// query to get a server-resized + recompressed variant. Verified on the
// property-photos bucket: a 1046 KB raw original → 17 KB at
// ?width=400&quality=70&resize=contain (HTTP 200) — ~98% bandwidth reduction.
//
// Safe passthrough by design: falsy input, an already-transformed
// "/render/image/" URL, a blob:/data: URL, or any URL that isn't a Supabase
// public-object URL are all returned UNCHANGED. This is deliberate — it means
// callers can run every photo URL through photoUrl()/photoThumb()/photoGrid()
// unconditionally without special-casing Google Drive previews, local blob
// previews, or a future non-Supabase CDN.

export interface PhotoUrlOpts {
  /** Target width in px. Omitted = no width constraint sent to the server. */
  width?: number;
  /** Optional target height in px. */
  height?: number;
  /** JPEG quality 1-100. Default 70. */
  quality?: number;
  /** "cover" | "contain" (default) | "fill" */
  resize?: "cover" | "contain" | "fill";
}

const OBJECT_PUBLIC_MARKER = "/object/public/";
const RENDER_IMAGE_MARKER = "/render/image/";

export function photoUrl(url: string, opts: PhotoUrlOpts = {}): string {
  // Falsy passthrough — return whatever was given (including "", null,
  // undefined at runtime; strictNullChecks is off project-wide so callers
  // regularly pass nullable DB fields straight through).
  if (!url) return url;

  // Already blob:/data: — never a Supabase object URL, and rewriting would
  // break local previews (e.g. a freshly-picked file before upload).
  if (url.startsWith("blob:") || url.startsWith("data:")) return url;

  // Already a transformed render URL — idempotent no-op so double-wrapping
  // (e.g. a downstream component calling photoThumb() on an already-thumbed
  // URL) is always safe.
  if (url.includes(RENDER_IMAGE_MARKER)) return url;

  const idx = url.indexOf(OBJECT_PUBLIC_MARKER);
  if (idx === -1) return url; // not a Supabase public-object URL — leave it alone

  const before = url.slice(0, idx);
  const after = url.slice(idx + OBJECT_PUBLIC_MARKER.length);
  const { width, height, quality = 70, resize = "contain" } = opts;

  const params = new URLSearchParams();
  if (width) params.set("width", String(width));
  if (height) params.set("height", String(height));
  params.set("quality", String(quality));
  params.set("resize", resize);

  return `${before}/render/image/public/${after}?${params.toString()}`;
}

/** Grid/list thumbnail preset — small + aggressively compressed. */
export function photoThumb(url: string): string {
  return photoUrl(url, { width: 400, quality: 70 });
}

/** Larger preview preset — property photo grids / lightboxes. */
export function photoGrid(url: string): string {
  return photoUrl(url, { width: 600, quality: 75 });
}

// ─── Bunny Stream poster derivation ──────────────────────────────────────────

const BUNNY_CDN_SUFFIX = ".b-cdn.net";

/**
 * Derive a Bunny Stream poster (thumbnail) URL from a Bunny-hosted video URL.
 *
 * Bunny Stream serves finished renders at
 *   https://<pull-zone>.b-cdn.net/<guid>/play_<res>.mp4
 * and always transcodes a sibling real-frame `<guid>/thumbnail.jpg` next to
 * it (see lib/providers/bunny-stream.ts). Swapping the final path segment for
 * `thumbnail.jpg` yields a poster a <video poster>/<img> can show instantly
 * instead of a blank/black box — a pure string derivation on data we already
 * have (the video src): no extra fetch, no secret. Any query string (e.g. a
 * Bunny token) is preserved so the thumbnail stays authorized.
 *
 * HOST-CHECKED: returns the thumbnail URL ONLY for a `.b-cdn.net` host with a
 * `<guid>/<segment>` path shape (>= 2 path segments); returns null for
 * everything else — a non-Bunny CDN, a legacy/un-rehosted provider clip, a
 * malformed URL, or a nullish input — so callers fall back cleanly (no poster,
 * or a first-frame <video>). The host check is the point: a host-agnostic
 * version emits bogus thumbnail URLs for any non-Bunny `play_*.mp4`, which
 * then 404 as posters.
 */
export function bunnyPosterUrl(videoUrl: string | null | undefined): string | null {
  if (!videoUrl) return null;
  try {
    const u = new URL(videoUrl);
    if (!u.hostname.endsWith(BUNNY_CDN_SUFFIX)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null; // need a <guid>/<segment> shape
    parts[parts.length - 1] = "thumbnail.jpg";
    u.pathname = `/${parts.join("/")}`;
    return u.toString();
  } catch {
    return null;
  }
}
