/**
 * Gemini Files API helper.
 *
 * The Gemini Developer API (GoogleGenAI({ apiKey })) does NOT accept
 * arbitrary HTTPS URLs in fileData.fileUri — that field is GCS / Files-API /
 * YouTube only (see the note in lib/providers/gemini-analyzer.ts). Passing a
 * Supabase storage URL silently yields a model that never sees the media.
 *
 * For video the bytes must go through the Files API: upload, then poll until
 * the file leaves PROCESSING (videos process asynchronously), then reference
 * the returned files/... uri in fileData. Files auto-expire after 48h but we
 * still best-effort delete after use.
 */

import { FileState, type GoogleGenAI } from '@google/genai';
import { bunnyCdnHeaders } from './bunny-stream.js';

const POLL_INTERVAL_MS = 2_000;
const PROCESSING_TIMEOUT_MS = 60_000;

export interface UploadedGeminiFile {
  /** Resource name, e.g. "files/abc-123" — used for get/delete. */
  name: string;
  /** Files-API uri for fileData.fileUri. */
  uri: string;
  mimeType: string;
}

/**
 * Fetch a video from `url`, upload it to the Gemini Files API, and poll
 * until the file is ACTIVE. Throws on fetch failure, upload failure,
 * processing failure, or processing timeout (~60s) — callers must treat a
 * throw as "media unavailable", never fall back to the raw URL.
 */
export async function uploadVideoToGeminiFiles(
  ai: GoogleGenAI,
  url: string,
  mimeType = 'video/mp4',
): Promise<UploadedGeminiFile> {
  // Bunny CDN library 679131 requires Referer: https://www.listingelevate.com/ on server-side
  // fetches — no referer causes 403. bunnyCdnHeaders() returns the header for b-cdn.net URLs
  // and an empty object for all other hosts (safe to call unconditionally).
  const r = await fetch(url, { headers: bunnyCdnHeaders(url) });
  if (!r.ok) throw new Error(`Gemini Files upload: fetch ${r.status} for ${url}`);
  const blob = new Blob([await r.arrayBuffer()], { type: mimeType });

  let file = await ai.files.upload({ file: blob, config: { mimeType } });

  const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
  while (file.state === FileState.PROCESSING) {
    if (Date.now() > deadline) {
      await deleteGeminiFile(ai, file.name);
      throw new Error(`Gemini Files upload: ${file.name} still PROCESSING after ${PROCESSING_TIMEOUT_MS}ms`);
    }
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
    file = await ai.files.get({ name: file.name! });
  }

  if (file.state !== FileState.ACTIVE || !file.uri || !file.name) {
    await deleteGeminiFile(ai, file.name);
    throw new Error(
      `Gemini Files upload: ${file.name ?? '(unnamed)'} state=${file.state}` +
        (file.error ? ` (${JSON.stringify(file.error)})` : ''),
    );
  }
  return { name: file.name, uri: file.uri, mimeType: file.mimeType ?? mimeType };
}

/** Best-effort delete (files auto-expire in 48h, so failure is non-fatal). */
export async function deleteGeminiFile(ai: GoogleGenAI, name: string | undefined): Promise<void> {
  if (!name) return;
  try {
    await ai.files.delete({ name });
  } catch (err) {
    console.error(`[gemini-files] best-effort delete failed for ${name}:`, err instanceof Error ? err.message : err);
  }
}
