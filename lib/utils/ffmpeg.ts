import { execFile } from "child_process";
import { promisify } from "util";
import { createGunzip } from "zlib";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { createWriteStream, createReadStream } from "fs";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import * as crypto from "crypto";

const exec = promisify(execFile);

// Vercel serverless functions don't ship ffmpeg/ffprobe. We previously bundled
// them via vercel.json includeFiles (with ffmpeg-static + ffprobe-static), but
// the ~110 MB of binaries pushed each function bundle over Vercel's 250 MB
// uncompressed limit and deploys started failing during the "Deploying outputs"
// phase. Switched (2026-05-27) to fetch-on-cold-start from public CDNs into
// /tmp, which lambdas have 512 MB of and warm-instances reuse. First cold
// invocation pays ~2-4s extra for the download; subsequent calls are instant.
//
// If a system ffmpeg is on PATH (local dev shells with brew install ffmpeg),
// we use that instead — checked via `which`. Only Vercel lambdas hit the CDN.

const FFMPEG_DOWNLOAD_URL =
  process.env.LE_FFMPEG_DOWNLOAD_URL ??
  "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-x64.gz";

const FFPROBE_DOWNLOAD_URL =
  process.env.LE_FFPROBE_DOWNLOAD_URL ??
  "https://unpkg.com/ffprobe-static@3.1.0/bin/linux/x64/ffprobe";

const TMP_FFMPEG = path.join(os.tmpdir(), "ffmpeg");
const TMP_FFPROBE = path.join(os.tmpdir(), "ffprobe");

let _ffmpegBootstrap: Promise<string> | null = null;
let _ffprobeBootstrap: Promise<string> | null = null;

async function systemBinary(name: "ffmpeg" | "ffprobe"): Promise<string | null> {
  try {
    const { stdout } = await exec("which", [name]);
    const p = stdout.trim();
    return p || null;
  } catch {
    return null;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function downloadGzipped(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`download ${url} failed: HTTP ${res.status}`);
  }
  // Node's fetch returns a Web ReadableStream; convert to Node Readable.
  const src = Readable.fromWeb(res.body as unknown as import("stream/web").ReadableStream);
  await pipeline(src, createGunzip(), createWriteStream(destPath));
}

async function downloadRaw(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`download ${url} failed: HTTP ${res.status}`);
  }
  const src = Readable.fromWeb(res.body as unknown as import("stream/web").ReadableStream);
  await pipeline(src, createWriteStream(destPath));
}

async function ensureBinary(opts: {
  name: "ffmpeg" | "ffprobe";
  tmpPath: string;
  url: string;
  gzipped: boolean;
}): Promise<string> {
  // 1. Prefer system binary on PATH (local dev shells, CI test runners).
  const system = await systemBinary(opts.name);
  if (system) return system;

  // 2. Cached in /tmp from a previous invocation on this warm lambda.
  if (await fileExists(opts.tmpPath)) return opts.tmpPath;

  // 3. Cold start — download to /tmp. Atomic: write to .tmp then rename so
  //    concurrent invocations don't race on a half-written binary.
  const stagingPath = `${opts.tmpPath}.${process.pid}.${Date.now()}`;
  try {
    if (opts.gzipped) {
      await downloadGzipped(opts.url, stagingPath);
    } else {
      await downloadRaw(opts.url, stagingPath);
    }
    await fs.chmod(stagingPath, 0o755);
    await fs.rename(stagingPath, opts.tmpPath);
  } catch (err) {
    await fs.unlink(stagingPath).catch(() => {});
    throw err;
  }
  return opts.tmpPath;
}

async function ffmpegBin(): Promise<string> {
  if (!_ffmpegBootstrap) {
    _ffmpegBootstrap = ensureBinary({
      name: "ffmpeg",
      tmpPath: TMP_FFMPEG,
      url: FFMPEG_DOWNLOAD_URL,
      gzipped: true,
    }).catch((err) => {
      _ffmpegBootstrap = null; // allow retry on next call
      throw err;
    });
  }
  return _ffmpegBootstrap;
}

async function ffprobeBin(): Promise<string> {
  if (!_ffprobeBootstrap) {
    _ffprobeBootstrap = ensureBinary({
      name: "ffprobe",
      tmpPath: TMP_FFPROBE,
      url: FFPROBE_DOWNLOAD_URL,
      gzipped: false,
    }).catch((err) => {
      _ffprobeBootstrap = null;
      throw err;
    });
  }
  return _ffprobeBootstrap;
}

// Re-export so unused-import doesn't strip them; the streams import is used
// only inside the helpers above. (Silence TS6133 in strict configs.)
void createReadStream;

interface AssemblyOptions {
  clips: Array<{ path: string; duration: number }>;
  outputDir: string;
  musicPath: string | null;
  transitionDuration: number;
  overlay: {
    address: string;
    price: string;
    details: string; // "4 BD | 3 BA"
    agent: string;
    brokerage: string | null;
  };
}

export async function assembleVideo(opts: AssemblyOptions): Promise<{
  horizontalPath: string;
  verticalPath: string;
}> {
  await fs.mkdir(opts.outputDir, { recursive: true });

  const concatListPath = path.join(opts.outputDir, "concat.txt");
  const rawPath = path.join(opts.outputDir, "raw_concat.mp4");
  const withTransitionsPath = path.join(opts.outputDir, "with_transitions.mp4");
  const withAudioPath = path.join(opts.outputDir, "with_audio.mp4");
  const horizontalPath = path.join(opts.outputDir, "final_horizontal.mp4");
  const verticalPath = path.join(opts.outputDir, "final_vertical.mp4");

  // Step 1: Normalize all clips to consistent format
  const normalizedPaths: string[] = [];
  for (let i = 0; i < opts.clips.length; i++) {
    const normPath = path.join(opts.outputDir, `norm_${i}.mp4`);
    await exec(await ffmpegBin(), [
      "-i", opts.clips[i].path,
      "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1",
      "-r", "30",
      "-c:v", "libx264",
      "-preset", "fast",
      "-pix_fmt", "yuv420p",
      "-an",
      "-y",
      normPath,
    ]);
    normalizedPaths.push(normPath);
  }

  // Step 2: Build xfade filter chain for crossfade transitions
  if (normalizedPaths.length === 1) {
    await fs.copyFile(normalizedPaths[0], withTransitionsPath);
  } else {
    const td = opts.transitionDuration;
    const filterParts: string[] = [];
    let prevLabel = "[0:v]";
    let runningOffset = opts.clips[0].duration - td;

    for (let i = 1; i < normalizedPaths.length; i++) {
      const outLabel = i === normalizedPaths.length - 1 ? "[outv]" : `[v${i}]`;
      filterParts.push(
        `${prevLabel}[${i}:v]xfade=transition=fade:duration=${td}:offset=${runningOffset.toFixed(2)}${outLabel}`
      );
      prevLabel = outLabel;
      if (i < normalizedPaths.length - 1) {
        runningOffset += opts.clips[i].duration - td;
      }
    }

    const inputs = normalizedPaths.flatMap((p) => ["-i", p]);
    await exec(await ffmpegBin(), [
      ...inputs,
      "-filter_complex", filterParts.join(";"),
      "-map", "[outv]",
      "-c:v", "libx264",
      "-preset", "fast",
      "-pix_fmt", "yuv420p",
      "-y",
      withTransitionsPath,
    ]);
  }

  // Step 3: Add audio track (if provided)
  const videoBeforeOverlay = opts.musicPath
    ? withAudioPath
    : withTransitionsPath;

  if (opts.musicPath) {
    // Get video duration for audio fade
    const { stdout } = await exec(await ffprobeBin(), [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      withTransitionsPath,
    ]);
    const videoDuration = parseFloat(JSON.parse(stdout).format.duration);
    const fadeStart = Math.max(0, videoDuration - 2);

    await exec(await ffmpegBin(), [
      "-i", withTransitionsPath,
      "-i", opts.musicPath,
      "-filter_complex",
      `[1:a]afade=t=in:d=0.5,afade=t=out:st=${fadeStart.toFixed(1)}:d=2[a]`,
      "-map", "0:v",
      "-map", "[a]",
      "-shortest",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "192k",
      "-y",
      withAudioPath,
    ]);
  }

  // Step 4: Add text overlays (opening and closing cards)
  const { stdout: durOut } = await exec(await ffprobeBin(), [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    videoBeforeOverlay,
  ]);
  const totalDuration = parseFloat(JSON.parse(durOut).format.duration);
  const closingStart = totalDuration - 4;

  const priceFormatted = opts.overlay.price;
  const closingLine = opts.overlay.brokerage
    ? `${opts.overlay.agent} | ${opts.overlay.brokerage}`
    : opts.overlay.agent;

  // Use drawtext for overlays
  const drawFilters = [
    // Opening: address (first 2.5 seconds)
    `drawtext=text='${escapeFFmpegText(opts.overlay.address)}':fontsize=48:fontcolor=white:borderw=2:bordercolor=black@0.6:x=(w-tw)/2:y=h-140:enable='between(t,0.5,2.5)'`,
    // Closing: price + details
    `drawtext=text='${escapeFFmpegText(priceFormatted)} | ${escapeFFmpegText(opts.overlay.details)}':fontsize=42:fontcolor=white:borderw=2:bordercolor=black@0.6:x=(w-tw)/2:y=h-160:enable='between(t,${closingStart},${totalDuration})'`,
    // Closing: agent line
    `drawtext=text='${escapeFFmpegText(closingLine)}':fontsize=32:fontcolor=white:borderw=2:bordercolor=black@0.6:x=(w-tw)/2:y=h-110:enable='between(t,${closingStart},${totalDuration})'`,
  ];

  await exec(await ffmpegBin(), [
    "-i", videoBeforeOverlay,
    "-vf", drawFilters.join(","),
    "-c:v", "libx264",
    "-preset", "fast",
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-y",
    horizontalPath,
  ]);

  // Step 5: Create 9:16 vertical version (center crop)
  await exec(await ffmpegBin(), [
    "-i", horizontalPath,
    "-vf", "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920",
    "-c:v", "libx264",
    "-preset", "fast",
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-y",
    verticalPath,
  ]);

  // Clean up intermediate files
  const intermediates = [
    ...normalizedPaths,
    concatListPath,
    rawPath,
    withTransitionsPath,
    withAudioPath,
  ];
  for (const f of intermediates) {
    await fs.unlink(f).catch(() => {});
  }

  return { horizontalPath, verticalPath };
}

function escapeFFmpegText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "'\\''")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

// ---------------------------------------------------------------------------
// Speed-ramp utilities (added for v1.1 Seedance push-in)
// ---------------------------------------------------------------------------

interface SpeedRampOpts {
  /** Duration (seconds) of the head/tail segments to slow down. Default 0.5 */
  rampSeconds?: number;
  /** Playback speed factor for head/tail (< 1 = slower). Default 0.8 */
  rampFactor?: number;
}

/**
 * Apply a gentle speed ramp to the first and last `rampSeconds` of a video
 * by slowing them to `rampFactor`× normal speed via trim+setpts+concat.
 *
 * Expected output duration: inputDuration + 2 * rampSeconds * (1/rampFactor - 1)
 * e.g. 5s clip, rampSeconds=0.5, rampFactor=0.8 → 5.25s
 */
export async function applySpeedRamp(
  inputPath: string,
  outputPath: string,
  opts: SpeedRampOpts = {}
): Promise<void> {
  const RS = opts.rampSeconds ?? 0.5;
  const RF = opts.rampFactor ?? 0.8;

  // Probe input duration
  const { stdout: probeOut } = await exec(await ffprobeBin(), [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    inputPath,
  ]);
  const inputDuration = parseFloat(probeOut.trim());

  if (inputDuration < 2 * RS + 0.1) {
    throw new Error("clip too short for speed ramp");
  }

  const DUR = inputDuration;
  const rs = RS.toFixed(3);
  const rf = RF.toFixed(3);
  const dur = DUR.toFixed(3);
  const durMinusRs = (DUR - RS).toFixed(3);

  // Build 3-segment filter:
  // [head] = first RS seconds, slowed to 1/RF× speed (larger timestamps = slower)
  // [mid]  = middle unchanged, reset PTS to 0
  // [tail] = last RS seconds, slowed to 1/RF× speed, reset PTS to 0
  //
  // After trim, each segment's STARTPTS equals the first retained frame's PTS.
  // We must subtract STARTPTS before dividing so each segment starts at t=0,
  // then the concat filter handles the timeline offset automatically.
  const filterComplex = [
    `[0:v]trim=0:${rs},setpts=PTS/RF[head]`,
    `[0:v]trim=${rs}:${durMinusRs},setpts=PTS-STARTPTS[mid]`,
    `[0:v]trim=${durMinusRs}:${dur},setpts=(PTS-STARTPTS)/${rf}[tail]`,
    `[head][mid][tail]concat=n=3:v=1[out]`,
  ].join(";").replace(/RF/g, rf);

  await exec(await ffmpegBin(), [
    "-i", inputPath,
    "-filter_complex", filterComplex,
    "-map", "[out]",
    "-c:v", "libx264",
    "-preset", "fast",
    "-pix_fmt", "yuv420p",
    "-an",
    "-y",
    outputPath,
  ]);
}

// ---------------------------------------------------------------------------
// Concat utility (for Director assembly in v1.1)
// ---------------------------------------------------------------------------

/**
 * Concatenate an ordered list of video files into a single output using
 * ffmpeg's concat demuxer (-f concat -safe 0 -c copy).
 *
 * Stream-copy mode: fast, lossless, assumes all inputs share the same codec
 * (guaranteed when all segments come from the same speed-ramp pass which
 * produces libx264/yuv420p).
 *
 * @returns duration of the output file in seconds (probed via ffprobe)
 */
export async function concatClips(
  orderedPaths: string[],
  outputPath: string,
): Promise<{ durationSeconds: number }> {
  if (orderedPaths.length === 0) {
    throw new Error("concatClips: orderedPaths must not be empty");
  }

  // Write a ffmpeg concat list file next to the output file
  const listPath = outputPath + ".concat.txt";
  const listContent = orderedPaths
    .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
    .join("\n");

  await fs.writeFile(listPath, listContent, "utf8");

  try {
    await exec(await ffmpegBin(), [
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-c", "copy",
      "-y",
      outputPath,
    ]);
  } finally {
    await fs.unlink(listPath).catch(() => {});
  }

  // Probe output duration
  const { stdout: probeOut } = await exec(await ffprobeBin(), [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    outputPath,
  ]);
  const durationSeconds = parseFloat(probeOut.trim());

  return { durationSeconds };
}

/**
 * Convenience wrapper: accepts a video buffer, writes to a tmp file,
 * applies the speed ramp, and returns the resulting buffer.
 * Both temp files are cleaned up in a finally block.
 */
export async function applySpeedRampToBuffer(
  buf: Buffer,
  opts: SpeedRampOpts = {}
): Promise<Buffer> {
  const uuid = crypto.randomUUID();
  const inPath = path.join(os.tmpdir(), `seedance-ramp-in-${uuid}.mp4`);
  const outPath = path.join(os.tmpdir(), `seedance-ramp-out-${uuid}.mp4`);

  await fs.writeFile(inPath, buf);
  try {
    await applySpeedRamp(inPath, outPath, opts);
    return await fs.readFile(outPath);
  } finally {
    await fs.unlink(inPath).catch(() => {});
    await fs.unlink(outPath).catch(() => {});
  }
}
