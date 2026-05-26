-- 071_gen2_render_outcomes.sql
-- Tracks Atlas render jobs submitted for a pair label and their outcomes.
-- Matches RenderOutcome type in lib/gen2-v21/types.ts.

CREATE TABLE IF NOT EXISTS public.gen2_render_outcomes (
  outcome_id      uuid        NOT NULL DEFAULT gen_random_uuid(),
  pair_label_id   uuid        NOT NULL,
  atlas_job_id    text,
  video_url       text,
  judge_score     numeric,
  judge_reasoning text,
  status          text        NOT NULL DEFAULT 'pending',
  cost_cents      int         NOT NULL DEFAULT 0,
  retry_count     int         NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,

  CONSTRAINT gen2_render_outcomes_pkey PRIMARY KEY (outcome_id),
  CONSTRAINT gen2_render_outcomes_pair_label_fk
    FOREIGN KEY (pair_label_id) REFERENCES public.gen2_pair_labels(label_id) ON DELETE CASCADE,
  CONSTRAINT gen2_render_outcomes_status_chk CHECK (
    status IN ('pending', 'submitted', 'polling', 'rendered', 'judged', 'completed', 'failed')
  ),
  CONSTRAINT gen2_render_outcomes_judge_score_range_chk CHECK (
    judge_score IS NULL
    OR (judge_score >= 0 AND judge_score <= 1)
  ),
  CONSTRAINT gen2_render_outcomes_cost_non_neg_chk CHECK (cost_cents >= 0),
  CONSTRAINT gen2_render_outcomes_retry_non_neg_chk CHECK (retry_count >= 0)
);

-- Polling worker query: all non-terminal rows ordered oldest-first
CREATE INDEX IF NOT EXISTS gen2_render_outcomes_polling_idx
  ON public.gen2_render_outcomes (status, created_at)
  WHERE status IN ('submitted', 'polling');

-- Look up outcome by label
CREATE INDEX IF NOT EXISTS gen2_render_outcomes_pair_label_idx
  ON public.gen2_render_outcomes (pair_label_id);

COMMENT ON TABLE public.gen2_render_outcomes IS
  'V2.1 Atlas render outcomes for pair-label render jobs. '
  'Outcome feedback worker polls rows with status submitted/polling and updates them.';

NOTIFY pgrst, 'reload schema';
