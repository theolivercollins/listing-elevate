// lib/blog-engine/image-storage.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

const BUCKET = "blog-images";
const MAX_WIDTH = 2048;

export interface UploadInput {
  buffer: Buffer;
  siteId: string;
  fileHash: string;
  mime: string;
  filenameExt: string;
}

export interface UploadResult {
  blob_url: string;
  width: number;
  height: number;
  mime: string;
}

export async function uploadImageBuffer(
  supabase: SupabaseClient,
  input: UploadInput,
): Promise<UploadResult> {
  let pipeline = sharp(input.buffer);
  const meta = await pipeline.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  let resized: Buffer = input.buffer;
  let outMime = input.mime;
  let outExt = input.filenameExt;
  let outWidth = width;
  let outHeight = height;

  if (width > MAX_WIDTH) {
    pipeline = pipeline.resize({ width: MAX_WIDTH });
  }
  if (input.mime !== "image/png") {
    resized = await pipeline.jpeg({ quality: 85 }).toBuffer();
    outMime = "image/jpeg";
    outExt = ".jpg";
    const newMeta = await sharp(resized).metadata();
    outWidth = newMeta.width ?? outWidth;
    outHeight = newMeta.height ?? outHeight;
  } else if (width > MAX_WIDTH) {
    resized = await pipeline.png().toBuffer();
    const newMeta = await sharp(resized).metadata();
    outWidth = newMeta.width ?? outWidth;
    outHeight = newMeta.height ?? outHeight;
  }

  const path = `${input.siteId}/${input.fileHash}${outExt}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, resized, {
    contentType: outMime,
    upsert: true,
  });
  if (error) throw new Error(`uploadImageBuffer: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { blob_url: data.publicUrl, width: outWidth, height: outHeight, mime: outMime };
}

export interface DownloadResult {
  buffer: Buffer;
  filename: string;
  mime: string;
}

export async function downloadImageById(
  supabase: SupabaseClient,
  imageId: string,
): Promise<DownloadResult> {
  const { data: row, error } = await supabase
    .from("blog_images").select("blob_url, mime, file_hash").eq("id", imageId).single();
  if (error || !row) throw new Error(`downloadImageById: image ${imageId} not found`);

  const res = await fetch(row.blob_url);
  if (!res.ok) throw new Error(`downloadImageById: fetch ${row.blob_url} failed (${res.status})`);
  const arr = new Uint8Array(await res.arrayBuffer());
  const ext = row.mime === "image/png" ? ".png" : ".jpg";
  return { buffer: Buffer.from(arr), filename: `${row.file_hash}${ext}`, mime: row.mime ?? "image/jpeg" };
}
