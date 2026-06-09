-- 076: clients.brokerage — per-client brokerage label for brand-kit injection.
-- Brand-kit precedence: clients.brokerage → properties.brokerage → null.
-- (clients.agent_name remains the display name; no new display-name column.)

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS brokerage text;
