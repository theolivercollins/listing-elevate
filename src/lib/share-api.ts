import * as tus from 'tus-js-client';
import { authedFetch } from '@/lib/api';
import { supabase } from '@/lib/supabase';

// ─── Types (mirror the admin API row shape) ─────────────────────────────────

export type CreativeSource = 'upload' | 'render';
export type CreativeKind = 'video' | 'image';
export type CreativeVisibility = 'unlisted' | 'public';

export interface Creative {
  id: string;
  title: string;
  description: string | null;
  source: CreativeSource;
  kind: CreativeKind;
  public_url: string | null;
  storage_path: string | null;
  bucket: string;
  thumbnail_url: string | null;
  visibility: CreativeVisibility;
  allow_download: boolean;
  allow_embed: boolean;
  presentation_enabled: boolean;
  expires_at: string | null;
  view_count: number;
  share_token: string;
  property_id: string | null;
  created_at: string;
  bunny_video_id: string | null; // set when hosted on Bunny Stream
  // Computed by the admin API:
  shareUrl: string; // `/v/{token}`
  embedUrl: string; // `/embed/{token}`
  previewUrl: string | null; // signed URL (uploads) or public_url (renders) for in-studio preview
  bunnyEmbedUrl: string | null; // Bunny iframe player URL (in-studio preview for Bunny videos)
}

export interface RenderOption {
  id: string;
  address: string;
  horizontal_video_url: string | null;
  vertical_video_url: string | null;
}

export interface UploadedFileMeta {
  storage_path?: string | null; // set for Supabase-bucket uploads (images)
  bunny_video_id?: string; // set for Bunny Stream uploads (videos)
  kind: CreativeKind;
  mime_type: string;
  file_size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  title: string;
}

interface BunnyUploadAuth {
  videoId: string;
  libraryId: number | string;
  signature: string;
  expiration: number;
  endpoint: string;
}

export interface CreativePatch {
  title?: string;
  description?: string | null;
  visibility?: CreativeVisibility;
  allow_download?: boolean;
  allow_embed?: boolean;
  presentation_enabled?: boolean;
  expires_at?: string | null;
  password?: string;
}

const CREATIVES_BUCKET = 'creatives';

// ─── Internal: JSON helper over authedFetch ─────────────────────────────────

async function authedJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await authedFetch(path, options);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── List / create / patch / delete ─────────────────────────────────────────

export async function listCreatives(): Promise<Creative[]> {
  const body = await authedJson<{ creatives: Creative[] }>('/api/admin/studio/creatives');
  return body.creatives ?? [];
}

export async function listRenders(): Promise<RenderOption[]> {
  const body = await authedJson<{ renders: RenderOption[] }>('/api/admin/studio/creatives/renders');
  return body.renders ?? [];
}

export async function createUploadCreative(meta: UploadedFileMeta): Promise<Creative> {
  const body = await authedJson<{ creative: Creative }>('/api/admin/studio/creatives', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'upload', ...meta }),
  });
  return body.creative;
}

export async function createRenderCreative(input: {
  property_id: string;
  orientation: 'horizontal' | 'vertical';
  title: string;
}): Promise<Creative> {
  const body = await authedJson<{ creative: Creative }>('/api/admin/studio/creatives', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'render', ...input }),
  });
  return body.creative;
}

export async function patchCreative(id: string, patch: CreativePatch): Promise<Creative> {
  const body = await authedJson<{ creative: Creative }>(`/api/admin/studio/creatives/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return body.creative;
}

export async function deleteCreative(id: string): Promise<{ ok: true }> {
  return authedJson<{ ok: true }>(`/api/admin/studio/creatives/${id}`, {
    method: 'DELETE',
  });
}

// ─── Upload flow ────────────────────────────────────────────────────────────

export async function getUploadUrl(
  filename: string,
  kind: CreativeKind,
): Promise<{ path: string; token: string; signedUrl: string }> {
  return authedJson<{ path: string; token: string; signedUrl: string }>(
    '/api/admin/studio/creatives/upload-url',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, kind }),
    },
  );
}

/** Infer creative kind from a File's MIME type. */
function kindFromFile(file: File): CreativeKind {
  return file.type.startsWith('image/') ? 'image' : 'video';
}

/**
 * Read intrinsic metadata (dimensions + duration) from a media File by loading
 * it into a temporary off-DOM <video>/<img>. Resolves with best-effort values;
 * never rejects (missing metadata is acceptable — columns are nullable).
 */
function readMediaMetadata(
  file: File,
  kind: CreativeKind,
): Promise<{ width: number | null; height: number | null; duration_seconds: number | null }> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const done = (
      width: number | null,
      height: number | null,
      duration_seconds: number | null,
    ) => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width, height, duration_seconds });
    };

    if (kind === 'image') {
      const img = new Image();
      img.onload = () => done(img.naturalWidth || null, img.naturalHeight || null, null);
      img.onerror = () => done(null, null, null);
      img.src = objectUrl;
      return;
    }

    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const dur = Number.isFinite(video.duration) ? video.duration : null;
      done(video.videoWidth || null, video.videoHeight || null, dur);
    };
    video.onerror = () => done(null, null, null);
    video.src = objectUrl;
  });
}

/** Ask our server to create a Bunny video + mint a short-lived TUS signature. */
async function getBunnyUploadAuth(title: string): Promise<BunnyUploadAuth> {
  return authedJson<BunnyUploadAuth>('/api/admin/studio/creatives/bunny-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
}

/**
 * Upload a video to Bunny Stream via resumable TUS. Reports TRUE progress
 * (0→1) and survives flaky connections — replacing the Supabase signed-upload
 * path that had no progress events (it appeared stuck at 10%).
 */
async function uploadVideoToBunny(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<UploadedFileMeta> {
  onProgress?.(0);
  const title = file.name.replace(/\.[^.]+$/, '') || file.name;
  const auth = await getBunnyUploadAuth(title);
  const { width, height, duration_seconds } = await readMediaMetadata(file, 'video');

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: auth.endpoint,
      retryDelays: [0, 1000, 3000, 5000],
      headers: {
        AuthorizationSignature: auth.signature,
        AuthorizationExpire: String(auth.expiration),
        LibraryId: String(auth.libraryId),
        VideoId: auth.videoId,
      },
      metadata: { filetype: file.type || 'video/mp4', title },
      onError: (err) => reject(new Error(`Upload failed: ${err.message || String(err)}`)),
      onProgress: (sent, total) => onProgress?.(total ? sent / total : 0),
      onSuccess: () => resolve(),
    });
    upload.start();
  });
  onProgress?.(1);

  return {
    bunny_video_id: auth.videoId,
    kind: 'video',
    mime_type: file.type || 'video/mp4',
    file_size_bytes: file.size,
    width,
    height,
    duration_seconds,
    title,
  };
}

/**
 * Upload a creative. Videos go to Bunny Stream (resumable, real progress, HLS
 * + adaptive playback); images stay in the Supabase `creatives` bucket (Bunny
 * is video-only). Returns the metadata payload for createUploadCreative.
 */
export async function uploadCreativeFile(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<UploadedFileMeta> {
  const kind = kindFromFile(file);
  if (kind === 'video') {
    return uploadVideoToBunny(file, onProgress);
  }

  onProgress?.(0);
  const { path, token } = await getUploadUrl(file.name, kind);
  onProgress?.(0.1);

  const { error } = await supabase.storage
    .from(CREATIVES_BUCKET)
    .uploadToSignedUrl(path, token, file);
  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }
  onProgress?.(0.9);

  const { width, height, duration_seconds } = await readMediaMetadata(file, kind);
  onProgress?.(1);

  const title = file.name.replace(/\.[^.]+$/, '') || file.name;

  return {
    storage_path: path,
    kind,
    mime_type: file.type || 'image/jpeg',
    file_size_bytes: file.size,
    width,
    height,
    duration_seconds,
    title,
  };
}
