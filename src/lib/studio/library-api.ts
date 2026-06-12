/**
 * Client helpers for LE Video v2 library management (spec §3).
 *
 * Thin wrappers over `authedFetch` (admin cookie / bearer auto-attached) for the
 * folder CRUD + per-video library-action endpoints. Each returns the raw status
 * so callers can degrade gracefully when migration 086 is not yet applied (the
 * endpoints answer 503 `migration_pending` pre-migration — see spec §4).
 */

import { authedFetch } from '@/lib/api';

export interface VideoFolder {
  id: string;
  name: string;
  position: number;
  video_count: number;
}

export type LibraryAction = 'move' | 'archive' | 'restore' | 'delete';

const FOLDERS_URL = '/api/admin/studio/video-folders';

/**
 * GET folders. Returns null when the folder feature is unavailable
 * (pre-migration 503, or any non-ok response) so the rail can hide gracefully.
 */
export async function fetchFolders(): Promise<VideoFolder[] | null> {
  const res = await authedFetch(FOLDERS_URL);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.folders ?? [];
}

export async function createFolder(name: string): Promise<VideoFolder | null> {
  const res = await authedFetch(FOLDERS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.folder ?? null;
}

export async function renameFolder(id: string, name: string): Promise<boolean> {
  const res = await authedFetch(`${FOLDERS_URL}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return res.ok;
}

export async function reorderFolder(id: string, position: number): Promise<boolean> {
  const res = await authedFetch(`${FOLDERS_URL}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ position }),
  });
  return res.ok;
}

export async function deleteFolder(id: string): Promise<boolean> {
  const res = await authedFetch(`${FOLDERS_URL}/${id}`, { method: 'DELETE' });
  return res.ok;
}

/**
 * Per-video library action: move (folder_id|null) / archive / restore / delete.
 * Returns true on success; callers use this for optimistic-UI rollback.
 */
export async function videoLibraryAction(
  propertyId: string,
  action: LibraryAction,
  folderId?: string | null,
): Promise<boolean> {
  const body: { action: LibraryAction; folder_id?: string | null } = { action };
  if (action === 'move') body.folder_id = folderId ?? null;
  const res = await authedFetch(`/api/admin/studio/videos/${propertyId}/library`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}
