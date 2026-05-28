import sharp from "sharp";
import { createHash } from "node:crypto";
import { getSupabase } from "../client.js";

// Default target geometry for video sources: 16:9 1080p.
const TARGET_W = 1920;
const TARGET_H = 1080;
// Fractional tolerance on the aspect ratio. 2% comfortably absorbs the
// rounding a model applies when it snaps to multiple-of-16 dimensions
// (e.g. 1920×1081) while still rejecting 3:2 (1.50) and 4:3 (1.33).
const TOLERANCE = 0.02;

/**
 * True when (width / height) is within `tol` (fractional) of targetW / targetH.
 * Returns false for missing/zero dimensions.
 */
export function aspectRatioMatches(
  width: number,
  height: number,
  targetW: number,
  targetH: number,
  tol: number = TOLERANCE,
): boolean {
  if (!width || !height) return false;
  const ar = width / height;
  const target = targetW / targetH;
  return Math.abs(ar - target) / target <= tol;
}

// ── test seam ────────────────────────────────────────────────────────────────
// Lets unit tests bypass the real fetch + sharp + Storage path. Mirrors the
// pattern used by lib/services/end-frame.ts.
type TransformFn = (imageUrl: string, targetW: number, targetH: number) => Promise<string>;
let transformOverride: TransformFn | null = null;
export function __setTransformForTests(fn: TransformFn | null): void {
  transformOverride = fn;
}

/**
 * Returns a URL to a version of `imageUrl` whose aspect ratio matches
 * targetW:targetH (default 1920×1080 / 16:9). If the source already matches
 * within tolerance, it is returned unchanged. Otherwise the image is
 * center-cropped + resized to exactly targetW×targetH and uploaded to Supabase
 * Storage under a deterministic (idempotent) path; the public URL is returned.
 *
 * WHY THIS EXISTS — Seedance 2.0 image-to-video derives its OUTPUT aspect ratio
 * from the INPUT image (snapping to the nearest supported bucket) and ignores
 * the API `aspect_ratio` field. A 3:2 listing photo (1264×842) therefore yields
 * a 4:3 clip (1664×1248) instead of 16:9 1080p. Forcing the source to a true
 * 16:9 frame makes Seedance emit 1920×1080. Verified empirically against the
 * live Atlas endpoint 2026-05-28 (3:2 in → 4:3 out; 16:9 in → 16:9 out).
 */
export async function ensureSourceAspectRatio(
  imageUrl: string,
  targetW: number = TARGET_W,
  targetH: number = TARGET_H,
): Promise<string> {
  if (transformOverride) return transformOverride(imageUrl, targetW, targetH);

  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`ensureSourceAspectRatio: fetch failed HTTP ${res.status} for ${imageUrl}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buf).metadata();
  if (aspectRatioMatches(meta.width ?? 0, meta.height ?? 0, targetW, targetH)) {
    // Already 16:9 — no rewrite needed (avoids a redundant upload + re-encode).
    return imageUrl;
  }

  // `cover` center-crops to the target ratio and scales to exactly targetW×targetH:
  // upscaling small Lab uploads, downscaling large originals. Output always lands
  // on 1920×1080 — the matched resolution for Seedance's 1080p tier.
  const cropped = await sharp(buf)
    .resize(targetW, targetH, { fit: "cover", position: "centre" })
    .jpeg({ quality: 92 })
    .toBuffer();

  const hash = createHash("sha1").update(`${imageUrl}|${targetW}x${targetH}`).digest("hex").slice(0, 16);
  const path = `seedance-src/${hash}-${targetW}x${targetH}.jpg`;
  const supabase = getSupabase();
  const { error } = await supabase.storage
    .from("property-photos")
    .upload(path, cropped, { contentType: "image/jpeg", upsert: true });
  if (error) {
    throw new Error(`ensureSourceAspectRatio: upload failed — ${error.message}`);
  }
  return supabase.storage.from("property-photos").getPublicUrl(path).data.publicUrl;
}
