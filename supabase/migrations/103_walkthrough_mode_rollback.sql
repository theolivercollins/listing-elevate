-- Rollback for 103_walkthrough_mode.sql
--
-- IMPORTANT: run this only after confirming no row has
-- pipeline_mode='walkthrough' (or after migrating those rows back to 'v1')
-- — the restored CHECK constraint will reject 'walkthrough' rows in flight.

ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_pipeline_mode_check;

ALTER TABLE properties
  ADD CONSTRAINT properties_pipeline_mode_check
  CHECK (pipeline_mode IN ('v1', 'v1.1'));

ALTER TABLE properties DROP COLUMN IF EXISTS walkthrough_status;
ALTER TABLE properties DROP COLUMN IF EXISTS walkthrough_video_url;
ALTER TABLE properties DROP COLUMN IF EXISTS walkthrough_job_id;
ALTER TABLE properties DROP COLUMN IF EXISTS walkthrough_error;
ALTER TABLE properties DROP COLUMN IF EXISTS walkthrough_updated_at;
