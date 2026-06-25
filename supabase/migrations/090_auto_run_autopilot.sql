-- Autopilot / auto-run mode for delivery_runs (operator dashboard)
ALTER TABLE delivery_runs
  ADD COLUMN IF NOT EXISTS auto_run boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paused_reason text,
  ADD COLUMN IF NOT EXISTS auto_paused_at timestamptz;

COMMENT ON COLUMN delivery_runs.auto_run IS 'When true, AI autopilot resolves each gate instead of waiting for a human operator.';
COMMENT ON COLUMN delivery_runs.paused_reason IS 'Non-null when autopilot paused at a gate for a human (low confidence); null = live or manual.';
COMMENT ON COLUMN delivery_runs.auto_paused_at IS 'Timestamp autopilot paused for a human.';
