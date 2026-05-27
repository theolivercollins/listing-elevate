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

// extractFramesFromClip was removed 2026-05-27 — had no callers and pinned
// this module to ffmpeg-static/ffprobe-static deps. If we need to surface
// video frames again, import { ffmpegBin, ffprobeBin } from "./ffmpeg.js"
// once those helpers are exported.

export function getMediaType(
  fileName: string
): "image/jpeg" | "image/png" | "image/webp" {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}
