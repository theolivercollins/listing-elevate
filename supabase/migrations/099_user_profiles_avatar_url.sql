-- 099_user_profiles_avatar_url.sql
-- Adds a nullable avatar_url column to user_profiles so each user can set a
-- personal profile photo (uploaded to Supabase Storage bucket `user-logos`,
-- same bucket/RLS pattern as the existing brokerage `logo_url` column —
-- path convention `${user_id}/avatar.<ext>` so the existing storage.objects
-- policies (`auth.uid()::text = (storage.foldername(name))[1]`) apply
-- unchanged. Idempotent — safe to re-run.
--
-- NOT YET APPLIED to any environment. Apply via Supabase MCP / CLI before
-- shipping the avatar-upload UI (docs/HANDOFF.md follow-up).

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;
