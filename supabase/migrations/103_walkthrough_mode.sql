-- Migration 103 — walkthrough pipeline mode
--
-- Adds an opt-in "walkthrough" pipeline_mode: a SINGLE continuous
-- multi-reference walkthrough video generated from a property's photos via
-- Bytedance Seedance 2.0 "reference-to-video" (Atlas Cloud SKU
-- `seedance-reference-walkthrough`), instead of the per-scene v1/v1.1
-- pipeline. Fully additive — v1 and v1.1 behavior is untouched.
--
-- Idempotent by construction: safe to re-run. Constraint name matches the
-- one created by migration 062_properties_pipeline_mode.sql
-- (properties_pipeline_mode_check), dropped and recreated with the extra
-- allowed value.
--
-- Spec: docs/specs (walkthrough mode, added 2026-07-01).
-- Rollback: see 103_walkthrough_mode_rollback.sql — restores the
-- v1/v1.1-only CHECK constraint (fails if any row already has
-- pipeline_mode='walkthrough'; migrate those rows back to 'v1' first) and
-- drops the walkthrough_* columns.

ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_pipeline_mode_check;

ALTER TABLE properties
  ADD CONSTRAINT properties_pipeline_mode_check
  CHECK (pipeline_mode IN ('v1', 'v1.1', 'walkthrough'));

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS walkthrough_status TEXT;

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS walkthrough_video_url TEXT;

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS walkthrough_job_id TEXT;

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS walkthrough_error TEXT;

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS walkthrough_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN properties.pipeline_mode IS
  'Render-path selector. v1 = default mixed-movement routing across Kling/Runway/Atlas. v1.1 = Seedance push-in only with FFmpeg speed-ramp polish on every clip. walkthrough = single continuous multi-reference Seedance 2.0 reference-to-video walkthrough (async job tracked via walkthrough_* columns), bypassing the per-scene pipeline entirely. Paired scenes (end_photo_id set) always route to Kling 2.1 regardless of mode (n/a for walkthrough, which has no scenes).';

COMMENT ON COLUMN properties.walkthrough_status IS
  'Async job state for pipeline_mode=''walkthrough'': null (no job submitted yet) | processing | complete | failed. Set by lib/walkthrough/generate.ts submitWalkthrough()/pollWalkthrough() — never written synchronously in a request handler (Atlas render exceeds Vercel''s 300s maxDuration).';

COMMENT ON COLUMN properties.walkthrough_video_url IS
  'Final Bunny Stream (or, on Bunny failure, raw Atlas provider) MP4 URL for the completed walkthrough render. Null until walkthrough_status=''complete''.';

COMMENT ON COLUMN properties.walkthrough_job_id IS
  'Atlas Cloud prediction id for the in-flight/most-recent walkthrough render (seedance-reference-walkthrough SKU). Used by pollWalkthrough() to check status.';

COMMENT ON COLUMN properties.walkthrough_error IS
  'Human-readable error when walkthrough_status=''failed''. Cleared on a fresh submitWalkthrough() call.';

COMMENT ON COLUMN properties.walkthrough_updated_at IS
  'Timestamp of the last walkthrough_status transition (submit, poll-complete, or poll-failed).';
