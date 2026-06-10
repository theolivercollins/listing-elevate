-- 081: clients.realtor_suffix — per-client ", Realtor" display-name toggle.
-- When true, the agent name rendered on videos becomes "<agent_name>, Realtor".
-- Applied at render-mapping time (lib/operator-studio/brand-kit.ts applyRealtorSuffix);
-- the stored agent_name stays clean. Customer flow (no client row) is unaffected.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS realtor_suffix boolean NOT NULL DEFAULT false;
