-- 057_operator_studio_scenes_followup.sql
-- Follow-up columns required by lib/operator-studio/clip-swap.ts (Task 10).
--
-- 1. scenes.replaced_at  — timestamp written when a clip-swap overwrites a
--    production scene clip.
-- 2. scenes.room_type    — denorm from photos.room_type so swapClip can do
--    the compatibility check in a single table hit instead of a JOIN.
-- 3. prompt_lab_listing_scene_iterations.room_type — denorm from parent
--    prompt_lab_listing_scenes.room_type for the same reason.
--
-- All backfills are gated on WHERE room_type IS NULL for idempotency.

BEGIN;

-- 1. scenes.replaced_at
ALTER TABLE public.scenes
  ADD COLUMN IF NOT EXISTS replaced_at TIMESTAMPTZ;

-- 2. scenes.room_type (backfill from photos via the existing photo_id FK)
ALTER TABLE public.scenes
  ADD COLUMN IF NOT EXISTS room_type TEXT;

UPDATE public.scenes
SET room_type = (
  SELECT p.room_type
  FROM public.photos p
  WHERE p.id = scenes.photo_id
)
WHERE room_type IS NULL;

-- 3. prompt_lab_listing_scene_iterations.room_type
--    (backfill from prompt_lab_listing_scenes via scene_id FK)
ALTER TABLE public.prompt_lab_listing_scene_iterations
  ADD COLUMN IF NOT EXISTS room_type TEXT;

UPDATE public.prompt_lab_listing_scene_iterations i
SET room_type = (
  SELECT s.room_type
  FROM public.prompt_lab_listing_scenes s
  WHERE s.id = i.scene_id
)
WHERE i.room_type IS NULL;

COMMIT;
