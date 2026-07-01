-- 101_telegram_refine_conversation.sql
-- Per docs/specs/2026-07-01-telegram-conversational-refine.md (Plan B, decisions 5 & 10)
--
-- Changes:
--   drive_intake (existing table — additive columns only):
--     delivery_run_id          uuid  FK -> delivery_runs(id) on delete set null
--       — links a Drive intake to the operator delivery_runs row it was routed
--         through (set by approveIntake once the delivery-pipeline routing flag
--         is on), so pollResults / the refine agent target the exact run
--         directly instead of resolving one via property_id.
--     chat_messages            jsonb not null default '[]'::jsonb
--       — Telegram refine-agent conversation history, newest-last. The app
--         caps this to ~20 turns before persisting (lib/telegram/refine-agent.ts).
--     pending_plan             jsonb        — staged (un-applied) refine plan:
--                                              the batched RefineAction[] awaiting
--                                              operator confirmation.
--     pending_plan_id          uuid         — opaque id echoed back via the
--                                              Telegram inline-keyboard
--                                              "apply:<id>" callback.
--     pending_plan_created_at  timestamptz  — when the plan was staged; drives
--                                              staleness/short-expiry checks.
--     pending_plan_consumed_at timestamptz  — when the plan was applied.
--                                              NULL = still pending. Single-use
--                                              marker so a replayed
--                                              "apply:<planId>" callback no-ops.
--     last_paused_reason       text         — last-seen delivery_runs.paused_reason
--                                              (090) for this intake. Lets the poll
--                                              cron dedupe "paused for review"
--                                              Telegram notifications — only notify
--                                              when the reason first appears or
--                                              changes; cleared when the run resumes.
--
--   telegram_processed_updates (new table):
--     update_id  bigint primary key  — Telegram Update.update_id (monotonic
--                                       per bot, globally unique)
--     created_at timestamptz not null default now()
--
--   idx_telegram_processed_updates_created_at on telegram_processed_updates(created_at)
--     — supports a future TTL sweep, e.g.
--       delete from telegram_processed_updates
--        where created_at < now() - interval '7 days';
--
-- WHY A TABLE (not an in-memory cache): the webhook is a stateless serverless
-- function with no shared memory across invocations/instances, and Telegram
-- retries delivery on timeout/non-2xx. The webhook handler's side effects
-- (re-renders, AI music generation, cost events) are not safe to repeat, so
-- durable, race-safe dedupe has to live in Postgres. The idempotency gate is:
--   insert into telegram_processed_updates (update_id)
--   values ($1) on conflict (update_id) do nothing;
--   -- 0 rowcount => already processed (replay) => skip.
--
-- RLS / GRANTs: mirrors migration 097 exactly.
--   * drive_intake already has RLS enabled with ZERO policies (deny-all for
--     anon/authenticated) from 097 — adding columns doesn't change that
--     posture, so no RLS statement is repeated here.
--   * telegram_processed_updates gets the identical treatment: RLS enabled,
--     NO policies, NO explicit GRANTs. Both tables are written exclusively by
--     the Telegram webhook / cron using the service-role client
--     (lib/client.ts), and service_role bypasses RLS entirely — this is the
--     same backstop pattern as 062 / 080 / 086 / 094 / 097. (Cross-checked:
--     every service-role-only table in this codebase carries zero explicit
--     GRANTs; explicit GRANT/REVOKE only shows up where anon/authenticated
--     also need scoped access, e.g. 088, 093, 096 — not applicable here.)
--
-- No enum/vocabulary column is introduced by this migration (chat_messages /
-- pending_plan* are freeform jsonb/uuid/timestamptz), so no new CHECK
-- constraint is needed.
--
-- FORWARD-ONLY / IDEMPOTENT: every ALTER uses ADD COLUMN IF NOT EXISTS, the
-- new table uses CREATE TABLE IF NOT EXISTS, the index uses CREATE INDEX IF
-- NOT EXISTS. Safe to re-run. No data mutation; no existing column touched.
--
-- NOT YET APPLIED to any environment — author-only, apply via Supabase MCP /
-- CLI on a branch/preview database first (see docs/HANDOFF.md ship-gate rules).
--
-- Down-migration: see the "-- DOWN:" block at the end of this file.

-- ─── drive_intake: conversational refine columns ───────────────────────────

alter table drive_intake
  add column if not exists delivery_run_id          uuid references delivery_runs(id) on delete set null,
  add column if not exists chat_messages            jsonb not null default '[]'::jsonb,
  add column if not exists pending_plan             jsonb,
  add column if not exists pending_plan_id          uuid,
  add column if not exists pending_plan_created_at  timestamptz,
  add column if not exists pending_plan_consumed_at timestamptz,
  add column if not exists last_paused_reason        text;

comment on column drive_intake.delivery_run_id is
  'FK to delivery_runs.id once this intake is routed through the operator delivery pipeline (approveIntake). Lets pollResults/the refine agent target the exact run instead of resolving one via property_id.';
comment on column drive_intake.chat_messages is
  'Telegram refine-agent conversation history for this intake, newest-last. App caps this to ~20 turns before persisting.';
comment on column drive_intake.pending_plan is
  'Staged (not-yet-applied) refine plan from the conversational agent — the batched RefineAction[] awaiting operator confirmation.';
comment on column drive_intake.pending_plan_id is
  'Opaque id for the staged pending_plan, echoed back via the Telegram inline-keyboard "apply:<id>" callback. Single-use — see pending_plan_consumed_at.';
comment on column drive_intake.pending_plan_created_at is
  'When pending_plan was staged. Drives staleness / short-expiry checks on unconfirmed plans.';
comment on column drive_intake.pending_plan_consumed_at is
  'When pending_plan was applied. NULL = still pending. Non-null makes a replayed "apply:<planId>" callback a safe no-op.';
comment on column drive_intake.last_paused_reason is
  'Last-seen delivery_runs.paused_reason for this intake. Lets the poll cron dedupe "paused for review" Telegram notifications — only notify when the reason first appears or changes; cleared when the run resumes.';

-- ─── telegram_processed_updates ─────────────────────────────────────────────
-- Webhook idempotency / replay protection. Telegram retries delivery on
-- timeout or a non-2xx response, and the handler runs side-effecting refine
-- actions — every update_id must be processed at most once.

create table if not exists telegram_processed_updates (
  update_id  bigint      primary key,
  created_at timestamptz not null default now()
);

comment on table telegram_processed_updates is
  'Dedupe ledger for Telegram webhook updates. insert ... on conflict (update_id) do nothing against this table is the idempotency gate for the webhook handler; a 0 rowcount means the update was already handled (replay) and must be skipped.';
comment on column telegram_processed_updates.update_id is
  'Telegram Update.update_id — monotonically increasing per bot, globally unique.';
comment on column telegram_processed_updates.created_at is
  'When this update was first processed. Drives a future TTL cleanup: delete from telegram_processed_updates where created_at < now() - interval ''7 days''.';

create index if not exists idx_telegram_processed_updates_created_at
  on telegram_processed_updates(created_at);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Enable RLS with no policies → deny-all for non-service-role clients, the
-- same posture 097 established for drive_intake/drive_watch_state. The
-- Telegram webhook and refine executor run exclusively as the service-role
-- client (lib/client.ts), which bypasses RLS — no GRANT statements needed.

alter table telegram_processed_updates enable row level security;

-- =============================================================================
-- DOWN:
--   drop index if exists idx_telegram_processed_updates_created_at;
--   drop table if exists telegram_processed_updates;
--
--   alter table drive_intake
--     drop column if exists delivery_run_id,
--     drop column if exists chat_messages,
--     drop column if exists pending_plan,
--     drop column if exists pending_plan_id,
--     drop column if exists pending_plan_created_at,
--     drop column if exists pending_plan_consumed_at,
--     drop column if exists last_paused_reason;
-- =============================================================================
