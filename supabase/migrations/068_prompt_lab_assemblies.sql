-- Migration 068 — Prompt Lab Director assemblies
-- Tracks each assembled MP4 produced by the new Director (Edit) modal in v1.1
-- sessions. Stores the ordered iteration list, the assembly status, the
-- output URL, and the version of the pipeline that produced it.
--
-- Spec: docs/specs/2026-05-24-prompt-lab-v1.1-director-design.md §4

CREATE TABLE IF NOT EXISTS prompt_lab_assemblies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES prompt_lab_sessions(id) ON DELETE CASCADE,
  iteration_order UUID[] NOT NULL,
  assembled_url TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  duration_seconds NUMERIC,
  pipeline_version TEXT NOT NULL DEFAULT 'v1.1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT prompt_lab_assemblies_status_check
    CHECK (status IN ('queued', 'assembling', 'complete', 'failed')),
  CONSTRAINT prompt_lab_assemblies_pipeline_version_check
    CHECK (pipeline_version IN ('v1', 'v1.1'))
);

CREATE INDEX IF NOT EXISTS idx_prompt_lab_assemblies_session
  ON prompt_lab_assemblies (session_id, created_at DESC);

COMMENT ON TABLE prompt_lab_assemblies IS
  'One row per Director (Edit) assembly. Tracks the ordered iteration list, output URL, and status. v1.1 sessions only at MVP; pipeline_version column exists for future v1 director support.';

COMMENT ON COLUMN prompt_lab_assemblies.iteration_order IS
  'Ordered array of prompt_lab_iterations.id values; assembly concatenates them in this order. Duplicates allowed (a clip may appear more than once in a sequence).';
