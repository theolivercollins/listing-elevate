-- 073: Music track provenance — support the C-pooled music strategy.
--
-- The C-pooled strategy (docs/plans/2026-06-01-create-listing-finalize-plan.md)
-- pre-generates a pool of ElevenLabs Music tracks per mood and stores them here,
-- replacing the SoundHelix smoke-test placeholders. These columns let us track
-- where each track came from and (for AI tracks) the prompt that produced it,
-- and lay groundwork for a future operator-upload ("Option A") flow.

ALTER TABLE music_tracks
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'placeholder'
    CHECK (source IN ('placeholder', 'elevenlabs_music', 'upload', 'library')),
  ADD COLUMN IF NOT EXISTS prompt text,
  -- Free-form genre label for the future operator-upload flow. Distinct from
  -- mood_tag (which drives auto-pick); genre is descriptive ("Ambient", "Lo-fi").
  ADD COLUMN IF NOT EXISTS genre text;

-- Tag the existing SoundHelix seed rows as placeholders so the generation
-- script (scripts/generate-music-pool.ts) can deactivate them once real
-- ElevenLabs Music tracks are inserted.
UPDATE music_tracks
  SET source = 'placeholder'
  WHERE attribution ILIKE '%placeholder%' AND source = 'placeholder';
