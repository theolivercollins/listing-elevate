-- 097_impersonation_sessions.sql
-- Per docs/specs/2026-07-01-operator-role-impersonation-design.md §1
--
-- Changes:
--   impersonation_sessions (new table):
--     id                uuid pk default gen_random_uuid()
--     token_hash        text not null unique  — SHA-256 of the raw token (raw never stored)
--     admin_user_id     uuid not null         — auth.users id of the impersonating admin
--     admin_email       text                  — denormalized for the audit trail
--     impersonated_role text not null check (impersonated_role in ('admin','user'))
--     created_at        timestamptz not null default now()  — audit: start of session
--     expires_at        timestamptz not null default (now() + interval '2 hours')
--                                                            — hard 2h ceiling; API sets this
--                                                              explicitly, the default is a
--                                                              defense-in-depth backstop only
--     revoked_at        timestamptz                         — audit: explicit stop (null = active)
--
--   idx_impersonation_sessions_admin_active on (admin_user_id, revoked_at)
--   (no separate index on token_hash — the `unique` constraint on that column
--   already creates one; a second explicit index would be redundant)
--
-- The table doubles as the impersonation audit trail: created_at = start,
-- revoked_at / expires_at = stop. A token is honored only while
-- revoked_at IS NULL AND expires_at > now(). See lib/auth.ts verifyAuth.
--
-- RLS: enable, NO public policies (server uses service-role getSupabase() only).
-- JWT-authenticated anon/authenticated clients are deny-all by design — matches
-- the 086/094 backstop pattern. Zero policies = deny-all for non-service-role.
-- Never expose the raw token; clients receive it once from the API response.
--
-- Down-migration (rollback): see 097_impersonation_sessions_rollback.sql
--   DROP TABLE IF EXISTS impersonation_sessions;

-- ─── impersonation_sessions ─────────────────────────────────────────────────

create table if not exists impersonation_sessions (
  id                uuid primary key default gen_random_uuid(),
  token_hash        text not null unique,
  admin_user_id     uuid not null,
  admin_email       text,
  impersonated_role text not null check (impersonated_role in ('admin', 'user')),
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '2 hours'),
  revoked_at        timestamptz
);

create index if not exists idx_impersonation_sessions_admin_active
  on impersonation_sessions(admin_user_id, revoked_at);

comment on table impersonation_sessions is
  'Operator Studio role-impersonation audit + authority. One row per admin "preview as role" session. Honoring a token requires a live row (revoked_at IS NULL AND expires_at > now()) whose admin_user_id matches the real JWT identity AND whose real role is admin. De-escalation only; never escalates.';

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table impersonation_sessions enable row level security;
