/**
 * feature-helpers.ts — pixel-level utilities for V2.1 picker features.
 *
 * Two helpers:
 *   1. computeCosineSimilarity — pure math, no I/O
 *   2. computePixelBrightness  — sharp grayscale histogram → mean 0..1
 *
 * Both are sync-safe (brightness is async due to network fetch + sharp decode).
 * Callers cache per-photo in a Map<photo_id, …> to avoid redundant work.
 */

import sharp from "sharp";

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

/**
 * Compute cosine similarity between two equal-length numeric vectors.
 * Returns a value in [-1, 1]. Gemini embeddings are L2-normalised so this
 * is equivalent to the dot product and will always be in [0, 1] for them.
 *
 * Returns 0.5 (neutral sentinel) if either vector is empty or they differ
 * in length — callers should log and fall back gracefully.
 */
export function computeCosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0.5;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0.5;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ---------------------------------------------------------------------------
// Pixel brightness via sharp
// ---------------------------------------------------------------------------

/**
 * Fetch an image from `url` and compute its mean grayscale brightness.
 *
 * Strategy:
 *   1. HTTP GET → raw bytes
 *   2. sharp().grayscale().raw() → flat Uint8Array of pixel values 0-255
 *   3. Mean divided by 255 → 0..1
 *
 * Returns null on any error so callers can fall back to 0.5.
 */
export async function computePixelBrightness(url: string): Promise<number | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { data, info } = await sharp(buffer)
      .grayscale()
      .resize(64, 64, { fit: "inside" }) // downsample for speed; histogram shape is preserved
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = info.width * info.height;
    if (pixels === 0) return null;

    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    return sum / (pixels * 255);
  } catch {
    return null;
  }
}
