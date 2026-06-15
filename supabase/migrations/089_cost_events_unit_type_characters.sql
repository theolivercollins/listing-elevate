-- 089_cost_events_unit_type_characters.sql
-- (renumbered from 088 to avoid a collision with 088_delivery_photo_selection_checkpoint.sql,
--  which landed on main first via PR #120.)
--
-- Root cause: lib/voiceover/generate-audio.ts (line ~155) calls
-- recordCostEvent({ unitType: "characters" }) for every ElevenLabs TTS render.
-- The existing constraint only allows:
--   NULL, 'tokens', 'credits', 'kling_units', 'renders'
-- So every voiceover cost_event insert hits a CHECK violation (23514) and is
-- silently swallowed by the .catch() at line 169 of generate-audio.ts.
-- Result: voiceover spend has NEVER been tracked in prod.
--
-- Fix: widen the allowed set to include:
--   'characters' — ElevenLabs TTS (chars billed per 1000)
--   'seconds'    — future audio/video providers (e.g. music generation)
--   'minutes'    — future audio/video providers (e.g. long-form video)
--
-- After applying this migration, all subsequent voiceover cost_event inserts
-- will succeed and voiceover spend will be tracked correctly.
--
-- Down-migration (rollback):
--   ALTER TABLE cost_events DROP CONSTRAINT IF EXISTS cost_events_unit_type_check;
--   ALTER TABLE cost_events ADD CONSTRAINT cost_events_unit_type_check
--     CHECK ((unit_type IS NULL) OR (unit_type = ANY (
--       ARRAY['tokens','credits','kling_units','renders']
--     )));

ALTER TABLE cost_events
  DROP CONSTRAINT IF EXISTS cost_events_unit_type_check;

ALTER TABLE cost_events
  ADD CONSTRAINT cost_events_unit_type_check
  CHECK ((unit_type IS NULL) OR (unit_type = ANY (ARRAY[
    'tokens',
    'credits',
    'kling_units',
    'renders',
    'characters',
    'seconds',
    'minutes'
  ])));
