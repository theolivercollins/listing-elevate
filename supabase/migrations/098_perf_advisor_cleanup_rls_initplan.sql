-- Migration 098: Performance advisor cleanup — RLS initplan + index hygiene
-- ----------------------------------------------------------------------------
-- WHAT:  Re-creates 43 RLS policies wrapping every auth-function call
--        (auth.uid(), is_admin(), portal_is_admin()) in a scalar subquery
--        `(select fn())` so Postgres evaluates each ONCE per query (initPlan)
--        instead of once per row. Plus drops 2 redundant duplicate indexes
--        and adds 10 covering indexes on hot foreign keys.
-- WHY:   Clears Supabase performance advisor lints:
--          0003 auth_rls_initplan         (per-row auth re-evaluation)
--          0009 duplicate_index           (redundant index copies, also unused)
--          0001 unindexed_foreign_keys    (seq-scan risk on pipeline-hot FKs)
-- SAFETY: SEMANTICS-PRESERVING. The policy predicates are byte-for-byte the
--         live definitions with ONLY the three auth calls wrapped in
--         `(select ...)`; no joins, columns, EXISTS structure, roles, or
--         commands are altered. `(select auth.uid())` returns the same value
--         as `auth.uid()` — this is the Supabase-recommended initplan idiom.
-- ROLLBACK: 098_perf_advisor_cleanup_rls_initplan_rollback.sql
--           (restores the non-wrapped policies — which re-introduces the
--            harmless initplan lint by design — recreates the 2 dropped
--            indexes and drops the 10 added ones).
-- FORWARD-ONLY / idempotent: drop-if-exists + recreate for policies,
--           create-index-if-not-exists / drop-index-if-exists for indexes.
-- ----------------------------------------------------------------------------

BEGIN;

-- auth_rls_initplan (0003): wrap auth calls in scalar subqueries (43 policies)

DROP POLICY IF EXISTS "clients_delete_own" ON public.clients;
CREATE POLICY "clients_delete_own" ON public.clients AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) = created_by));

DROP POLICY IF EXISTS "clients_insert_own" ON public.clients;
CREATE POLICY "clients_insert_own" ON public.clients AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = created_by));

DROP POLICY IF EXISTS "clients_select_own" ON public.clients;
CREATE POLICY "clients_select_own" ON public.clients AS PERMISSIVE FOR SELECT TO public
  USING ((((select auth.uid()) = created_by) OR (EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = (select auth.uid())) AND (user_profiles.role = 'admin'::text))))));

DROP POLICY IF EXISTS "clients_update_own" ON public.clients;
CREATE POLICY "clients_update_own" ON public.clients AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) = created_by));

DROP POLICY IF EXISTS "Admins can delete dev notes" ON public.dev_session_notes;
CREATE POLICY "Admins can delete dev notes" ON public.dev_session_notes AS PERMISSIVE FOR DELETE TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = (select auth.uid())) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins can insert dev notes" ON public.dev_session_notes;
CREATE POLICY "Admins can insert dev notes" ON public.dev_session_notes AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = (select auth.uid())) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins can read dev notes" ON public.dev_session_notes;
CREATE POLICY "Admins can read dev notes" ON public.dev_session_notes AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = (select auth.uid())) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins can update dev notes" ON public.dev_session_notes;
CREATE POLICY "Admins can update dev notes" ON public.dev_session_notes AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = (select auth.uid())) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins all overrides" ON public.lab_prompt_overrides;
CREATE POLICY "Admins all overrides" ON public.lab_prompt_overrides AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = (select auth.uid())) AND (user_profiles.role = 'admin'::text)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = (select auth.uid())) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins all proposals" ON public.lab_prompt_proposals;
CREATE POLICY "Admins all proposals" ON public.lab_prompt_proposals AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = (select auth.uid())) AND (user_profiles.role = 'admin'::text)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = (select auth.uid())) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "landing_pages_delete_own" ON public.landing_pages;
CREATE POLICY "landing_pages_delete_own" ON public.landing_pages AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) = created_by));

DROP POLICY IF EXISTS "landing_pages_insert_own" ON public.landing_pages;
CREATE POLICY "landing_pages_insert_own" ON public.landing_pages AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = created_by));

DROP POLICY IF EXISTS "landing_pages_select_own" ON public.landing_pages;
CREATE POLICY "landing_pages_select_own" ON public.landing_pages AS PERMISSIVE FOR SELECT TO public
  USING ((((select auth.uid()) = created_by) OR (EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = (select auth.uid())) AND (user_profiles.role = 'admin'::text))))));

DROP POLICY IF EXISTS "landing_pages_update_own" ON public.landing_pages;
CREATE POLICY "landing_pages_update_own" ON public.landing_pages AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) = created_by));

DROP POLICY IF EXISTS "portal_comments_insert" ON public.portal_comments;
CREATE POLICY "portal_comments_insert" ON public.portal_comments AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((((select auth.uid()) = author_user_id) AND (EXISTS ( SELECT 1
   FROM (portal_deliverables d
     JOIN portal_orders o ON ((o.id = d.order_id)))
  WHERE ((d.id = portal_comments.deliverable_id) AND ((o.owner_id = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM portal_customers c
          WHERE ((c.id = o.customer_id) AND (c.user_id = (select auth.uid())))))))))));

DROP POLICY IF EXISTS "portal_comments_select" ON public.portal_comments;
CREATE POLICY "portal_comments_select" ON public.portal_comments AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM (portal_deliverables d
     JOIN portal_orders o ON ((o.id = d.order_id)))
  WHERE ((d.id = portal_comments.deliverable_id) AND ((o.owner_id = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM portal_customers c
          WHERE ((c.id = o.customer_id) AND (c.user_id = (select auth.uid()))))) OR (select portal_is_admin()))))));

DROP POLICY IF EXISTS "portal_customers_delete" ON public.portal_customers;
CREATE POLICY "portal_customers_delete" ON public.portal_customers AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) = owner_id));

DROP POLICY IF EXISTS "portal_customers_insert" ON public.portal_customers;
CREATE POLICY "portal_customers_insert" ON public.portal_customers AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = owner_id));

DROP POLICY IF EXISTS "portal_customers_select" ON public.portal_customers;
CREATE POLICY "portal_customers_select" ON public.portal_customers AS PERMISSIVE FOR SELECT TO public
  USING ((((select auth.uid()) = owner_id) OR ((select auth.uid()) = user_id) OR (select portal_is_admin())));

DROP POLICY IF EXISTS "portal_customers_update" ON public.portal_customers;
CREATE POLICY "portal_customers_update" ON public.portal_customers AS PERMISSIVE FOR UPDATE TO public
  USING ((((select auth.uid()) = owner_id) OR ((select auth.uid()) = user_id)));

DROP POLICY IF EXISTS "portal_versions_select" ON public.portal_deliverable_versions;
CREATE POLICY "portal_versions_select" ON public.portal_deliverable_versions AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM (portal_deliverables d
     JOIN portal_orders o ON ((o.id = d.order_id)))
  WHERE ((d.id = portal_deliverable_versions.deliverable_id) AND ((o.owner_id = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM portal_customers c
          WHERE ((c.id = o.customer_id) AND (c.user_id = (select auth.uid()))))) OR (select portal_is_admin()))))));

DROP POLICY IF EXISTS "portal_versions_write" ON public.portal_deliverable_versions;
CREATE POLICY "portal_versions_write" ON public.portal_deliverable_versions AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM (portal_deliverables d
     JOIN portal_orders o ON ((o.id = d.order_id)))
  WHERE ((d.id = portal_deliverable_versions.deliverable_id) AND (o.owner_id = (select auth.uid()))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (portal_deliverables d
     JOIN portal_orders o ON ((o.id = d.order_id)))
  WHERE ((d.id = portal_deliverable_versions.deliverable_id) AND (o.owner_id = (select auth.uid()))))));

DROP POLICY IF EXISTS "portal_deliverables_select" ON public.portal_deliverables;
CREATE POLICY "portal_deliverables_select" ON public.portal_deliverables AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM portal_orders o
  WHERE ((o.id = portal_deliverables.order_id) AND ((o.owner_id = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM portal_customers c
          WHERE ((c.id = o.customer_id) AND (c.user_id = (select auth.uid()))))) OR (select portal_is_admin()))))));

DROP POLICY IF EXISTS "portal_deliverables_write" ON public.portal_deliverables;
CREATE POLICY "portal_deliverables_write" ON public.portal_deliverables AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM portal_orders o
  WHERE ((o.id = portal_deliverables.order_id) AND (o.owner_id = (select auth.uid()))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM portal_orders o
  WHERE ((o.id = portal_deliverables.order_id) AND (o.owner_id = (select auth.uid()))))));

DROP POLICY IF EXISTS "portal_notifications_select" ON public.portal_notifications;
CREATE POLICY "portal_notifications_select" ON public.portal_notifications AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "portal_notifications_update" ON public.portal_notifications;
CREATE POLICY "portal_notifications_update" ON public.portal_notifications AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "portal_orders_delete" ON public.portal_orders;
CREATE POLICY "portal_orders_delete" ON public.portal_orders AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) = owner_id));

DROP POLICY IF EXISTS "portal_orders_insert" ON public.portal_orders;
CREATE POLICY "portal_orders_insert" ON public.portal_orders AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = owner_id));

DROP POLICY IF EXISTS "portal_orders_select" ON public.portal_orders;
CREATE POLICY "portal_orders_select" ON public.portal_orders AS PERMISSIVE FOR SELECT TO public
  USING ((((select auth.uid()) = owner_id) OR (EXISTS ( SELECT 1
   FROM portal_customers c
  WHERE ((c.id = portal_orders.customer_id) AND (c.user_id = (select auth.uid()))))) OR (select portal_is_admin())));

DROP POLICY IF EXISTS "portal_orders_update" ON public.portal_orders;
CREATE POLICY "portal_orders_update" ON public.portal_orders AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) = owner_id));

DROP POLICY IF EXISTS "Admins can delete iterations" ON public.prompt_lab_iterations;
CREATE POLICY "Admins can delete iterations" ON public.prompt_lab_iterations AS PERMISSIVE FOR DELETE TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = (select auth.uid())) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins can insert iterations" ON public.prompt_lab_iterations;
CREATE POLICY "Admins can insert iterations" ON public.prompt_lab_iterations AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = (select auth.uid())) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins can read iterations" ON public.prompt_lab_iterations;
CREATE POLICY "Admins can read iterations" ON public.prompt_lab_iterations AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = (select auth.uid())) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins can update iterations" ON public.prompt_lab_iterations;
CREATE POLICY "Admins can update iterations" ON public.prompt_lab_iterations AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = (select auth.uid())) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins all recipes" ON public.prompt_lab_recipes;
CREATE POLICY "Admins all recipes" ON public.prompt_lab_recipes AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = (select auth.uid())) AND (user_profiles.role = 'admin'::text)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = (select auth.uid())) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins can delete sessions" ON public.prompt_lab_sessions;
CREATE POLICY "Admins can delete sessions" ON public.prompt_lab_sessions AS PERMISSIVE FOR DELETE TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = (select auth.uid())) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins can insert sessions" ON public.prompt_lab_sessions;
CREATE POLICY "Admins can insert sessions" ON public.prompt_lab_sessions AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = (select auth.uid())) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins can read sessions" ON public.prompt_lab_sessions;
CREATE POLICY "Admins can read sessions" ON public.prompt_lab_sessions AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = (select auth.uid())) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins can update sessions" ON public.prompt_lab_sessions;
CREATE POLICY "Admins can update sessions" ON public.prompt_lab_sessions AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = (select auth.uid())) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Users can view own properties" ON public.properties;
CREATE POLICY "Users can view own properties" ON public.properties AS PERMISSIVE FOR SELECT TO authenticated
  USING ((((select auth.uid()) = submitted_by) OR (select is_admin())));

DROP POLICY IF EXISTS "Users can insert own profile" ON public.user_profiles;
CREATE POLICY "Users can insert own profile" ON public.user_profiles AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
CREATE POLICY "Users can update own profile" ON public.user_profiles AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Users can view own profile" ON public.user_profiles;
CREATE POLICY "Users can view own profile" ON public.user_profiles AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

-- duplicate_index (0009): drop redundant copies (both also unused)
DROP INDEX IF EXISTS public.marketing_chat_rate_limits_expires_idx;
DROP INDEX IF EXISTS public.marketing_leads_created_idx;

-- unindexed_foreign_keys (0001): covering indexes on pipeline-hot FKs
CREATE INDEX IF NOT EXISTS idx_scenes_photo_id              ON public.scenes(photo_id);
CREATE INDEX IF NOT EXISTS idx_scene_variants_scene_id      ON public.scene_variants(scene_id);
CREATE INDEX IF NOT EXISTS idx_cost_events_scene_id         ON public.cost_events(scene_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_logs_scene_id       ON public.pipeline_logs(scene_id);
CREATE INDEX IF NOT EXISTS idx_properties_client_id         ON public.properties(client_id);
CREATE INDEX IF NOT EXISTS idx_properties_music_track_id    ON public.properties(music_track_id);
CREATE INDEX IF NOT EXISTS idx_properties_submitted_by      ON public.properties(submitted_by);
CREATE INDEX IF NOT EXISTS idx_revenue_entries_property_id  ON public.revenue_entries(property_id);
CREATE INDEX IF NOT EXISTS idx_delivery_runs_client_id      ON public.delivery_runs(client_id);
CREATE INDEX IF NOT EXISTS idx_delivery_runs_music_track_id ON public.delivery_runs(music_track_id);

COMMIT;
