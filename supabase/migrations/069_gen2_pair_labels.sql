-- 069_gen2_pair_labels.sql
-- Operator (or autopilot) labels for a pair of photos.
-- Matches PairLabel type in lib/gen2-v21/types.ts.

CREATE TABLE IF NOT EXISTS public.gen2_pair_labels (
  label_id                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  listing_id                  uuid        NOT NULL,
  photo_a_id                  uuid        NOT NULL,
  photo_b_id                  uuid        NOT NULL,
  scene_graph_version         text        NOT NULL,
  model_version_at_prediction text,
  model_prediction_at_time    numeric,
  operator_verdict             text        NOT NULL,
  transition_tag               text,
  thumbnail_hash_a             text        NOT NULL,
  thumbnail_hash_b             text        NOT NULL,
  source_mode                  text        NOT NULL,
  apprentice_predicted_verdict text,
  apprentice_was_wrong         boolean,
  created_at                   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT gen2_pair_labels_pkey PRIMARY KEY (label_id),
  CONSTRAINT gen2_pair_labels_listing_fk
    FOREIGN KEY (listing_id) REFERENCES public.properties(id) ON DELETE CASCADE,
  CONSTRAINT gen2_pair_labels_photo_a_fk
    FOREIGN KEY (photo_a_id) REFERENCES public.photos(id) ON DELETE CASCADE,
  CONSTRAINT gen2_pair_labels_photo_b_fk
    FOREIGN KEY (photo_b_id) REFERENCES public.photos(id) ON DELETE CASCADE,
  CONSTRAINT gen2_pair_labels_operator_verdict_chk CHECK (
    operator_verdict IN ('good', 'bad', 'tie')
  ),
  CONSTRAINT gen2_pair_labels_apprentice_verdict_chk CHECK (
    apprentice_predicted_verdict IS NULL
    OR apprentice_predicted_verdict IN ('good', 'bad', 'tie')
  ),
  CONSTRAINT gen2_pair_labels_source_mode_chk CHECK (
    source_mode IN ('directors_cut', 'apprentice_review', 'autopilot_audit')
  ),
  CONSTRAINT gen2_pair_labels_model_pred_range_chk CHECK (
    model_prediction_at_time IS NULL
    OR (model_prediction_at_time >= 0 AND model_prediction_at_time <= 1)
  )
);

-- Primary read path: all labels for a listing ordered newest-first
CREATE INDEX IF NOT EXISTS gen2_pair_labels_listing_created_idx
  ON public.gen2_pair_labels (listing_id, created_at DESC);

-- Agreement tracker query
CREATE INDEX IF NOT EXISTS gen2_pair_labels_apprentice_wrong_idx
  ON public.gen2_pair_labels (listing_id, apprentice_was_wrong)
  WHERE apprentice_was_wrong IS NOT NULL;

COMMENT ON TABLE public.gen2_pair_labels IS
  'Operator (or autopilot) pair labels used to train and evaluate the V2.1 picker model. '
  'source_mode tracks which UX mode produced the label.';

NOTIFY pgrst, 'reload schema';
