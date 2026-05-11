-- 049_portal_orders_payment_intent.sql
-- Switch from Checkout Session (iframe of Stripe-hosted page) to
-- PaymentIntent + Stripe Elements (native-feeling form on our domain).
-- The 048 session column stays but is unused going forward.

ALTER TABLE portal_orders
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS portal_orders_pi_idx
  ON portal_orders(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
