-- 102_welcome_emails.sql
--
-- NOTE ON NUMBERING: this worktree's local supabase/migrations/ only goes up
-- to 098 (parallel-session drift — see MEMORY.md
-- "Migration number collisions across parallel sessions"). The live shared
-- DB (project vrhmaeywqsohlztoouxu) already has migrations applied through
-- 101_studio_drafts (verified via `list_migrations` before authoring this
-- file). 102 is the next free number against the LIVE state, not just this
-- worktree's local file listing. Re-check before applying if more time has
-- passed.
--
-- "Welcome to Listing Elevate" transactional email — send-once ledger +
-- cost-provider widening. Supports api/hooks/welcome-email.ts, which a
-- Supabase Database Webhook (auth.users INSERT) calls to send the branded
-- welcome email (supabase/templates/welcome.html) via Resend.
--
-- welcome_emails is BOTH the idempotency guard (at-most-once per user) and
-- the send audit trail:
--   user_id              — PK, FK to auth.users(id), one row per user
--   email                — recipient at claim time (denormalized for audit)
--   provider              — set on successful send (currently always 'resend')
--   provider_message_id   — Resend's message id, for support lookups
--   sent_at                — NULL until a send actually succeeds
--   created_at              — when the claim was first taken
--
-- Claim pattern (see lib/email/welcome-db.ts claimWelcomeEmail):
--   INSERT INTO welcome_emails (user_id, email) VALUES (...)
--   ON CONFLICT (user_id) DO NOTHING
-- via supabase-js `.upsert(row, { onConflict: 'user_id', ignoreDuplicates: true })`.
-- A failed send deletes the still-unsent claim row (sent_at IS NULL) so a
-- retried webhook delivery — or a manual backfill — can attempt again
-- without ever touching a row that already recorded a real send.
--
-- RLS: enable, NO public policies (server uses the service-role
-- getSupabase() client only, which bypasses RLS entirely). Zero policies =
-- deny-all for anon/authenticated — matches the 086/094/097 backstop
-- pattern already established for server-only tables in this repo.
--
-- Also widens cost_events_provider_check to add 'resend': every successful
-- send records a $0 cost_events row (stage='welcome_email',
-- provider='resend', property_id=NULL) per the repo's first-class
-- cost-tracking convention ("every API call writes to cost_events, even $0
-- ones" — docs/HANDOFF.md "Oliver's standing preferences"). Without this,
-- the insert hits CHECK violation 23514 and is silently swallowed by the
-- caller's try/catch — exactly the failure mode fixed by the historical
-- 048a/060/085/089 provider/unit_type-widening migrations.
--
-- Rollback: see 102_welcome_emails_rollback.sql
--   (drops the welcome_emails table only; 'resend' is kept PERMANENTLY in
--    cost_events_provider_check even on rollback, because by rollback time
--    real provider='resend' cost_events rows likely already exist and
--    re-narrowing the CHECK would abort on them -- see the rollback file's
--    header comment for the full reasoning)

-- ─── welcome_emails ─────────────────────────────────────────────────────────

create table if not exists welcome_emails (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  email               text not null,
  provider            text,
  provider_message_id text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now()
);

comment on table welcome_emails is
  'At-most-once ledger for the "Welcome to Listing Elevate" transactional email (api/hooks/welcome-email.ts). One row per user_id: row presence = claimed; sent_at IS NULL means the claim is in-flight or the send failed and was released for retry. Written only via the service-role client.';

alter table welcome_emails enable row level security;

-- ─── cost_events: widen provider CHECK for 'resend' ────────────────────────
-- Preserves every existing allowed provider (live-verified via
-- pg_get_constraintdef against project vrhmaeywqsohlztoouxu immediately
-- before authoring this migration) and adds 'resend'.

alter table cost_events
  drop constraint if exists cost_events_provider_check;

alter table cost_events
  add constraint cost_events_provider_check
  check (provider in (
    'anthropic', 'runway', 'kling', 'luma', 'shotstack', 'openai',
    'atlas', 'google', 'higgsfield', 'browserbase', 'apify', 'gemini',
    'creatomate', 'elevenlabs', 'bunny', 'veo', 'resend'
  ));
