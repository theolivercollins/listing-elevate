-- V2 outcome-feedback worker concurrent claim helper.
-- Returns N rows in non-terminal status, locking them so concurrent
-- worker instances don't double-process. Uses FOR UPDATE SKIP LOCKED.

CREATE OR REPLACE FUNCTION public.claim_v21_outcomes(p_limit int DEFAULT 5)
RETURNS SETOF public.gen2_render_outcomes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM public.gen2_render_outcomes
  WHERE status IN ('pending', 'submitted', 'polling', 'rendered')
  ORDER BY created_at ASC
  LIMIT p_limit
  FOR UPDATE SKIP LOCKED;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_v21_outcomes(int) TO service_role;

NOTIFY pgrst, 'reload schema';
