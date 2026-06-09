// lib/types/creatives.ts — Data Contract for Operator Studio "Share" creatives.
// Shared by server helpers, public share API, and admin CRUD. Do not drift.

export type CreativeSource = 'upload' | 'render';
export type CreativeKind = 'video' | 'image';
export type CreativeVisibility = 'unlisted' | 'public';

export interface CreativeRow {
  id: string;
  title: string;
  description: string | null;
  source: CreativeSource;
  kind: CreativeKind;
  bucket: string;
  storage_path: string | null;
  public_url: string | null;
  thumbnail_url: string | null;
  mime_type: string | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  file_size_bytes: number | null;
  property_id: string | null;
  share_token: string;
  visibility: CreativeVisibility;
  allow_download: boolean;
  allow_embed: boolean;
  presentation_enabled: boolean;
  password_hash: string | null;
  expires_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Public share payload (no secrets).
export interface SharePayload {
  title: string;
  description: string | null;
  kind: CreativeKind;
  allow_download: boolean;
  allow_embed: boolean;
  presentation_enabled: boolean;
  playbackUrl: string; // signed (upload) or public (render)
  posterUrl: string | null;
  downloadUrl: string | null; // present only when allow_download
  width: number | null;
  height: number | null;
}
