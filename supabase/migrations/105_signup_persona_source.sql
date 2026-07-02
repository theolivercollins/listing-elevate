-- 105_signup_persona_source.sql
--
-- What:  Adds three optional onboarding-metadata columns to `user_profiles`:
--          - persona              (which persona the user self-selected)
--          - signup_source        (how they heard about us — category)
--          - signup_source_detail (the specific sub-choice, e.g. "Google")
--        All are nullable, no defaults, no backfill; purely additive.
--
-- Why:   The redesigned immersive signup/onboarding flow captures a persona
--        picker and an acquisition source. These are analytics/personalization
--        fields only. They are DELIBERATELY separate from the existing `role`
--        column, which is the admin/user security gate wired into RLS and is
--        NOT touched here.
--
-- Safety: ADD COLUMN IF NOT EXISTS is idempotent; the CHECK allows NULL so
--         existing rows remain valid. The app-side onboarding writer degrades
--         gracefully if this migration has not yet been applied.
--
-- Rollback:
--   ALTER TABLE user_profiles DROP COLUMN IF EXISTS signup_source_detail;
--   ALTER TABLE user_profiles DROP COLUMN IF EXISTS signup_source;
--   ALTER TABLE user_profiles DROP COLUMN IF EXISTS persona;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS persona text
  CHECK (persona IS NULL OR persona IN ('agent', 'team_leader', 'broker', 'marketing'));

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS signup_source text;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS signup_source_detail text;
