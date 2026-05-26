-- 072_gen2_apprentice_predictions.sql
-- Gemini 2.5 Pro Apprentice predictions for pair candidates before operator review.
-- Matches ApprenticePrediction type + agreement tracking fields from lib/gen2-v21/types.ts.

CREATE TABLE IF NOT EXISTS public.gen2_apprentice_predictions (
  prediction_id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  candidate_id             uuid        NOT NULL,
  listing_id               uuid        NOT NULL,
  predicted_verdict        text        NOT NULL,
  predicted_transition_tag text,
  confidence               numeric,
  reasoning                text,
  model_version            text,
  few_shot_label_ids       uuid[]      NOT NULL DEFAULT '{}',
  agreement_with_operator  boolean,
  created_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT gen2_apprentice_predictions_pkey PRIMARY KEY (prediction_id),
  CONSTRAINT gen2_apprentice_predictions_candidate_fk
    FOREIGN KEY (candidate_id) REFERENCES public.gen2_pair_candidates(candidate_id) ON DELETE CASCADE,
  CONSTRAINT gen2_apprentice_predictions_listing_fk
    FOREIGN KEY (listing_id) REFERENCES public.properties(id) ON DELETE CASCADE,
  CONSTRAINT gen2_apprentice_predictions_verdict_chk CHECK (
    predicted_verdict IN ('good', 'bad', 'tie')
  ),
  CONSTRAINT gen2_apprentice_predictions_confidence_range_chk CHECK (
    confidence IS NULL
    OR (confidence >= 0 AND confidence <= 1)
  )
);

-- Agreement tracker: rolling window on a listing
CREATE INDEX IF NOT EXISTS gen2_apprentice_predictions_listing_created_idx
  ON public.gen2_apprentice_predictions (listing_id, created_at DESC);

-- Candidate lookup (one candidate may accumulate multiple predictions over retrains)
CREATE INDEX IF NOT EXISTS gen2_apprentice_predictions_candidate_idx
  ON public.gen2_apprentice_predictions (candidate_id);

-- GIN index for querying few_shot_label_ids membership
CREATE INDEX IF NOT EXISTS gen2_apprentice_predictions_few_shot_gin_idx
  ON public.gen2_apprentice_predictions USING GIN (few_shot_label_ids);

COMMENT ON TABLE public.gen2_apprentice_predictions IS
  'V2.1 Apprentice (Gemini 2.5 Pro) few-shot predictions per pair candidate. '
  'agreement_with_operator is populated once the operator labels the same pair (autopilot_audit or comparison).';

NOTIFY pgrst, 'reload schema';
