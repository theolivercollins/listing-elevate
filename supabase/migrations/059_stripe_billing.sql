-- 058: Stripe billing integration.
-- Two charge points are introduced:
--   1. Per-order video charge — fires when the customer submits the Upload form.
--      The property row starts in 'pending_payment'; the webhook flips it to
--      'queued' once checkout.session.completed is received.
--   2. Voice-clone setup charge ($125 one-time) — fired separately by admin via
--      a dedicated checkout session. Does NOT gate the per-order pipeline.
--
-- Migration is ADDITIVE — legacy rows keep their current status values.
-- 'pending_payment' is the only new status; all existing values remain valid.

-- ── properties: Stripe billing columns ──────────────────────────────────────

-- The Stripe Checkout Session ID created when the customer submits the form.
-- Used to correlate checkout.session.completed webhook back to the property.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS stripe_session_id text;

-- The PaymentIntent associated with the completed checkout session.
-- Written by the webhook handler after checkout.session.completed fires.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;

-- Tracks the lifecycle of the Stripe payment for this order.
-- 'unpaid'    — property created, checkout session not yet completed (default)
-- 'pending'   — checkout session open, waiting for customer to pay
-- 'paid'      — checkout.session.completed received and verified
-- 'refunded'  — full or partial refund issued post-delivery
-- 'failed'    — payment_intent.payment_failed received
-- 'cancelled' — checkout.session.expired without payment
ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_stripe_payment_status_check;

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS stripe_payment_status text NOT NULL DEFAULT 'unpaid';

ALTER TABLE properties
  ADD CONSTRAINT properties_stripe_payment_status_check
  CHECK (stripe_payment_status IN ('unpaid', 'pending', 'paid', 'refunded', 'failed', 'cancelled'));

-- Timestamp when the Stripe payment was confirmed (checkout.session.completed).
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS stripe_paid_at timestamptz;

-- Total amount charged in cents, derived from line items at checkout creation.
-- Stored so finance reconciliation never has to re-derive it from form fields.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS stripe_amount_cents int;

-- ── properties: new status value ────────────────────────────────────────────
-- The properties.status column is type text with no CHECK constraint
-- (verified by examining migrations 001 onward — the column was added without
-- a CHECK and has never had one added). The new 'pending_payment' value is
-- therefore automatically valid; documenting it here for completeness.
--
-- Valid status flow after this migration:
--   pending_payment → queued → analyzing → scripting → generating →
--   qc → assembling → complete | failed | needs_review
--
-- Legacy rows in any other status are unaffected by this migration.

-- ── user_profiles: Stripe customer linkage ──────────────────────────────────

-- Stripe Customer ID created on first per-order or voice-clone checkout.
-- Allows Stripe to surface saved payment methods for returning customers.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

-- ── Index ────────────────────────────────────────────────────────────────────

-- Partial index on the session ID for fast webhook correlation lookups.
-- The WHERE clause keeps the index small — most rows will have NULL.
CREATE INDEX IF NOT EXISTS idx_properties_stripe_session
  ON properties(stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
