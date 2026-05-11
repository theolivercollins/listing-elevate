-- 050_portal_orders_order_number.sql
-- Human-friendly sequential order number that we surface to the customer
-- AND attach to Stripe (as PaymentIntent.description) so the number on
-- the success page matches the number on the Stripe receipt.
--
-- Done in stages to avoid the "default already assigned a colliding value"
-- error that the single-statement backfill hit.

CREATE SEQUENCE IF NOT EXISTS portal_orders_order_number_seq START 1;

-- 1. Add the column nullable, no default — so we can backfill cleanly.
ALTER TABLE portal_orders
  ADD COLUMN IF NOT EXISTS order_number INTEGER;

-- 2. Backfill in created_at order. Oldest order → REC-0001.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS n
  FROM portal_orders
)
UPDATE portal_orders po
SET order_number = ordered.n
FROM ordered
WHERE po.id = ordered.id;

-- 3. Set the sequence to start after the highest assigned value.
SELECT setval(
  'portal_orders_order_number_seq',
  GREATEST(COALESCE((SELECT MAX(order_number) FROM portal_orders), 0), 1)
);

-- 4. Default for future inserts.
ALTER TABLE portal_orders
  ALTER COLUMN order_number SET DEFAULT nextval('portal_orders_order_number_seq');

-- 5. Lock it down.
ALTER TABLE portal_orders ALTER COLUMN order_number SET NOT NULL;
ALTER TABLE portal_orders ADD CONSTRAINT portal_orders_order_number_unique UNIQUE (order_number);
