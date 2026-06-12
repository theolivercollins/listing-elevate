# LE Video v2 — Sub-project A: Library Management

Date: 2026-06-12 · Status: approved (Oliver, in-session) · Branch: `feat/le-video-library`
Part of: LE Video v2 (A library → B link/settings model → C engagement → D watch-page redesign)
Builds on: LE Video (shipped 2026-06-11/12; `/dashboard/studio/videos` library + `/videos/:propertyId` hub; migrations 083/084 applied)

## Goal

Give the operator real control over the video library: organize videos into **folders**, **archive** videos out of the default view (restorable), and **permanently delete** a video (with confirmation). Operator-only; no public/watch-page surface changes in this sub-project.

## Scope decisions (locked with Oliver)

- **Folders:** one level, operator-global (not per-client). A video lives in at most one folder. Deleting a folder un-files its videos (never deletes the videos).
- **Archive:** hides a video from the default library; lives in an "Archived" view with a Restore action. Reversible.
- **Delete:** permanent, behind an "Are you sure?" confirm. Scope: removes the video from the library **and deletes its preview/share links** (they 404 thereafter). The underlying `properties` row + all `cost_events` are **retained** (cost-tracking-first-class — never destroy accounting). Video files in storage are **not** wiped. A `library_deleted_at` tombstone keeps the property out of the library permanently; the UI treats it as gone (no restore).

## 1. Data — migration 085 (additive only; write file, do NOT apply — Oliver gates)

> Verify 085 is still the free next number against a fresh `origin/main` fetch **and** Supabase `list_migrations` before naming (082/084-collision precedent). If taken, take the next free number and update all references.

```sql
-- video_folders: operator-global, one level
create table if not exists video_folders (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- video_library_meta: sidecar holding library-org attributes per property,
-- keeping these concerns OUT of the large properties table.
create table if not exists video_library_meta (
  property_id        uuid primary key references properties(id) on delete cascade,
  folder_id          uuid references video_folders(id) on delete set null,
  archived_at        timestamptz,
  library_deleted_at timestamptz,
  updated_at         timestamptz not null default now()
);
create index if not exists idx_video_library_meta_folder on video_library_meta(folder_id);
create index if not exists idx_video_library_meta_archived on video_library_meta(archived_at) where archived_at is not null;

-- RLS: service-role only (admin API uses the service-role client), deny-all for
-- anon/authenticated — matches the 062/084 backstop pattern for sibling tables.
alter table video_folders enable row level security;
alter table video_library_meta enable row level security;
```

`folder_id on delete set null` implements "deleting a folder un-files its videos." A property with no `video_library_meta` row is treated as unfiled + not-archived + not-deleted (the default for every existing video pre-migration).

## 2. API (all admin-gated via `requireAdmin`; ESM `.js` imports)

**Folders — `api/admin/studio/video-folders/index.ts` + `[id].ts`:**
- `GET /api/admin/studio/video-folders` → `{ folders: [{id,name,position,video_count}] }` (video_count = non-archived, non-deleted videos in the folder).
- `POST` `{name}` → creates (position = max+1).
- `PATCH /api/admin/studio/video-folders/[id]` `{name?, position?}` → rename / reorder.
- `DELETE /api/admin/studio/video-folders/[id]` → deletes the folder; its videos' `folder_id` set null by FK.

**Library actions — `api/admin/studio/videos/[id]/library.ts` (POST `{action, folder_id?}`):**
- `action:'move'` `folder_id` (or null to unfile) → upsert `video_library_meta.folder_id`.
- `action:'archive'` → set `archived_at = now()`.
- `action:'restore'` → set `archived_at = null`.
- `action:'delete'` → set `library_deleted_at = now()` AND delete the property's `property_previews` rows (cascades `preview_view_events`). Permanent from the product's view; property + cost_events retained.
- Upserts the `video_library_meta` row keyed by property_id when absent.

**Library list — extend `api/admin/studio/videos/index.ts`:**
- LEFT JOIN `video_library_meta`. **Always** exclude `library_deleted_at IS NOT NULL`.
- New query params: `?folder=<id>` (filter to folder; `?folder=none` = unfiled), `?archived=1` (show only archived; default shows only non-archived).
- Each item gains `folder_id` and `archived_at`.
- Back-compat: properties with no meta row → folder_id null, not archived, not deleted (LEFT JOIN handles it). Pre-migration (table absent) → wrap the join/select in the same 42703-fallback pattern used elsewhere so the library still renders.
- vercel.json: add routes for `/api/admin/studio/video-folders(/[id])` and `/api/admin/studio/videos/([^/]+)/library` ABOVE the bare `/api/admin/studio/videos/([^/]+)` route; extend the route-coverage test.

## 3. UI — `/dashboard/studio/videos` (`src/pages/dashboard/studio/Videos.tsx`)

- **Folder rail** (left sidebar or a horizontal pill strip above the grid, matching DESIGN-GUIDE): **All videos** · ‹folders with counts› · **Archived**. A "＋ New folder" affordance; rename/reorder/delete folders via a small folder-edit control (inline rename, drag or ↑↓ to reorder, delete with confirm that explains videos are un-filed not deleted).
- **Video card ⋯ menu:** *Move to folder ▸* (submenu of folders + "Remove from folder"), *Archive* (or *Restore* in the Archived view), *Delete…*.
- **Delete confirm dialog:** "Permanently delete this video? Its share links will stop working. This can't be undone." (the property's accounting is retained, but don't surface that to the operator as a hedge — keep the copy decisive). Primary destructive button + cancel.
- Selecting a folder filters the grid (`?folder=`); "Archived" shows archived videos with Restore. Empty states per view (no folders yet, empty folder, nothing archived) styled per DESIGN-GUIDE §9. Inter only, no monospace, tabular-nums for counts.
- Client API helpers in the existing studio api-client; optimistic UI on move/archive with rollback on error.

## 4. Back-compat & rollout

- Code tolerates migration 085 not applied: list endpoint falls back to "no meta" (all videos unfiled/active) on 42703; folder/library-action endpoints return a clear 503 pre-migration (mirrors the approve-route pre-084 pattern) rather than 500.
- Rollout: merge code → Oliver green-lights migration 085 → folders/archive/delete become functional. Library keeps working throughout.

## 5. Testing (TDD, vitest/happy-dom)

- Folder CRUD (create/rename/reorder/delete; delete un-files not deletes).
- Library actions: move (incl. unfile), archive, restore, delete (asserts `property_previews` deleted + `library_deleted_at` set + property row retained).
- List filters: default excludes archived + deleted; `?folder=`/`?folder=none`/`?archived=1`; pre-migration 42703 fallback still returns the library.
- Route-coverage test extended; admin-gating on every new endpoint (401 unauth).
- UI: ⋯ menu actions render per view; delete confirm required before the call fires; Archived view shows Restore not Archive.
- Full suite green, `pnpm run build` clean, headless mount check of the built `/dashboard/studio/videos` route before any prod push.

## Out of scope (later sub-projects)

Per-link capability toggles, branding, customer-link generation, settings-panel restructure (B); comments + ratings + notifications (C); watch-page Vimeo redesign + player parity (D). Nested folders, tags, per-agent folders, bulk multi-select operations, storage-file deletion.
