-- 097_drive_telegram_intake.sql
-- Per docs/specs/drive-telegram-intake-design.md
--
-- Changes:
--   drive_watch_state (new table, singleton-row):
--     id               text pk default 'singleton' + CHECK id='singleton'
--     channel_id       text
--     resource_id      text
--     expiration       bigint   -- ms epoch when Drive push channel expires
--     start_page_token text
--     updated_at       timestamptz not null default now()
--
--   drive_intake (new table):
--     id                    uuid pk default gen_random_uuid()
--     drive_folder_id       text not null unique
--     address               text not null
--     final_folder_id       text
--     photo_count           int not null default 0
--     last_count_change_at  timestamptz not null default now()
--     status                text not null default 'detected'
--       CHECK status IN (detected|awaiting_approval|approved|skipped|
--                        ingesting|generating|rendered|error)
--     telegram_message_id   bigint
--     feedback_notes        text
--     property_id           uuid FK → properties(id) on delete set null
--     created_at            timestamptz not null default now()
--     updated_at            timestamptz not null default now()
--
--   idx_drive_intake_status   on drive_intake(status)
--   idx_drive_intake_property on drive_intake(property_id)
--
-- Flow summary:
--   Drive webhook → upsert drive_intake (detected) → Telegram prompt sent →
--   operator approves/skips via Telegram reply → status advances →
--   ingestion/generation cron picks up approved rows.
--
-- RLS: service-role only (server/cron code only). Zero policies = deny-all for
--   non-service-role — matches the 062/086 backstop pattern used by operational
--   tables (cost_events, video_library_meta).
--
-- Down-migration (rollback):
--   DROP TABLE IF EXISTS drive_intake;
--   DROP TABLE IF EXISTS drive_watch_state;

-- ─── drive_watch_state ──────────────────────────────────────────────────────
-- Stores the single active Google Drive change-channel registration.
-- Only ever has one row (sentinel pk = 'singleton').

create table if not exists drive_watch_state (
  id               text primary key default 'singleton' check (id = 'singleton'),
  channel_id       text,
  resource_id      text,
  expiration       bigint,    -- ms epoch when the Drive push channel expires
  start_page_token text,
  updated_at       timestamptz not null default now()
);

comment on table drive_watch_state is
  'Single-row registry of the active Google Drive change-channel. '
  'Renewed before expiration by the drive-watch-renew cron.';
comment on column drive_watch_state.expiration is
  'Epoch milliseconds when the Drive push-notification channel expires.';
comment on column drive_watch_state.start_page_token is
  'Drive changes page token; advanced after each successful delta poll.';

-- ─── drive_intake ────────────────────────────────────────────────────────────
-- One row per property folder detected via Drive webhook.
-- Drives the Telegram approval flow and downstream ingestion.

create table if not exists drive_intake (
  id                   uuid        primary key default gen_random_uuid(),
  drive_folder_id      text        not null unique,
  address              text        not null,
  final_folder_id      text,
  photo_count          int         not null default 0,
  last_count_change_at timestamptz not null default now(),
  status               text        not null default 'detected',
  telegram_message_id  bigint,
  feedback_notes       text,
  property_id          uuid        references properties(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table drive_intake is
  'Tracks every property folder detected via Google Drive webhook. '
  'Status advances: detected → awaiting_approval → approved|skipped → '
  'ingesting → generating → rendered. Errors land in ''error''.';
comment on column drive_intake.drive_folder_id is
  'Google Drive folder ID for the property (e.g. "Macedonia Dr 171").';
comment on column drive_intake.final_folder_id is
  'Drive ID of the "Final" subfolder containing approved listing photos.';
comment on column drive_intake.status is
  'Lifecycle state: detected|awaiting_approval|approved|skipped|ingesting|generating|rendered|error';
comment on column drive_intake.telegram_message_id is
  'Telegram message ID of the approval prompt sent to the operator.';
comment on column drive_intake.property_id is
  'FK to properties.id once the property record has been created.';

-- Status CHECK constraint (idempotent via DO block so re-running is safe)
do $$
begin
  if not exists (
    select 1
      from information_schema.table_constraints
     where table_schema    = 'public'
       and table_name      = 'drive_intake'
       and constraint_name = 'drive_intake_status_check'
  ) then
    alter table drive_intake
      add constraint drive_intake_status_check
      check (status in (
        'detected',
        'awaiting_approval',
        'approved',
        'skipped',
        'ingesting',
        'generating',
        'rendered',
        'error'
      ));
  end if;
end $$;

-- ─── Indexes ─────────────────────────────────────────────────────────────────

create index if not exists idx_drive_intake_status
  on drive_intake(status);

create index if not exists idx_drive_intake_property
  on drive_intake(property_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Enable RLS with no policies → deny-all for non-service-role clients.
-- These tables are written exclusively by server/cron code using the
-- service-role client (lib/client.ts). Matches 086 backstop pattern.

alter table drive_watch_state enable row level security;
alter table drive_intake       enable row level security;
