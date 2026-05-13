-- 055: Music library for assembled videos.
-- One row per available music track + a FK on properties so the picked
-- track travels through the order pipeline.

CREATE TABLE IF NOT EXISTS music_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  file_url text NOT NULL,
  -- Mood tag drives the auto-pick logic per package (upbeat for just_listed,
  -- celebratory for just_closed, etc.). See lib/assembly/music.ts.
  mood_tag text NOT NULL
    CHECK (mood_tag IN ('upbeat', 'warm', 'celebratory', 'cinematic', 'neutral')),
  duration_seconds int,
  -- License metadata so we can prove royalty-free provenance later.
  license text,
  attribution text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_music_tracks_active_mood
  ON music_tracks (mood_tag) WHERE active = true;

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS music_track_id uuid REFERENCES music_tracks(id);

-- Seed rows. URLs point to SoundHelix public placeholders so smoke tests
-- work end-to-end. REPLACE WITH REAL ROYALTY-FREE TRACKS hosted in
-- Supabase Storage before launch.
INSERT INTO music_tracks (name, file_url, mood_tag, license, attribution, active)
VALUES
  ('Bright Beginnings',
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    'upbeat', 'SoundHelix free-use',
    'SoundHelix (smoke-test placeholder — REPLACE before launch)', true),
  ('Warm Welcome',
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    'warm', 'SoundHelix free-use',
    'SoundHelix (smoke-test placeholder — REPLACE before launch)', true),
  ('Sold Celebration',
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
    'celebratory', 'SoundHelix free-use',
    'SoundHelix (smoke-test placeholder — REPLACE before launch)', true),
  ('Cinematic Walkthrough',
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
    'cinematic', 'SoundHelix free-use',
    'SoundHelix (smoke-test placeholder — REPLACE before launch)', true),
  ('Neutral Underscore',
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
    'neutral', 'SoundHelix free-use',
    'SoundHelix (smoke-test placeholder — REPLACE before launch)', true)
ON CONFLICT DO NOTHING;
