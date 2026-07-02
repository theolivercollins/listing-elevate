-- 101_studio_drafts.sql
-- Per Oliver's ask: "when you start creating a property and uploading photos,
-- it saves them as a draft automatically... if you exit out of it, it still
-- saves as a draft." Backs the Studio New Order autosave/resume feature
-- (src/pages/dashboard/studio/StudioNew.tsx).
--
-- Changes:
--   studio_drafts (new table) — one row per admin operator's in-progress
--   New Order form. Upserted (by submitted_by) on every autosave tick (~800ms
--   debounce); deleted on successful submit or explicit Discard; swept by the
--   daily api/cron/studio-draft-cleanup cron after 14 days of inactivity.
--
--     id                uuid pk default gen_random_uuid()
--     submitted_by      uuid not null            -- auth.users id of the admin who owns this draft
--     client_id         uuid null                -- no FK (mirrors properties.client_id — a stale/archived client must never block restoring a draft)
--     address           text
--     bedrooms          integer null
--     bathrooms         numeric null             -- matches properties.bathrooms exactly — verified live against the running DB via the PostgREST OpenAPI description ({"type":"number","format":"numeric"}, vs. bedrooms'/price's {"type":"integer"}) so values round-trip losslessly when the draft is eventually submitted to /api/admin/studio/ingest
--     square_footage    integer null             -- NOT a properties column (see lib/operator-studio/ingest.ts's `_square_footage` — accepted but discarded) but IS a StudioNew form field, so the draft must still remember it across a resume
--     price             bigint null              -- properties.price is integer (int4); bigint is a safe superset — no round-trip issue when the draft is eventually submitted
--     director_notes    text null
--     selected_duration integer null             -- 15 | 30 | 60 — enforced app-side only (StudioNew's own union type), no CHECK constraint, matching how selected_duration is handled elsewhere
--     video_type        text null                -- 'just_listed' | 'just_pended' | 'just_closed'
--     video_model_sku   text null
--     auto_run          boolean not null default false
--     photo_paths       jsonb not null default '[]'::jsonb   -- array of {path, url, name}: path/url = Supabase Storage bucket-relative path + absolute public URL in the property-photos bucket, name = original filename (for display + re-derivation)
--     created_at        timestamptz not null default now()
--     updated_at        timestamptz not null default now()  -- bumped explicitly by lib/studio/drafts.ts on every upsert (no DB trigger)
--
--   unique (submitted_by) — enforces "one active draft per operator" at the
--   DB layer so lib/studio/drafts.ts's upsertDraft() can safely
--   `.upsert(payload, { onConflict: 'submitted_by' })` without a
--   read-then-write race. The upsert payload never includes `id`, so on a
--   conflict Postgres leaves the existing row's primary key untouched — a
--   draft's identity survives every autosave tick from the moment it's first
--   created.
--
--   idx_studio_drafts_submitted_by_updated on (submitted_by, updated_at desc)
--   — serves the GET-latest-draft lookup (ORDER BY updated_at DESC LIMIT 1).
--   Technically redundant with the unique(submitted_by) index while the
--   one-draft-per-admin invariant holds, but kept as specified so the lookup
--   stays correct even if that invariant is ever relaxed later.
--
-- RLS
--   Server-only table. Every code path uses the service-role client
--   (lib/client.ts getSupabase → api/admin/studio/drafts/*, guarded by
--   requireAdmin + the standard VERCEL_ENV==='production' ||
--   LE_ALLOW_NONPROD_WRITES==='true' write gate — see
--   api/admin/studio/creatives/[id].ts for the mirrored shape), which bypasses
--   RLS entirely. No browser code queries studio_drafts directly.
--
--   So RLS is the 086/097 deny-all backstop: `enable row level security` +
--   `revoke all ... from anon, authenticated`, with NO policy and NO grant to
--   authenticated. Zero policies = deny-all for the JWT client roles; the
--   service-role key (which bypasses RLS) retains full access. Deliberately
--   simpler than an is_admin()+owner policy: because nothing authenticates
--   directly against this table, an in-DB policy would only add a
--   browser-facing DML surface for no functional gain. Matches 086
--   (video_folders / video_library_meta) and 097 (impersonation_sessions).
--   Re-runnable: `enable row level security` and `revoke all` are idempotent.
--
-- Down-migration (rollback): see 101_studio_drafts_rollback.sql
--   DROP TABLE IF EXISTS studio_drafts;

create table if not exists studio_drafts (
  id                uuid primary key default gen_random_uuid(),
  submitted_by      uuid not null,
  client_id         uuid,
  address           text,
  bedrooms          integer,
  bathrooms         numeric,
  square_footage    integer,
  price             bigint,
  director_notes    text,
  selected_duration integer,
  video_type        text,
  video_model_sku   text,
  auto_run          boolean not null default false,
  photo_paths       jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (submitted_by)
);

create index if not exists idx_studio_drafts_submitted_by_updated
  on studio_drafts(submitted_by, updated_at desc);

comment on table studio_drafts is
  'Operator Studio New Order autosave draft — one row per admin (unique on submitted_by). Upserted on every form/photo change, deleted on submit or explicit discard, swept after 14 days of inactivity by api/cron/studio-draft-cleanup.';

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Deny-all backstop (086/097 shape): enable RLS with NO policy, then revoke all
-- from both JWT client roles. anon/authenticated get zero access; the
-- service-role client (bypasses RLS) retains full access. No grant to
-- authenticated — the browser never touches this table directly.

alter table studio_drafts enable row level security;
revoke all on studio_drafts from anon, authenticated;
