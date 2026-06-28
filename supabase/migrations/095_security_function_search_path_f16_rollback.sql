-- 095_security_function_search_path_f16_rollback.sql
--
-- Rollback for 095_security_function_search_path_f16.sql (finding F16)
-- RESET search_path removes the pinned value and restores the prior mutable
-- state (GUC_NOT_IN_SAMPLE — Postgres uses the session/role default).
-- Same to_regprocedure guards: missing function is silently skipped.
--

-- ─── 1. public.portal_is_admin() ─────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.portal_is_admin()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.portal_is_admin() RESET search_path';
  END IF;
END;
$$;

-- ─── 2. public.assign_v1_iteration_order_id() ────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.assign_v1_iteration_order_id()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.assign_v1_iteration_order_id() RESET search_path';
  END IF;
END;
$$;

-- ─── 3. public.assign_v2_iteration_order_id() ────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.assign_v2_iteration_order_id()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.assign_v2_iteration_order_id() RESET search_path';
  END IF;
END;
$$;

-- ─── 4. public.blog_cost_events_after_insert() ───────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.blog_cost_events_after_insert()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.blog_cost_events_after_insert() RESET search_path';
  END IF;
END;
$$;

-- ─── 5. public.blog_match_image(vector, uuid, integer, integer) ──────────────
DO $$
BEGIN
  IF to_regprocedure('public.blog_match_image(vector,uuid,integer,integer)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.blog_match_image(vector, uuid, integer, integer) RESET search_path';
  END IF;
END;
$$;

-- ─── 6. public.blog_posts_enqueue_image_match() ──────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.blog_posts_enqueue_image_match()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.blog_posts_enqueue_image_match() RESET search_path';
  END IF;
END;
$$;

-- ─── 7. public.increment_preview_view(text) ──────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.increment_preview_view(text)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.increment_preview_view(text) RESET search_path';
  END IF;
END;
$$;

-- ─── 8. public.marketing_chat_rate_limit_bump(text, timestamp with time zone) ─
DO $$
BEGIN
  IF to_regprocedure('public.marketing_chat_rate_limit_bump(text,timestamp with time zone)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.marketing_chat_rate_limit_bump(text, timestamp with time zone) RESET search_path';
  END IF;
END;
$$;

-- ─── 9. public.marketing_leads_set_updated_at() ──────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.marketing_leads_set_updated_at()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.marketing_leads_set_updated_at() RESET search_path';
  END IF;
END;
$$;

-- ─── 10. public.match_lab_recipes(vector, text, double precision, integer, vector, double precision, double precision) ─
DO $$
BEGIN
  IF to_regprocedure('public.match_lab_recipes(vector,text,double precision,integer,vector,double precision,double precision)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.match_lab_recipes(vector, text, double precision, integer, vector, double precision, double precision) RESET search_path';
  END IF;
END;
$$;

-- ─── 11. public.match_loser_examples(vector, integer, integer, vector, double precision, double precision, text) ─
DO $$
BEGIN
  IF to_regprocedure('public.match_loser_examples(vector,integer,integer,vector,double precision,double precision,text)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.match_loser_examples(vector, integer, integer, vector, double precision, double precision, text) RESET search_path';
  END IF;
END;
$$;

-- ─── 12. public.match_rated_examples(vector, integer, integer, vector, double precision, double precision, text) ─
DO $$
BEGIN
  IF to_regprocedure('public.match_rated_examples(vector,integer,integer,vector,double precision,double precision,text)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.match_rated_examples(vector, integer, integer, vector, double precision, double precision, text) RESET search_path';
  END IF;
END;
$$;

-- ─── 13. public.portal_set_updated_at() ──────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.portal_set_updated_at()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.portal_set_updated_at() RESET search_path';
  END IF;
END;
$$;

-- ─── 14. public.recipe_exists_near(vector, text, double precision) ────────────
DO $$
BEGIN
  IF to_regprocedure('public.recipe_exists_near(vector,text,double precision)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.recipe_exists_near(vector, text, double precision) RESET search_path';
  END IF;
END;
$$;
