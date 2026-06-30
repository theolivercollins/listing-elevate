-- =============================================================================
-- EMERGENCY ROLLBACK for migration 094 (F6 view lockdown)
-- =============================================================================
--
-- !!! WARNING !!!
--   This script RESTORES THE INSECURE PRE-F6 STATE: it re-grants full DML on
--   the 5 public views to anon + authenticated and removes security_invoker.
--   Because the public anon key is shipped in the browser SPA, running this
--   re-opens prompt_lab / knowledge_map / judge calibration data to unauthenticated
--   read (and write) via PostgREST, bypassing the F1 base-table RLS lockdown.
--
--   USE ONLY if the 094 lockdown breaks production and you need to revert fast.
--   Re-apply 094 (or a corrected forward fix) as soon as the incident is over.
--
-- =============================================================================

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
    IF to_regclass('public.' || v) IS NOT NULL THEN
      -- Restore the insecure full-DML grant (matches pre-094 Supabase defaults).
      EXECUTE format('GRANT ALL ON public.%I TO anon, authenticated', v);
      -- Remove security_invoker so the view runs as its owner again (default).
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = false)', v);
    END IF;
  END LOOP;
END $$;

-- =============================================================================
-- END emergency rollback for migration 094
-- =============================================================================
