import sharp from "sharp";
import * as fs from "fs/promises";
import * as path from "path";

const MAX_DIMENSION = 2048;

export async function normalizeImage(inputPath: string): Promise<Buffer> {
  const buffer = await fs.readFile(inputPath);
  return sharp(buffer)
    .rotate() // auto-orient from EXIF
    .resize(MAX_DIMENSION, MAX_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 90 })
    .toBuffer();
}

export async function imageToBase64(buffer: Buffer): Promise<string> {
  return buffer.toString("base64");
}

export async function extractFramesFromClip(
  clipPath: string,
  outputDir: string,
  frameCount: number = 5
): Promise<string[]> {
  // Use ffprobe to get duration, then extract evenly spaced frames.
  // Vercel serverless has no system ffmpeg/ffprobe — use the bundled
  // binaries from ffmpeg-static + ffprobe-static (static-path exports,
  // Vercel tracer can see the binary file via the package's index.js).
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const ffmpegPath = (await import("ffmpeg-static")).default;
  const ffprobeStatic = (await import("ffprobe-static")).default;
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static did not return a path — check pnpm install");
  }
  const exec = promisify(execFile);

  // Get video duration
  const { stdout } = await exec(ffprobeStatic.path, [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    clipPath,
  ]);
  const duration = parseFloat(JSON.parse(stdout).format.duration);
  const interval = duration / (frameCount + 1);

  await fs.mkdir(outputDir, { recursive: true });
  const framePaths: string[] = [];

  for (let i = 1; i <= frameCount; i++) {
    const timestamp = interval * i;
    const framePath = path.join(outputDir, `frame_${i}.jpg`);
    await exec(ffmpegPath, [
      "-ss", timestamp.toString(),
      "-i", clipPath,
      "-frames:v", "1",
      "-q:v", "2",
      "-y",
      framePath,
    ]);
    framePaths.push(framePath);
  }

  return framePaths;
}

export function getMediaType(
  fileName: string
): "image/jpeg" | "image/png" | "image/webp" {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}
