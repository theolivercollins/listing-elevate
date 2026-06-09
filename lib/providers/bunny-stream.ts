// lib/providers/bunny-stream.ts — Bunny Stream video hosting provider.
// Replaces Supabase storage for Share-tab creatives: cheaper delivery
// (~$0.005/GB vs $0.09), HLS adaptive streaming, a real player, thumbnails,
// and resumable (TUS) uploads with true progress.
//
// Server-only (uses the per-library AccessKey). The browser never sees the key:
// it uploads via TUS using a short-lived signature minted here.
import * as crypto from "crypto";

const STREAM_API = "https://video.bunnycdn.com";
const IFRAME_BASE = "https://iframe.mediadelivery.net";

/** Bunny video processing status. 4 = finished/playable. */
export const BUNNY_STATUS = {
  CREATED: 0,
  UPLOADED: 1,
  PROCESSING: 2,
  TRANSCODING: 3,
  FINISHED: 4,
  ERROR: 5,
  UPLOAD_FAILED: 6,
} as const;

export interface BunnyVideo {
  guid: string;
  title: string;
  status: number;
  length: number; // seconds
  width: number;
  height: number;
  thumbnailFileName: string | null;
  availableResolutions: string | null;
  encodeProgress: number;
}

function cfg() {
  const apiKey = process.env.BUNNY_STREAM_API_KEY;
  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
  const cdnHostname = process.env.BUNNY_STREAM_CDN_HOSTNAME;
  if (!apiKey || !libraryId || !cdnHostname) {
    throw new Error(
      "Bunny Stream not configured: set BUNNY_STREAM_API_KEY, BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_CDN_HOSTNAME",
    );
  }
  return { apiKey, libraryId, cdnHostname };
}

/** True when Bunny Stream env is present (so callers can fall back to Supabase). */
export function isBunnyConfigured(): boolean {
  return Boolean(
    process.env.BUNNY_STREAM_API_KEY &&
      process.env.BUNNY_STREAM_LIBRARY_ID &&
      process.env.BUNNY_STREAM_CDN_HOSTNAME,
  );
}

/** Create an (empty) Bunny video object; returns its GUID for the upload step. */
export async function createBunnyVideo(title: string): Promise<{ guid: string }> {
  const { apiKey, libraryId } = cfg();
  const res = await fetch(`${STREAM_API}/library/${libraryId}/videos`, {
    method: "POST",
    headers: { AccessKey: apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    throw new Error(`Bunny createVideo failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { guid: string };
  return { guid: data.guid };
}

/**
 * Mint a short-lived TUS upload authorization for the browser.
 * signature = sha256(libraryId + apiKey + expiration + videoId).
 * The browser POSTs to `${endpoint}` with these as TUS headers; the key stays
 * server-side.
 */
export function bunnyTusAuth(videoId: string, ttlSeconds = 3600) {
  const { apiKey, libraryId } = cfg();
  const expiration = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = crypto
    .createHash("sha256")
    .update(`${libraryId}${apiKey}${expiration}${videoId}`)
    .digest("hex");
  return {
    endpoint: `${STREAM_API}/tusupload`,
    libraryId,
    videoId,
    signature,
    expiration,
  };
}

/**
 * Server-side direct upload of raw bytes (used by tests / server flows). The
 * browser uses TUS instead so the key never leaves the server.
 */
export async function uploadBunnyVideoBytes(
  videoId: string,
  bytes: Buffer | Uint8Array,
): Promise<void> {
  const { apiKey, libraryId } = cfg();
  const res = await fetch(`${STREAM_API}/library/${libraryId}/videos/${videoId}`, {
    method: "PUT",
    headers: { AccessKey: apiKey },
    body: bytes,
  });
  if (!res.ok) {
    throw new Error(`Bunny upload failed: ${res.status} ${await res.text()}`);
  }
}

export async function getBunnyVideo(guid: string): Promise<BunnyVideo> {
  const { apiKey, libraryId } = cfg();
  const res = await fetch(`${STREAM_API}/library/${libraryId}/videos/${guid}`, {
    headers: { AccessKey: apiKey, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Bunny getVideo failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as BunnyVideo;
}

export async function deleteBunnyVideo(guid: string): Promise<void> {
  const { apiKey, libraryId } = cfg();
  await fetch(`${STREAM_API}/library/${libraryId}/videos/${guid}`, {
    method: "DELETE",
    headers: { AccessKey: apiKey },
  }).catch(() => {});
}

// ── Playback URL helpers ──────────────────────────────────────────────

/** Embeddable iframe player URL (built-in controls + adaptive HLS). */
export function bunnyEmbedUrl(
  guid: string,
  opts: { autoplay?: boolean; loop?: boolean; muted?: boolean } = {},
): string {
  const { libraryId } = cfg();
  const p = new URLSearchParams();
  if (opts.autoplay) p.set("autoplay", "true");
  if (opts.loop) p.set("loop", "true");
  if (opts.muted) p.set("muted", "true");
  const q = p.toString();
  return `${IFRAME_BASE}/embed/${libraryId}/${guid}${q ? `?${q}` : ""}`;
}

/** Raw HLS playlist (for a custom hls.js player). */
export function bunnyHlsUrl(guid: string): string {
  const { cdnHostname } = cfg();
  return `https://${cdnHostname}/${guid}/playlist.m3u8`;
}

/** Poster/thumbnail produced by Bunny during transcode. */
export function bunnyThumbnailUrl(guid: string): string {
  const { cdnHostname } = cfg();
  return `https://${cdnHostname}/${guid}/thumbnail.jpg`;
}

/**
 * A direct MP4 URL for downloads (requires "MP4 Fallback" enabled on the
 * library). `res` defaults to 720p; Bunny serves the nearest available.
 */
export function bunnyMp4Url(guid: string, res = "720p"): string {
  const { cdnHostname } = cfg();
  return `https://${cdnHostname}/${guid}/play_${res}.mp4`;
}
