/**
 * line-delta.ts
 *
 * Extracts structural-line angular variance across a clip by sampling
 * frames at t=0, t=mid, t=end, running a Sobel-like edge-detection via
 * sharp, then computing the dominant-line angle per frame and returning
 * the inter-frame angular variance in degrees.
 *
 * Returns Infinity on any extraction/processing failure — callers treat
 * that as "check failed".
 */

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rm, mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

// ── ffmpeg helpers ────────────────────────────────────────────────────────────

/** Spawn ffmpeg and return stdout + stderr when it exits. */
function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

/** Return the duration (in seconds) of a video file via ffprobe. */
async function getVideoDuration(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=duration",
      "-of", "csv=p=0",
      path,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (c: Buffer) => { out += c.toString(); });
    proc.on("close", (code) => {
      const val = parseFloat(out.trim());
      if (code !== 0 || isNaN(val)) reject(new Error(`ffprobe failed (code=${code})`));
      else resolve(val);
    });
  });
}

/** Extract a single frame at `timeSecs` from `inputPath` into `outputPath`. */
async function extractFrame(
  inputPath: string,
  timeSecs: number,
  outputPath: string,
): Promise<boolean> {
  const { code } = await runFfmpeg([
    "-ss", String(timeSecs),
    "-i", inputPath,
    "-frames:v", "1",
    "-q:v", "3",
    "-y",
    outputPath,
  ]);
  return code === 0;
}

// ── Sobel-like edge map → dominant angle ────────────────────────────────────

/**
 * Sobel X kernel (3×3 convolution for horizontal gradient detection).
 * sharp.convolve expects row-major, scale=1 means raw sum.
 */
const SOBEL_X: sharp.Kernel = {
  width: 3,
  height: 3,
  kernel: [-1, 0, 1, -2, 0, 2, -1, 0, 1],
  scale: 1,
  offset: 128,
};

const SOBEL_Y: sharp.Kernel = {
  width: 3,
  height: 3,
  kernel: [-1, -2, -1, 0, 0, 0, 1, 2, 1],
  scale: 1,
  offset: 128,
};

const NUM_ANGLE_BINS = 36; // 5-degree bins over 0..180°

/**
 * Given a JPEG path, compute a histogram of gradient angles (Hough-like,
 * 36 bins × 5°) and return the dominant angle in degrees [0, 180).
 *
 * Only pixels with gradient magnitude above a threshold are counted —
 * this filters noise in low-texture regions.
 */
async function dominantGradientAngle(framePath: string): Promise<number> {
  // Resize to a fixed size for speed; structural lines are scale-invariant
  const resized = sharp(framePath).resize(256, 144, { fit: "fill" }).grayscale();

  const [rawX, rawY, meta] = await Promise.all([
    resized.clone().convolve(SOBEL_X).raw().toBuffer(),
    resized.clone().convolve(SOBEL_Y).raw().toBuffer(),
    resized.clone().metadata(),
  ]);

  const bins = new Float32Array(NUM_ANGLE_BINS).fill(0);
  const THRESHOLD = 10; // gradient magnitude threshold

  for (let i = 0; i < rawX.length; i++) {
    // Recover signed gradient from [0,255] offset representation
    const gx = (rawX[i] - 128);
    const gy = (rawY[i] - 128);
    const mag = Math.sqrt(gx * gx + gy * gy);
    if (mag < THRESHOLD) continue;

    // Gradient angle in [0, π) mapped to a bin
    let angle = Math.atan2(Math.abs(gy), gx); // [0, π/2]
    if (angle < 0) angle += Math.PI;
    const binIdx = Math.min(
      NUM_ANGLE_BINS - 1,
      Math.floor((angle / Math.PI) * NUM_ANGLE_BINS),
    );
    bins[binIdx] += mag;
  }

  // Find the bin with the highest total gradient weight
  let maxBin = 0;
  for (let b = 1; b < NUM_ANGLE_BINS; b++) {
    if (bins[b] > bins[maxBin]) maxBin = b;
  }

  return (maxBin / NUM_ANGLE_BINS) * 180;
}

/**
 * Compute the circular variance of angles (0..180° domain) given a list
 * of angles in degrees. Uses the unit-circle projection trick for circular
 * statistics.
 */
function circularVarianceDeg(angles: number[]): number {
  if (angles.length < 2) return 0;
  // Map each angle to a point on the unit circle (doubled to handle 0=180 aliasing)
  let cosSum = 0;
  let sinSum = 0;
  for (const a of angles) {
    const rad = (a * 2 * Math.PI) / 180;
    cosSum += Math.cos(rad);
    sinSum += Math.sin(rad);
  }
  const R = Math.sqrt(cosSum * cosSum + sinSum * sinSum) / angles.length;
  // R ∈ [0,1]: R=1 means all pointing same direction, R=0 means uniform spread
  // Convert to degrees: max variance = 90° (half-circle uniform)
  return (1 - R) * 90;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sample frames 0, mid, end of the clip at `clipUrl`, run Sobel-based edge
 * detection on each, and return the inter-frame angular variance in degrees.
 *
 * High values (e.g. > 3°) indicate structural geometry shifting across the
 * clip — a signal of warping or morphing artefacts.
 *
 * Returns `Infinity` if frames cannot be extracted or processed.
 */
export async function computeLineAngularVariance(clipUrl: string): Promise<number> {
  const workDir = join(tmpdir(), `line-delta-${randomUUID()}`);
  try {
    await mkdir(workDir, { recursive: true });

    // Download the clip to a temp file
    const videoPath = join(workDir, "clip.mp4");
    const response = await fetch(clipUrl);
    if (!response.ok) return Infinity;
    const buf = Buffer.from(await response.arrayBuffer());
    await writeFile(videoPath, buf);

    // Get duration
    let duration: number;
    try {
      duration = await getVideoDuration(videoPath);
    } catch {
      return Infinity;
    }

    // Extract 3 frames: 0, mid, end (slightly before to avoid stream cutoff)
    const times = [0, duration / 2, Math.max(0, duration - 0.1)];
    const framePaths = times.map((_, i) => join(workDir, `frame_${i}.jpg`));

    const extracted = await Promise.all(
      times.map((t, i) => extractFrame(videoPath, t, framePaths[i])),
    );

    if (extracted.some((ok) => !ok)) return Infinity;

    // Compute dominant gradient angle per frame
    const angles = await Promise.all(framePaths.map(dominantGradientAngle));

    return circularVarianceDeg(angles);
  } catch {
    return Infinity;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
