-- 054: Persist order-form fields on properties.
-- Before this migration, the Upload form collected 9 order-specific fields
-- (package, duration, orientation, voiceover toggles, custom request,
-- days_on_market, sold_price) and threw them away on submit. The pipeline
-- already reads selected_duration optimistically and defaults to 60s on
-- miss; this migration removes the silent default by making the value
-- explicit on every property row.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS selected_package text,
  ADD COLUMN IF NOT EXISTS selected_duration int,
  ADD COLUMN IF NOT EXISTS selected_orientation text,
  ADD COLUMN IF NOT EXISTS add_voiceover boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS add_voice_clone boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS add_custom_request boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS custom_request_text text,
  ADD COLUMN IF NOT EXISTS days_on_market int,
  ADD COLUMN IF NOT EXISTS sold_price int;

-- Constrain duration to the three values the order form actually sells.
-- Null is allowed for legacy rows + drive-link flows that don't go through
-- the order form yet.
ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_selected_duration_check;

ALTER TABLE properties
  ADD CONSTRAINT properties_selected_duration_check
  CHECK (selected_duration IS NULL OR selected_duration IN (15, 30, 60));

-- Constrain orientation similarly. "vertical" + "horizontal" + "both" cover
-- the three options surfaced in src/pages/Upload.tsx.
ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_selected_orientation_check;

ALTER TABLE properties
  ADD CONSTRAINT properties_selected_orientation_check
  CHECK (selected_orientation IS NULL OR selected_orientation IN ('vertical', 'horizontal', 'both'));

-- Same for the four packages the form sells.
ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_selected_package_check;

ALTER TABLE properties
  ADD CONSTRAINT properties_selected_package_check
  CHECK (selected_package IS NULL OR selected_package IN ('just_listed', 'just_pended', 'just_closed', 'life_cycle'));
