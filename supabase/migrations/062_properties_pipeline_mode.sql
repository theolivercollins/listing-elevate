-- Migration 062 — properties.pipeline_mode
-- Adds an opt-in pipeline selector to switch a property into the v1.1
-- Seedance push-in path (with FFmpeg speed-ramp polish). Paired-scene
-- rule (kling-v2-1-pair) is preserved regardless of mode.
--
-- Spec: docs/specs/2026-05-23-v1.1-seedance-pushin-design.md

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS pipeline_mode TEXT NOT NULL DEFAULT 'v1';

ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_pipeline_mode_check;

ALTER TABLE properties
  ADD CONSTRAINT properties_pipeline_mode_check
  CHECK (pipeline_mode IN ('v1', 'v1.1'));

COMMENT ON COLUMN properties.pipeline_mode IS
  'Render-path selector. v1 = default mixed-movement routing across Kling/Runway/Atlas. v1.1 = Seedance push-in only with FFmpeg speed-ramp polish on every clip. Paired scenes (end_photo_id set) always route to Kling 2.1 regardless of mode.';
