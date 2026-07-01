-- =============================================================================
-- 100_user_profiles_role_escalation_fix_rollback.sql
-- =============================================================================
-- Reverses 100_user_profiles_role_escalation_fix.sql.
--
-- WARNING: applying this rollback RE-OPENS the P0 privilege-escalation hole
-- (authenticated users could again self-set role='admin'). Only run it if the
-- forward migration must be backed out; otherwise leave the trigger in place.
--
-- Idempotent (IF EXISTS guards throughout).
-- =============================================================================

-- --- 1. drop the role-clamp trigger + function ------------------------------
DROP TRIGGER IF EXISTS trg_enforce_user_profiles_role_immutable ON public.user_profiles;
DROP FUNCTION IF EXISTS public.enforce_user_profiles_role_immutable();

-- --- 2. restore the 'user-logos' bucket to unrestricted ----------------------
-- (Pre-fix state: allowed_mime_types = NULL, file_size_limit = NULL.)
UPDATE storage.buckets
SET allowed_mime_types = NULL,
    file_size_limit    = NULL
WHERE id = 'user-logos';
