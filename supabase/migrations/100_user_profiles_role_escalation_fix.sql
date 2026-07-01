-- =============================================================================
-- 100_user_profiles_role_escalation_fix.sql
-- =============================================================================
-- P0 PRIVILEGE-ESCALATION FIX (confirmed live).
--
-- THE HOLE
--   public.user_profiles.role is the sole authorization signal for admin access
--   (lib/auth.ts verifyAuth reads realProfile.role; requireAdmin gates on it;
--   public.is_admin() -- migration 093 -- resolves role='admin'). Yet:
--     * authenticated + anon hold INSERT + UPDATE on the table, and
--     * the RLS policies constrain only ownership, not role:
--         INSERT "Users can insert own profile":  WITH CHECK (auth.uid()=user_id)
--         UPDATE "Users can update own profile":  USING (auth.uid()=user_id),
--                                                 WITH CHECK IS NULL
--   => any signed-in user can run, from the browser,
--        supabase.from('user_profiles').update({role:'admin'}).eq('user_id', uid)
--      and RLS permits it -> full cross-tenant admin on the next request.
--
-- WHY A TRIGGER (not a column REVOKE, not an RLS-policy edit)
--   Trace (read-only, exhaustive) proved role is NEVER written by any client OR
--   server code path:
--     * Initial profile row is created CLIENT-side by the authenticated client
--       (src/lib/auth.tsx fetchProfile -> insert{user_id,email,first_name,
--       last_name,brokerage}). role is OMITTED -> it takes the column DEFAULT
--       'user' (migration 001). There is NO handle_new_user / on_auth_user_created
--       trigger in this project.
--     * Every client UPDATE (identity {first_name,last_name,phone,email};
--       brand {brokerage,colors}; avatar_url; logo_url; presets) omits role.
--     * Every server (service_role) write (stripe webhook, api/properties,
--       api/account/profile) omits role. The lone admin was provisioned manually.
--   A column-level REVOKE would ALSO have to strip table-level INSERT/UPDATE and
--   re-GRANT an explicit column allowlist (Postgres: table priv overrides column
--   priv), which silently breaks the day any new column is added. The trigger:
--     * is column-agnostic (future columns keep working),
--     * clamps role regardless of what any current/future client sends,
--     * leaves the legitimate self-writes (identity/brand/avatar/logo/presets)
--       untouched (NEW.role := OLD.role is a no-op for them),
--     * still lets the server promote admins via service_role,
--     * is a database-enforced invariant, and does NOT alter any RLS policy
--       (so it needs no RLS-policy change-control gate).
--
-- current_user resolves to the SET-ROLE identity PostgREST installs per request
-- ('authenticated' | 'anon' | 'service_role'); direct DB/admin work runs as
-- 'postgres' / 'supabase_admin'. The function is SECURITY INVOKER (the default)
-- precisely so current_user reflects the real caller and is NOT rewritten to the
-- function owner.
--
-- IDEMPOTENT. Reversible via 100_user_profiles_role_escalation_fix_rollback.sql.
-- =============================================================================

-- --- 1. role-clamp trigger function -----------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_user_profiles_role_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER              -- MUST stay INVOKER so current_user = real caller
  SET search_path = public, pg_temp
AS $$
BEGIN
  -- Privileged server/admin identities may set role freely (admin provisioning,
  -- migrations). Everyone else is clamped.
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- New self-signup rows are forced to the safe default regardless of payload.
    NEW.role := 'user';
  ELSIF TG_OP = 'UPDATE' THEN
    -- role is immutable for non-privileged callers: pin it to the stored value.
    NEW.role := OLD.role;
  END IF;

  RETURN NEW;
END;
$$;

-- --- 2. attach it BEFORE INSERT OR UPDATE ------------------------------------
DROP TRIGGER IF EXISTS trg_enforce_user_profiles_role_immutable ON public.user_profiles;

CREATE TRIGGER trg_enforce_user_profiles_role_immutable
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_user_profiles_role_immutable();

-- --- 3. storage: harden the public 'user-logos' bucket -----------------------
-- Separate concern, same PR. Bucket verified EMPTY (0 objects) and currently
-- unrestricted (allowed_mime_types=NULL, file_size_limit=NULL), so tightening
-- breaks no existing brokerage logo / avatar. Restrict to raster image types
-- and a 5 MiB ceiling. Idempotent (plain UPDATE, no-op if already set).
-- NOTE: HEIC (common on iPhone camera uploads) is intentionally excluded per the
-- requested allowlist; if mobile avatar uploads must accept HEIC, add
-- 'image/heic'/'image/heif' here.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp','image/gif'],
    file_size_limit    = 5242880   -- 5 MiB
WHERE id = 'user-logos';
