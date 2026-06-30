-- Rollback for migration 096 — restores the pre-F15 broad-grant state.
--
-- Run this ONLY to undo migration 096. It re-grants EXECUTE to PUBLIC (which
-- implicitly covers anon and authenticated) on both functions, returning them
-- to the original overly-permissive posture that existed before F15 was fixed.
--
-- Idempotent: each block checks whether the function exists before executing
-- the GRANT. Running after the function has been dropped is a no-op.

-- 1. claim_v21_outcomes(integer) — restore pre-F15 broad grant
DO $$
BEGIN
  IF to_regprocedure('public.claim_v21_outcomes(integer)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.claim_v21_outcomes(integer) TO PUBLIC;
    RAISE NOTICE 'F15 rollback: EXECUTE re-granted to PUBLIC on claim_v21_outcomes(integer)';
  ELSE
    RAISE NOTICE 'F15 rollback: public.claim_v21_outcomes(integer) not found — skipping grant';
  END IF;
END
$$;

-- 2. increment_creative_view(text) — restore pre-F15 broad grant
DO $$
BEGIN
  IF to_regprocedure('public.increment_creative_view(text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.increment_creative_view(text) TO PUBLIC;
    RAISE NOTICE 'F15 rollback: EXECUTE re-granted to PUBLIC on increment_creative_view(text)';
  ELSE
    RAISE NOTICE 'F15 rollback: public.increment_creative_view(text) not found — skipping grant';
  END IF;
END
$$;
