-- migration 064: recurring subscriptions ledger
-- Tracks monthly/yearly recurring charges from external providers.
-- Cron (api/cron/post-subscription-charges.ts) posts to cost_events + expenses
-- on each billing date and advances next_charge_at.

CREATE TABLE IF NOT EXISTS subscriptions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT        NOT NULL,
  amount_cents    INT         NOT NULL,
  billing_period  TEXT        NOT NULL CHECK (billing_period IN ('monthly', 'yearly')),
  started_at      DATE        NOT NULL,
  next_charge_at  DATE        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'paused', 'cancelled')),
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_next_charge_at_idx
  ON subscriptions (next_charge_at)
  WHERE status = 'active';
