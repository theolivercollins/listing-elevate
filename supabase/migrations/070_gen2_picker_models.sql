-- 070_gen2_picker_models.sql
-- Trained LightGBM (or heuristic-fallback) picker model snapshots.
-- Only one row may have is_active = true at a time (enforced by partial unique index).

CREATE TABLE IF NOT EXISTS public.gen2_picker_models (
  model_id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  trained_at            timestamptz NOT NULL DEFAULT now(),
  listing_count_at_train int,
  label_count_at_train  int,
  weights_blob          jsonb,
  top_features          jsonb,
  accuracy_on_holdout   numeric,
  is_active             boolean     NOT NULL DEFAULT false,

  CONSTRAINT gen2_picker_models_pkey PRIMARY KEY (model_id),
  CONSTRAINT gen2_picker_models_accuracy_range_chk CHECK (
    accuracy_on_holdout IS NULL
    OR (accuracy_on_holdout >= 0 AND accuracy_on_holdout <= 1)
  )
);

-- Enforce at most one active model at a time
CREATE UNIQUE INDEX IF NOT EXISTS gen2_picker_models_single_active_idx
  ON public.gen2_picker_models (is_active)
  WHERE is_active = true;

-- Retrain history ordered newest-first
CREATE INDEX IF NOT EXISTS gen2_picker_models_trained_at_idx
  ON public.gen2_picker_models (trained_at DESC);

COMMENT ON TABLE public.gen2_picker_models IS
  'V2.1 picker model snapshots. is_active=true is enforced unique via partial index. '
  'weights_blob and top_features are opaque JSON blobs stored for auditability.';

NOTIFY pgrst, 'reload schema';
