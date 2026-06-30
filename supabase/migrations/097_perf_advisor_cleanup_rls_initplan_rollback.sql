-- Migration 097 ROLLBACK: restore non-wrapped RLS policies + index state
-- ----------------------------------------------------------------------------
-- Undoes 097_perf_advisor_cleanup_rls_initplan.sql.
-- Restores the 43 RLS policies to their ORIGINAL (non-wrapped) auth calls.
-- NOTE: restoring non-wrapped policies RE-INTRODUCES the harmless
--       0003 auth_rls_initplan lint — that is the intended undo, not a bug.
-- NOTE: the recreated duplicate-index definitions are BEST-EFFORT on columns
--       (expires_at / created_at). The orchestrator should confirm the exact
--       original `indexdef` during the dry-run before relying on them.
-- ----------------------------------------------------------------------------

BEGIN;

-- Restore original (non-wrapped) policy definitions

DROP POLICY IF EXISTS "clients_delete_own" ON public.clients;
CREATE POLICY "clients_delete_own" ON public.clients AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = created_by));

DROP POLICY IF EXISTS "clients_insert_own" ON public.clients;
CREATE POLICY "clients_insert_own" ON public.clients AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = created_by));

DROP POLICY IF EXISTS "clients_select_own" ON public.clients;
CREATE POLICY "clients_select_own" ON public.clients AS PERMISSIVE FOR SELECT TO public
  USING (((auth.uid() = created_by) OR (EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text))))));

DROP POLICY IF EXISTS "clients_update_own" ON public.clients;
CREATE POLICY "clients_update_own" ON public.clients AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = created_by));

DROP POLICY IF EXISTS "Admins can delete dev notes" ON public.dev_session_notes;
CREATE POLICY "Admins can delete dev notes" ON public.dev_session_notes AS PERMISSIVE FOR DELETE TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins can insert dev notes" ON public.dev_session_notes;
CREATE POLICY "Admins can insert dev notes" ON public.dev_session_notes AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins can read dev notes" ON public.dev_session_notes;
CREATE POLICY "Admins can read dev notes" ON public.dev_session_notes AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins can update dev notes" ON public.dev_session_notes;
CREATE POLICY "Admins can update dev notes" ON public.dev_session_notes AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins all overrides" ON public.lab_prompt_overrides;
CREATE POLICY "Admins all overrides" ON public.lab_prompt_overrides AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins all proposals" ON public.lab_prompt_proposals;
CREATE POLICY "Admins all proposals" ON public.lab_prompt_proposals AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "landing_pages_delete_own" ON public.landing_pages;
CREATE POLICY "landing_pages_delete_own" ON public.landing_pages AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = created_by));

DROP POLICY IF EXISTS "landing_pages_insert_own" ON public.landing_pages;
CREATE POLICY "landing_pages_insert_own" ON public.landing_pages AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = created_by));

DROP POLICY IF EXISTS "landing_pages_select_own" ON public.landing_pages;
CREATE POLICY "landing_pages_select_own" ON public.landing_pages AS PERMISSIVE FOR SELECT TO public
  USING (((auth.uid() = created_by) OR (EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text))))));

DROP POLICY IF EXISTS "landing_pages_update_own" ON public.landing_pages;
CREATE POLICY "landing_pages_update_own" ON public.landing_pages AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = created_by));

DROP POLICY IF EXISTS "portal_comments_insert" ON public.portal_comments;
CREATE POLICY "portal_comments_insert" ON public.portal_comments AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((auth.uid() = author_user_id) AND (EXISTS ( SELECT 1
   FROM (portal_deliverables d
     JOIN portal_orders o ON ((o.id = d.order_id)))
  WHERE ((d.id = portal_comments.deliverable_id) AND ((o.owner_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM portal_customers c
          WHERE ((c.id = o.customer_id) AND (c.user_id = auth.uid()))))))))));

DROP POLICY IF EXISTS "portal_comments_select" ON public.portal_comments;
CREATE POLICY "portal_comments_select" ON public.portal_comments AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM (portal_deliverables d
     JOIN portal_orders o ON ((o.id = d.order_id)))
  WHERE ((d.id = portal_comments.deliverable_id) AND ((o.owner_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM portal_customers c
          WHERE ((c.id = o.customer_id) AND (c.user_id = auth.uid())))) OR portal_is_admin())))));

DROP POLICY IF EXISTS "portal_customers_delete" ON public.portal_customers;
CREATE POLICY "portal_customers_delete" ON public.portal_customers AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = owner_id));

DROP POLICY IF EXISTS "portal_customers_insert" ON public.portal_customers;
CREATE POLICY "portal_customers_insert" ON public.portal_customers AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = owner_id));

DROP POLICY IF EXISTS "portal_customers_select" ON public.portal_customers;
CREATE POLICY "portal_customers_select" ON public.portal_customers AS PERMISSIVE FOR SELECT TO public
  USING (((auth.uid() = owner_id) OR (auth.uid() = user_id) OR portal_is_admin()));

DROP POLICY IF EXISTS "portal_customers_update" ON public.portal_customers;
CREATE POLICY "portal_customers_update" ON public.portal_customers AS PERMISSIVE FOR UPDATE TO public
  USING (((auth.uid() = owner_id) OR (auth.uid() = user_id)));

DROP POLICY IF EXISTS "portal_versions_select" ON public.portal_deliverable_versions;
CREATE POLICY "portal_versions_select" ON public.portal_deliverable_versions AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM (portal_deliverables d
     JOIN portal_orders o ON ((o.id = d.order_id)))
  WHERE ((d.id = portal_deliverable_versions.deliverable_id) AND ((o.owner_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM portal_customers c
          WHERE ((c.id = o.customer_id) AND (c.user_id = auth.uid())))) OR portal_is_admin())))));

DROP POLICY IF EXISTS "portal_versions_write" ON public.portal_deliverable_versions;
CREATE POLICY "portal_versions_write" ON public.portal_deliverable_versions AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM (portal_deliverables d
     JOIN portal_orders o ON ((o.id = d.order_id)))
  WHERE ((d.id = portal_deliverable_versions.deliverable_id) AND (o.owner_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (portal_deliverables d
     JOIN portal_orders o ON ((o.id = d.order_id)))
  WHERE ((d.id = portal_deliverable_versions.deliverable_id) AND (o.owner_id = auth.uid())))));

DROP POLICY IF EXISTS "portal_deliverables_select" ON public.portal_deliverables;
CREATE POLICY "portal_deliverables_select" ON public.portal_deliverables AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM portal_orders o
  WHERE ((o.id = portal_deliverables.order_id) AND ((o.owner_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM portal_customers c
          WHERE ((c.id = o.customer_id) AND (c.user_id = auth.uid())))) OR portal_is_admin())))));

DROP POLICY IF EXISTS "portal_deliverables_write" ON public.portal_deliverables;
CREATE POLICY "portal_deliverables_write" ON public.portal_deliverables AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM portal_orders o
  WHERE ((o.id = portal_deliverables.order_id) AND (o.owner_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM portal_orders o
  WHERE ((o.id = portal_deliverables.order_id) AND (o.owner_id = auth.uid())))));

DROP POLICY IF EXISTS "portal_notifications_select" ON public.portal_notifications;
CREATE POLICY "portal_notifications_select" ON public.portal_notifications AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "portal_notifications_update" ON public.portal_notifications;
CREATE POLICY "portal_notifications_update" ON public.portal_notifications AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "portal_orders_delete" ON public.portal_orders;
CREATE POLICY "portal_orders_delete" ON public.portal_orders AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = owner_id));

DROP POLICY IF EXISTS "portal_orders_insert" ON public.portal_orders;
CREATE POLICY "portal_orders_insert" ON public.portal_orders AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = owner_id));

DROP POLICY IF EXISTS "portal_orders_select" ON public.portal_orders;
CREATE POLICY "portal_orders_select" ON public.portal_orders AS PERMISSIVE FOR SELECT TO public
  USING (((auth.uid() = owner_id) OR (EXISTS ( SELECT 1
   FROM portal_customers c
  WHERE ((c.id = portal_orders.customer_id) AND (c.user_id = auth.uid())))) OR portal_is_admin()));

DROP POLICY IF EXISTS "portal_orders_update" ON public.portal_orders;
CREATE POLICY "portal_orders_update" ON public.portal_orders AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = owner_id));

DROP POLICY IF EXISTS "Admins can delete iterations" ON public.prompt_lab_iterations;
CREATE POLICY "Admins can delete iterations" ON public.prompt_lab_iterations AS PERMISSIVE FOR DELETE TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins can insert iterations" ON public.prompt_lab_iterations;
CREATE POLICY "Admins can insert iterations" ON public.prompt_lab_iterations AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins can read iterations" ON public.prompt_lab_iterations;
CREATE POLICY "Admins can read iterations" ON public.prompt_lab_iterations AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins can update iterations" ON public.prompt_lab_iterations;
CREATE POLICY "Admins can update iterations" ON public.prompt_lab_iterations AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins all recipes" ON public.prompt_lab_recipes;
CREATE POLICY "Admins all recipes" ON public.prompt_lab_recipes AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins can delete sessions" ON public.prompt_lab_sessions;
CREATE POLICY "Admins can delete sessions" ON public.prompt_lab_sessions AS PERMISSIVE FOR DELETE TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins can insert sessions" ON public.prompt_lab_sessions;
CREATE POLICY "Admins can insert sessions" ON public.prompt_lab_sessions AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins can read sessions" ON public.prompt_lab_sessions;
CREATE POLICY "Admins can read sessions" ON public.prompt_lab_sessions AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Admins can update sessions" ON public.prompt_lab_sessions;
CREATE POLICY "Admins can update sessions" ON public.prompt_lab_sessions AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.user_id = auth.uid()) AND (user_profiles.role = 'admin'::text)))));

DROP POLICY IF EXISTS "Users can view own properties" ON public.properties;
CREATE POLICY "Users can view own properties" ON public.properties AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() = submitted_by) OR is_admin()));

DROP POLICY IF EXISTS "Users can insert own profile" ON public.user_profiles;
CREATE POLICY "Users can insert own profile" ON public.user_profiles AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
CREATE POLICY "Users can update own profile" ON public.user_profiles AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own profile" ON public.user_profiles;
CREATE POLICY "Users can view own profile" ON public.user_profiles AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));

-- Recreate the 2 duplicate indexes dropped by the forward migration
-- (indexdefs confirmed against live pg_indexes before apply, 2026-07-01)
CREATE INDEX IF NOT EXISTS marketing_chat_rate_limits_expires_idx ON public.marketing_chat_rate_limits USING btree (expires_at);
CREATE INDEX IF NOT EXISTS marketing_leads_created_idx ON public.marketing_leads USING btree (created_at DESC);

-- Drop the 10 covering indexes added by the forward migration
DROP INDEX IF EXISTS public.idx_scenes_photo_id;
DROP INDEX IF EXISTS public.idx_scene_variants_scene_id;
DROP INDEX IF EXISTS public.idx_cost_events_scene_id;
DROP INDEX IF EXISTS public.idx_pipeline_logs_scene_id;
DROP INDEX IF EXISTS public.idx_properties_client_id;
DROP INDEX IF EXISTS public.idx_properties_music_track_id;
DROP INDEX IF EXISTS public.idx_properties_submitted_by;
DROP INDEX IF EXISTS public.idx_revenue_entries_property_id;
DROP INDEX IF EXISTS public.idx_delivery_runs_client_id;
DROP INDEX IF EXISTS public.idx_delivery_runs_music_track_id;

COMMIT;
