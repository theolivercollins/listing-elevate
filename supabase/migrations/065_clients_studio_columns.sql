-- migration 065: align clients table with operator-studio expectations
--
-- Context: migration 062_operator_studio.sql declared `CREATE TABLE IF NOT EXISTS
-- clients` with a brand/operator-studio shape, but the prod `clients` table was
-- already created earlier for the Sierra Interactive integration (sierra_admin_*,
-- agent_*, brand_color_primary). The CREATE was a no-op, so the operator-studio
-- columns (brand_primary_hex, brand_logo_url, monthly_rate_cents, voice_id, etc.)
-- never landed. Result: /studio/clients and the Studio Queue 500 with
-- `column clients_1.brand_primary_hex does not exist`.
--
-- Fix: purely additive ALTERs that bring the existing clients table up to the
-- shape the operator-studio code expects. Both features (Sierra publishing +
-- operator-studio video pipeline) share one client entity, which matches the
-- business model (a Listing Elevate customer can use both).
--
-- Backfill: copy brand_color_primary -> brand_primary_hex and agent_photo_url
-- -> agent_headshot_url for existing rows so the one shipped Sierra client
-- renders correctly in the Studio UI.

BEGIN;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS contact_email      text,
  ADD COLUMN IF NOT EXISTS phone              text,
  ADD COLUMN IF NOT EXISTS monthly_rate_cents integer,
  ADD COLUMN IF NOT EXISTS notes              text,
  ADD COLUMN IF NOT EXISTS brand_logo_url     text,
  ADD COLUMN IF NOT EXISTS brand_primary_hex  text,
  ADD COLUMN IF NOT EXISTS brand_secondary_hex text,
  ADD COLUMN IF NOT EXISTS agent_headshot_url text,
  ADD COLUMN IF NOT EXISTS voice_id           text,
  ADD COLUMN IF NOT EXISTS archived_at        timestamptz;

UPDATE public.clients
   SET brand_primary_hex = brand_color_primary
 WHERE brand_primary_hex IS NULL
   AND brand_color_primary IS NOT NULL;

UPDATE public.clients
   SET agent_headshot_url = agent_photo_url
 WHERE agent_headshot_url IS NULL
   AND agent_photo_url IS NOT NULL;

COMMIT;
