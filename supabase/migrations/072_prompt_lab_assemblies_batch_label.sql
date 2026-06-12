-- Migration 072 — Prompt Lab batch-level Director assemblies
--
-- Relaxes prompt_lab_assemblies.session_id to NULL and adds batch_label
-- so a single assembly row can represent a Director output assembled from
-- iterations across multiple sessions in the same batch.
--
-- Constraint: every row must have either session_id (single-session
-- assembly) OR batch_label (cross-session batch assembly). Not both null.
--
-- Spec: docs/specs/2026-05-26-lab-director-batch-ux-polish-design.md (extension)

ALTER TABLE prompt_lab_assemblies
  ALTER COLUMN session_id DROP NOT NULL;

ALTER TABLE prompt_lab_assemblies
  ADD COLUMN IF NOT EXISTS batch_label TEXT;

ALTER TABLE prompt_lab_assemblies
  DROP CONSTRAINT IF EXISTS prompt_lab_assemblies_scope_check;

ALTER TABLE prompt_lab_assemblies
  ADD CONSTRAINT prompt_lab_assemblies_scope_check
  CHECK (session_id IS NOT NULL OR batch_label IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_prompt_lab_assemblies_batch
  ON prompt_lab_assemblies (batch_label, created_at DESC)
  WHERE batch_label IS NOT NULL;

COMMENT ON COLUMN prompt_lab_assemblies.batch_label IS
  'Set when the assembly was produced from iterations across multiple sessions sharing this batch_label. Mutually exclusive with session_id (one or both must be set). iteration_order references prompt_lab_iterations.id values whose parent sessions all share this batch_label.';
