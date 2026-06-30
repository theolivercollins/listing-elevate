-- 092_scene_variants_atlas_model_sku.sql
--
-- Adds a nullable column to scene_variants recording the Atlas SKU key that
-- was actually used for this variant's render submit.  The delivery poll path
-- (lib/delivery/variants.ts pollPendingVariants) reads this column to
-- attribute cost_events.cost_cents to the rendered SKU rather than the
-- env-default ATLAS_VIDEO_MODEL, which may differ from what was actually
-- dispatched (e.g. when a delivery A/B pair submits variant A and variant B
-- on different SKUs at submit time).
--
-- Companion to migration 091 which added the same column to scenes; that
-- migration covers the scenes table but PostgREST rejects variant upserts
-- (PGRST204) without this column present on scene_variants.
--
-- No CHECK constraint: valid SKU strings evolve in app code; hard-coding
-- them here would require a migration on every SKU addition (same rationale
-- as migration 090 for properties.video_model_sku and migration 091).
--
-- RLS posture: scene_variants already has RLS enabled (migration 080);
-- additive columns inherit existing row-level security without any policy
-- change.
--
-- Rollback: ALTER TABLE scene_variants DROP COLUMN IF EXISTS atlas_model_sku;

ALTER TABLE scene_variants
  ADD COLUMN IF NOT EXISTS atlas_model_sku text;

COMMENT ON COLUMN scene_variants.atlas_model_sku IS
  'Atlas SKU key (e.g. ''seedance-2-0-4k'', ''kling-v3-pro'') actually used '
  'for this variant''s render submit. '
  'Read by lib/delivery/variants.ts pollPendingVariants to attribute '
  'cost_events.cost_cents to the rendered SKU rather than the ATLAS_VIDEO_MODEL '
  'env default. '
  'NULL for non-Atlas providers and for rows created before this migration.';
