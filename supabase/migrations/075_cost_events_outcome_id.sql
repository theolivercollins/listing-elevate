-- 075_cost_events_outcome_id.sql
-- Add cost_events.outcome_id so V2.1 paired-render spend (Atlas takes,
-- guardrail retries, outcome judge) can be attributed back to the
-- gen2_render_outcomes row that triggered the call.
--
-- Pre-migration: every cost_events row for an Atlas pair render had
-- outcome_id implicit-only (buried in metadata.pair_label_id), so
-- gen2_render_outcomes.cost_cents stayed 0 and per-outcome cost
-- reporting was broken.
--
-- Nullable + ON DELETE SET NULL: cost rows for one-off Lab calls or
-- pipeline stages outside the V2.1 worker keep outcome_id NULL.
-- Outcome deletes don't cascade-wipe the audit trail.

ALTER TABLE cost_events
  ADD COLUMN IF NOT EXISTS outcome_id uuid
    REFERENCES gen2_render_outcomes(outcome_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cost_events_outcome_id_idx
  ON cost_events (outcome_id)
  WHERE outcome_id IS NOT NULL;
