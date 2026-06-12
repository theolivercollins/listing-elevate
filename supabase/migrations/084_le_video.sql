-- 084_le_video.sql
-- Per docs/specs/2026-06-11-le-video-design.md §Data (additive only)
--
-- Changes:
--   property_previews  +2 columns:
--     label            text (null, user-facing link alias: "Sent to Brian", "IG bio")
--     revoked_at       timestamptz (null — when set, link is expired on watch page)
--
--   preview_view_events (new table):
--     id               uuid pk default gen_random_uuid()
--     preview_id       uuid not null → property_previews(id) on delete cascade
--     session_id       text not null (crypto.randomUUID() from navigator.sendBeacon client)
--     event            text check in ('view','play','progress_25','progress_50','progress_75','complete')
--     position_seconds numeric (optional, logged at progress milestones)
--     orientation      text check in ('horizontal','vertical')
--     referrer         text (clamped to 512 chars on insert)
--     user_agent       text (clamped to 512 chars on insert)
--     created_at       timestamptz not null default now()
--
--   idx_preview_events_preview(preview_id, created_at desc) — analytics queries by link & time
--   idx_preview_events_session(preview_id, session_id) — dedupe viewer sessions
--
-- DDL defaults keep existing rows valid (label→null, revoked_at→null).
-- Business logic (label defaults, revoke vs approve gates) live in app code.
--
-- Back-compat posture:
--   GET reads (fetchByToken / library / hub) — safe pre-migration:
--     missing columns SELECT ... COALESCE(label, null) → null fallback
--     missing table on JOIN → LEFT JOIN ... IS NOT NULL → empty aggregates
--   POST events endpoint — handles insert errors with 204 always
--     (never breaks watch page even if table doesn't exist yet)
--
-- Down-migration (rollback):
--   DROP TABLE IF EXISTS preview_view_events;
--   ALTER TABLE property_previews
--     DROP COLUMN IF EXISTS label,
--     DROP COLUMN IF EXISTS revoked_at;

-- ─── property_previews ──────────────────────────────────────────────────────

alter table property_previews
  add column if not exists label     text,
  add column if not exists revoked_at timestamptz;

-- ─── preview_view_events ────────────────────────────────────────────────────

create table if not exists preview_view_events (
  id               uuid primary key default gen_random_uuid(),
  preview_id       uuid not null references property_previews(id) on delete cascade,
  session_id       text not null,
  event            text not null check (event in ('view', 'play', 'progress_25', 'progress_50', 'progress_75', 'complete')),
  position_seconds numeric,
  orientation      text check (orientation in ('horizontal', 'vertical')),
  referrer         text,
  user_agent       text,
  created_at       timestamptz not null default now()
);

create index if not exists idx_preview_events_preview on preview_view_events(preview_id, created_at desc);
create index if not exists idx_preview_events_session on preview_view_events(preview_id, session_id);
