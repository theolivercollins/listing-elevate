-- Migration 071 — Prompt Lab Listings Director assemblies
-- Sibling of prompt_lab_assemblies (migration 068). Same shape, but FK'd
-- to prompt_lab_listings (a "batch"/property in the Listings Lab) instead
-- of prompt_lab_sessions. The iteration_order array holds
-- prompt_lab_listing_scene_iterations.id values.
--
-- Spec: docs/specs/2026-05-26-lab-director-batch-ux-polish-design.md

CREATE TABLE IF NOT EXISTS prompt_lab_listing_assemblies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES prompt_lab_listings(id) ON DELETE CASCADE,
  iteration_order UUID[] NOT NULL,
  assembled_url TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  duration_seconds NUMERIC,
  pipeline_version TEXT NOT NULL DEFAULT 'v1.1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT plla_status_check
    CHECK (status IN ('queued', 'assembling', 'complete', 'failed')),
  CONSTRAINT plla_pipeline_version_check
    CHECK (pipeline_version IN ('v1', 'v1.1'))
);

CREATE INDEX IF NOT EXISTS idx_plla_listing
  ON prompt_lab_listing_assemblies (listing_id, created_at DESC);

COMMENT ON TABLE prompt_lab_listing_assemblies IS
  'One row per Director (Edit) assembly in the Listings Lab. Mirrors prompt_lab_assemblies but FK-d to prompt_lab_listings. iteration_order references prompt_lab_listing_scene_iterations.id values.';
