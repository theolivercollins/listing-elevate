-- 091_scenes_atlas_model_sku.sql
--
-- Adds a nullable column to scenes recording the Atlas SKU key that was
-- actually used for a scene's successful render submit.  The cost-recording
-- poll path (api/cron/poll-scenes.ts) and the delivery A/B path
-- (lib/delivery/variants.ts) read this column to attribute
-- cost_events.cost_cents to the rendered SKU rather than the env-default
-- ATLAS_VIDEO_MODEL, which may differ from what was actually dispatched
-- (e.g. when a per-property override or a delivery variant selects a
-- different SKU at submit time).
--
-- No CHECK constraint: valid SKU strings evolve in app code; hard-coding
-- them here would require a migration on every SKU addition (same rationale
-- as migration 090 for properties.video_model_sku).
--
-- RLS posture: scenes already has RLS enabled; additive columns inherit
-- existing row-level security without any policy change.
--
-- Rollback: ALTER TABLE scenes DROP COLUMN IF EXISTS atlas_model_sku;

ALTER TABLE scenes
  ADD COLUMN IF NOT EXISTS atlas_model_sku text;

COMMENT ON COLUMN scenes.atlas_model_sku IS
  'Atlas SKU key (e.g. ''seedance-2-0-4k'', ''kling-v3-pro'') actually used '
  'for this scene''s successful render submit. '
  'Consumed by api/cron/poll-scenes.ts and lib/delivery/variants.ts to '
  'attribute cost_events.cost_cents to the rendered SKU rather than the '
  'ATLAS_VIDEO_MODEL env default. '
  'NULL for non-Atlas providers and for rows created before this migration.';
