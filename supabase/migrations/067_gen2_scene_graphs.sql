-- 067_gen2_scene_graphs.sql
-- Stores the full PropertySceneGraph payload produced by Gemini 2.5 Pro per listing.
-- One row per listing (PK = listing_id). Re-extract overwrites the row.

CREATE TABLE IF NOT EXISTS public.gen2_scene_graphs (
  listing_id    uuid        NOT NULL,
  payload       jsonb       NOT NULL,
  model_version text        NOT NULL,
  extracted_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT gen2_scene_graphs_pkey PRIMARY KEY (listing_id),
  CONSTRAINT gen2_scene_graphs_listing_fk
    FOREIGN KEY (listing_id) REFERENCES public.properties(id) ON DELETE CASCADE
);

-- Fast lookup by extraction recency (e.g. "stale" re-extracts)
CREATE INDEX IF NOT EXISTS gen2_scene_graphs_extracted_at_idx
  ON public.gen2_scene_graphs (extracted_at DESC);

-- JSONB index for room-confidence queries inside payload
CREATE INDEX IF NOT EXISTS gen2_scene_graphs_payload_gin_idx
  ON public.gen2_scene_graphs USING GIN (payload);

COMMENT ON TABLE public.gen2_scene_graphs IS
  'V2.1 scene graph per listing. Payload follows PropertySceneGraph from lib/gen2-v21/types.ts. '
  'One row per listing; upserted on re-extract. NOT applied to remote in sprint 2026-05-23.';

NOTIFY pgrst, 'reload schema';
