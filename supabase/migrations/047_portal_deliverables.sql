-- 047_portal_deliverables.sql
-- Client portal: orders, deliverables, comments, notifications.
-- Tables prefixed with `portal_` to avoid collision with the existing
-- real-estate `clients` table (which is for Sierra publishing, not invoicing).

BEGIN;

-- ─── portal_customers ─────────────────────────────────────────────────────
-- A person/business you invoice and deliver to. Created by the owner with
-- minimal info (email + name). Stripe Customer is created later, after the
-- customer self-onboards via the tokenized link and provides billing details.
-- `user_id` is filled in the first time they sign in via magic link.
CREATE TABLE IF NOT EXISTS portal_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Minimal owner-provided fields
  email TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,

  -- Self-provided billing details (filled during onboarding)
  business_name TEXT,
  phone TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  address_city TEXT,
  address_state TEXT,
  address_postal_code TEXT,
  address_country TEXT, -- ISO-3166-1 alpha-2 e.g. "US"

  -- Stripe linkage (populated after first onboarding)
  stripe_customer_id TEXT UNIQUE,
  onboarded_at TIMESTAMPTZ,

  -- Auth linkage (populated when client first magic-links into /portal)
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(owner_id, email)
);

CREATE INDEX IF NOT EXISTS portal_customers_owner_idx ON portal_customers(owner_id);
CREATE INDEX IF NOT EXISTS portal_customers_user_idx ON portal_customers(user_id);
CREATE INDEX IF NOT EXISTS portal_customers_email_idx ON portal_customers(lower(email));

-- ─── portal_orders ────────────────────────────────────────────────────────
-- One order = one invoice = one job. Holds 0..N deliverable threads.
-- Stage flow: awaiting_onboarding → awaiting_payment → paid → in_progress
--           → delivered → in_review → revision_requested → approved
-- An order can also be `canceled`. `delivered`/`in_review`/`revision_requested`
-- are derived from deliverable activity but cached here for fast badge render.
CREATE TABLE IF NOT EXISTS portal_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES portal_customers(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  description TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'usd' CHECK (length(currency) = 3),

  -- Optional line items (stored as JSON for flexibility on a v1 product).
  -- Shape: [{ description: string, amount_cents: number, quantity: number }]
  -- If empty, a single line item is generated from `title` + `amount_cents`.
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,

  status TEXT NOT NULL DEFAULT 'awaiting_onboarding'
    CHECK (status IN (
      'awaiting_onboarding',
      'awaiting_payment',
      'paid',
      'in_progress',
      'delivered',
      'in_review',
      'revision_requested',
      'approved',
      'canceled'
    )),

  -- Tokenized link the customer uses to onboard (one-time-use; consumed when invoice issued)
  onboarding_token TEXT UNIQUE,

  -- Stripe linkage (populated after onboarding completes)
  stripe_invoice_id TEXT UNIQUE,
  stripe_invoice_url TEXT,
  paid_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS portal_orders_owner_idx ON portal_orders(owner_id);
CREATE INDEX IF NOT EXISTS portal_orders_customer_idx ON portal_orders(customer_id);
CREATE INDEX IF NOT EXISTS portal_orders_status_idx ON portal_orders(status);
CREATE INDEX IF NOT EXISTS portal_orders_token_idx ON portal_orders(onboarding_token) WHERE onboarding_token IS NOT NULL;

-- ─── portal_deliverables ──────────────────────────────────────────────────
-- A deliverable thread within an order (e.g. "Main episode video").
-- One order can have many deliverables. Each deliverable has 1..N versions
-- (uploads stack as v1, v2, v3 across revisions).
CREATE TABLE IF NOT EXISTS portal_deliverables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES portal_orders(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  description TEXT,

  -- Tokenized public review link. Anyone with this link can watch + download.
  -- Magic-link sign-in is required to comment / approve / request revision.
  review_token TEXT NOT NULL UNIQUE,

  -- Lifecycle: pending → in_review → revision_requested → approved
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_review', 'revision_requested', 'approved')),

  approved_at TIMESTAMPTZ,
  approved_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS portal_deliverables_order_idx ON portal_deliverables(order_id);
CREATE INDEX IF NOT EXISTS portal_deliverables_token_idx ON portal_deliverables(review_token);

-- ─── portal_deliverable_versions ──────────────────────────────────────────
-- v1, v2, v3… of a deliverable. The newest unsuperseded version is what the
-- client sees on the review page; older versions stay accessible as history.
CREATE TABLE IF NOT EXISTS portal_deliverable_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_id UUID NOT NULL REFERENCES portal_deliverables(id) ON DELETE CASCADE,

  version INTEGER NOT NULL CHECK (version >= 1),

  -- Supabase Storage object path inside the `deliverables` bucket
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size_bytes BIGINT,
  mime_type TEXT,
  duration_seconds INTEGER,

  -- Owner's note when uploading a new revision (e.g. "fixed audio levels in act 2")
  upload_note TEXT,

  uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(deliverable_id, version)
);

CREATE INDEX IF NOT EXISTS portal_deliverable_versions_deliverable_idx
  ON portal_deliverable_versions(deliverable_id);

-- ─── portal_comments ──────────────────────────────────────────────────────
-- Comments on a deliverable. `kind` distinguishes free-form comments from
-- approval / revision-request actions. Revisions require a comment body.
-- Anonymous users CANNOT comment — magic-link sign-in is enforced at API.
CREATE TABLE IF NOT EXISTS portal_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_id UUID NOT NULL REFERENCES portal_deliverables(id) ON DELETE CASCADE,
  -- Pinned to the version that was current when the comment was made
  version_id UUID NOT NULL REFERENCES portal_deliverable_versions(id) ON DELETE CASCADE,

  -- The signed-in user (auth.users) who left the comment.
  -- For client comments, this matches portal_customers.user_id.
  -- For owner internal notes, this is the owner_id.
  author_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Cached at write time so deletion / email change doesn't break attribution
  author_first_name TEXT NOT NULL,
  author_last_name TEXT NOT NULL,
  author_email TEXT NOT NULL,

  kind TEXT NOT NULL DEFAULT 'comment'
    CHECK (kind IN ('comment', 'approval', 'revision_request')),
  body TEXT,

  -- Optional video timestamp the comment is anchored to (seconds, integer)
  video_timestamp_seconds INTEGER CHECK (video_timestamp_seconds >= 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Revision/approval bodies are required; free comments must have a body too
  CHECK (
    (kind IN ('comment', 'revision_request') AND body IS NOT NULL AND length(trim(body)) > 0)
    OR (kind = 'approval')
  )
);

CREATE INDEX IF NOT EXISTS portal_comments_deliverable_idx ON portal_comments(deliverable_id);
CREATE INDEX IF NOT EXISTS portal_comments_author_idx ON portal_comments(author_user_id);

-- ─── portal_notifications ─────────────────────────────────────────────────
-- In-app notification feed for the owner. Email is fired separately by Resend.
CREATE TABLE IF NOT EXISTS portal_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  kind TEXT NOT NULL CHECK (kind IN (
    'order_paid',
    'comment_added',
    'revision_requested',
    'approval_received',
    'onboarding_completed'
  )),
  title TEXT NOT NULL,
  body TEXT,
  -- Where the bell-click should take you (e.g. /dashboard/orders/<id>)
  link_path TEXT,

  -- Foreign keys for filtering / dedup
  order_id UUID REFERENCES portal_orders(id) ON DELETE CASCADE,
  deliverable_id UUID REFERENCES portal_deliverables(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES portal_comments(id) ON DELETE CASCADE,

  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS portal_notifications_user_unread_idx
  ON portal_notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

-- ─── updated_at triggers ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION portal_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS portal_customers_updated_at ON portal_customers;
CREATE TRIGGER portal_customers_updated_at BEFORE UPDATE ON portal_customers
  FOR EACH ROW EXECUTE FUNCTION portal_set_updated_at();

DROP TRIGGER IF EXISTS portal_orders_updated_at ON portal_orders;
CREATE TRIGGER portal_orders_updated_at BEFORE UPDATE ON portal_orders
  FOR EACH ROW EXECUTE FUNCTION portal_set_updated_at();

DROP TRIGGER IF EXISTS portal_deliverables_updated_at ON portal_deliverables;
CREATE TRIGGER portal_deliverables_updated_at BEFORE UPDATE ON portal_deliverables
  FOR EACH ROW EXECUTE FUNCTION portal_set_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────────────────
-- Two access modes:
--  1) Owner: sees all rows where owner_id = auth.uid() (or is admin).
--  2) Customer: sees their own portal_customers row, their orders, the
--     deliverables under those orders, comments on those deliverables.
-- API endpoints that take an `onboarding_token` or `review_token` use the
-- service-role client and validate the token themselves — RLS doesn't apply.

ALTER TABLE portal_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_deliverables ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_deliverable_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_notifications ENABLE ROW LEVEL SECURITY;

-- Helper: is the current user an admin?
CREATE OR REPLACE FUNCTION portal_is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- portal_customers: owner sees their customers; customer sees their own row
CREATE POLICY portal_customers_select ON portal_customers FOR SELECT
  USING (auth.uid() = owner_id OR auth.uid() = user_id OR portal_is_admin());
CREATE POLICY portal_customers_insert ON portal_customers FOR INSERT
  WITH CHECK (auth.uid() = owner_id);
CREATE POLICY portal_customers_update ON portal_customers FOR UPDATE
  USING (auth.uid() = owner_id OR auth.uid() = user_id);
CREATE POLICY portal_customers_delete ON portal_customers FOR DELETE
  USING (auth.uid() = owner_id);

-- portal_orders: owner sees their orders; customer sees orders linked to their customer row
CREATE POLICY portal_orders_select ON portal_orders FOR SELECT
  USING (
    auth.uid() = owner_id
    OR EXISTS (
      SELECT 1 FROM portal_customers c
      WHERE c.id = portal_orders.customer_id AND c.user_id = auth.uid()
    )
    OR portal_is_admin()
  );
CREATE POLICY portal_orders_insert ON portal_orders FOR INSERT
  WITH CHECK (auth.uid() = owner_id);
CREATE POLICY portal_orders_update ON portal_orders FOR UPDATE
  USING (auth.uid() = owner_id);
CREATE POLICY portal_orders_delete ON portal_orders FOR DELETE
  USING (auth.uid() = owner_id);

-- portal_deliverables: visibility follows the parent order
CREATE POLICY portal_deliverables_select ON portal_deliverables FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM portal_orders o
    WHERE o.id = portal_deliverables.order_id
      AND (
        o.owner_id = auth.uid()
        OR EXISTS (SELECT 1 FROM portal_customers c WHERE c.id = o.customer_id AND c.user_id = auth.uid())
        OR portal_is_admin()
      )
  ));
CREATE POLICY portal_deliverables_write ON portal_deliverables FOR ALL
  USING (EXISTS (SELECT 1 FROM portal_orders o WHERE o.id = portal_deliverables.order_id AND o.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM portal_orders o WHERE o.id = portal_deliverables.order_id AND o.owner_id = auth.uid()));

-- portal_deliverable_versions: visibility follows the parent deliverable
CREATE POLICY portal_versions_select ON portal_deliverable_versions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM portal_deliverables d
    JOIN portal_orders o ON o.id = d.order_id
    WHERE d.id = portal_deliverable_versions.deliverable_id
      AND (
        o.owner_id = auth.uid()
        OR EXISTS (SELECT 1 FROM portal_customers c WHERE c.id = o.customer_id AND c.user_id = auth.uid())
        OR portal_is_admin()
      )
  ));
CREATE POLICY portal_versions_write ON portal_deliverable_versions FOR ALL
  USING (EXISTS (
    SELECT 1 FROM portal_deliverables d
    JOIN portal_orders o ON o.id = d.order_id
    WHERE d.id = portal_deliverable_versions.deliverable_id AND o.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM portal_deliverables d
    JOIN portal_orders o ON o.id = d.order_id
    WHERE d.id = portal_deliverable_versions.deliverable_id AND o.owner_id = auth.uid()
  ));

-- portal_comments: anyone in the order chain can read; writers must be in the chain
CREATE POLICY portal_comments_select ON portal_comments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM portal_deliverables d
    JOIN portal_orders o ON o.id = d.order_id
    WHERE d.id = portal_comments.deliverable_id
      AND (
        o.owner_id = auth.uid()
        OR EXISTS (SELECT 1 FROM portal_customers c WHERE c.id = o.customer_id AND c.user_id = auth.uid())
        OR portal_is_admin()
      )
  ));
CREATE POLICY portal_comments_insert ON portal_comments FOR INSERT
  WITH CHECK (
    auth.uid() = author_user_id
    AND EXISTS (
      SELECT 1 FROM portal_deliverables d
      JOIN portal_orders o ON o.id = d.order_id
      WHERE d.id = portal_comments.deliverable_id
        AND (
          o.owner_id = auth.uid()
          OR EXISTS (SELECT 1 FROM portal_customers c WHERE c.id = o.customer_id AND c.user_id = auth.uid())
        )
    )
  );

-- portal_notifications: only the recipient sees them
CREATE POLICY portal_notifications_select ON portal_notifications FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY portal_notifications_update ON portal_notifications FOR UPDATE
  USING (auth.uid() = user_id);

COMMIT;
