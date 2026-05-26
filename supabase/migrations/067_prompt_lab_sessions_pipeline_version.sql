-- Migration 064 — Prompt Lab sessions + iterations pipeline_version
-- Extends the v1/v1.1 version-scoping from migration 063 to the *session-based*
-- Prompt Lab tables (prompt_lab_sessions, prompt_lab_iterations). These are
-- distinct from the listing-based tables (prompt_lab_listings,
-- prompt_lab_listing_scene_iterations) tagged in 063.
--
-- Spec: docs/specs/2026-05-23-prompt-lab-version-toggle-design.md §1

-- 1. Sessions
ALTER TABLE prompt_lab_sessions
  ADD COLUMN IF NOT EXISTS pipeline_version TEXT NOT NULL DEFAULT 'v1';

ALTER TABLE prompt_lab_sessions
  DROP CONSTRAINT IF EXISTS prompt_lab_sessions_pipeline_version_check;

ALTER TABLE prompt_lab_sessions
  ADD CONSTRAINT prompt_lab_sessions_pipeline_version_check
  CHECK (pipeline_version IN ('v1', 'v1.1'));

COMMENT ON COLUMN prompt_lab_sessions.pipeline_version IS
  'Pinned at session creation. v1 = legacy mixed-movement routing (Kling/Runway/Atlas). v1.1 = Seedance 2.0 push-in only with FFmpeg speed-ramp polish. Existing rows default to v1.';

-- 2. Iterations (inherit from parent session)
ALTER TABLE prompt_lab_iterations
  ADD COLUMN IF NOT EXISTS pipeline_version TEXT NOT NULL DEFAULT 'v1';

ALTER TABLE prompt_lab_iterations
  DROP CONSTRAINT IF EXISTS prompt_lab_iterations_pipeline_version_check;

ALTER TABLE prompt_lab_iterations
  ADD CONSTRAINT prompt_lab_iterations_pipeline_version_check
  CHECK (pipeline_version IN ('v1', 'v1.1'));

CREATE INDEX IF NOT EXISTS idx_prompt_lab_iterations_pipeline_version
  ON prompt_lab_iterations (pipeline_version);

COMMENT ON COLUMN prompt_lab_iterations.pipeline_version IS
  'Inherited from parent session. v1.1 overrides SKU to seedance-pro-pushin and forces push-in camera movement.';
