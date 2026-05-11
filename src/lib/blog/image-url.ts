// src/lib/blog/image-url.ts
//
// Supabase Storage public URLs come back as
//   /storage/v1/object/public/<bucket>/<path>
// Swap "/object/public/" → "/render/image/public/" + append transform query
// to get a server-resized + recompressed variant. ~85% bandwidth reduction
// at width=400 quality=70 vs the raw 2048px uploaded original.
//
// If the input URL doesn't match the Supabase public-object shape (e.g. an
// external URL or a future CDN), the helper returns the URL untouched.

export interface ThumbOpts {
  /** Target width in px. Server will resize-cover to this. Default 400. */
  width?: number;
  /** Optional target height in px. */
  height?: number;
  /** JPEG quality 1-100. Default 70. */
  quality?: number;
  /** "cover" (default) | "contain" | "fill" */
  resize?: "cover" | "contain" | "fill";
}

export function thumbUrl(url: string | null | undefined, opts: ThumbOpts = {}): string {
  if (!url) return "";
  const idx = url.indexOf("/object/public/");
  if (idx === -1) return url;
  const before = url.slice(0, idx);
  const after = url.slice(idx + "/object/public/".length);
  const { width = 400, height, quality = 70, resize = "cover" } = opts;
  const params = new URLSearchParams();
  params.set("width", String(width));
  if (height) params.set("height", String(height));
  params.set("quality", String(quality));
  params.set("resize", resize);
  return `${before}/render/image/public/${after}?${params.toString()}`;
}
