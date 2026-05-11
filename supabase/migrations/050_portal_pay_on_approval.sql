-- 050_portal_pay_on_approval.sql
-- Adds awaiting_delivery to the order state machine, approved_at timestamp,
-- and upload_status on deliverable versions. See
-- docs/specs/2026-05-10-portal-deliverables-phase-2-design.md §5.

BEGIN;

ALTER TABLE portal_orders DROP CONSTRAINT IF EXISTS portal_orders_status_check;
ALTER TABLE portal_orders ADD CONSTRAINT portal_orders_status_check
  CHECK (status IN (
    'awaiting_onboarding',
    'awaiting_delivery',
    'delivered',
    'in_review',
    'revision_requested',
    'approved',
    'awaiting_payment',
    'paid',
    'canceled',
    'in_progress'
  ));

ALTER TABLE portal_orders
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE portal_deliverable_versions
  ADD COLUMN IF NOT EXISTS upload_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (upload_status IN ('pending', 'uploaded', 'failed'));

CREATE INDEX IF NOT EXISTS portal_versions_upload_status_idx
  ON portal_deliverable_versions(deliverable_id, upload_status);

COMMIT;
