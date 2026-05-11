import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "deliverables";
const ALLOWED_EXTS = new Set(["mp4", "mov", "webm"]);
const STREAM_TTL_SECONDS = 5 * 60;
const DOWNLOAD_TTL_SECONDS = 60 * 60;
const UPLOAD_TTL_SECONDS = 30 * 60;

export function splitExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toLowerCase();
}

export interface ObjectPathInput {
  ownerId: string;
  orderId: string;
  deliverableId: string;
  version: number;
  fileName: string;
}

export function objectPathFor(input: ObjectPathInput): string {
  const ext = splitExtension(input.fileName);
  if (!ext || !ALLOWED_EXTS.has(ext)) {
    throw new Error(`unsupported extension: ${ext ?? "(none)"} — allowed: ${[...ALLOWED_EXTS].join(", ")}`);
  }
  return `${input.ownerId}/${input.orderId}/${input.deliverableId}/v${input.version}.${ext}`;
}

export async function createSignedUploadUrl(
  supabase: SupabaseClient,
  path: string,
): Promise<{ signedUrl: string; token: string }> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`createSignedUploadUrl failed: ${error?.message ?? "no data"}`);
  return { signedUrl: data.signedUrl, token: data.token };
}

export async function createSignedStreamUrl(
  supabase: SupabaseClient,
  path: string,
): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrl(path, STREAM_TTL_SECONDS);
  if (error || !data) throw new Error(`createSignedStreamUrl failed: ${error?.message ?? "no data"}`);
  return data.signedUrl;
}

export async function createSignedDownloadUrl(
  supabase: SupabaseClient,
  path: string,
  downloadFileName: string,
): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrl(path, DOWNLOAD_TTL_SECONDS, { download: downloadFileName });
  if (error || !data) throw new Error(`createSignedDownloadUrl failed: ${error?.message ?? "no data"}`);
  return data.signedUrl;
}

export async function verifyObjectExists(
  supabase: SupabaseClient,
  path: string,
): Promise<boolean> {
  // Storage SDK has no HEAD; list() the parent dir and look for the basename.
  const slash = path.lastIndexOf("/");
  const dir = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const { data, error } = await supabase.storage.from(BUCKET).list(dir, { limit: 100 });
  if (error) throw new Error(`verifyObjectExists list failed: ${error.message}`);
  return !!data?.some((f) => f.name === name);
}

export const STORAGE_CONSTANTS = {
  BUCKET,
  ALLOWED_EXTS,
  STREAM_TTL_SECONDS,
  DOWNLOAD_TTL_SECONDS,
  UPLOAD_TTL_SECONDS,
  MAX_FILE_BYTES: 2 * 1024 ** 3,
};
