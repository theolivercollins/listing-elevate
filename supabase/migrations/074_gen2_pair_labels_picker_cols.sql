-- 074_gen2_pair_labels_picker_cols.sql
-- Adds columns that pair-label.ts inserts and retrain-trigger.ts queries
-- but were omitted from migration 069.
--
-- candidate_id  uuid   — FK to gen2_pair_candidates; nullable (direct labels may omit it)
-- labeled_by    uuid   — FK to auth.users; which operator submitted the label
-- features_blob jsonb  — pre-computed PickerFeatures snapshot at label time
-- target        smallint CHECK (0,1) — derived from operator_verdict: good→1, bad→0, tie→NULL

ALTER TABLE public.gen2_pair_labels
  ADD COLUMN IF NOT EXISTS candidate_id uuid
    REFERENCES public.gen2_pair_candidates(candidate_id) ON DELETE SET NULL,

  ADD COLUMN IF NOT EXISTS labeled_by uuid
    REFERENCES auth.users(id) ON DELETE SET NULL,

  ADD COLUMN IF NOT EXISTS features_blob jsonb,

  ADD COLUMN IF NOT EXISTS target smallint
    CONSTRAINT gen2_pair_labels_target_chk CHECK (target IN (0, 1));

-- Populate target from existing rows where verdict is known and not tie
UPDATE public.gen2_pair_labels
  SET target = CASE operator_verdict
    WHEN 'good' THEN 1
    WHEN 'bad'  THEN 0
    ELSE NULL
  END
WHERE target IS NULL;

-- Index for picker training query (queries all labels for a listing, filters target IS NOT NULL)
CREATE INDEX IF NOT EXISTS gen2_pair_labels_target_idx
  ON public.gen2_pair_labels (listing_id, target)
  WHERE target IS NOT NULL;

COMMENT ON COLUMN public.gen2_pair_labels.candidate_id IS
  'FK to gen2_pair_candidates. Nullable — direct operator labels may not reference a candidate.';
COMMENT ON COLUMN public.gen2_pair_labels.labeled_by IS
  'auth.users FK — which operator submitted this label.';
COMMENT ON COLUMN public.gen2_pair_labels.features_blob IS
  'PickerFeatures JSON snapshot captured at label-insert time. Null for labels inserted before migration 074.';
COMMENT ON COLUMN public.gen2_pair_labels.target IS
  '1=good, 0=bad, NULL=tie. Derived from operator_verdict. Used as training target by the picker.';

NOTIFY pgrst, 'reload schema';
