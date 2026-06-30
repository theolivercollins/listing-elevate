-- =============================================================================
-- EMERGENCY ROLLBACK for migration 093 (F1 RLS lockdown)
-- =============================================================================
--
-- !!! WARNING !!!
--   This script RESTORES THE INSECURE PRE-F1 STATE: it DISABLES RLS on all 57
--   tables and RE-GRANTS FULL DML to the anon + authenticated roles. Because the
--   public anon key is shipped in the browser SPA, running this re-opens the
--   entire database to world read/write via PostgREST.
--
--   USE ONLY if the 093 lockdown breaks production and you need to revert fast.
--   Re-apply 093 (or a corrected forward fix) as soon as the incident is over.
--
-- WHAT IT UNDOES (in dependency-safe order):
--   1. Drops/restores all policies that reference public.is_admin() — must
--      precede dropping the function, or DROP FUNCTION fails with a dependency
--      error. This includes:
--      * The 4 "Admins manage <table>" FOR ALL policies (finance tables).
--      * "Admins read cost_events" SELECT policy.
--      * "Users can view own properties" — 093 expanded its USING clause to
--        include OR public.is_admin(), so it must be dropped before the function
--        is removed. It is immediately recreated with the original 001 USING
--        clause (auth.uid() = submitted_by only), restoring the pre-093 state
--        (which was inert anyway because RLS was disabled).
--   2. Disables RLS and re-grants ALL to anon + authenticated on all 57 tables.
--   3. Drops public.is_admin().
--
--   Every operation is guarded with to_regclass() so absent tables are skipped.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 1 — drop the admin policies created by 093 (before dropping is_admin)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  fin text[] := ARRAY[
    'token_purchases',
    'expenses',
    'revenue_entries',
    'subscriptions'
  ];
BEGIN
  FOREACH t IN ARRAY fin LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Admins manage ' || t, t);
    END IF;
  END LOOP;

  IF to_regclass('public.cost_events') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins read cost_events" ON public.cost_events;
  END IF;

  -- 093 changed the USING clause of "Users can view own properties" to include
  -- OR public.is_admin(). Drop it here (before is_admin() is dropped in Step 3,
  -- which would fail due to a dependency) and restore the original 001 clause.
  IF to_regclass('public.properties') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Users can view own properties" ON public.properties;
    CREATE POLICY "Users can view own properties"
      ON public.properties FOR SELECT
      TO authenticated
      USING (auth.uid() = submitted_by);
    -- RLS is disabled on properties in Step 2, making this policy inert —
    -- exactly matching the pre-093 state.
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 2 — disable RLS and re-grant ALL to anon + authenticated on all 57 tables
-- -----------------------------------------------------------------------------
-- This is the line that re-opens the database. Intentional, per the warning above.
DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    -- Section A (51 server-only tables)
    'photos',
    'scenes',
    'pipeline_logs',
    'daily_stats',
    'scene_ratings',
    'prompt_revisions',
    'video_revisions',
    'music_tracks',
    'lab_judge_scores',
    'lab_judge_calibrations',
    'knowledge_map_room_types',
    'knowledge_map_camera_verbs',
    'judge_calibration_examples',
    'prompt_lab_listings',
    'prompt_lab_listing_photos',
    'prompt_lab_listing_scenes',
    'prompt_lab_listing_scene_iterations',
    'prompt_lab_assemblies',
    'prompt_lab_model_feedback',
    'prompt_lab_listing_assemblies',
    'router_bucket_stats',
    'router_shadow_log',
    'sku_motion_affinity',
    'sku_motion_affinity_refresh_log',
    'system_flags',
    'blog_sites',
    'blog_posts',
    'blog_jobs',
    'blog_topic_suggestions',
    'blog_research_runs',
    'blog_images',
    'blog_image_usages',
    'blog_corrections',
    'blog_style_rules',
    'ally_memories',
    'email_templates',
    'emails',
    'gen2_scene_graphs',
    'gen2_pair_candidates',
    'gen2_pair_labels',
    'gen2_picker_models',
    'gen2_render_outcomes',
    'gen2_apprentice_predictions',
    'mu_regions',
    'market_update_runs',
    'ally_seo_audits',
    'ally_seo_findings',
    'ally_conversations',
    'ally_runs',
    'ally_run_steps',
    'ally_autonomy_settings',
    -- Section B
    'properties',
    -- Section C (finance)
    'token_purchases',
    'expenses',
    'revenue_entries',
    'subscriptions',
    'cost_events'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
      EXECUTE format('GRANT ALL ON public.%I TO anon, authenticated', t);
    END IF;
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 3 — drop the admin helper
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.is_admin();

-- =============================================================================
-- END emergency rollback for migration 093
-- =============================================================================
