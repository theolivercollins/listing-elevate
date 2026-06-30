-- =============================================================================
-- Migration 093 — SECURITY: RLS lockdown for finding F1 (CRITICAL / P0)
-- =============================================================================
--
-- WHAT
--   Enables Row Level Security and strips the anon + authenticated DML grants
--   from 57 public tables that currently ship with RLS DISABLED.
--
-- WHY (finding F1)
--   The public anon key is bundled into the browser SPA. With RLS off and the
--   anon/authenticated roles holding full DML, PostgREST exposes the ENTIRE
--   database as world-readable AND world-writable to anyone who opens devtools.
--   This is a P0 tenant-boundary failure: there is effectively no tenant
--   boundary today.
--
-- GRANT MODEL AFTER THIS MIGRATION
--   * service_role  — UNAFFECTED. It has BYPASSRLS and its own grants; we never
--                     revoke from it. Every server route (api/, lib/) uses the
--                     service-role key, so this migration does NOT break any
--                     server-side code path. (RLS bypass is privilege-level, not
--                     grant-level; Supabase grants service_role broadly and we
--                     touch only anon/authenticated below.)
--   * Section A (51 server-only tables) — RLS ON, anon+authenticated REVOKE ALL,
--                     no policy. The browser never reads these; only the
--                     service-role server touches them (bypassing RLS). RLS-on
--                     with no policy is default-deny, so even a stray future
--                     grant cannot leak rows (defence in depth atop the REVOKE).
--   * Section B (properties) — RLS ON; owner-or-admin SELECT policy; anon and
--                     authenticated both get REVOKE ALL then authenticated gets
--                     GRANT SELECT only (no TRUNCATE/REFERENCES/TRIGGER footgun).
--   * Section C (finance tables) — RLS ON, admin-only policies gated by
--                     public.is_admin(); anon gets REVOKE ALL (zero access);
--                     authenticated gets REVOKE ALL then GRANT SELECT,INSERT,
--                     UPDATE,DELETE only — TRUNCATE/REFERENCES/TRIGGER revoked
--                     so a non-admin authenticated user cannot TRUNCATE financial
--                     tables despite the admin policy (RLS does NOT gate TRUNCATE,
--                     only grants do). cost_events authenticated gets SELECT only.
--
-- SAFETY / IDEMPOTENCY
--   ENABLE RLS, REVOKE, GRANT, and DROP POLICY IF EXISTS are all idempotent, so
--   this file is safe to re-run. EVERY table operation is wrapped in a
--   to_regclass() existence guard so absent tables are skipped rather than
--   aborting the migration. This matters here because several locked-down tables
--   (properties, token_purchases, expenses, revenue_entries, ...) were created
--   out-of-band via the SQL editor and have NO CREATE TABLE migration, so a
--   migrations-only branch/preview DB may not contain all 57.
--
-- ROLLBACK
--   See 093_security_rls_lockdown_f1_rollback.sql (restores the insecure
--   pre-F1 state). Use only in an emergency if the lockdown breaks prod.
-- =============================================================================

-- Fail fast on lock contention rather than stalling live queries.
-- ALTER TABLE … ENABLE RLS takes brief AccessExclusiveLocks; without this,
-- a blocked statement hangs every subsequent query on the same relation.
SET lock_timeout = '3s';


-- -----------------------------------------------------------------------------
-- SECTION 0 — admin helper used by the finance policies (Section C)
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER + fixed search_path: the function executes as its owner (the
-- migration/DB owner, which owns and therefore bypasses RLS on user_profiles),
-- so it can resolve the caller's role regardless of user_profiles' own RLS. The
-- pinned search_path (public, pg_temp) closes the "Function Search Path Mutable"
-- / search-path-injection class of bug. Even under SECURITY INVOKER this would
-- still work, because user_profiles' existing self-row SELECT policy already lets
-- a user read their own row — but DEFINER makes it robust against any future
-- change to that policy.
CREATE OR REPLACE FUNCTION public.is_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.user_id = auth.uid()
      AND up.role = 'admin'
  );
$$;

-- Only authenticated users may call it; never expose it to PUBLIC/anon.
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;


-- -----------------------------------------------------------------------------
-- SECTION A — 51 SERVER-ONLY TABLES
-- -----------------------------------------------------------------------------
-- Enable RLS and revoke ALL from anon + authenticated. No policy is needed: the
-- browser never reads these tables, and the service-role server bypasses RLS.
-- With RLS on and no policy, anon/authenticated are default-denied even if a
-- stray grant ever reappears. Each table is guarded with to_regclass() so a
-- not-yet-applied table is skipped silently instead of aborting the migration.
DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    -- pipeline / media
    'photos',
    'scenes',
    'pipeline_logs',
    'daily_stats',
    'scene_ratings',
    'prompt_revisions',
    'video_revisions',
    'music_tracks',
    -- lab / judge / knowledge map
    'lab_judge_scores',
    'lab_judge_calibrations',
    'knowledge_map_room_types',
    'knowledge_map_camera_verbs',
    'judge_calibration_examples',
    -- prompt lab
    'prompt_lab_listings',
    'prompt_lab_listing_photos',
    'prompt_lab_listing_scenes',
    'prompt_lab_listing_scene_iterations',
    'prompt_lab_assemblies',
    'prompt_lab_model_feedback',
    'prompt_lab_listing_assemblies',
    -- router / sku / system
    'router_bucket_stats',
    'router_shadow_log',
    'sku_motion_affinity',
    'sku_motion_affinity_refresh_log',
    'system_flags',
    -- blog
    'blog_sites',
    'blog_posts',
    'blog_jobs',
    'blog_topic_suggestions',
    'blog_research_runs',
    'blog_images',
    'blog_image_usages',
    'blog_corrections',
    'blog_style_rules',
    -- ally / email
    'ally_memories',
    'email_templates',
    'emails',
    -- gen2
    'gen2_scene_graphs',
    'gen2_pair_candidates',
    'gen2_pair_labels',
    'gen2_picker_models',
    'gen2_render_outcomes',
    'gen2_apprentice_predictions',
    -- market update
    'mu_regions',
    'market_update_runs',
    -- ally seo / runs / autonomy
    'ally_seo_audits',
    'ally_seo_findings',
    'ally_conversations',
    'ally_runs',
    'ally_run_steps',
    'ally_autonomy_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- SECTION B — properties
-- -----------------------------------------------------------------------------
-- Non-admin authenticated agents read only their own rows (submitted_by =
-- auth.uid()). Admins read ALL rows — required by countDeliveredVideos() in
-- src/lib/finances.ts (line 161), which does a business-wide
-- SELECT WHERE status='complete' with no submitted_by filter to compute the
-- cost-per-video metric on the Finances dashboard. Without the OR is_admin()
-- branch, that metric would undercount (return only the admin's own rows).
-- Non-admin agent reads (Billing.tsx, Listings.tsx) already add
-- .eq("submitted_by", user.id) in app code, so they are unaffected by the
-- wider policy.
-- anon must not read at all; nobody but the service-role server may write.
-- Guarded with to_regclass() because properties has no CREATE TABLE migration
-- (bootstrapped out-of-band).
DO $$
DECLARE
  pol record;
BEGIN
  IF to_regclass('public.properties') IS NOT NULL THEN
    ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

    -- Defensive: drop ALL existing policies on properties before creating ours.
    -- Prevents any legacy permissive policy from OR-composing and re-opening
    -- access. Live DB has exactly 1 policy (the 001 owner SELECT); this loop
    -- is future-proofing against any stray policies added between now and apply.
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'properties'
    LOOP
      EXECUTE format('DROP POLICY %I ON public.properties', pol.policyname);
    END LOOP;

    -- Owner-or-admin SELECT: non-admin agents see only their own rows; admins
    -- see all rows (needed by countDeliveredVideos() — see comment above).
    CREATE POLICY "Users can view own properties"
      ON public.properties FOR SELECT
      TO authenticated
      USING (auth.uid() = submitted_by OR public.is_admin());

    -- Normalize to exact-privilege grants: REVOKE ALL from both client roles,
    -- then re-grant only what is actually needed (SELECT for authenticated).
    -- This eliminates any TRUNCATE/REFERENCES/TRIGGER that may linger from the
    -- Supabase default grant set (RLS does NOT gate TRUNCATE; grants do).
    -- All writes go through service-role api/ — authenticated gets no write access.
    REVOKE ALL ON public.properties FROM anon, authenticated;
    GRANT SELECT ON public.properties TO authenticated;
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- SECTION C — finance tables (admin Finances/Billing dashboard)
-- -----------------------------------------------------------------------------
-- Admin-only access enforced by policy via public.is_admin(). anon gets zero
-- access (REVOKE ALL). authenticated keeps its grants so the dashboard can
-- operate THROUGH the policies; non-admin authenticated users are denied by the
-- policy predicate, not by missing grants. Guarded with to_regclass() because
-- token_purchases / expenses / revenue_entries have NO CREATE TABLE migration
-- (bootstrapped out-of-band), so a migrations-only branch DB may lack them.

-- C.1 — full-CRUD finance tables: one FOR ALL admin policy each.
-- TRUNCATE footgun fix: authenticated ends with exactly the 4 DML verbs the
-- dashboard needs (SELECT, INSERT, UPDATE, DELETE), and no TRUNCATE/REFERENCES/
-- TRIGGER. RLS does NOT gate TRUNCATE; only the table grant does — so without
-- this explicit revoke a non-admin authenticated user could TRUNCATE financial
-- tables despite the admin policy denying all row access.
DO $$
DECLARE
  t text;
  pol record;
  fin text[] := ARRAY[
    'token_purchases',
    'expenses',
    'revenue_entries',
    'subscriptions'
  ];
BEGIN
  FOREACH t IN ARRAY fin LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      -- Defensive: drop ALL existing policies on this table before creating ours.
      -- (Live DB has 0 policies on these tables; this is future-proofing.)
      FOR pol IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t
      LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
      END LOOP;
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
        'USING (public.is_admin()) WITH CHECK (public.is_admin())',
        'Admins manage ' || t, t);
      -- anon: zero access.
      -- authenticated: REVOKE ALL then explicit minimal grant (no TRUNCATE etc.).
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    END IF;
  END LOOP;
END $$;

-- C.2 — cost_events: dashboard READS only (SELECT); writes are service-role only.
DO $$
DECLARE
  pol record;
BEGIN
  IF to_regclass('public.cost_events') IS NOT NULL THEN
    ALTER TABLE public.cost_events ENABLE ROW LEVEL SECURITY;
    -- Defensive: drop ALL existing policies before creating ours.
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'cost_events'
    LOOP
      EXECUTE format('DROP POLICY %I ON public.cost_events', pol.policyname);
    END LOOP;
    CREATE POLICY "Admins read cost_events"
      ON public.cost_events FOR SELECT
      TO authenticated
      USING (public.is_admin());
    -- Normalize: REVOKE ALL from both, then re-grant SELECT only to authenticated.
    -- Eliminates any lingering TRUNCATE/REFERENCES/TRIGGER from Supabase defaults.
    -- Writes are service-role only; no client write access needed.
    REVOKE ALL ON public.cost_events FROM anon, authenticated;
    GRANT SELECT ON public.cost_events TO authenticated;
  END IF;
END $$;

-- =============================================================================
-- END migration 093
-- =============================================================================
