-- 090_properties_video_model_sku.sql
--
-- Adds an optional operator-selected video model SKU to the properties table.
-- NULL (default) preserves the existing behaviour: the Atlas router selects
-- the provider SKU automatically per scene.  A non-NULL value pins every
-- scene of the listing to that SKU, bypassing router scoring.
--
-- No CHECK constraint is intentional: valid SKU keys evolve in app code and
-- are validated at ingest time by lib/providers/atlas.ts `getOperatorVideoSkus`.
-- Encoding a hard list here would require a migration on every SKU addition.
--
-- RLS posture: properties already has RLS enabled and policies in place from
-- earlier migrations; additive columns inherit the existing row-level security
-- without any policy changes.
--
-- Rollback: ALTER TABLE properties DROP COLUMN IF EXISTS video_model_sku;

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS video_model_sku text;

COMMENT ON COLUMN properties.video_model_sku IS
  'Operator-selected Atlas SKU applied to all scenes of the listing. '
  'NULL = automatic routing via the Atlas router (existing behaviour). '
  'Validated in app code by lib/providers/atlas.ts `getOperatorVideoSkus`; '
  'ingest rejects unknown SKUs before this column is written.';
