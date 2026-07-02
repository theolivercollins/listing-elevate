-- 099_user_profiles_avatar_url_rollback.sql
-- Down-migration for 099_user_profiles_avatar_url.sql.
-- Drops the personal-avatar column added to user_profiles.
-- Safe/idempotent — only affects the avatar_url column; brokerage logo_url untouched.

ALTER TABLE public.user_profiles
  DROP COLUMN IF EXISTS avatar_url;
