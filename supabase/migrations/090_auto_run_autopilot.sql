-- Autopilot / auto-run mode for delivery_runs (operator dashboard)
ALTER TABLE delivery_runs
  ADD COLUMN IF NOT EXISTS auto_run boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paused_reason text,
  ADD COLUMN IF NOT EXISTS auto_paused_at timestamptz;

COMMENT ON COLUMN delivery_runs.auto_run IS 'When true, AI autopilot resolves each gate instead of waiting for a human operator.';
COMMENT ON COLUMN delivery_runs.paused_reason IS 'Non-null when autopilot paused at a gate for a human (low confidence); null = live or manual.';
COMMENT ON COLUMN delivery_runs.auto_paused_at IS 'Timestamp autopilot paused for a human.';

-- Extend ml_events.event_type CHECK to include autopilot event types.
-- Drop and re-add with the full value list (pattern from migrations 082, 088).
alter table ml_events
  drop constraint if exists ml_events_event_type_check;

alter table ml_events
  add constraint ml_events_event_type_check
  check (event_type in (
    'photo_selection','reorder','regenerate','variant_override','script_edit',
    'voice_choice','music_choice','rating','comment','details_edit',
    'music_feedback',
    'auto_pause','auto_advance','auto_resume'
  ));
