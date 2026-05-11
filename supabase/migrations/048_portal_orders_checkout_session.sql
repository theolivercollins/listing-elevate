-- 048_portal_orders_checkout_session.sql
-- Phase 1.5: switch the payment flow from Stripe-hosted invoice to embedded
-- Stripe Checkout. Sessions are created server-side and rendered inline on
-- portal.listingelevate.com. We still get an invoice (via invoice_creation
-- on the session) so the dashboard view of an order has both linkage points.

ALTER TABLE portal_orders
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS portal_orders_session_idx
  ON portal_orders(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
