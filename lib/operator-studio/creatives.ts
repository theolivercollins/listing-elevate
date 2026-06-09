// lib/operator-studio/creatives.ts — server helpers for shareable creatives.
// Token generation, password hashing/verify, share-access enforcement, and
// SharePayload construction incl. signed-URL selection. Service-role only.
import crypto from 'node:crypto';
import { generatePreviewToken } from './preview-tokens.js';
import type { CreativeRow, SharePayload } from '../types/creatives.js';

/**
 * Generate a share token. Reuses the codebase token style (base64url, 32 chars,
 * /^[A-Za-z0-9_-]{32}$/) so all opaque tokens look alike.
 */
export function generateShareToken(): string {
  return generatePreviewToken();
}

/** SHA-256 hex digest of a password. */
export function hashPassword(pw: string): string {
  return crypto.createHash('sha256').update(pw, 'utf8').digest('hex');
}

/** True when no hash is set (open) or the password matches the stored hash. */
export function verifyPassword(pw: string, hash: string | null): boolean {
  if (!hash) return true;
  return hashPassword(pw) === hash;
}

type AccessRow = Pick<CreativeRow, 'password_hash' | 'expires_at'>;

export type ShareAccessStatus = 'ok' | 'expired' | 'password_required';

/**
 * Pure share-access evaluation. Expired wins over password; a set password with
 * a missing/wrong value yields `password_required`; otherwise `ok`.
 */
export function evaluateShareAccess(
  row: AccessRow,
  opts: { now: Date; password: string | null },
): { status: ShareAccessStatus } {
  if (row.expires_at && new Date(row.expires_at) <= opts.now) {
    return { status: 'expired' };
  }
  if (row.password_hash && !verifyPassword(opts.password ?? '', row.password_hash)) {
    return { status: 'password_required' };
  }
  return { status: 'ok' };
}

/** Minimal shape of the Supabase storage surface this module needs. */
interface StorageLike {
  storage: {
    from(bucket: string): {
      createSignedUrl(
        path: string,
        expiresIn: number,
      ): Promise<{ data: { signedUrl: string } | null; error: unknown }>;
    };
  };
}

/**
 * Resolve a playback URL: render creatives serve their stored public URL;
 * uploads mint a 2h signed URL from the private bucket.
 */
export async function getPlaybackUrl(row: CreativeRow, supabase: StorageLike): Promise<string> {
  if (row.source === 'render') {
    return row.public_url ?? '';
  }
  const { data, error } = await supabase.storage
    .from(row.bucket)
    .createSignedUrl(row.storage_path ?? '', 7200);
  if (error || !data) {
    throw new Error(
      `getPlaybackUrl: failed to sign ${row.bucket}/${row.storage_path}: ${String(error)}`,
    );
  }
  return data.signedUrl;
}

/**
 * Resolve a download URL (same signed/public URL as playback). Callers only use
 * this when `allow_download` is set.
 */
export async function getDownloadUrl(row: CreativeRow, supabase: StorageLike): Promise<string | null> {
  return getPlaybackUrl(row, supabase);
}

/** Map a CreativeRow + resolved URLs → the public SharePayload (no secrets). */
export function buildSharePayload(
  row: CreativeRow,
  playbackUrl: string,
  downloadUrl: string | null,
): SharePayload {
  return {
    title: row.title,
    description: row.description,
    kind: row.kind,
    allow_download: row.allow_download,
    allow_embed: row.allow_embed,
    presentation_enabled: row.presentation_enabled,
    playbackUrl,
    posterUrl: row.thumbnail_url,
    downloadUrl: row.allow_download ? downloadUrl : null,
    width: row.width,
    height: row.height,
  };
}
