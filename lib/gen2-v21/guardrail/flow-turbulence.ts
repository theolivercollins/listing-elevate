/**
 * flow-turbulence.ts
 *
 * Lightweight optical-flow proxy: samples 8 evenly-spaced frames, computes
 * frame-diff entropy localized in 8×8 grid cells. High entropy concentrated
 * in a small region ⇒ localized turbulence ⇒ likely morphing artefact.
 *
 * Returns a score in [0, 1]: 0 = pristine motion, 1 = severe turbulence.
 * Returns 1 (max penalty) on any extraction failure.
 */

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rm, mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

// ── ffmpeg helpers ────────────────────────────────────────────────────────────

function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

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

async function extractFrame(
  inputPath: string,
  timeSecs: number,
  outputPath: string,
): Promise<boolean> {
  const { code } = await runFfmpeg([
    "-ss", String(timeSecs),
    "-i", inputPath,
    "-frames:v", "1",
    "-q:v", "5",
    "-y",
    outputPath,
  ]);
  return code === 0;
}

// ── Per-cell entropy calculation ─────────────────────────────────────────────

const FRAME_W = 128; // process at reduced resolution for speed
const FRAME_H = 72;
const GRID_COLS = 8;
const GRID_ROWS = 8;
const CELL_W = FRAME_W / GRID_COLS; // 16
const CELL_H = FRAME_H / GRID_ROWS; // 9

/**
 * Compute the absolute pixel-level difference between two grayscale raw
 * buffers (same dimensions) and return a Float32Array of per-cell mean diff.
 */
function cellMeanDiff(bufA: Buffer, bufB: Buffer): Float32Array {
  const cells = new Float32Array(GRID_COLS * GRID_ROWS).fill(0);
  const counts = new Uint32Array(GRID_COLS * GRID_ROWS).fill(0);

  for (let y = 0; y < FRAME_H; y++) {
    const row = y * FRAME_W;
    const cellRow = Math.floor(y / CELL_H);
    for (let x = 0; x < FRAME_W; x++) {
      const cellCol = Math.floor(x / CELL_W);
      const cellIdx = cellRow * GRID_COLS + cellCol;
      const diff = Math.abs(bufA[row + x] - bufB[row + x]);
      cells[cellIdx] += diff;
      counts[cellIdx]++;
    }
  }

  for (let c = 0; c < cells.length; c++) {
    if (counts[c] > 0) cells[c] /= counts[c];
  }
  return cells;
}

/**
 * Shannon entropy of a distribution of values (normalized to [0,1]).
 * Higher entropy = more uniform spread of motion across cells.
 * Lower entropy = motion concentrated in few cells (localized turbulence).
 *
 * We invert the entropy: 1 - normalized_entropy = turbulence signal.
 */
function spatialConcentrationScore(cellDiffs: Float32Array): number {
  const total = cellDiffs.reduce((s, v) => s + v, 0);
  if (total === 0) return 0; // no motion at all → no turbulence

  const probs = Array.from(cellDiffs).map((v) => v / total);

  let entropy = 0;
  const maxEntropy = Math.log2(cellDiffs.length);
  for (const p of probs) {
    if (p > 0) entropy -= p * Math.log2(p);
  }

  // Normalized entropy: 0 = all in one cell (worst), 1 = uniform spread
  const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 1;

  // Invert: 1 - normalized = concentration score
  // Scale by mean diff magnitude so tiny diffs don't spike concentration
  const diffMagnitude = Math.min(1, total / (cellDiffs.length * 30));
  return (1 - normalizedEntropy) * diffMagnitude;
}

/**
 * Aggregate per-frame-pair turbulence scores into a single clip score [0,1].
 * Uses the 90th-percentile value so a single bad frame-pair dominates.
 */
function aggregateFramePairScores(scores: number[]): number {
  if (scores.length === 0) return 0;
  const sorted = [...scores].sort((a, b) => a - b);
  const p90Idx = Math.ceil(sorted.length * 0.9) - 1;
  return Math.min(1, sorted[Math.max(0, p90Idx)]);
}

// ── Public API ────────────────────────────────────────────────────────────────

const NUM_SAMPLE_FRAMES = 8;

/**
 * Compute optical-flow turbulence proxy for the clip at `clipUrl`.
 *
 * Samples 8 frames, measures localized frame-diff entropy per 8×8 spatial
 * cell, returns a score in [0, 1] where higher = more turbulence / morphing.
 *
 * A score above ~0.5 typically indicates morphing or other warping artefacts
 * that indicate a failed generation.
 *
 * Returns 1 (worst) on any extraction failure.
 */
export async function computeTurbulenceScore(clipUrl: string): Promise<number> {
  const workDir = join(tmpdir(), `flow-turb-${randomUUID()}`);
  try {
    await mkdir(workDir, { recursive: true });

    // Download
    const videoPath = join(workDir, "clip.mp4");
    const response = await fetch(clipUrl);
    if (!response.ok) return 1;
    const buf = Buffer.from(await response.arrayBuffer());
    await writeFile(videoPath, buf);

    // Duration
    let duration: number;
    try {
      duration = await getVideoDuration(videoPath);
    } catch {
      return 1;
    }

    // Sample timestamps
    const times: number[] = [];
    for (let i = 0; i < NUM_SAMPLE_FRAMES; i++) {
      times.push((i / (NUM_SAMPLE_FRAMES - 1)) * Math.max(0, duration - 0.1));
    }

    // Extract frames
    const framePaths = times.map((_, i) => join(workDir, `f${i}.jpg`));
    const ok = await Promise.all(times.map((t, i) => extractFrame(videoPath, t, framePaths[i])));
    if (ok.some((v) => !v)) return 1;

    // Resize + grayscale all frames
    const rawBuffers = await Promise.all(
      framePaths.map((fp) =>
        sharp(fp)
          .resize(FRAME_W, FRAME_H, { fit: "fill" })
          .grayscale()
          .raw()
          .toBuffer(),
      ),
    );

    // Compute per-consecutive-pair turbulence
    const pairScores: number[] = [];
    for (let i = 1; i < rawBuffers.length; i++) {
      const cellDiffs = cellMeanDiff(rawBuffers[i - 1], rawBuffers[i]);
      pairScores.push(spatialConcentrationScore(cellDiffs));
    }

    return aggregateFramePairScores(pairScores);
  } catch {
    return 1;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
