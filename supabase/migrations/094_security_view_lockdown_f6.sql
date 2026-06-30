-- =============================================================================
-- Migration 094 — SECURITY: view lockdown for finding F6
-- =============================================================================
--
-- WHAT
--   Revokes anon + authenticated grants on 5 public views that currently carry
--   full DML access (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER),
--   then marks each view security_invoker = true.
--
-- WHY (finding F6)
--   PostgreSQL views run as their OWNER by default (security definer semantics).
--   That means a view over an RLS-protected base table executes as the DB owner,
--   who bypasses RLS entirely. Migration 093 enabled RLS on the base tables that
--   these views sit on top of — but without revoking the view grants, an attacker
--   with the public anon key can still read prompt_lab, knowledge_map, and judge
--   calibration data through the views, routing around the F1 lockdown.
--
--   The two-layer fix:
--     1. REVOKE ALL FROM anon, authenticated  (load-bearing: cuts client access
--        immediately regardless of security_invoker support level).
--     2. ALTER VIEW … SET (security_invoker = true)  (defence-in-depth: any
--        future grant to anon/authenticated would then be filtered by the base
--        table's RLS instead of bypassing it as the owner).
--
-- IMPACT
--   * src/ (browser/SPA) references NONE of these 5 views — confirmed by grep.
--   * Server code (api/, lib/) uses the service-role key (BYPASSRLS) and is
--     unaffected by either grant revocation or security_invoker.
--   * This migration is therefore non-breaking for all current call sites.
--
-- ROLLBACK
--   See 094_security_view_lockdown_f6_rollback.sql
-- =============================================================================

-- Fail fast on lock contention (matches 093 policy).
SET lock_timeout = '3s';

DO $$
DECLARE
  v text;
  views text[] := ARRAY[
    'lab_prompt_override_readiness',
    'prompt_lab_iterations_complete',
    'v_judge_calibration_status',
    'v_knowledge_map_cells',
    'v_rated_pool'
  ];
BEGIN
  FOREACH v IN ARRAY views LOOP
    -- to_regclass returns NULL for views too (it resolves any pg_class entry),
    -- so this guard handles both absent views and absent tables safely.
    IF to_regclass('public.' || v) IS NOT NULL THEN
      -- Load-bearing: cut all client access to the view immediately.
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', v);
      -- Defence-in-depth: future grants to client roles will be filtered by the
      -- base tables' RLS rather than executing as the view owner (bypassing RLS).
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
    END IF;
  END LOOP;
END $$;

-- =============================================================================
-- END migration 094
-- =============================================================================
