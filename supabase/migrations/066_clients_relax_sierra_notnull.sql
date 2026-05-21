-- migration 066: relax obsolete NOT NULL constraints on clients
--
-- Follow-up to migration 065. The `clients` table was originally created for
-- a Sierra-integration onboarding flow that was never built end-to-end (no
-- code paths read sierra_admin_password_encrypted, sierra_public_base_url,
-- sierra_region_id, sierra_admin_url, or sierra_admin_username; the single
-- existing row was seeded manually).
--
-- The operator-studio createClient (lib/operator-studio/clients.ts) writes a
-- subset of columns and fails with `null value in column "sierra_public_base_url"
-- ... violates not-null constraint` because those NOT NULLs are stale.
--
-- Fix: drop the not-null on every column that the operator-studio path can't
-- meaningfully populate. The existing row keeps its values; the constraint
-- relaxation is non-destructive. If a Sierra onboarding UI is ever rebuilt,
-- it can re-introduce per-path validation (CHECK or app-layer), scoped to
-- that flow.

BEGIN;

ALTER TABLE public.clients
  ALTER COLUMN sierra_public_base_url            DROP NOT NULL,
  ALTER COLUMN sierra_region_id                  DROP NOT NULL,
  ALTER COLUMN sierra_admin_url                  DROP NOT NULL,
  ALTER COLUMN sierra_admin_username             DROP NOT NULL,
  ALTER COLUMN sierra_admin_password_encrypted   DROP NOT NULL,
  ALTER COLUMN agent_name                        DROP NOT NULL,
  ALTER COLUMN agent_phone                       DROP NOT NULL,
  ALTER COLUMN agent_email                       DROP NOT NULL,
  ALTER COLUMN created_by                        DROP NOT NULL;

COMMIT;
