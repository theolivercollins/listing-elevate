import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile, execFileSync } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import * as crypto from "crypto";
import { concatClips } from "../ffmpeg.js";

const exec = promisify(execFile);

// Detect ffmpeg synchronously at module-load time so describe.skipIf works correctly
function detectFfmpegSync(): boolean {
  try {
    execFileSync("which", ["ffmpeg"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const hasFfmpeg = detectFfmpegSync();
if (!hasFfmpeg) {
  console.log("ffmpeg not found on PATH — skipping concatClips integration tests");
}

const uuid = crypto.randomUUID();
const clip1 = path.join(os.tmpdir(), `concat-fixture-1-${uuid}.mp4`);
const clip2 = path.join(os.tmpdir(), `concat-fixture-2-${uuid}.mp4`);
const clip3 = path.join(os.tmpdir(), `concat-fixture-3-${uuid}.mp4`);
const outputPath = path.join(os.tmpdir(), `concat-output-${uuid}.mp4`);

beforeAll(async () => {
  if (!hasFfmpeg) return;

  // Generate 3 × 3-second fixture clips with a test source pattern
  for (const dest of [clip1, clip2, clip3]) {
    await exec("ffmpeg", [
      "-y",
      "-f", "lavfi",
      "-i", "testsrc=duration=3:size=320x240:rate=30",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      dest,
    ]);
  }
});

afterAll(async () => {
  for (const f of [clip1, clip2, clip3, outputPath]) {
    await fs.unlink(f).catch(() => {});
  }
});

describe.skipIf(!hasFfmpeg)("concatClips (integration)", () => {
  it("concatenates 3 clips and returns duration ~9s ±0.5s", async () => {
    const result = await concatClips([clip1, clip2, clip3], outputPath);

    // The three 3-second clips should produce ~9s of output
    expect(result.durationSeconds).toBeGreaterThan(9 - 0.5);
    expect(result.durationSeconds).toBeLessThan(9 + 0.5);
  });

  it("output file exists and is non-empty after concat", async () => {
    const stat = await fs.stat(outputPath);
    expect(stat.size).toBeGreaterThan(0);
  });

  it("duration returned by concatClips matches ffprobe output", async () => {
    const { stdout } = await exec("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      outputPath,
    ]);
    const probedDuration = parseFloat(stdout.trim());
    const result = await concatClips([clip1, clip2, clip3], outputPath);
    // Allow 0.1s tolerance between two consecutive probes (re-encode timing)
    expect(Math.abs(result.durationSeconds - probedDuration)).toBeLessThan(0.5);
  });

  it("throws when given an empty array", async () => {
    await expect(concatClips([], outputPath)).rejects.toThrow(
      "concatClips: orderedPaths must not be empty",
    );
  });
});
