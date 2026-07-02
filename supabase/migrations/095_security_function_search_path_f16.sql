-- 095_security_function_search_path_f16.sql
--
-- Finding: F16 — function_search_path_mutable (x14 app-owned functions)
-- What this does: pins search_path to 'public, pg_temp' on every affected
--   app-owned function. This is pure security hardening: no behavior change,
--   no signature change, no grant change. It closes the search-path-injection
--   class (an attacker with CREATE privileges on any schema could shadow a
--   function referenced without a schema qualifier).
-- What this does NOT touch: the ~130 pgvector extension functions
--   (vector_*, halfvec_*, sparsevec_*, cosine_distance, l2_distance,
--   inner_product, binary_quantize, subvector, hamming_distance,
--   jaccard_distance, *_support, *_handler, array_to_*) — those are owned
--   by the `vector` extension and must not be altered.
-- Idempotent: ALTER FUNCTION … SET search_path is safely re-runnable.
-- Each statement is guarded with to_regprocedure so a missing function is
-- skipped rather than aborting the transaction.
--
-- Rollback: 095_security_function_search_path_f16_rollback.sql
--   (RESET search_path restores the prior mutable state)
--

-- ─── 1. public.portal_is_admin() ─────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.portal_is_admin()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.portal_is_admin() SET search_path = public, pg_temp';
  END IF;
END;
$$;

-- ─── 2. public.assign_v1_iteration_order_id() ────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.assign_v1_iteration_order_id()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.assign_v1_iteration_order_id() SET search_path = public, pg_temp';
  END IF;
END;
$$;

-- ─── 3. public.assign_v2_iteration_order_id() ────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.assign_v2_iteration_order_id()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.assign_v2_iteration_order_id() SET search_path = public, pg_temp';
  END IF;
END;
$$;

-- ─── 4. public.blog_cost_events_after_insert() ───────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.blog_cost_events_after_insert()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.blog_cost_events_after_insert() SET search_path = public, pg_temp';
  END IF;
END;
$$;

-- ─── 5. public.blog_match_image(vector, uuid, integer, integer) ──────────────
DO $$
BEGIN
  IF to_regprocedure('public.blog_match_image(vector,uuid,integer,integer)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.blog_match_image(vector, uuid, integer, integer) SET search_path = public, pg_temp';
  END IF;
END;
$$;

-- ─── 6. public.blog_posts_enqueue_image_match() ──────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.blog_posts_enqueue_image_match()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.blog_posts_enqueue_image_match() SET search_path = public, pg_temp';
  END IF;
END;
$$;

-- ─── 7. public.increment_preview_view(text) ──────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.increment_preview_view(text)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.increment_preview_view(text) SET search_path = public, pg_temp';
  END IF;
END;
$$;

-- ─── 8. public.marketing_chat_rate_limit_bump(text, timestamp with time zone) ─
DO $$
BEGIN
  IF to_regprocedure('public.marketing_chat_rate_limit_bump(text,timestamp with time zone)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.marketing_chat_rate_limit_bump(text, timestamp with time zone) SET search_path = public, pg_temp';
  END IF;
END;
$$;

-- ─── 9. public.marketing_leads_set_updated_at() ──────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.marketing_leads_set_updated_at()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.marketing_leads_set_updated_at() SET search_path = public, pg_temp';
  END IF;
END;
$$;

-- ─── 10. public.match_lab_recipes(vector, text, double precision, integer, vector, double precision, double precision) ─
DO $$
BEGIN
  IF to_regprocedure('public.match_lab_recipes(vector,text,double precision,integer,vector,double precision,double precision)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.match_lab_recipes(vector, text, double precision, integer, vector, double precision, double precision) SET search_path = public, pg_temp';
  END IF;
END;
$$;

-- ─── 11. public.match_loser_examples(vector, integer, integer, vector, double precision, double precision, text) ─
DO $$
BEGIN
  IF to_regprocedure('public.match_loser_examples(vector,integer,integer,vector,double precision,double precision,text)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.match_loser_examples(vector, integer, integer, vector, double precision, double precision, text) SET search_path = public, pg_temp';
  END IF;
END;
$$;

-- ─── 12. public.match_rated_examples(vector, integer, integer, vector, double precision, double precision, text) ─
DO $$
BEGIN
  IF to_regprocedure('public.match_rated_examples(vector,integer,integer,vector,double precision,double precision,text)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.match_rated_examples(vector, integer, integer, vector, double precision, double precision, text) SET search_path = public, pg_temp';
  END IF;
END;
$$;

-- ─── 13. public.portal_set_updated_at() ──────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.portal_set_updated_at()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.portal_set_updated_at() SET search_path = public, pg_temp';
  END IF;
END;
$$;

-- ─── 14. public.recipe_exists_near(vector, text, double precision) ────────────
DO $$
BEGIN
  IF to_regprocedure('public.recipe_exists_near(vector,text,double precision)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.recipe_exists_near(vector, text, double precision) SET search_path = public, pg_temp';
  END IF;
END;
$$;
