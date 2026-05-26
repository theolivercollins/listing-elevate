-- Migration 070 — v1.1 quality tracking + qualitative model feedback
--
-- Two things:
-- (1) resolution_used column on both Lab iteration tables so we record
--     what resolution each render was submitted at (now that v1.1 lets
--     the operator pick 720p / 1080p / 4K per render).
-- (2) prompt_lab_model_feedback table — append-only qualitative notes
--     the operator types under each rendered clip. Version-scoped per
--     Oliver's isolation rule. Embedding column gets backfilled async
--     by an embed worker (or via a backfill script) for similarity
--     retrieval in the director context.
--
-- Spec: docs/specs/2026-05-24-v1.1-quality-veo-feedback-design.md

-- ─── 1. resolution_used columns ─────────────────────────────────────────
ALTER TABLE prompt_lab_iterations
  ADD COLUMN IF NOT EXISTS resolution_used TEXT;

ALTER TABLE prompt_lab_listing_scene_iterations
  ADD COLUMN IF NOT EXISTS resolution_used TEXT;

COMMENT ON COLUMN prompt_lab_iterations.resolution_used IS
  'Render resolution the operator picked at submit time. NULL on rows predating migration 070; read-side defaults to "1080p" for display. Values: "480p" | "720p" | "1080p" | "4k".';

-- ─── 2. prompt_lab_model_feedback ───────────────────────────────────────
-- Requires pgvector extension (already enabled for prompt_lab_iterations.embedding).
CREATE TABLE IF NOT EXISTS prompt_lab_model_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  iteration_id UUID NOT NULL REFERENCES prompt_lab_iterations(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES prompt_lab_sessions(id) ON DELETE CASCADE,
  model_used TEXT NOT NULL,
  pipeline_version TEXT NOT NULL DEFAULT 'v1',
  resolution_used TEXT,
  author TEXT NOT NULL,
  comment TEXT NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prompt_lab_model_feedback_pipeline_version_check
    CHECK (pipeline_version IN ('v1', 'v1.1'))
);

CREATE INDEX IF NOT EXISTS idx_plmf_model
  ON prompt_lab_model_feedback (model_used, pipeline_version, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plmf_session
  ON prompt_lab_model_feedback (session_id);
CREATE INDEX IF NOT EXISTS idx_plmf_iteration
  ON prompt_lab_model_feedback (iteration_id);
CREATE INDEX IF NOT EXISTS idx_plmf_embedding
  ON prompt_lab_model_feedback USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

COMMENT ON TABLE prompt_lab_model_feedback IS
  'Append-only qualitative feedback the operator writes under each rendered Lab clip. Embedded for similarity retrieval; surfaced in director context so the next render sees prior notes on the same model. Version-scoped so v1 and v1.1 feedback stay isolated per the Lab pipeline_version rule.';
