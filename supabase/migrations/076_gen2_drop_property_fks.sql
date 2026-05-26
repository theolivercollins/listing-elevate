-- 076_gen2_drop_property_fks.sql
-- Drop FK constraints on V2 tables that pointed to properties(id) and photos(id).
-- V2 (gen2-v21) needs to work on both real property listings AND prompt_lab_listings,
-- whose photos live in prompt_lab_listing_photos rather than photos. The strict FKs
-- were preventing lab listings from being used in the scene-graph / labeling pipeline.

-- ── listing_id FKs (properties → unrestricted uuid) ───────────────────────────

ALTER TABLE public.gen2_scene_graphs
  DROP CONSTRAINT IF EXISTS gen2_scene_graphs_listing_fk;

ALTER TABLE public.gen2_pair_candidates
  DROP CONSTRAINT IF EXISTS gen2_pair_candidates_listing_fk;

ALTER TABLE public.gen2_pair_labels
  DROP CONSTRAINT IF EXISTS gen2_pair_labels_listing_fk;

ALTER TABLE public.gen2_apprentice_predictions
  DROP CONSTRAINT IF EXISTS gen2_apprentice_predictions_listing_fk;

-- ── photo_id FKs (photos → unrestricted uuid) ─────────────────────────────────

ALTER TABLE public.gen2_pair_candidates
  DROP CONSTRAINT IF EXISTS gen2_pair_candidates_photo_a_fk;

ALTER TABLE public.gen2_pair_candidates
  DROP CONSTRAINT IF EXISTS gen2_pair_candidates_photo_b_fk;

ALTER TABLE public.gen2_pair_labels
  DROP CONSTRAINT IF EXISTS gen2_pair_labels_photo_a_fk;

ALTER TABLE public.gen2_pair_labels
  DROP CONSTRAINT IF EXISTS gen2_pair_labels_photo_b_fk;

NOTIFY pgrst, 'reload schema';
