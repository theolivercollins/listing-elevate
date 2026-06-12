-- 086_le_video_library.sql
-- Per docs/specs/2026-06-12-le-video-library-management-design.md §1
--
-- Changes:
--   video_folders (new table):
--     id               uuid pk default gen_random_uuid()
--     name             text not null
--     position         integer not null default 0
--     created_at       timestamptz not null default now()
--     updated_at       timestamptz not null default now()
--
--   video_library_meta (new table):
--     property_id      uuid pk → properties(id) on delete cascade
--     folder_id        uuid → video_folders(id) on delete set null
--     archived_at      timestamptz (null — reversible hide)
--     library_deleted_at timestamptz (null — permanent hide)
--     updated_at       timestamptz not null default now()
--
--   idx_video_library_meta_folder on (folder_id)
--   idx_video_library_meta_archived on (archived_at) where archived_at is not null
--
-- RLS: service-role only (admin APIs use lib/client.ts service-role client).
-- JWT-authenticated anon/authenticated clients are deny-all by design — matches
-- the 062/084 backstop pattern. No policies intentional: zero policies = deny-all
-- for non-service-role.
--
-- Properties without a video_library_meta row are treated as unfiled + not-archived
-- + not-deleted (the default pre-migration). Folder deletion (FK on delete set null)
-- un-files videos without deleting them.
--
-- Down-migration (rollback):
--   DROP TABLE IF EXISTS video_library_meta;
--   DROP TABLE IF EXISTS video_folders;

-- ─── video_folders ──────────────────────────────────────────────────────────

create table if not exists video_folders (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── video_library_meta ─────────────────────────────────────────────────────

create table if not exists video_library_meta (
  property_id        uuid primary key references properties(id) on delete cascade,
  folder_id          uuid references video_folders(id) on delete set null,
  archived_at        timestamptz,
  library_deleted_at timestamptz,
  updated_at         timestamptz not null default now()
);

create index if not exists idx_video_library_meta_folder on video_library_meta(folder_id);
create index if not exists idx_video_library_meta_archived on video_library_meta(archived_at) where archived_at is not null;

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table video_folders enable row level security;
alter table video_library_meta enable row level security;
