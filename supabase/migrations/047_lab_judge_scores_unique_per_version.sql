-- 047_lab_judge_scores_unique_per_version.sql
-- Allow multiple judge_versions per iteration (calibration history). Replaces
-- the previous UNIQUE(iteration_id) which prevented re-scoring an iteration
-- with a new rubric version. Strictly additive — no row deletions.
--
-- Applied via Supabase MCP first per project convention, then committed.

ALTER TABLE lab_judge_scores DROP CONSTRAINT IF EXISTS lab_judge_scores_iteration_id_key;
ALTER TABLE lab_judge_scores
  ADD CONSTRAINT lab_judge_scores_iteration_judge_version_key
  UNIQUE (iteration_id, judge_version);
