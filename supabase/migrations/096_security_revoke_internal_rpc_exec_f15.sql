-- Migration 096 — Security finding F15: revoke PUBLIC/anon/authenticated EXECUTE
--   on server-only SECURITY DEFINER functions.
--
-- Affected functions
--   public.claim_v21_outcomes(integer)
--   public.increment_creative_view(text)
--
-- Rationale
--   Both are SECURITY DEFINER and are called exclusively by server code via the
--   service_role key (api/ and lib/ directories). The browser/client makes zero
--   .rpc() calls to either function (confirmed by codebase audit). No RLS policy
--   references either function. Therefore PUBLIC, anon, and authenticated have no
--   legitimate need for EXECUTE; removing their grant eliminates a privilege-
--   escalation vector with zero impact on any live call path.
--
--   service_role retains its own explicit GRANT from the original DDL, so all
--   server calls continue to work unchanged.
--
-- Intentional exclusion
--   public.portal_is_admin() is NOT touched here. It is referenced by 5 portal RLS
--   policies (portal_orders, portal_customers, portal_deliverables,
--   portal_deliverable_versions, portal_comments) that authenticated users evaluate
--   at query time, so revoking its grant would break portal access. Its
--   search_path is already pinned by migration 095 (F16 fix).
--
-- Idempotent: each block checks whether the function exists before executing the
-- REVOKE. Re-running after the function has been dropped is a no-op.

-- 1. claim_v21_outcomes(integer)
DO $$
BEGIN
  IF to_regprocedure('public.claim_v21_outcomes(integer)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.claim_v21_outcomes(integer)
      FROM PUBLIC, anon, authenticated;
    RAISE NOTICE 'F15: EXECUTE revoked from PUBLIC/anon/authenticated on claim_v21_outcomes(integer)';
  ELSE
    RAISE NOTICE 'F15: public.claim_v21_outcomes(integer) not found — skipping revoke';
  END IF;
END
$$;

-- 2. increment_creative_view(text)
DO $$
BEGIN
  IF to_regprocedure('public.increment_creative_view(text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.increment_creative_view(text)
      FROM PUBLIC, anon, authenticated;
    RAISE NOTICE 'F15: EXECUTE revoked from PUBLIC/anon/authenticated on increment_creative_view(text)';
  ELSE
    RAISE NOTICE 'F15: public.increment_creative_view(text) not found — skipping revoke';
  END IF;
END
$$;
