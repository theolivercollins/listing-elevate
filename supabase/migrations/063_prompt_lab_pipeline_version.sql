-- Migration 063 — Prompt Lab v1 / v1.1 version scoping
-- Tags listings, iterations, and recipes by which pipeline produced them so
-- v1 and v1.1 learning loops do not cross-contaminate. Default 'v1' so all
-- existing rows backfill cleanly.
--
-- Spec: docs/specs/2026-05-23-prompt-lab-version-toggle-design.md

-- 1. Listings
ALTER TABLE prompt_lab_listings
  ADD COLUMN IF NOT EXISTS pipeline_version TEXT NOT NULL DEFAULT 'v1';

ALTER TABLE prompt_lab_listings
  DROP CONSTRAINT IF EXISTS prompt_lab_listings_pipeline_version_check;

ALTER TABLE prompt_lab_listings
  ADD CONSTRAINT prompt_lab_listings_pipeline_version_check
  CHECK (pipeline_version IN ('v1', 'v1.1'));

COMMENT ON COLUMN prompt_lab_listings.pipeline_version IS
  'Pinned at listing creation. v1 = legacy mixed-movement routing across Kling/Runway/Atlas SKUs. v1.1 = Seedance 2.0 push-in only with FFmpeg speed-ramp polish. Iterations and recipes inherit this value.';

-- 2. Iterations
ALTER TABLE prompt_lab_listing_scene_iterations
  ADD COLUMN IF NOT EXISTS pipeline_version TEXT NOT NULL DEFAULT 'v1';

ALTER TABLE prompt_lab_listing_scene_iterations
  DROP CONSTRAINT IF EXISTS prompt_lab_listing_scene_iterations_pipeline_version_check;

ALTER TABLE prompt_lab_listing_scene_iterations
  ADD CONSTRAINT prompt_lab_listing_scene_iterations_pipeline_version_check
  CHECK (pipeline_version IN ('v1', 'v1.1'));

CREATE INDEX IF NOT EXISTS idx_prompt_lab_iterations_pipeline_version
  ON prompt_lab_listing_scene_iterations (pipeline_version);

COMMENT ON COLUMN prompt_lab_listing_scene_iterations.pipeline_version IS
  'Inherited from parent listing. Used to scope retrieval (v1.1 only retrieves v1.1 recipes) and to skip Thompson router writes for v1.1 (single SKU, no exploration).';

-- 3. Recipes — promoted from ≥4★ ratings; must stay version-scoped so a v1.1
--    push-in recipe doesn't leak into v1's mixed-movement retrieval.
ALTER TABLE prompt_lab_recipes
  ADD COLUMN IF NOT EXISTS pipeline_version TEXT NOT NULL DEFAULT 'v1';

ALTER TABLE prompt_lab_recipes
  DROP CONSTRAINT IF EXISTS prompt_lab_recipes_pipeline_version_check;

ALTER TABLE prompt_lab_recipes
  ADD CONSTRAINT prompt_lab_recipes_pipeline_version_check
  CHECK (pipeline_version IN ('v1', 'v1.1'));

CREATE INDEX IF NOT EXISTS idx_prompt_lab_recipes_pipeline_version
  ON prompt_lab_recipes (pipeline_version);

COMMENT ON COLUMN prompt_lab_recipes.pipeline_version IS
  'Inherited from the iteration that produced this recipe. Retrieval at render time filters by version so v1.1 renders only see v1.1 recipes.';
