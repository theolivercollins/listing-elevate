import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile, execFileSync } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import * as crypto from "crypto";
import { applySpeedRamp } from "../ffmpeg.js";

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
  console.log("ffmpeg not found on PATH — skipping speed-ramp integration tests");
}

let fixturePath = "";
let outputPath = "";
let shortFixturePath = "";

beforeAll(async () => {
  if (!hasFfmpeg) return;

  const uuid = crypto.randomUUID();
  fixturePath = path.join(os.tmpdir(), `speed-ramp-fixture-${uuid}.mp4`);
  outputPath = path.join(os.tmpdir(), `speed-ramp-output-${uuid}.mp4`);
  shortFixturePath = path.join(os.tmpdir(), `speed-ramp-short-${uuid}.mp4`);

  // Generate 5-second testsrc fixture
  await exec("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", "testsrc=duration=5:size=320x240:rate=30",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    fixturePath,
  ]);

  // Generate 0.5-second fixture for the "too short" guard test
  await exec("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", "testsrc=duration=0.5:size=320x240:rate=30",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    shortFixturePath,
  ]);
});

afterAll(async () => {
  for (const f of [fixturePath, outputPath, shortFixturePath]) {
    if (f) await fs.unlink(f).catch(() => {});
  }
});

describe.skipIf(!hasFfmpeg)("applySpeedRamp (integration)", () => {
  it("produces output with duration within ±0.05s of 5.25s", async () => {
    // With defaults: rampSeconds=0.5, rampFactor=0.8
    // Expected duration = 5 + 2 * 0.5 * (1/0.8 - 1) = 5 + 2 * 0.5 * 0.25 = 5.25
    await applySpeedRamp(fixturePath, outputPath);

    const { stdout } = await exec("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      outputPath,
    ]);

    const measuredDuration = parseFloat(stdout.trim());
    console.log(`Measured output duration: ${measuredDuration.toFixed(4)}s (expected ~5.25s)`);

    expect(measuredDuration).toBeGreaterThan(5.25 - 0.05);
    expect(measuredDuration).toBeLessThan(5.25 + 0.05);
  });

  it("throws 'clip too short for speed ramp' for a 0.5s clip with defaults", async () => {
    // 0.5s < 2 * 0.5 + 0.1 = 1.1, so should throw
    await expect(
      applySpeedRamp(shortFixturePath, outputPath)
    ).rejects.toThrow("clip too short for speed ramp");
  });

  it("output file exists and is non-empty after ramp", async () => {
    const stat = await fs.stat(outputPath);
    expect(stat.size).toBeGreaterThan(0);
  });
});
