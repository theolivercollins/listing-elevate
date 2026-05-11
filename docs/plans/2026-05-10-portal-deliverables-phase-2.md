# Portal Phase 2 — Deliverables + Review + Pay-on-Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the back half of the client portal — owner uploads deliverables, client reviews with timestamped comments + revision loop, approves and pays via embedded Stripe Payment Element, downloads the released video. Inverts Phase 1's payment timing from pay-at-onboarding to pay-at-approval.

**Architecture:** Vercel functions under `api/portal/...` for the API, Supabase Postgres + Storage for persistence, Stripe Payment Element (PaymentIntent + `client_secret`) for inline payment, Resend for email, React (Vite) for the dashboard + review page. State transitions are encoded in a single pure helper (`lib/portal/state.ts`) so the table is in one place. Upload bytes go browser → Supabase directly via signed URLs, never through Vercel functions.

**Tech Stack:** TypeScript, Vercel Functions (Node), Supabase (Postgres + Storage), Stripe SDK, Resend, React + react-router-dom, Vitest + @testing-library/react.

**Spec:** `docs/specs/2026-05-10-portal-deliverables-phase-2-design.md`
**Design language:** `docs/DESIGN_STYLE.md` — binding for every UI surface in this plan.

---

## File structure

### Created

| File | Responsibility |
|---|---|
| `supabase/migrations/050_portal_pay_on_approval.sql` | Migration: add `awaiting_delivery` status, `approved_at`, `upload_status` on versions |
| `lib/portal/state.ts` | Pure helper: `computeNextOrderStatus(current, event)` — single source of truth for the order state machine |
| `lib/portal/state.test.ts` | Unit tests for every legal + illegal transition |
| `lib/portal/storage.ts` | Helpers: `createSignedUploadUrl`, `createSignedStreamUrl`, `createSignedDownloadUrl`, `verifyObjectExists`, `objectPathFor` |
| `lib/portal/storage.test.ts` | Unit tests for path generation + mocked SDK calls |
| `lib/portal/deliverables.ts` | Server helpers: `createDeliverable`, `createVersion`, `finalizeVersion`, `getLatestUploadedVersion` |
| `lib/portal/notifications.ts` | Server helpers: `notifyOwner(event, payload)`, `notifyClient(event, payload)` — writes `portal_notifications` row + fires the right Resend template |
| `api/portal/orders/[id]/deliverables/index.ts` | POST: create deliverable |
| `api/portal/orders/[id]/deliverables/[did]/index.ts` | DELETE: remove deliverable (only if no `uploaded` versions) |
| `api/portal/orders/[id]/deliverables/[did]/versions/index.ts` | POST: create version row + return signed upload URL |
| `api/portal/orders/[id]/deliverables/[did]/versions/[vid]/finalize.ts` | POST: verify upload + flip order state |
| `api/portal/review/[token]/index.ts` | GET: review page data (deliverable, versions, latest stream URL, comments, order_status, price) |
| `api/portal/review/[token]/versions/[vid]/stream.ts` | GET: fresh signed stream URL for a specific version |
| `api/portal/review/[token]/comments.ts` | GET (list) + POST (create) for comments + revision_request kind |
| `api/portal/review/[token]/approve.ts` | POST: write approval row, create PaymentIntent, return `client_secret` |
| `api/portal/review/[token]/download.ts` | GET: 302 to fresh signed download URL (requires `paid`) |
| `api/portal/review/[token]/status.ts` | GET: `{ order_status }` for post-payment polling |
| `api/portal/review/[token]/sign-in/magic-link.ts` | POST: send Supabase OTP to the customer email |
| `src/lib/reviewApi.ts` | Frontend HTTP client for review-page endpoints |
| `src/pages/Review.tsx` | Review page route — top-level data load + layout switching |
| `src/pages/review/ReviewPlayer.tsx` | Video element + timeline + version selector |
| `src/pages/review/CommentsRail.tsx` | Comment list + compose box + pin-to-timestamp toggle |
| `src/pages/review/ActionBar.tsx` | Request revision / Approve & pay / Download (post-pay) |
| `src/pages/review/SignInPanel.tsx` | Auth-gated state — password OR magic link |
| `src/pages/review/PaymentPanel.tsx` | Stripe Payment Element wrapper (shared with onboarding pattern) |
| `src/pages/dashboard/OrderDetailTabs.tsx` | Tab bar (Overview / Deliverables / Activity) |
| `src/pages/dashboard/OrderDeliverables.tsx` | Deliverables tab content — list + add modal + upload widget |
| `src/pages/dashboard/OrderActivity.tsx` | Activity tab content — notification feed for one order |

### Modified

| File | Change |
|---|---|
| `api/portal/onboard/[token].ts` | POST drops PaymentIntent creation; sets `awaiting_delivery`. GET drops resume-payment branch. |
| `api/portal/stripe-webhook.ts` | `payment_intent.succeeded` handler routes on `metadata.flow`: `approve_pay` → flip `paid` + notify; legacy onboarding flow handled separately (or removed once production is on Phase 2). |
| `lib/portal/email.ts` | Three new templates: `deliverable_ready_v1`, `deliverable_ready_vn`, `payment_receipt`. Existing post-onboarding template rewritten to "we'll deliver shortly". |
| `src/pages/Onboard.tsx` | Remove Payment Element mount. After submit, show "Thanks — we'll deliver shortly" confirmation. Idempotent on reload. |
| `src/pages/dashboard/OrderDetail.tsx` | Embed `OrderDetailTabs`. Overview content stays as the default tab body. |
| `src/lib/portalApi.ts` | Add `createDeliverable`, `createVersion`, `finalizeVersion`, `deleteDeliverable` for the owner UI. |

---

## Execution checkpoints

Three natural batches. Execute in order; each leaves the app in a working state.

- **Batch A — Foundation + Phase 1 surgery (Tasks 1–6):** Migration + state helper + storage helpers + Phase 1 onboarding rewrite. Onboarding stops creating PaymentIntents; orders sit at `awaiting_delivery` instead of `awaiting_payment`. Nothing visible to clients yet; existing paid Phase 1 orders unaffected.
- **Batch B — Owner side (Tasks 7–13):** Owner can upload deliverables. Order flips to `delivered`. Client gets the "your video is ready" email but the `/review/<token>` route returns 404 (route not yet registered). Safe to ship — owner-only UI.
- **Batch C — Client side + payment (Tasks 14–25):** Review page, comments, approve-pay, webhook, download. Ships the loop end-to-end.

Within each batch, tasks are sequential — later tasks depend on types/helpers from earlier tasks.

---

## Batch A — Foundation + Phase 1 surgery

### Task 1: Migration 050 (state machine + upload lifecycle)

**Files:**
- Create: `supabase/migrations/050_portal_pay_on_approval.sql`

- [ ] **Step 1: Write the migration file**

```sql
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
```

- [ ] **Step 2: Apply to Supabase dev via MCP**

Run via `mcp__plugin_supabase_supabase__apply_migration` with name `050_portal_pay_on_approval` and the SQL body above.

Expected: success. If "constraint already exists", the migration was already applied — confirm via `list_migrations`.

- [ ] **Step 3: Verify**

Run via `mcp__plugin_supabase_supabase__execute_sql`:

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'portal_orders'::regclass AND conname = 'portal_orders_status_check';
```

Expected: returns one row containing `awaiting_delivery`.

- [ ] **Step 4: Create storage bucket**

Run via `execute_sql`:

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('deliverables', 'deliverables', false)
ON CONFLICT (id) DO NOTHING;
```

Expected: 1 row affected (or 0 if already exists).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/050_portal_pay_on_approval.sql
git commit -m "migration(050): portal pay-on-approval schema — awaiting_delivery + upload_status"
```

---

### Task 2: State machine helper

**Files:**
- Create: `lib/portal/state.ts`
- Test: `lib/portal/state.test.ts`

- [ ] **Step 1: Write the failing test**

`lib/portal/state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeNextOrderStatus, type OrderEvent, type OrderStatus } from "./state.js";

describe("computeNextOrderStatus", () => {
  it("awaiting_onboarding + onboarding_completed → awaiting_delivery", () => {
    expect(computeNextOrderStatus("awaiting_onboarding", "onboarding_completed"))
      .toBe("awaiting_delivery");
  });

  it("awaiting_delivery + version_uploaded → delivered", () => {
    expect(computeNextOrderStatus("awaiting_delivery", "version_uploaded"))
      .toBe("delivered");
  });

  it("delivered + client_opened → in_review", () => {
    expect(computeNextOrderStatus("delivered", "client_opened"))
      .toBe("in_review");
  });

  it("in_review + revision_requested → revision_requested", () => {
    expect(computeNextOrderStatus("in_review", "revision_requested"))
      .toBe("revision_requested");
  });

  it("revision_requested + version_uploaded → delivered", () => {
    expect(computeNextOrderStatus("revision_requested", "version_uploaded"))
      .toBe("delivered");
  });

  it("in_review + approved → approved", () => {
    expect(computeNextOrderStatus("in_review", "approved")).toBe("approved");
  });

  it("approved + payment_intent_created → awaiting_payment", () => {
    expect(computeNextOrderStatus("approved", "payment_intent_created"))
      .toBe("awaiting_payment");
  });

  it("awaiting_payment + payment_succeeded → paid", () => {
    expect(computeNextOrderStatus("awaiting_payment", "payment_succeeded"))
      .toBe("paid");
  });

  it("paid is terminal — any event throws", () => {
    expect(() => computeNextOrderStatus("paid", "client_opened" as OrderEvent))
      .toThrow(/illegal transition/i);
  });

  it("delivered + client_opened repeated (already in_review) is idempotent — throws", () => {
    expect(() => computeNextOrderStatus("in_review", "client_opened" as OrderEvent))
      .toThrow(/illegal transition/i);
  });

  it("canceled is terminal", () => {
    expect(() => computeNextOrderStatus("canceled", "version_uploaded" as OrderEvent))
      .toThrow(/illegal transition/i);
  });

  it("any state + canceled event → canceled", () => {
    const states: OrderStatus[] = ["awaiting_delivery", "delivered", "in_review", "revision_requested", "approved"];
    for (const s of states) {
      expect(computeNextOrderStatus(s, "canceled")).toBe("canceled");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/portal/state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

`lib/portal/state.ts`:

```ts
export type OrderStatus =
  | "awaiting_onboarding"
  | "awaiting_delivery"
  | "delivered"
  | "in_review"
  | "revision_requested"
  | "approved"
  | "awaiting_payment"
  | "paid"
  | "canceled"
  | "in_progress"; // legacy — accepted by the CHECK constraint but not produced by computeNextOrderStatus

export type OrderEvent =
  | "onboarding_completed"
  | "version_uploaded"
  | "client_opened"
  | "revision_requested"
  | "approved"
  | "payment_intent_created"
  | "payment_succeeded"
  | "canceled";

const TRANSITIONS: Partial<Record<OrderStatus, Partial<Record<OrderEvent, OrderStatus>>>> = {
  awaiting_onboarding: { onboarding_completed: "awaiting_delivery", canceled: "canceled" },
  awaiting_delivery: { version_uploaded: "delivered", canceled: "canceled" },
  delivered: { client_opened: "in_review", version_uploaded: "delivered", canceled: "canceled" },
  in_review: { revision_requested: "revision_requested", approved: "approved", version_uploaded: "delivered", canceled: "canceled" },
  revision_requested: { version_uploaded: "delivered", canceled: "canceled" },
  approved: { payment_intent_created: "awaiting_payment", canceled: "canceled" },
  awaiting_payment: { payment_succeeded: "paid", canceled: "canceled" },
};

export function computeNextOrderStatus(current: OrderStatus, event: OrderEvent): OrderStatus {
  const next = TRANSITIONS[current]?.[event];
  if (!next) {
    throw new Error(`illegal transition: ${current} + ${event}`);
  }
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/portal/state.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/portal/state.ts lib/portal/state.test.ts
git commit -m "feat(portal/state): order state machine helper with TDD coverage"
```

---

### Task 3: Storage helpers (signed URLs)

**Files:**
- Create: `lib/portal/storage.ts`
- Test: `lib/portal/storage.test.ts`

- [ ] **Step 1: Write the failing test**

`lib/portal/storage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { objectPathFor, splitExtension } from "./storage.js";

describe("objectPathFor", () => {
  it("composes owner/order/deliverable/v<n>.<ext>", () => {
    expect(objectPathFor({
      ownerId: "a1",
      orderId: "b2",
      deliverableId: "c3",
      version: 2,
      fileName: "Walkthrough.MOV",
    })).toBe("a1/b2/c3/v2.mov");
  });

  it("lowercases extension", () => {
    expect(objectPathFor({
      ownerId: "a1", orderId: "b2", deliverableId: "c3", version: 1, fileName: "clip.MP4",
    })).toBe("a1/b2/c3/v1.mp4");
  });

  it("throws on unknown extension", () => {
    expect(() => objectPathFor({
      ownerId: "a1", orderId: "b2", deliverableId: "c3", version: 1, fileName: "x.avi",
    })).toThrow(/extension/i);
  });
});

describe("splitExtension", () => {
  it("returns lowercase extension without dot", () => {
    expect(splitExtension("foo.MP4")).toBe("mp4");
  });
  it("returns null when no extension", () => {
    expect(splitExtension("foo")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/portal/storage.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the helper**

`lib/portal/storage.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "deliverables";
const ALLOWED_EXTS = new Set(["mp4", "mov", "webm"]);
const STREAM_TTL_SECONDS = 5 * 60;
const DOWNLOAD_TTL_SECONDS = 60 * 60;
const UPLOAD_TTL_SECONDS = 30 * 60;

export function splitExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toLowerCase();
}

export interface ObjectPathInput {
  ownerId: string;
  orderId: string;
  deliverableId: string;
  version: number;
  fileName: string;
}

export function objectPathFor(input: ObjectPathInput): string {
  const ext = splitExtension(input.fileName);
  if (!ext || !ALLOWED_EXTS.has(ext)) {
    throw new Error(`unsupported extension: ${ext ?? "(none)"} — allowed: ${[...ALLOWED_EXTS].join(", ")}`);
  }
  return `${input.ownerId}/${input.orderId}/${input.deliverableId}/v${input.version}.${ext}`;
}

export async function createSignedUploadUrl(
  supabase: SupabaseClient,
  path: string,
): Promise<{ signedUrl: string; token: string }> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`createSignedUploadUrl failed: ${error?.message ?? "no data"}`);
  return { signedUrl: data.signedUrl, token: data.token };
}

export async function createSignedStreamUrl(
  supabase: SupabaseClient,
  path: string,
): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrl(path, STREAM_TTL_SECONDS);
  if (error || !data) throw new Error(`createSignedStreamUrl failed: ${error?.message ?? "no data"}`);
  return data.signedUrl;
}

export async function createSignedDownloadUrl(
  supabase: SupabaseClient,
  path: string,
  downloadFileName: string,
): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrl(path, DOWNLOAD_TTL_SECONDS, { download: downloadFileName });
  if (error || !data) throw new Error(`createSignedDownloadUrl failed: ${error?.message ?? "no data"}`);
  return data.signedUrl;
}

export async function verifyObjectExists(
  supabase: SupabaseClient,
  path: string,
): Promise<boolean> {
  // Storage SDK has no HEAD; list() the parent dir and look for the basename.
  const slash = path.lastIndexOf("/");
  const dir = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const { data, error } = await supabase.storage.from(BUCKET).list(dir, { limit: 100 });
  if (error) throw new Error(`verifyObjectExists list failed: ${error.message}`);
  return !!data?.some((f) => f.name === name);
}

export const STORAGE_CONSTANTS = {
  BUCKET,
  ALLOWED_EXTS,
  STREAM_TTL_SECONDS,
  DOWNLOAD_TTL_SECONDS,
  UPLOAD_TTL_SECONDS,
  MAX_FILE_BYTES: 2 * 1024 ** 3,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/portal/storage.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/portal/storage.ts lib/portal/storage.test.ts
git commit -m "feat(portal/storage): signed URL + object path helpers for deliverables bucket"
```

---

### Task 4: Onboard POST — drop PaymentIntent step

**Files:**
- Modify: `api/portal/onboard/[token].ts`

- [ ] **Step 1: Read the current POST handler**

Run: `sed -n '112,260p' api/portal/onboard/\[token\].ts` to locate the PaymentIntent creation block.

- [ ] **Step 2: Edit the POST handler**

Replace the PaymentIntent creation + return block with the awaiting_delivery transition. The full replacement (everything from step 3 of the original handler through the response) becomes:

```ts
      // After Phase 2: onboarding no longer creates a PaymentIntent. The order
      // sits at awaiting_delivery until the owner uploads. Payment is handled
      // on the review page after the client approves the deliverable.
      const { error: updOrderErr } = await supabase
        .from("portal_orders")
        .update({ status: "awaiting_delivery" })
        .eq("id", order.id);
      if (updOrderErr) {
        console.error("[onboard] order update failed", updOrderErr);
        return res.status(500).json({ error: updOrderErr.message });
      }

      return res.json({ status: "awaiting_delivery" });
    } catch (e) {
      console.error("[onboard] Stripe customer create failed", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  return res.status(405).json({ error: "method not allowed" });
}
```

Also: delete the entire "Re-open: if we have an active PaymentIntent in `requires_payment_method`…" block in the POST entry guard (the `if (existingPiId)` branch). Replace it with:

```ts
    if (order.status !== "awaiting_onboarding") {
      // Form already submitted — the customer is past onboarding. Return the
      // current status so the page can render the appropriate confirmation.
      return res.json({ status: order.status });
    }
```

- [ ] **Step 3: Edit the GET handler**

Delete the entire `let client_secret: string | null = null;` block and its surrounding `if (order.status === "awaiting_payment"...)` retrieval. The GET response becomes:

```ts
    return res.json({
      order: {
        id: order.id,
        title: order.title,
        description: order.description,
        amount_cents: order.amount_cents,
        currency: order.currency,
        line_items: order.line_items,
        status: order.status,
      },
      customer: {
        email: customer.email,
        first_name: customer.first_name,
        last_name: customer.last_name,
        business_name: customer.business_name,
        phone: customer.phone,
        address_line1: customer.address_line1,
        address_line2: customer.address_line2,
        address_city: customer.address_city,
        address_state: customer.address_state,
        address_postal_code: customer.address_postal_code,
        address_country: customer.address_country,
      },
    });
```

- [ ] **Step 4: Remove the now-unused Stripe import branch**

If `getStripe` is still imported but no longer used in this file, delete the import line. Run: `grep -n 'getStripe' api/portal/onboard/\[token\].ts` to confirm zero references before removing the import.

- [ ] **Step 5: Smoke test against dev**

```bash
LE_ALLOW_NONPROD_WRITES=true pnpm run dev
```

Open a new portal order via the dashboard, complete the onboarding form, confirm the response is `{ status: "awaiting_delivery" }` and the order row in `portal_orders` shows `status='awaiting_delivery'` (verify via `mcp__plugin_supabase_supabase__execute_sql`).

- [ ] **Step 6: Commit**

```bash
git add api/portal/onboard/'[token].ts'
git commit -m "feat(portal/onboard): drop PaymentIntent step — payment moves to review approve"
```

---

### Task 5: Onboarding frontend — drop Payment Element

**Files:**
- Modify: `src/pages/Onboard.tsx`

- [ ] **Step 1: Locate the Payment Element mount logic**

Run: `grep -n 'client_secret\|PaymentElement\|stripe' src/pages/Onboard.tsx`. Note every line that references these — they all go away.

- [ ] **Step 2: Edit `src/pages/Onboard.tsx`**

The page now has three render states:
1. `awaiting_onboarding` → render the form (unchanged from current).
2. `awaiting_delivery` (just-submitted OR returning visitor) → render the "Thanks — we'll deliver shortly" confirmation.
3. Any other status (`canceled`, terminal) → render an appropriate state-specific message (use existing terminal-state copy if present).

Replace the conditional block that previously mounted `<PaymentElement>` with the confirmation copy:

```tsx
if (state.order.status === "awaiting_delivery") {
  return (
    <div className="le-onboard-confirm" style={{ /* per DESIGN_STYLE.md §3 §5 */ }}>
      <div className="le-eyebrow">
        <span style={{ width: 14, height: 1, background: "var(--le-border-strong)" }} />
        Thank you
      </div>
      <h2 style={{ fontSize: 56, fontWeight: 500, letterSpacing: "-0.03em", lineHeight: 0.98 }}>
        We'll deliver shortly.
      </h2>
      <p style={{ fontSize: 14, color: "var(--le-text-muted)", maxWidth: 480 }}>
        Your details are saved. We'll email you at <span style={{ fontFamily: "var(--le-font-mono)" }}>{state.customer.email}</span> as soon as your first cut is ready to review. You can close this tab.
      </p>
    </div>
  );
}
```

Strip every import + state hook tied to Stripe Payment Element (the `loadStripe` / `Elements` / `PaymentElement` imports, the `client_secret` state, the `stripePromise` const, the `Elements` wrapper).

- [ ] **Step 3: Verify TypeScript**

Run: `pnpm tsc --noEmit`
Expected: clean. Fix any dangling references.

- [ ] **Step 4: Smoke**

`pnpm run dev`, open an `awaiting_onboarding` order link, submit the form, confirm the confirmation panel renders. Reload the page — confirmation should re-render (no flicker, no form, no payment widget).

- [ ] **Step 5: Commit**

```bash
git add src/pages/Onboard.tsx
git commit -m "feat(portal/onboard): drop Payment Element — show 'we'll deliver shortly' confirmation"
```

---

### Task 6: Update `portalApi` types + add deliverable client functions

**Files:**
- Modify: `src/lib/portalApi.ts`

- [ ] **Step 1: Read current types**

Run: `grep -n 'PortalOrder\|status\|export ' src/lib/portalApi.ts | head -30`

- [ ] **Step 2: Extend the `PortalOrder.status` union**

Find the existing status type and add `'awaiting_delivery'`. The full union should be:

```ts
status:
  | "awaiting_onboarding"
  | "awaiting_delivery"
  | "delivered"
  | "in_review"
  | "revision_requested"
  | "approved"
  | "awaiting_payment"
  | "paid"
  | "canceled";
```

Update `formatStatus` to include `awaiting_delivery: "Awaiting delivery"`.

- [ ] **Step 3: Add deliverable client functions (stubs — implementation lands when API endpoints exist in Batch B)**

Append to `src/lib/portalApi.ts`:

```ts
export interface PortalDeliverable {
  id: string;
  order_id: string;
  title: string;
  description: string | null;
  review_token: string;
  status: "pending" | "in_review" | "revision_requested" | "approved";
  created_at: string;
  updated_at: string;
  versions: PortalDeliverableVersion[];
}

export interface PortalDeliverableVersion {
  id: string;
  version: number;
  file_name: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  upload_note: string | null;
  upload_status: "pending" | "uploaded" | "failed";
  created_at: string;
}

export async function createDeliverable(orderId: string, title: string): Promise<{ deliverable_id: string }> {
  const res = await fetch(`/api/portal/orders/${orderId}/deliverables`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "createDeliverable failed");
  return res.json();
}

export async function createVersion(
  orderId: string,
  deliverableId: string,
  init: { file_name: string; mime_type: string; file_size_bytes: number; upload_note?: string },
): Promise<{ version_id: string; signed_upload_url: string; storage_path: string }> {
  const res = await fetch(`/api/portal/orders/${orderId}/deliverables/${deliverableId}/versions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(init),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "createVersion failed");
  return res.json();
}

export async function finalizeVersion(
  orderId: string,
  deliverableId: string,
  versionId: string,
): Promise<{ status: "uploaded"; order_status: PortalOrder["status"] }> {
  const res = await fetch(
    `/api/portal/orders/${orderId}/deliverables/${deliverableId}/versions/${versionId}/finalize`,
    { method: "POST" },
  );
  if (!res.ok) throw new Error((await res.json()).error ?? "finalizeVersion failed");
  return res.json();
}

export async function deleteDeliverable(orderId: string, deliverableId: string): Promise<void> {
  const res = await fetch(`/api/portal/orders/${orderId}/deliverables/${deliverableId}`, { method: "DELETE" });
  if (!res.ok) throw new Error((await res.json()).error ?? "deleteDeliverable failed");
}
```

- [ ] **Step 4: TypeScript check**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portalApi.ts
git commit -m "feat(portal/api): extend PortalOrder + add deliverable client stubs"
```

---

## Batch B — Owner side

### Task 7: Deliverable helpers (server)

**Files:**
- Create: `lib/portal/deliverables.ts`

- [ ] **Step 1: Write `lib/portal/deliverables.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

export function generateReviewToken(): string {
  // 32 bytes → 64 hex chars. URL-safe by construction.
  return randomBytes(32).toString("hex");
}

export interface CreateDeliverableInput {
  orderId: string;
  title: string;
}

export async function createDeliverable(
  supabase: SupabaseClient,
  input: CreateDeliverableInput,
): Promise<{ id: string; review_token: string }> {
  const review_token = generateReviewToken();
  const { data, error } = await supabase
    .from("portal_deliverables")
    .insert({ order_id: input.orderId, title: input.title, review_token })
    .select("id, review_token")
    .single();
  if (error || !data) throw new Error(`createDeliverable failed: ${error?.message ?? "no data"}`);
  return data;
}

export interface CreateVersionInput {
  deliverableId: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadNote?: string;
  uploadedBy: string;
}

export async function createVersionRow(
  supabase: SupabaseClient,
  input: CreateVersionInput,
  storagePath: string,
): Promise<{ id: string; version: number }> {
  // Determine the next version number for this deliverable.
  const { data: latest } = await supabase
    .from("portal_deliverable_versions")
    .select("version")
    .eq("deliverable_id", input.deliverableId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (latest?.version ?? 0) + 1;

  const { data, error } = await supabase
    .from("portal_deliverable_versions")
    .insert({
      deliverable_id: input.deliverableId,
      version: nextVersion,
      file_name: input.fileName,
      file_size_bytes: input.fileSizeBytes,
      mime_type: input.mimeType,
      upload_note: input.uploadNote ?? null,
      uploaded_by: input.uploadedBy,
      storage_path: storagePath,
      upload_status: "pending",
    })
    .select("id, version")
    .single();
  if (error || !data) throw new Error(`createVersionRow failed: ${error?.message ?? "no data"}`);
  return data;
}

export async function markVersionUploaded(
  supabase: SupabaseClient,
  versionId: string,
): Promise<void> {
  const { error } = await supabase
    .from("portal_deliverable_versions")
    .update({ upload_status: "uploaded" })
    .eq("id", versionId);
  if (error) throw new Error(`markVersionUploaded failed: ${error.message}`);
}

export async function getLatestUploadedVersion(
  supabase: SupabaseClient,
  deliverableId: string,
): Promise<{ id: string; version: number; storage_path: string; file_name: string } | null> {
  const { data, error } = await supabase
    .from("portal_deliverable_versions")
    .select("id, version, storage_path, file_name")
    .eq("deliverable_id", deliverableId)
    .eq("upload_status", "uploaded")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLatestUploadedVersion failed: ${error.message}`);
  return data;
}
```

- [ ] **Step 2: Add test**

`lib/portal/deliverables.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateReviewToken } from "./deliverables.js";

describe("generateReviewToken", () => {
  it("produces a 64-char hex string", () => {
    const t = generateReviewToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces unique tokens", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateReviewToken()));
    expect(tokens.size).toBe(100);
  });
});
```

- [ ] **Step 3: Run test**

Run: `pnpm vitest run lib/portal/deliverables.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
git add lib/portal/deliverables.ts lib/portal/deliverables.test.ts
git commit -m "feat(portal/deliverables): server helpers — create deliverable + version + finalize"
```

---

### Task 8: POST create deliverable endpoint

**Files:**
- Create: `api/portal/orders/[id]/deliverables/index.ts`

- [ ] **Step 1: Write the endpoint**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../../lib/db.js";
import { createDeliverable } from "../../../../../lib/portal/deliverables.js";
import { requireOwner } from "../../../../../lib/portal/auth.js"; // existing helper used in Phase 1

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const orderId = req.query.id as string;
  if (!orderId) return res.status(400).json({ error: "order id required" });

  const supabase = getSupabase();
  const ownerCheck = await requireOwner(req, supabase, orderId);
  if (!ownerCheck.ok) return res.status(ownerCheck.status).json({ error: ownerCheck.error });

  const { title } = (req.body ?? {}) as { title?: string };
  if (!title || typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "title required" });
  }

  try {
    const { id } = await createDeliverable(supabase, { orderId, title: title.trim() });
    return res.status(201).json({ deliverable_id: id });
  } catch (e) {
    console.error("[deliverables/create]", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
```

- [ ] **Step 2: Verify `requireOwner` exists or create it**

Run: `grep -rn 'requireOwner' lib/portal/ api/portal/ 2>/dev/null`. If it doesn't exist, create `lib/portal/auth.ts` with:

```ts
import type { VercelRequest } from "@vercel/node";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface OwnerOk { ok: true; userId: string; }
export interface OwnerErr { ok: false; status: number; error: string; }

export async function requireOwner(
  req: VercelRequest,
  supabase: SupabaseClient,
  orderId: string,
): Promise<OwnerOk | OwnerErr> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return { ok: false, status: 401, error: "missing bearer token" };
  const accessToken = auth.slice(7);

  const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
  if (userErr || !userData.user) return { ok: false, status: 401, error: "invalid session" };

  const { data: order, error: ordErr } = await supabase
    .from("portal_orders")
    .select("id, owner_id")
    .eq("id", orderId)
    .maybeSingle();
  if (ordErr) return { ok: false, status: 500, error: ordErr.message };
  if (!order) return { ok: false, status: 404, error: "order not found" };
  if (order.owner_id !== userData.user.id) return { ok: false, status: 403, error: "not order owner" };

  return { ok: true, userId: userData.user.id };
}
```

- [ ] **Step 3: Manual test**

```bash
pnpm run dev
# Get a session bearer token via the dashboard cookie, then:
curl -X POST http://localhost:3000/api/portal/orders/<order_id>/deliverables \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Main 60s video"}'
# Expected: 201 { "deliverable_id": "..." }
```

Verify row exists:

```sql
SELECT id, title, review_token FROM portal_deliverables WHERE order_id = '<order_id>';
```

- [ ] **Step 4: Commit**

```bash
git add api/portal/orders/'[id]'/deliverables/index.ts lib/portal/auth.ts
git commit -m "feat(portal/api): POST create deliverable"
```

---

### Task 9: POST create version + signed upload URL

**Files:**
- Create: `api/portal/orders/[id]/deliverables/[did]/versions/index.ts`

- [ ] **Step 1: Write the endpoint**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../../../../lib/db.js";
import { requireOwner } from "../../../../../../../lib/portal/auth.js";
import {
  objectPathFor,
  createSignedUploadUrl,
  STORAGE_CONSTANTS,
} from "../../../../../../../lib/portal/storage.js";
import { createVersionRow } from "../../../../../../../lib/portal/deliverables.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const orderId = req.query.id as string;
  const did = req.query.did as string;
  if (!orderId || !did) return res.status(400).json({ error: "order + deliverable id required" });

  const supabase = getSupabase();
  const ownerCheck = await requireOwner(req, supabase, orderId);
  if (!ownerCheck.ok) return res.status(ownerCheck.status).json({ error: ownerCheck.error });

  const body = (req.body ?? {}) as {
    file_name?: string; mime_type?: string; file_size_bytes?: number; upload_note?: string;
  };
  if (!body.file_name || !body.mime_type || typeof body.file_size_bytes !== "number") {
    return res.status(400).json({ error: "file_name, mime_type, file_size_bytes required" });
  }
  if (!body.mime_type.startsWith("video/")) {
    return res.status(400).json({ error: "mime_type must be video/*" });
  }
  if (body.file_size_bytes > STORAGE_CONSTANTS.MAX_FILE_BYTES) {
    return res.status(400).json({ error: `file too large (>${STORAGE_CONSTANTS.MAX_FILE_BYTES} bytes)` });
  }

  // Resolve deliverable → confirm it belongs to this order
  const { data: deliv, error: delivErr } = await supabase
    .from("portal_deliverables")
    .select("id, order_id")
    .eq("id", did)
    .maybeSingle();
  if (delivErr) return res.status(500).json({ error: delivErr.message });
  if (!deliv || deliv.order_id !== orderId) return res.status(404).json({ error: "deliverable not found" });

  try {
    // Determine next version number to compute the storage path first; we need
    // the path to insert the row. Use a transaction-ish pattern: insert with
    // a placeholder path, then update — or use the helper's nextVersion logic.
    const tmpPath = "__pending__";
    const versionRow = await createVersionRow(supabase, {
      deliverableId: did,
      fileName: body.file_name,
      mimeType: body.mime_type,
      fileSizeBytes: body.file_size_bytes,
      uploadNote: body.upload_note,
      uploadedBy: ownerCheck.userId,
    }, tmpPath);

    const storagePath = objectPathFor({
      ownerId: ownerCheck.userId,
      orderId,
      deliverableId: did,
      version: versionRow.version,
      fileName: body.file_name,
    });

    const { error: updErr } = await supabase
      .from("portal_deliverable_versions")
      .update({ storage_path: storagePath })
      .eq("id", versionRow.id);
    if (updErr) throw new Error(updErr.message);

    const signed = await createSignedUploadUrl(supabase, storagePath);

    return res.status(201).json({
      version_id: versionRow.id,
      signed_upload_url: signed.signedUrl,
      storage_path: storagePath,
    });
  } catch (e) {
    console.error("[versions/create]", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
```

- [ ] **Step 2: Manual test**

```bash
curl -X POST http://localhost:3000/api/portal/orders/<oid>/deliverables/<did>/versions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"file_name":"walkthrough.mp4","mime_type":"video/mp4","file_size_bytes":47000000}'
# Expected: 201 { "version_id": "...", "signed_upload_url": "https://...", "storage_path": "<owner>/<order>/<deliv>/v1.mp4" }
```

Then test the signed URL with a small file:

```bash
curl -X PUT "<signed_upload_url>" \
  --data-binary @/path/to/small-test.mp4 \
  -H "Content-Type: video/mp4"
# Expected: 200
```

- [ ] **Step 3: Commit**

```bash
git add api/portal/orders/'[id]'/deliverables/'[did]'/versions/index.ts
git commit -m "feat(portal/api): POST create version + signed upload URL"
```

---

### Task 10: POST finalize version

**Files:**
- Create: `api/portal/orders/[id]/deliverables/[did]/versions/[vid]/finalize.ts`

- [ ] **Step 1: Write the endpoint**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../../../../../lib/db.js";
import { requireOwner } from "../../../../../../../../lib/portal/auth.js";
import { verifyObjectExists } from "../../../../../../../../lib/portal/storage.js";
import { markVersionUploaded } from "../../../../../../../../lib/portal/deliverables.js";
import { computeNextOrderStatus, type OrderStatus } from "../../../../../../../../lib/portal/state.js";

const STATES_THAT_FLIP_ON_UPLOAD: OrderStatus[] = ["awaiting_delivery", "delivered", "in_review", "revision_requested"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const orderId = req.query.id as string;
  const did = req.query.did as string;
  const vid = req.query.vid as string;
  if (!orderId || !did || !vid) return res.status(400).json({ error: "ids required" });

  const supabase = getSupabase();
  const ownerCheck = await requireOwner(req, supabase, orderId);
  if (!ownerCheck.ok) return res.status(ownerCheck.status).json({ error: ownerCheck.error });

  // Resolve version + verify it belongs to this deliverable + order
  const { data: ver, error: verErr } = await supabase
    .from("portal_deliverable_versions")
    .select("id, deliverable_id, storage_path, upload_status")
    .eq("id", vid)
    .maybeSingle();
  if (verErr) return res.status(500).json({ error: verErr.message });
  if (!ver || ver.deliverable_id !== did) return res.status(404).json({ error: "version not found" });
  if (ver.upload_status === "uploaded") return res.status(409).json({ error: "already finalized" });

  // Verify the object actually landed
  const exists = await verifyObjectExists(supabase, ver.storage_path);
  if (!exists) return res.status(409).json({ error: "object not found in storage" });

  await markVersionUploaded(supabase, vid);

  // Advance order state
  const { data: order, error: ordErr } = await supabase
    .from("portal_orders")
    .select("status")
    .eq("id", orderId)
    .single();
  if (ordErr || !order) return res.status(500).json({ error: ordErr?.message ?? "order missing" });

  if (STATES_THAT_FLIP_ON_UPLOAD.includes(order.status as OrderStatus)) {
    const next = computeNextOrderStatus(order.status as OrderStatus, "version_uploaded");
    if (next !== order.status) {
      const { error: updErr } = await supabase
        .from("portal_orders")
        .update({ status: next })
        .eq("id", orderId);
      if (updErr) return res.status(500).json({ error: updErr.message });
    }
  }

  const { data: refreshed } = await supabase
    .from("portal_orders").select("status").eq("id", orderId).single();

  return res.json({ status: "uploaded", order_status: refreshed?.status });
}
```

- [ ] **Step 2: Manual test**

After uploading via the signed URL from Task 9, call:

```bash
curl -X POST http://localhost:3000/api/portal/orders/<oid>/deliverables/<did>/versions/<vid>/finalize \
  -H "Authorization: Bearer <token>"
# Expected: { "status": "uploaded", "order_status": "delivered" }
```

Verify in DB:

```sql
SELECT status FROM portal_orders WHERE id = '<oid>';        -- delivered
SELECT upload_status FROM portal_deliverable_versions WHERE id = '<vid>';   -- uploaded
```

- [ ] **Step 3: Commit**

```bash
git add api/portal/orders/'[id]'/deliverables/'[did]'/versions/'[vid]'/finalize.ts
git commit -m "feat(portal/api): POST finalize version — verify + advance order state"
```

---

### Task 11: DELETE deliverable (only if no uploaded versions)

**Files:**
- Create: `api/portal/orders/[id]/deliverables/[did]/index.ts`

- [ ] **Step 1: Write the endpoint**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../../../lib/db.js";
import { requireOwner } from "../../../../../../lib/portal/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "DELETE") return res.status(405).json({ error: "method not allowed" });

  const orderId = req.query.id as string;
  const did = req.query.did as string;
  if (!orderId || !did) return res.status(400).json({ error: "ids required" });

  const supabase = getSupabase();
  const ownerCheck = await requireOwner(req, supabase, orderId);
  if (!ownerCheck.ok) return res.status(ownerCheck.status).json({ error: ownerCheck.error });

  // Disallow delete if any version is uploaded — preserves audit trail.
  const { data: uploaded, error: vErr } = await supabase
    .from("portal_deliverable_versions")
    .select("id")
    .eq("deliverable_id", did)
    .eq("upload_status", "uploaded")
    .limit(1);
  if (vErr) return res.status(500).json({ error: vErr.message });
  if (uploaded && uploaded.length > 0) {
    return res.status(409).json({ error: "deliverable has uploaded versions; cannot delete" });
  }

  const { error: delErr } = await supabase
    .from("portal_deliverables")
    .delete()
    .eq("id", did)
    .eq("order_id", orderId);
  if (delErr) return res.status(500).json({ error: delErr.message });

  return res.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add api/portal/orders/'[id]'/deliverables/'[did]'/index.ts
git commit -m "feat(portal/api): DELETE deliverable (only if no uploaded versions)"
```

---

### Task 12: OrderDetail tabs scaffold

**Files:**
- Create: `src/pages/dashboard/OrderDetailTabs.tsx`
- Modify: `src/pages/dashboard/OrderDetail.tsx`

- [ ] **Step 1: Write the tab component**

`src/pages/dashboard/OrderDetailTabs.tsx`:

```tsx
import { useState, type ReactNode } from "react";

type TabKey = "overview" | "deliverables" | "activity";

interface Tab { key: TabKey; label: string; count?: number | null; content: ReactNode; }

interface Props {
  tabs: Tab[];
  defaultTab?: TabKey;
}

export function OrderDetailTabs({ tabs, defaultTab = "overview" }: Props) {
  const [active, setActive] = useState<TabKey>(defaultTab);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div>
      {/* Per DESIGN_STYLE.md §3.4: hairline-divided tabs, mono labels, ink underline on active. */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--le-border)" }}>
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              style={{
                padding: "10px 14px",
                background: "transparent",
                border: "none",
                borderBottom: `2px solid ${isActive ? "var(--le-text)" : "transparent"}`,
                fontSize: 13,
                fontWeight: 500,
                letterSpacing: "-0.005em",
                color: isActive ? "var(--le-text)" : "var(--le-text-muted)",
                cursor: "pointer",
              }}
            >
              {t.label}
              {typeof t.count === "number" && (
                <span style={{
                  marginLeft: 6,
                  fontFamily: "var(--le-font-mono)",
                  fontSize: 11,
                  color: "var(--le-text-faint)",
                }}>{t.count}</span>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ paddingTop: 24 }}>{current.content}</div>
    </div>
  );
}
```

- [ ] **Step 2: Integrate into OrderDetail.tsx**

Find the section of `src/pages/dashboard/OrderDetail.tsx` that renders the stage rail + customer info. Wrap that existing content as the `overview` tab's content, and add empty placeholder cells for `deliverables` and `activity` (filled in Tasks 13/22). Skeleton:

```tsx
import { OrderDetailTabs } from "./OrderDetailTabs";
import { OrderDeliverables } from "./OrderDeliverables";    // Task 13
import { OrderActivity } from "./OrderActivity";              // Task 22

// ... inside the rendered JSX, replace the stage-rail+customer block with:
<OrderDetailTabs
  tabs={[
    { key: "overview", label: "Overview", content: <OverviewContent order={order} onboardingUrl={onboardingUrl} /> },
    { key: "deliverables", label: "Deliverables", count: deliverables.length, content: <OrderDeliverables orderId={order.id} /> },
    { key: "activity", label: "Activity", content: <OrderActivity orderId={order.id} /> },
  ]}
/>
```

`OverviewContent` is just the existing stage rail + customer + payment block extracted into a local component. `deliverables` is fetched alongside the order — extend the `getOrder` API to return them (covered in Task 13).

- [ ] **Step 3: TypeScript check**

Run: `pnpm tsc --noEmit`
Expected: clean (tolerating temporary "module not found" for OrderDeliverables/OrderActivity — those are next tasks).

- [ ] **Step 4: Commit**

```bash
git add src/pages/dashboard/OrderDetailTabs.tsx src/pages/dashboard/OrderDetail.tsx
git commit -m "feat(portal/ui): OrderDetail tabs scaffold (Overview / Deliverables / Activity)"
```

---

### Task 13: Deliverables tab content + add-deliverable + upload widget

**Files:**
- Create: `src/pages/dashboard/OrderDeliverables.tsx`
- Modify: `src/lib/portalApi.ts` (extend `getOrder` to include deliverables)
- Modify: `api/portal/orders/[id].ts` (server-side: include deliverables in GET response)

- [ ] **Step 1: Extend the GET order endpoint**

Read `api/portal/orders/[id].ts` to find the existing SELECT. Add a join:

```ts
const { data: deliverables } = await supabase
  .from("portal_deliverables")
  .select(`
    id, title, status, review_token, created_at, updated_at,
    versions:portal_deliverable_versions(id, version, file_name, file_size_bytes, mime_type, upload_note, upload_status, created_at)
  `)
  .eq("order_id", orderId)
  .order("created_at", { ascending: true });

// Add to response:
return res.json({ order, onboarding_url, deliverables: deliverables ?? [] });
```

Update the response type in `src/lib/portalApi.ts`:

```ts
export interface GetOrderResponse {
  order: PortalOrder;
  onboarding_url: string | null;
  deliverables: PortalDeliverable[];
}
```

- [ ] **Step 2: Write `OrderDeliverables.tsx`**

```tsx
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  createDeliverable, createVersion, finalizeVersion, deleteDeliverable,
  type PortalDeliverable,
} from "@/lib/portalApi";

interface Props { orderId: string; }

export function OrderDeliverables({ orderId }: Props) {
  const [deliverables, setDeliverables] = useState<PortalDeliverable[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  async function reload() {
    const res = await fetch(`/api/portal/orders/${orderId}`);
    const json = await res.json();
    setDeliverables(json.deliverables ?? []);
    setLoading(false);
  }

  useEffect(() => { reload(); }, [orderId]);

  if (loading) return <div className="le-shimmer" style={{ height: 80 }} />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div className="le-eyebrow">
          <span style={{ width: 14, height: 1, background: "var(--le-border-strong)" }} />
          Deliverables ({deliverables.length})
        </div>
        <button
          onClick={() => setAddOpen(true)}
          style={{ background: "var(--le-accent)", color: "var(--le-accent-fg)", border: 0, padding: "10px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}
        >
          + Add deliverable
        </button>
      </div>

      {deliverables.length === 0 ? (
        <p style={{ color: "var(--le-text-muted)", fontSize: 14 }}>
          No deliverables yet. Click <strong>Add deliverable</strong> to upload the first version.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {deliverables.map((d) => (
            <DeliverableCard key={d.id} deliverable={d} orderId={orderId} onChange={reload} />
          ))}
        </ul>
      )}

      {addOpen && (
        <AddDeliverableModal
          orderId={orderId}
          onClose={() => setAddOpen(false)}
          onCreated={() => { setAddOpen(false); reload(); }}
        />
      )}
    </div>
  );
}

function DeliverableCard({ deliverable, orderId, onChange }: { deliverable: PortalDeliverable; orderId: string; onChange: () => void }) {
  const latest = [...deliverable.versions].sort((a, b) => b.version - a.version).find((v) => v.upload_status === "uploaded");
  const reviewUrl = `${window.location.origin}/review/${deliverable.review_token}`;

  function copyLink() {
    navigator.clipboard.writeText(reviewUrl).then(() => toast.success("Review link copied"));
  }

  return (
    <li style={{ borderTop: "1px solid var(--le-border)", padding: "18px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 18 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 500, letterSpacing: "-0.01em" }}>{deliverable.title}</div>
          <div style={{ fontFamily: "var(--le-font-mono)", fontSize: 11, color: "var(--le-text-faint)", marginTop: 4 }}>
            {latest ? `v${latest.version} · ${formatBytes(latest.file_size_bytes)} · ${relativeTime(latest.created_at)}` : "no uploaded version"}
          </div>
        </div>
        <StatusPill status={deliverable.status} />
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <UploadButton orderId={orderId} deliverableId={deliverable.id} onUploaded={onChange} />
        <button onClick={copyLink} style={ghostBtn}>Copy review link</button>
      </div>
    </li>
  );
}

// (UploadButton, AddDeliverableModal, StatusPill, formatBytes, relativeTime, ghostBtn defined below — keeping in same file for v1 simplicity)
```

(Continue with `UploadButton`, `AddDeliverableModal`, and helpers. `UploadButton` calls `createVersion` → PUT to the signed URL with XHR for progress → `finalizeVersion`. `AddDeliverableModal` is an underline-input + Create button.)

Detailed body for the auxiliary components (paste into the same file under the `DeliverableCard` component):

```tsx
function UploadButton({ orderId, deliverableId, onUploaded }: { orderId: string; deliverableId: string; onUploaded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  async function onFile(file: File) {
    setBusy(true);
    setProgress(0);
    try {
      const v = await createVersion(orderId, deliverableId, {
        file_name: file.name,
        mime_type: file.type || "video/mp4",
        file_size_bytes: file.size,
      });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", v.signed_upload_url);
        xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100)); };
        xhr.onload = () => xhr.status < 300 ? resolve() : reject(new Error(`upload failed: ${xhr.status}`));
        xhr.onerror = () => reject(new Error("upload network error"));
        xhr.send(file);
      });
      await finalizeVersion(orderId, deliverableId, v.version_id);
      toast.success("Uploaded");
      onUploaded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  return (
    <label style={{ ...ghostBtn, cursor: busy ? "wait" : "pointer", position: "relative", overflow: "hidden" }}>
      <input
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        disabled={busy}
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        style={{ position: "absolute", inset: 0, opacity: 0, cursor: busy ? "wait" : "pointer" }}
      />
      {busy ? `Uploading ${progress}%` : "↑ Upload new version"}
      {busy && (
        <span style={{ position: "absolute", left: 0, bottom: 0, height: 1, background: "var(--le-text)", width: `${progress}%`, transition: "width 0.1s linear" }} />
      )}
    </label>
  );
}

function AddDeliverableModal({ orderId, onClose, onCreated }: { orderId: string; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await createDeliverable(orderId, title.trim());
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(5,7,16,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ background: "var(--le-bg)", padding: 32, minWidth: 420, border: "1px solid var(--le-border)" }}>
        <div className="le-eyebrow"><span style={{ width: 14, height: 1, background: "var(--le-border-strong)" }} />New deliverable</div>
        <h3 style={{ fontSize: 34, fontWeight: 500, letterSpacing: "-0.025em", margin: "12px 0 24px" }}>What is this?</h3>
        <label style={{ display: "block" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--le-text-faint)", fontWeight: 500 }}>Title</div>
          <input
            value={title} onChange={(e) => setTitle(e.target.value)} autoFocus
            placeholder="Main 60s video"
            style={{ width: "100%", marginTop: 10, padding: "10px 0", border: "none", borderBottom: "1px solid var(--le-border-strong)", fontSize: 17, fontWeight: 500, background: "transparent", outline: "none" }}
          />
        </label>
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 28 }}>
          <button type="button" onClick={onClose} style={ghostBtn}>Cancel</button>
          <button type="submit" disabled={busy || !title.trim()} style={{ ...primaryBtn, opacity: busy || !title.trim() ? 0.4 : 1 }}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

function StatusPill({ status }: { status: PortalDeliverable["status"] }) {
  const map: Record<typeof status, { fg: string; bg: string; label: string }> = {
    pending: { fg: "var(--le-text-muted)", bg: "var(--le-bg-sunken)", label: "Pending" },
    in_review: { fg: "oklch(0.4 0.13 240)", bg: "oklch(0.94 0.04 240)", label: "In review" },
    revision_requested: { fg: "oklch(0.4 0.14 75)", bg: "oklch(0.95 0.05 75)", label: "Revision" },
    approved: { fg: "oklch(0.4 0.15 155)", bg: "oklch(0.94 0.05 155)", label: "Approved" },
  };
  const s = map[status];
  return (
    <span style={{ fontFamily: "var(--le-font-mono)", fontSize: 11, fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase", color: s.fg, background: s.bg, padding: "3px 8px", borderRadius: 999, alignSelf: "flex-start" }}>
      {s.label}
    </span>
  );
}

function formatBytes(b: number | null): string {
  if (!b) return "?";
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const ghostBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--le-border-strong)",
  color: "var(--le-text)",
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  background: "var(--le-accent)",
  color: "var(--le-accent-fg)",
  border: 0,
  padding: "10px 16px",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};
```

- [ ] **Step 3: Smoke**

`pnpm run dev`, open an order in `awaiting_delivery`, click Deliverables tab, add a deliverable, upload a small mp4. Verify order status flips to `delivered`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/dashboard/OrderDeliverables.tsx src/lib/portalApi.ts api/portal/orders/'[id].ts'
git commit -m "feat(portal/ui): Deliverables tab — add modal, upload widget, version list"
```

---

## Batch C — Client side + payment

### Task 14: GET review endpoint

**Files:**
- Create: `api/portal/review/[token]/index.ts`

- [ ] **Step 1: Write the endpoint**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../lib/db.js";
import { createSignedStreamUrl } from "../../../../lib/portal/storage.js";
import { computeNextOrderStatus, type OrderStatus } from "../../../../lib/portal/state.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  const token = req.query.token as string;
  if (!token) return res.status(400).json({ error: "token required" });

  const supabase = getSupabase();

  // Resolve deliverable → its order + versions + comments
  const { data: deliv, error: dErr } = await supabase
    .from("portal_deliverables")
    .select(`
      id, order_id, title, description, status, review_token, created_at,
      order:portal_orders(id, title, amount_cents, currency, status, customer_id),
      versions:portal_deliverable_versions(id, version, file_name, storage_path, upload_status, created_at),
      comments:portal_comments(id, version_id, kind, body, video_timestamp_seconds, author_first_name, author_last_name, created_at)
    `)
    .eq("review_token", token)
    .maybeSingle();
  if (dErr) return res.status(500).json({ error: dErr.message });
  if (!deliv) return res.status(404).json({ error: "invalid link" });

  const uploadedVersions = (deliv.versions ?? [])
    .filter((v: { upload_status: string }) => v.upload_status === "uploaded")
    .sort((a: { version: number }, b: { version: number }) => a.version - b.version);
  if (uploadedVersions.length === 0) {
    return res.status(409).json({ error: "no uploaded versions yet" });
  }

  const latest = uploadedVersions[uploadedVersions.length - 1] as { id: string; version: number; storage_path: string };
  const stream_url = await createSignedStreamUrl(supabase, latest.storage_path);

  // First-view side effect: if order is `delivered`, flip to `in_review`.
  const order = deliv.order as { id: string; status: OrderStatus; title: string; amount_cents: number; currency: string };
  if (order.status === "delivered") {
    try {
      const next = computeNextOrderStatus("delivered", "client_opened");
      await supabase.from("portal_orders").update({ status: next }).eq("id", order.id);
    } catch { /* idempotent — ignore */ }
  }

  return res.json({
    deliverable: { id: deliv.id, title: deliv.title, description: deliv.description, status: deliv.status },
    order: { id: order.id, title: order.title, status: order.status, amount_cents: order.amount_cents, currency: order.currency },
    versions: uploadedVersions.map((v: { id: string; version: number; file_name: string; created_at: string }) => ({
      id: v.id, version: v.version, file_name: v.file_name, created_at: v.created_at,
    })),
    latest_version_id: latest.id,
    stream_url,
    comments: (deliv.comments ?? []).map((c: { id: string; version_id: string; kind: string; body: string | null; video_timestamp_seconds: number | null; author_first_name: string; author_last_name: string; created_at: string }) => ({
      id: c.id, version_id: c.version_id, kind: c.kind, body: c.body,
      video_timestamp_seconds: c.video_timestamp_seconds,
      author: `${c.author_first_name} ${c.author_last_name}`,
      created_at: c.created_at,
    })),
  });
}
```

- [ ] **Step 2: Manual test**

```bash
curl http://localhost:3000/api/portal/review/<token>
# Expected: { deliverable, order, versions, latest_version_id, stream_url, comments }
```

- [ ] **Step 3: Commit**

```bash
git add api/portal/review/'[token]'/index.ts
git commit -m "feat(portal/api): GET review — deliverable + stream url + comments + auto delivered→in_review"
```

---

### Task 15: Stream URL endpoint (per version)

**Files:**
- Create: `api/portal/review/[token]/versions/[vid]/stream.ts`

- [ ] **Step 1: Write the endpoint**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../../../lib/db.js";
import { createSignedStreamUrl } from "../../../../../../lib/portal/storage.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  const token = req.query.token as string;
  const vid = req.query.vid as string;
  if (!token || !vid) return res.status(400).json({ error: "token + vid required" });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("portal_deliverable_versions")
    .select("id, storage_path, upload_status, deliverable:portal_deliverables(review_token)")
    .eq("id", vid)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  const deliverable = data?.deliverable as { review_token: string } | null;
  if (!data || !deliverable || deliverable.review_token !== token) return res.status(404).json({ error: "not found" });
  if (data.upload_status !== "uploaded") return res.status(409).json({ error: "version not ready" });

  const stream_url = await createSignedStreamUrl(supabase, data.storage_path);
  return res.json({ stream_url });
}
```

- [ ] **Step 2: Commit**

```bash
git add api/portal/review/'[token]'/versions/'[vid]'/stream.ts
git commit -m "feat(portal/api): GET per-version stream url"
```

---

### Task 16: Comments endpoint (GET + POST + revision_request)

**Files:**
- Create: `api/portal/review/[token]/comments.ts`

- [ ] **Step 1: Write the endpoint**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../lib/db.js";
import { computeNextOrderStatus, type OrderStatus } from "../../../../lib/portal/state.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = req.query.token as string;
  if (!token) return res.status(400).json({ error: "token required" });

  const supabase = getSupabase();
  const { data: deliv, error: dErr } = await supabase
    .from("portal_deliverables")
    .select("id, order_id, order:portal_orders(id, status, customer_id, owner_id)")
    .eq("review_token", token)
    .maybeSingle();
  if (dErr) return res.status(500).json({ error: dErr.message });
  if (!deliv) return res.status(404).json({ error: "invalid link" });

  if (req.method === "GET") {
    const { data: comments } = await supabase
      .from("portal_comments")
      .select("id, version_id, kind, body, video_timestamp_seconds, author_first_name, author_last_name, created_at")
      .eq("deliverable_id", deliv.id)
      .order("created_at", { ascending: true });
    return res.json({ comments: comments ?? [] });
  }

  if (req.method === "POST") {
    // Session required for writes
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "session required" });
    const { data: userData, error: userErr } = await supabase.auth.getUser(auth.slice(7));
    if (userErr || !userData.user) return res.status(401).json({ error: "invalid session" });

    // Authorize: user must be the order owner OR the customer.user_id
    const order = deliv.order as { id: string; status: OrderStatus; customer_id: string; owner_id: string };
    const { data: cust } = await supabase
      .from("portal_customers").select("user_id, first_name, last_name, email").eq("id", order.customer_id).single();
    const isOwner = order.owner_id === userData.user.id;
    const isCustomer = cust?.user_id === userData.user.id;
    if (!isOwner && !isCustomer) return res.status(403).json({ error: "not authorized" });

    const body = (req.body ?? {}) as { body?: string; video_timestamp_seconds?: number; kind?: "comment" | "revision_request"; version_id?: string };
    const kind = body.kind ?? "comment";
    if (!body.body || !body.body.trim()) return res.status(400).json({ error: "body required" });
    if (!body.version_id) return res.status(400).json({ error: "version_id required" });

    // Author name: use the customer's name if customer; the user's email-derived name if owner.
    const author_first_name = isCustomer ? cust!.first_name : "Owner";
    const author_last_name = isCustomer ? cust!.last_name : "";
    const author_email = isCustomer ? cust!.email : (userData.user.email ?? "");

    const { data: inserted, error: insErr } = await supabase
      .from("portal_comments")
      .insert({
        deliverable_id: deliv.id,
        version_id: body.version_id,
        author_user_id: userData.user.id,
        author_first_name, author_last_name, author_email,
        kind, body: body.body.trim(),
        video_timestamp_seconds: typeof body.video_timestamp_seconds === "number" ? body.video_timestamp_seconds : null,
      })
      .select("id")
      .single();
    if (insErr || !inserted) return res.status(500).json({ error: insErr?.message ?? "insert failed" });

    // If revision_request: advance order state
    if (kind === "revision_request") {
      try {
        const next = computeNextOrderStatus(order.status, "revision_requested");
        await supabase.from("portal_orders").update({ status: next }).eq("id", order.id);
      } catch (e) {
        // Illegal transition (e.g. revision requested twice without an upload in between). Leave state as-is.
        console.warn("[comments POST] revision transition skipped", e);
      }
    }

    // (Notification wiring is added in Task 22 once lib/portal/notifications.ts lands.
    //  The endpoint must not block on notifications — they fire-and-forget.)

    return res.status(201).json({ comment_id: inserted.id });
  }

  return res.status(405).json({ error: "method not allowed" });
}
```

- [ ] **Step 2: Commit**

```bash
git add api/portal/review/'[token]'/comments.ts
git commit -m "feat(portal/api): comments GET+POST with revision_request state transition"
```

---

### Task 17: Approve endpoint (creates PaymentIntent)

**Files:**
- Create: `api/portal/review/[token]/approve.ts`

- [ ] **Step 1: Write the endpoint**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../lib/db.js";
import { getStripe } from "../../../../lib/portal/stripe.js";
import { computeNextOrderStatus, type OrderStatus } from "../../../../lib/portal/state.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const token = req.query.token as string;
  if (!token) return res.status(400).json({ error: "token required" });

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "session required" });
  const supabase = getSupabase();
  const { data: userData, error: userErr } = await supabase.auth.getUser(auth.slice(7));
  if (userErr || !userData.user) return res.status(401).json({ error: "invalid session" });

  const { data: deliv, error: dErr } = await supabase
    .from("portal_deliverables")
    .select("id, order:portal_orders(id, status, amount_cents, currency, customer_id, stripe_payment_intent_id), versions:portal_deliverable_versions(id, version, upload_status)")
    .eq("review_token", token)
    .maybeSingle();
  if (dErr) return res.status(500).json({ error: dErr.message });
  if (!deliv) return res.status(404).json({ error: "invalid link" });

  const order = deliv.order as { id: string; status: OrderStatus; amount_cents: number; currency: string; customer_id: string; stripe_payment_intent_id: string | null };
  const { data: cust } = await supabase
    .from("portal_customers").select("user_id, stripe_customer_id").eq("id", order.customer_id).single();
  if (cust?.user_id !== userData.user.id) return res.status(403).json({ error: "must be customer" });
  if (!cust.stripe_customer_id) return res.status(409).json({ error: "no stripe customer; complete onboarding first" });

  const latestUploaded = (deliv.versions as { id: string; version: number; upload_status: string }[])
    .filter((v) => v.upload_status === "uploaded")
    .sort((a, b) => b.version - a.version)[0];
  if (!latestUploaded) return res.status(409).json({ error: "no uploaded version" });

  // Idempotency: if we already have a PaymentIntent for this order in
  // requires_payment_method state, return its client_secret instead of creating a new one.
  const stripe = getStripe();
  if (order.stripe_payment_intent_id) {
    try {
      const existing = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id);
      if (existing.status === "requires_payment_method" || existing.status === "requires_confirmation") {
        return res.json({ client_secret: existing.client_secret });
      }
    } catch (e) {
      console.warn("[approve] failed to retrieve existing PI; creating new", e);
    }
  }

  // Write the approval comment + advance state to approved
  await supabase.from("portal_comments").insert({
    deliverable_id: deliv.id,
    version_id: latestUploaded.id,
    author_user_id: userData.user.id,
    author_first_name: "Customer",
    author_last_name: "",
    author_email: userData.user.email ?? "",
    kind: "approval",
  });

  try {
    const next1 = computeNextOrderStatus(order.status, "approved");
    await supabase.from("portal_orders").update({ status: next1, approved_at: new Date().toISOString() }).eq("id", order.id);
  } catch (e) {
    return res.status(409).json({ error: e instanceof Error ? e.message : "cannot approve from current state" });
  }

  // Create PaymentIntent
  const pi = await stripe.paymentIntents.create(
    {
      amount: order.amount_cents,
      currency: order.currency,
      customer: cust.stripe_customer_id,
      automatic_payment_methods: { enabled: true },
      metadata: {
        portal_order_id: order.id,
        flow: "approve_pay",
      },
    },
    { idempotencyKey: `portal-approve-${order.id}` },
  );

  await supabase.from("portal_orders")
    .update({ status: "awaiting_payment", stripe_payment_intent_id: pi.id })
    .eq("id", order.id);

  return res.json({ client_secret: pi.client_secret });
}
```

- [ ] **Step 2: Commit**

```bash
git add api/portal/review/'[token]'/approve.ts
git commit -m "feat(portal/api): POST approve — write approval row, create PaymentIntent (approve_pay flow)"
```

---

### Task 18: Status + download + magic-link endpoints

**Files:**
- Create: `api/portal/review/[token]/status.ts`
- Create: `api/portal/review/[token]/download.ts`
- Create: `api/portal/review/[token]/sign-in/magic-link.ts`

- [ ] **Step 1: Write `status.ts`**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  const token = req.query.token as string;
  if (!token) return res.status(400).json({ error: "token required" });
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("portal_deliverables")
    .select("order:portal_orders(status)")
    .eq("review_token", token)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "not found" });
  const order = data.order as { status: string } | null;
  return res.json({ order_status: order?.status ?? null });
}
```

- [ ] **Step 2: Write `download.ts`**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../lib/db.js";
import { createSignedDownloadUrl } from "../../../../lib/portal/storage.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  const token = req.query.token as string;
  if (!token) return res.status(400).json({ error: "token required" });

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "session required" });
  const supabase = getSupabase();
  const { data: userData, error: userErr } = await supabase.auth.getUser(auth.slice(7));
  if (userErr || !userData.user) return res.status(401).json({ error: "invalid session" });

  const { data: deliv } = await supabase
    .from("portal_deliverables")
    .select(`
      id, title,
      order:portal_orders(id, status, customer_id),
      versions:portal_deliverable_versions(id, version, storage_path, file_name, upload_status)
    `)
    .eq("review_token", token)
    .maybeSingle();
  if (!deliv) return res.status(404).json({ error: "not found" });
  const order = deliv.order as { status: string; customer_id: string };
  if (order.status !== "paid") return res.status(403).json({ error: "not paid" });

  const { data: cust } = await supabase
    .from("portal_customers").select("user_id").eq("id", order.customer_id).single();
  if (cust?.user_id !== userData.user.id) return res.status(403).json({ error: "not customer" });

  const latest = (deliv.versions as { id: string; version: number; storage_path: string; file_name: string; upload_status: string }[])
    .filter((v) => v.upload_status === "uploaded")
    .sort((a, b) => b.version - a.version)[0];
  if (!latest) return res.status(404).json({ error: "no version" });

  const url = await createSignedDownloadUrl(supabase, latest.storage_path, latest.file_name);
  res.setHeader("Location", url);
  return res.status(302).end();
}
```

- [ ] **Step 3: Write `sign-in/magic-link.ts`**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const token = req.query.token as string;
  if (!token) return res.status(400).json({ error: "token required" });

  const supabase = getSupabase();
  const { data: deliv } = await supabase
    .from("portal_deliverables")
    .select("order:portal_orders(customer_id)")
    .eq("review_token", token)
    .maybeSingle();
  if (!deliv) return res.status(404).json({ error: "not found" });
  const order = deliv.order as { customer_id: string };
  const { data: cust } = await supabase
    .from("portal_customers").select("email").eq("id", order.customer_id).single();
  if (!cust) return res.status(404).json({ error: "no customer" });

  const { error } = await supabase.auth.signInWithOtp({
    email: cust.email,
    options: { emailRedirectTo: `${process.env.PUBLIC_BASE_URL ?? ""}/review/${token}` },
  });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, email: cust.email });
}
```

- [ ] **Step 4: Commit**

```bash
git add api/portal/review/'[token]'/status.ts api/portal/review/'[token]'/download.ts api/portal/review/'[token]'/sign-in/
git commit -m "feat(portal/api): review status + download + magic-link endpoints"
```

---

### Task 19: Review page route + data load

**Files:**
- Create: `src/lib/reviewApi.ts`
- Create: `src/pages/Review.tsx`
- Modify: `src/App.tsx` (register the `/review/:token` route)

- [ ] **Step 1: Write `src/lib/reviewApi.ts`**

```ts
export interface ReviewVersion { id: string; version: number; file_name: string; created_at: string; }
export interface ReviewComment {
  id: string; version_id: string;
  kind: "comment" | "approval" | "revision_request";
  body: string | null; video_timestamp_seconds: number | null;
  author: string; created_at: string;
}
export interface ReviewPageData {
  deliverable: { id: string; title: string; description: string | null; status: string };
  order: { id: string; title: string; status: string; amount_cents: number; currency: string };
  versions: ReviewVersion[];
  latest_version_id: string;
  stream_url: string;
  comments: ReviewComment[];
}

export async function getReview(token: string): Promise<ReviewPageData> {
  const res = await fetch(`/api/portal/review/${token}`);
  if (!res.ok) throw new Error((await res.json()).error ?? "load failed");
  return res.json();
}

export async function getVersionStream(token: string, versionId: string): Promise<string> {
  const res = await fetch(`/api/portal/review/${token}/versions/${versionId}/stream`);
  if (!res.ok) throw new Error((await res.json()).error ?? "stream failed");
  return (await res.json()).stream_url;
}

export async function getOrderStatus(token: string): Promise<string | null> {
  const res = await fetch(`/api/portal/review/${token}/status`);
  if (!res.ok) return null;
  return (await res.json()).order_status;
}

export async function postComment(
  token: string,
  accessToken: string,
  input: { body: string; video_timestamp_seconds?: number; kind: "comment" | "revision_request"; version_id: string },
): Promise<{ comment_id: string }> {
  const res = await fetch(`/api/portal/review/${token}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "comment failed");
  return res.json();
}

export async function approve(token: string, accessToken: string): Promise<{ client_secret: string }> {
  const res = await fetch(`/api/portal/review/${token}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "approve failed");
  return res.json();
}

export async function requestMagicLink(token: string): Promise<{ ok: true; email: string }> {
  const res = await fetch(`/api/portal/review/${token}/sign-in/magic-link`, { method: "POST" });
  if (!res.ok) throw new Error((await res.json()).error ?? "magic link failed");
  return res.json();
}
```

- [ ] **Step 2: Write `src/pages/Review.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getReview, type ReviewPageData } from "@/lib/reviewApi";
import { ReviewPlayer } from "./review/ReviewPlayer";
import { CommentsRail } from "./review/CommentsRail";
import { ActionBar } from "./review/ActionBar";

export default function Review() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ReviewPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  async function reload() {
    if (!token) return;
    try {
      const d = await getReview(token);
      setData(d);
      setCurrentVersionId(d.latest_version_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { reload(); }, [token]);

  if (error) return <div style={{ padding: 48 }}>{error}</div>;
  if (!data || !token) return <div style={{ padding: 48 }} className="le-shimmer" />;

  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;

  return (
    <div style={{ minHeight: "100vh", background: "var(--le-bg)", color: "var(--le-text)" }}>
      {/* Top bar */}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 24px", borderBottom: "1px solid var(--le-border)" }}>
        <div style={{ fontFamily: "var(--le-font-mono)", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--le-text-faint)" }}>
          {data.order.title} · v{data.versions.find((v) => v.id === currentVersionId)?.version ?? "?"} of {data.versions.length}
        </div>
        <StatusPill status={data.order.status} />
      </div>

      {/* Body */}
      <div style={{ display: "flex", flexDirection: isDesktop ? "row" : "column" }}>
        <div style={{ flex: 1 }}>
          <ReviewPlayer
            token={token} versions={data.versions} currentVersionId={currentVersionId}
            initialStreamUrl={data.stream_url}
            comments={data.comments}
            onTimeUpdate={setCurrentTime}
            onVersionChange={setCurrentVersionId}
          />
          {!isDesktop && (
            <ActionBar token={token} data={data} currentVersionId={currentVersionId ?? data.latest_version_id} onChange={reload} />
          )}
        </div>
        <div style={{ width: isDesktop ? 320 : "auto", borderLeft: isDesktop ? "1px solid var(--le-border)" : "none", borderTop: !isDesktop ? "1px solid var(--le-border)" : "none" }}>
          <CommentsRail
            token={token} comments={data.comments}
            currentVersionId={currentVersionId ?? data.latest_version_id}
            currentTime={currentTime}
            onPosted={reload}
          />
        </div>
      </div>

      {isDesktop && (
        <div style={{ borderTop: "1px solid var(--le-border)" }}>
          <ActionBar token={token} data={data} currentVersionId={currentVersionId ?? data.latest_version_id} onChange={reload} />
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span style={{ fontFamily: "var(--le-font-mono)", fontSize: 11, fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--le-text-muted)" }}>
      ● {status.replace(/_/g, " ")}
    </span>
  );
}
```

- [ ] **Step 3: Register route in `src/App.tsx`**

Find the existing react-router-dom `Routes` and add:

```tsx
<Route path="/review/:token" element={<Review />} />
```

Import: `import Review from "./pages/Review";`

- [ ] **Step 4: Commit**

```bash
git add src/lib/reviewApi.ts src/pages/Review.tsx src/App.tsx
git commit -m "feat(portal/review): scaffold review page route + data load"
```

---

### Task 20: ReviewPlayer + CommentsRail + ActionBar components

**Files:**
- Create: `src/pages/review/ReviewPlayer.tsx`
- Create: `src/pages/review/CommentsRail.tsx`
- Create: `src/pages/review/ActionBar.tsx`

- [ ] **Step 1: Write `ReviewPlayer.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { getVersionStream, type ReviewComment, type ReviewVersion } from "@/lib/reviewApi";

interface Props {
  token: string;
  versions: ReviewVersion[];
  currentVersionId: string | null;
  initialStreamUrl: string;
  comments: ReviewComment[];
  onTimeUpdate: (seconds: number) => void;
  onVersionChange: (versionId: string) => void;
}

export function ReviewPlayer({ token, versions, currentVersionId, initialStreamUrl, comments, onTimeUpdate, onVersionChange }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [streamUrl, setStreamUrl] = useState(initialStreamUrl);
  const [duration, setDuration] = useState(0);

  // Refresh stream URL when version changes (initial URL only valid for latest)
  useEffect(() => {
    if (!currentVersionId) return;
    if (currentVersionId === versions[versions.length - 1]?.id) {
      setStreamUrl(initialStreamUrl);
      return;
    }
    getVersionStream(token, currentVersionId).then(setStreamUrl).catch(console.error);
  }, [token, currentVersionId, versions, initialStreamUrl]);

  const versionComments = comments.filter((c) => c.version_id === currentVersionId && c.video_timestamp_seconds != null);

  return (
    <div style={{ background: "#000" }}>
      <video
        ref={videoRef}
        src={streamUrl}
        controls
        style={{ width: "100%", aspectRatio: "16/9", display: "block" }}
        onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />
      {/* Timeline strip with comment dots */}
      <div style={{ position: "relative", height: 18, background: "#0e0e0e", borderTop: "1px solid var(--le-border)" }}>
        {versionComments.map((c) => (
          <button
            key={c.id}
            onClick={() => { if (videoRef.current) videoRef.current.currentTime = c.video_timestamp_seconds ?? 0; }}
            title={c.body ?? ""}
            style={{
              position: "absolute",
              left: `${duration ? (c.video_timestamp_seconds! / duration) * 100 : 0}%`,
              top: 6,
              width: 6, height: 6, borderRadius: "50%",
              background: "var(--le-text-faint)",
              border: 0, cursor: "pointer", padding: 0,
              transform: "translateX(-50%)",
            }}
          />
        ))}
      </div>
      {/* Version selector */}
      {versions.length > 1 && (
        <div style={{ display: "flex", gap: 12, padding: "10px 18px", borderTop: "1px solid var(--le-border)" }}>
          {versions.map((v) => (
            <button
              key={v.id}
              onClick={() => onVersionChange(v.id)}
              style={{
                background: "transparent", border: 0,
                fontFamily: "var(--le-font-mono)", fontSize: 11, letterSpacing: "0.04em",
                color: v.id === currentVersionId ? "var(--le-text)" : "var(--le-text-faint)",
                borderBottom: v.id === currentVersionId ? "1px solid var(--le-text)" : "1px solid transparent",
                padding: "2px 0", cursor: "pointer",
              }}
            >v{v.version}</button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write `CommentsRail.tsx`**

```tsx
import { useState } from "react";
import { supabase } from "@/lib/supabase"; // existing supabase-js client used in dashboard auth
import { postComment, type ReviewComment } from "@/lib/reviewApi";
import { SignInPanel } from "./SignInPanel";  // Task 21

interface Props {
  token: string;
  comments: ReviewComment[];
  currentVersionId: string;
  currentTime: number;
  onPosted: () => void;
}

export function CommentsRail({ token, comments, currentVersionId, currentTime, onPosted }: Props) {
  const [body, setBody] = useState("");
  const [pin, setPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<{ access_token: string } | null>(null);

  // Subscribe to Supabase auth (existing pattern in dashboard)
  useState(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || !session) return;
    setBusy(true);
    try {
      await postComment(token, session.access_token, {
        body: body.trim(),
        video_timestamp_seconds: pin ? Math.floor(currentTime) : undefined,
        kind: "comment",
        version_id: currentVersionId,
      });
      setBody("");
      onPosted();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--le-border)" }}>
        <div className="le-eyebrow"><span style={{ width: 14, height: 1, background: "var(--le-border-strong)" }} />Comments ({comments.filter((c) => c.kind === "comment").length})</div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 18px" }}>
        {comments.filter((c) => c.kind !== "approval").map((c) => (
          <div key={c.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--le-border)" }}>
            {c.video_timestamp_seconds != null && (
              <div style={{ fontFamily: "var(--le-font-mono)", fontSize: 10, color: "var(--le-text-faint)", marginBottom: 4 }}>
                {Math.floor(c.video_timestamp_seconds / 60)}:{String(c.video_timestamp_seconds % 60).padStart(2, "0")}
              </div>
            )}
            {c.kind === "revision_request" && (
              <div style={{ fontFamily: "var(--le-font-mono)", fontSize: 10, color: "oklch(0.4 0.14 75)", marginBottom: 4 }}>REVISION REQUESTED</div>
            )}
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>{c.body}</div>
            <div style={{ fontFamily: "var(--le-font-mono)", fontSize: 10, color: "var(--le-text-faint)", marginTop: 4 }}>{c.author}</div>
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid var(--le-border)", padding: "12px 18px" }}>
        {session ? (
          <form onSubmit={submit}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--le-font-mono)", fontSize: 10, color: "var(--le-text-faint)", textTransform: "uppercase", letterSpacing: "0.18em", marginBottom: 6 }}>
              <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} />
              Pin to {Math.floor(currentTime / 60)}:{String(Math.floor(currentTime) % 60).padStart(2, "0")}
            </label>
            <textarea
              value={body} onChange={(e) => setBody(e.target.value)}
              placeholder="Add a comment…"
              style={{ width: "100%", padding: "8px 0", border: "none", borderBottom: "1px solid var(--le-border-strong)", background: "transparent", outline: "none", resize: "vertical", fontSize: 14, color: "var(--le-text)" }}
              rows={2}
            />
            <button type="submit" disabled={busy || !body.trim()} style={{ marginTop: 8, background: "var(--le-accent)", color: "var(--le-accent-fg)", border: 0, padding: "8px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer", opacity: busy || !body.trim() ? 0.4 : 1 }}>
              {busy ? "Posting…" : "Post"}
            </button>
          </form>
        ) : (
          <SignInPanel token={token} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `ActionBar.tsx` (without payment panel — that's Task 21)**

```tsx
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { postComment, type ReviewPageData } from "@/lib/reviewApi";
import { PaymentPanel } from "./PaymentPanel";  // Task 21

interface Props {
  token: string;
  data: ReviewPageData;
  currentVersionId: string;
  onChange: () => void;
}

export function ActionBar({ token, data, currentVersionId, onChange }: Props) {
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  if (data.order.status === "paid") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "14px 24px", gap: 12 }}>
        <a
          href={`/api/portal/review/${token}/download`}
          style={{ background: "var(--le-accent)", color: "var(--le-accent-fg)", border: 0, padding: "10px 18px", fontSize: 13, fontWeight: 500, textDecoration: "none" }}
        >
          ↓ Download
        </a>
      </div>
    );
  }

  if (paymentOpen) {
    return <PaymentPanel token={token} amountCents={data.order.amount_cents} currency={data.order.currency} onClose={() => setPaymentOpen(false)} onPaid={onChange} />;
  }

  async function submitRevision() {
    if (!revisionNote.trim()) return;
    setBusy(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) { setBusy(false); return; }
      await postComment(token, session.access_token, {
        body: revisionNote.trim(),
        kind: "revision_request",
        version_id: currentVersionId,
      });
      setRevisionOpen(false);
      setRevisionNote("");
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "14px 24px", gap: 12, background: "var(--le-bg)" }}>
        <button onClick={() => setRevisionOpen(true)} style={{ background: "transparent", border: "1px solid var(--le-border-strong)", padding: "10px 18px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
          Request revision
        </button>
        <button onClick={() => setPaymentOpen(true)} style={{ background: "var(--le-accent)", color: "var(--le-accent-fg)", border: 0, padding: "10px 18px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
          Approve & pay ${(data.order.amount_cents / 100).toFixed(0)}
        </button>
      </div>
      {revisionOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(5,7,16,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setRevisionOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--le-bg)", padding: 32, minWidth: 460, border: "1px solid var(--le-border)" }}>
            <div className="le-eyebrow"><span style={{ width: 14, height: 1, background: "var(--le-border-strong)" }} />Request revision</div>
            <h3 style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-0.02em", margin: "12px 0 18px" }}>What needs to change?</h3>
            <textarea value={revisionNote} onChange={(e) => setRevisionNote(e.target.value)} rows={4} placeholder="Audio is too quiet in the kitchen scene, please redo." style={{ width: "100%", padding: "8px 0", border: "none", borderBottom: "1px solid var(--le-border-strong)", background: "transparent", outline: "none", fontSize: 14, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 20 }}>
              <button onClick={() => setRevisionOpen(false)} style={{ background: "transparent", border: "1px solid var(--le-border-strong)", padding: "10px 16px", fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button onClick={submitRevision} disabled={busy || !revisionNote.trim()} style={{ background: "var(--le-accent)", color: "var(--le-accent-fg)", border: 0, padding: "10px 16px", fontSize: 13, cursor: "pointer", opacity: busy || !revisionNote.trim() ? 0.4 : 1 }}>
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/review/ReviewPlayer.tsx src/pages/review/CommentsRail.tsx src/pages/review/ActionBar.tsx
git commit -m "feat(portal/review): video player + timeline dots + comments rail + action bar"
```

---

### Task 21: SignInPanel + PaymentPanel (Payment Element wrapper)

**Files:**
- Create: `src/pages/review/SignInPanel.tsx`
- Create: `src/pages/review/PaymentPanel.tsx`

- [ ] **Step 1: Write `SignInPanel.tsx`**

```tsx
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { requestMagicLink } from "@/lib/reviewApi";

interface Props { token: string; }

export function SignInPanel({ token }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);

  async function signInPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  async function sendMagic() {
    setBusy(true); setError(null);
    try {
      const { email } = await requestMagicLink(token);
      setMagicSent(true);
      setEmail(email);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  if (magicSent) {
    return (
      <div>
        <div className="le-eyebrow"><span style={{ width: 14, height: 1, background: "var(--le-border-strong)" }} />Check your email</div>
        <p style={{ fontSize: 13, color: "var(--le-text-muted)", marginTop: 8 }}>
          We sent a sign-in link to <span style={{ fontFamily: "var(--le-font-mono)" }}>{email}</span>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={signInPassword}>
      <div className="le-eyebrow"><span style={{ width: 14, height: 1, background: "var(--le-border-strong)" }} />Sign in to comment or approve</div>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" style={{ width: "100%", marginTop: 10, padding: "8px 0", border: "none", borderBottom: "1px solid var(--le-border-strong)", background: "transparent", outline: "none", fontSize: 14 }} />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" style={{ width: "100%", marginTop: 8, padding: "8px 0", border: "none", borderBottom: "1px solid var(--le-border-strong)", background: "transparent", outline: "none", fontSize: 14 }} />
      {error && <p style={{ color: "oklch(0.58 0.17 25)", fontSize: 12, marginTop: 8, fontFamily: "var(--le-font-mono)" }}>ERR {error}</p>}
      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
        <button type="submit" disabled={busy} style={{ background: "var(--le-accent)", color: "var(--le-accent-fg)", border: 0, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>
          {busy ? "…" : "Continue"}
        </button>
        <button type="button" onClick={sendMagic} disabled={busy} style={{ background: "transparent", border: 0, fontSize: 13, color: "var(--le-text)", textDecoration: "underline", textUnderlineOffset: 4, cursor: "pointer" }}>
          Email me a magic link
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Write `PaymentPanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { supabase } from "@/lib/supabase";
import { approve, getOrderStatus } from "@/lib/reviewApi";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY!);

interface Props {
  token: string;
  amountCents: number;
  currency: string;
  onClose: () => void;
  onPaid: () => void;
}

export function PaymentPanel({ token, amountCents, currency, onClose, onPaid }: Props) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        if (!session) { setError("Sign in required"); return; }
        const { client_secret } = await approve(token, session.access_token);
        setClientSecret(client_secret);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [token]);

  if (error) return <div style={{ padding: 18 }}><p style={{ color: "oklch(0.58 0.17 25)", fontFamily: "var(--le-font-mono)", fontSize: 12 }}>ERR {error}</p><button onClick={onClose}>Back</button></div>;
  if (!clientSecret) return <div style={{ padding: 18 }} className="le-shimmer">Preparing payment…</div>;

  return (
    <div style={{ padding: 24 }}>
      <div className="le-eyebrow"><span style={{ width: 14, height: 1, background: "var(--le-border-strong)" }} />Approve & pay {(amountCents / 100).toFixed(0)} {currency.toUpperCase()}</div>
      <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "flat" } }}>
        <PaymentForm token={token} onPaid={onPaid} onCancel={onClose} />
      </Elements>
    </div>
  );
}

function PaymentForm({ token, onPaid, onCancel }: { token: string; onPaid: () => void; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true); setError(null);
    const { error } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (error) { setError(error.message ?? "payment failed"); setBusy(false); return; }
    // Poll status until webhook flips order to paid (up to 30s).
    for (let i = 0; i < 15; i++) {
      const status = await getOrderStatus(token);
      if (status === "paid") { onPaid(); return; }
      await new Promise((r) => setTimeout(r, 2000));
    }
    setError("Payment succeeded but order not flipped yet — refresh in a moment.");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 14 }}>
      <PaymentElement />
      {error && <p style={{ color: "oklch(0.58 0.17 25)", fontFamily: "var(--le-font-mono)", fontSize: 12, marginTop: 8 }}>ERR {error}</p>}
      <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
        <button type="button" onClick={onCancel} style={{ background: "transparent", border: "1px solid var(--le-border-strong)", padding: "10px 16px", fontSize: 13, cursor: "pointer" }}>Cancel</button>
        <button type="submit" disabled={!stripe || busy} style={{ background: "var(--le-accent)", color: "var(--le-accent-fg)", border: 0, padding: "10px 16px", fontSize: 13, cursor: "pointer", opacity: busy ? 0.4 : 1 }}>
          {busy ? "Processing…" : "Pay"}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Verify Stripe deps are present**

Run: `grep '@stripe/' package.json`. If `@stripe/react-stripe-js` is missing, install:

```bash
pnpm add @stripe/react-stripe-js @stripe/stripe-js
```

(They're likely already present from Phase 1's onboarding Payment Element.)

- [ ] **Step 4: Commit**

```bash
git add src/pages/review/SignInPanel.tsx src/pages/review/PaymentPanel.tsx package.json pnpm-lock.yaml
git commit -m "feat(portal/review): sign-in panel + Payment Element approve-and-pay flow"
```

---

### Task 22: Notifications + email templates

**Files:**
- Create: `lib/portal/notifications.ts`
- Modify: `lib/portal/email.ts`
- Modify: `api/portal/review/[token]/comments.ts` (replace the TODO stub)
- Modify: `api/portal/orders/[id]/deliverables/[did]/versions/[vid]/finalize.ts` (notify client on first upload)
- Modify: `api/portal/onboard/[token].ts` (notify owner on onboarding complete)

- [ ] **Step 1: Write `lib/portal/notifications.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, type EmailTemplate } from "./email.js";

export type NotificationKind =
  | "onboarding_completed"
  | "comment_added"
  | "revision_requested"
  | "approval_received"
  | "order_paid";

interface NotifyInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  linkPath?: string;
  orderId?: string;
  deliverableId?: string;
  commentId?: string;
}

export async function writeNotification(supabase: SupabaseClient, input: NotifyInput): Promise<void> {
  const { error } = await supabase.from("portal_notifications").insert({
    user_id: input.userId,
    kind: input.kind,
    title: input.title,
    body: input.body ?? null,
    link_path: input.linkPath ?? null,
    order_id: input.orderId ?? null,
    deliverable_id: input.deliverableId ?? null,
    comment_id: input.commentId ?? null,
  });
  if (error) console.error("[notifications] write failed", error);
}

export async function notifyOwner(
  supabase: SupabaseClient,
  ownerId: string,
  template: EmailTemplate,
  toEmail: string,
  data: Record<string, unknown>,
  notif: Omit<NotifyInput, "userId">,
): Promise<void> {
  await writeNotification(supabase, { ...notif, userId: ownerId });
  await sendEmail(supabase, { to: toEmail, template, data });
}

export async function notifyClient(
  supabase: SupabaseClient,
  toEmail: string,
  template: EmailTemplate,
  data: Record<string, unknown>,
): Promise<void> {
  await sendEmail(supabase, { to: toEmail, template, data });
}
```

- [ ] **Step 2: Extend `lib/portal/email.ts`**

Read the current `lib/portal/email.ts`, find the existing template enum / switch, and add:

```ts
export type EmailTemplate =
  | "onboarding_thanks"       // post-onboarding: "we'll deliver shortly"
  | "deliverable_ready_v1"    // first upload
  | "deliverable_ready_vn"    // subsequent versions
  | "comment_added"           // owner notification
  | "revision_requested"      // owner notification
  | "approval_received"       // owner notification
  | "payment_receipt";        // client receipt + download link
```

Add a `render` case for each new template — copy follows the design-guide voice (concierge, short clauses, sentence case). Sample for `deliverable_ready_v1`:

```ts
case "deliverable_ready_v1":
  return {
    subject: `Your video is ready to review — ${data.order_title}`,
    html: `
      <div style="font-family: Geist, -apple-system, sans-serif; max-width: 560px; margin: 40px auto;">
        <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.22em; color: #888; text-transform: uppercase;">— Listing Elevate</div>
        <h1 style="font-size: 32px; font-weight: 500; letter-spacing: -0.025em; line-height: 1.05; margin: 16px 0 24px;">Your video is ready.</h1>
        <p style="font-size: 14px; line-height: 1.6; color: #555;">Open the review link below to watch, leave timestamped feedback, and approve when you're happy.</p>
        <p style="margin-top: 32px;">
          <a href="${data.review_url}" style="background: #07080c; color: #fff; padding: 14px 22px; text-decoration: none; font-size: 13px; font-weight: 500;">Review your video →</a>
        </p>
        <p style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #aaa; margin-top: 48px;">© Listing Elevate</p>
      </div>
    `,
  };
```

Repeat for the other templates with appropriately scaled copy. The existing `onboarding_thanks` template (or whatever it was called) needs its copy rewritten: drop the "click here to pay" CTA; replace with "Your details are saved. We'll email you as soon as your first cut is ready."

Ensure `sendEmail` still writes a `cost_events` row with `provider='resend'` after every send — this is the existing Phase 1 convention.

- [ ] **Step 3: Wire notifications into the endpoints**

In `api/portal/review/[token]/comments.ts`, after a successful insert:

```ts
// Notify owner (in-app + email)
const { data: ownerProfile } = await supabase.auth.admin.getUserById(order.owner_id);
const ownerEmail = ownerProfile.user?.email;
if (ownerEmail) {
  const reviewUrl = `${process.env.PUBLIC_BASE_URL ?? ""}/review/${token}`;
  if (kind === "revision_request") {
    await notifyOwner(supabase, order.owner_id, "revision_requested", ownerEmail, {
      author: `${author_first_name} ${author_last_name}`.trim(),
      note: body.body.trim(),
      review_url: reviewUrl,
    }, { kind: "revision_requested", title: "Revision requested", body: body.body.trim().slice(0, 120), orderId: order.id, deliverableId: deliv.id, commentId: inserted.id, linkPath: `/dashboard/orders/${order.id}` });
  } else {
    await notifyOwner(supabase, order.owner_id, "comment_added", ownerEmail, {
      author: `${author_first_name} ${author_last_name}`.trim(),
      body: body.body.trim(),
      review_url: reviewUrl,
    }, { kind: "comment_added", title: "New comment", body: body.body.trim().slice(0, 120), orderId: order.id, deliverableId: deliv.id, commentId: inserted.id, linkPath: `/dashboard/orders/${order.id}` });
  }
}
```

In `finalize.ts`, after a successful state advance to `delivered`, if this was version 1, notify the client:

```ts
// If we just moved from awaiting_delivery → delivered, this was v1 — email the client.
if (order.status === "awaiting_delivery" && refreshed?.status === "delivered") {
  const { data: deliv } = await supabase
    .from("portal_deliverables").select("review_token, order:portal_orders(customer_id)")
    .eq("id", did).single();
  const customerId = (deliv?.order as { customer_id: string })?.customer_id;
  const { data: cust } = await supabase.from("portal_customers").select("email").eq("id", customerId).single();
  const { data: orderRow } = await supabase.from("portal_orders").select("title").eq("id", orderId).single();
  if (cust?.email && deliv?.review_token) {
    await notifyClient(supabase, cust.email, "deliverable_ready_v1", {
      review_url: `${process.env.PUBLIC_BASE_URL ?? ""}/review/${deliv.review_token}`,
      order_title: orderRow?.title ?? "your video",
    });
  }
}
// Otherwise (v2+), email the "new version uploaded" template:
else if (refreshed?.status === "delivered") {
  const { data: deliv } = await supabase
    .from("portal_deliverables").select("review_token, order:portal_orders(customer_id)")
    .eq("id", did).single();
  const customerId = (deliv?.order as { customer_id: string })?.customer_id;
  const { data: cust } = await supabase.from("portal_customers").select("email").eq("id", customerId).single();
  const { data: orderRow } = await supabase.from("portal_orders").select("title").eq("id", orderId).single();
  if (cust?.email && deliv?.review_token) {
    await notifyClient(supabase, cust.email, "deliverable_ready_vn", {
      review_url: `${process.env.PUBLIC_BASE_URL ?? ""}/review/${deliv.review_token}`,
      order_title: orderRow?.title ?? "your video",
    });
  }
}
```

In `api/portal/onboard/[token].ts`, after the order flips to `awaiting_delivery`:

```ts
const { data: ownerProfile } = await supabase.auth.admin.getUserById(order.owner_id);
if (ownerProfile.user?.email) {
  await notifyOwner(supabase, order.owner_id, "onboarding_completed" as EmailTemplate, ownerProfile.user.email, {
    customer_name: `${customer.first_name} ${customer.last_name}`,
    order_title: order.title,
  }, { kind: "onboarding_completed", title: "Customer onboarded", body: `${customer.first_name} ${customer.last_name} finished onboarding for "${order.title}"`, orderId: order.id, linkPath: `/dashboard/orders/${order.id}` });
}
```

And ALSO send the client thank-you email:

```ts
await notifyClient(supabase, customer.email, "onboarding_thanks", {
  customer_first_name: body.first_name?.trim() || customer.first_name,
  order_title: order.title,
});
```

- [ ] **Step 4: Commit**

```bash
git add lib/portal/notifications.ts lib/portal/email.ts api/portal/review/'[token]'/comments.ts api/portal/orders/'[id]'/deliverables/'[did]'/versions/'[vid]'/finalize.ts api/portal/onboard/'[token].ts'
git commit -m "feat(portal/notifications): in-app + email wiring for every Phase 2 event"
```

---

### Task 23: Stripe webhook — handle `flow=approve_pay`

**Files:**
- Modify: `api/portal/stripe-webhook.ts`

- [ ] **Step 1: Read the existing webhook**

Run: `cat api/portal/stripe-webhook.ts` and locate the `payment_intent.succeeded` branch.

- [ ] **Step 2: Add flow disambiguation + paid-flow handling**

Inside the `payment_intent.succeeded` branch, after resolving `portal_order_id` from `metadata`:

```ts
const flow = (event.data.object as { metadata?: Record<string, string> }).metadata?.flow ?? "legacy";

if (flow === "approve_pay") {
  // Phase 2 path: client approved + paid. Flip to paid, notify, email receipt.
  const { error: updErr } = await supabase
    .from("portal_orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", orderId);
  if (updErr) {
    console.error("[stripe-webhook] order update failed", updErr);
    return res.status(500).json({ error: updErr.message });
  }

  // Notify owner + email client receipt
  const { data: order } = await supabase
    .from("portal_orders")
    .select("owner_id, customer_id, title, amount_cents, currency")
    .eq("id", orderId).single();
  if (!order) return res.status(200).json({ ok: true });

  const { data: cust } = await supabase.from("portal_customers").select("email").eq("id", order.customer_id).single();
  const { data: deliv } = await supabase.from("portal_deliverables").select("review_token").eq("order_id", orderId).limit(1).single();

  const reviewUrl = `${process.env.PUBLIC_BASE_URL ?? ""}/review/${deliv?.review_token ?? ""}`;
  if (cust?.email && deliv?.review_token) {
    await notifyClient(supabase, cust.email, "payment_receipt", {
      order_title: order.title,
      amount: (order.amount_cents / 100).toFixed(0),
      currency: order.currency.toUpperCase(),
      review_url: reviewUrl,
      download_url: `${reviewUrl}/download`,
    });
  }

  const { data: ownerProfile } = await supabase.auth.admin.getUserById(order.owner_id);
  if (ownerProfile.user?.email) {
    await notifyOwner(supabase, order.owner_id, "approval_received" /* repurposed for paid */, ownerProfile.user.email, {
      order_title: order.title, amount: (order.amount_cents / 100).toFixed(0), currency: order.currency.toUpperCase(),
    }, { kind: "order_paid", title: "Order paid", body: `${order.title} — $${(order.amount_cents / 100).toFixed(0)}`, orderId, linkPath: `/dashboard/orders/${orderId}` });
  }

  return res.status(200).json({ ok: true });
}

// Legacy onboarding-flow PaymentIntent (in-flight at deploy time, will drain out).
// Existing handler logic stays here for orders created before Phase 2.
```

(Wire imports for `notifyClient`, `notifyOwner` at the top of the file.)

- [ ] **Step 2: Manual smoke**

Use Stripe CLI to forward webhooks against dev:

```bash
stripe listen --forward-to localhost:3000/api/portal/stripe-webhook
# Trigger a test PaymentIntent succeeded with metadata flow=approve_pay manually via the dashboard
```

Verify the order row flips to `paid` and `paid_at` is set.

- [ ] **Step 3: Commit**

```bash
git add api/portal/stripe-webhook.ts
git commit -m "feat(portal/webhook): handle approve_pay flow — flip paid + notify + receipt"
```

---

### Task 24: Activity tab (notification feed per order)

**Files:**
- Create: `src/pages/dashboard/OrderActivity.tsx`
- Create: `api/portal/orders/[id]/activity.ts`

- [ ] **Step 1: Write the activity endpoint**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../lib/db.js";
import { requireOwner } from "../../../../lib/portal/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  const orderId = req.query.id as string;
  if (!orderId) return res.status(400).json({ error: "order id required" });

  const supabase = getSupabase();
  const ownerCheck = await requireOwner(req, supabase, orderId);
  if (!ownerCheck.ok) return res.status(ownerCheck.status).json({ error: ownerCheck.error });

  const { data, error } = await supabase
    .from("portal_notifications")
    .select("id, kind, title, body, link_path, created_at, read_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ activity: data ?? [] });
}
```

- [ ] **Step 2: Write `OrderActivity.tsx`**

```tsx
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface ActivityRow { id: string; kind: string; title: string; body: string | null; created_at: string; }

export function OrderActivity({ orderId }: { orderId: string }) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) return;
      const res = await fetch(`/api/portal/orders/${orderId}/activity`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const json = await res.json();
      setRows(json.activity ?? []);
      setLoading(false);
    })();
  }, [orderId]);

  if (loading) return <div className="le-shimmer" style={{ height: 60 }} />;
  if (rows.length === 0) return <p style={{ color: "var(--le-text-muted)", fontSize: 14 }}>No activity yet.</p>;

  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {rows.map((r) => (
        <li key={r.id} style={{ borderTop: "1px solid var(--le-border)", padding: "14px 0", display: "flex", gap: 18 }}>
          <span style={{ fontFamily: "var(--le-font-mono)", fontSize: 11, color: "var(--le-text-faint)", minWidth: 110 }}>
            {new Date(r.created_at).toLocaleString()}
          </span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{r.title}</div>
            {r.body && <div style={{ fontSize: 13, color: "var(--le-text-muted)", marginTop: 4 }}>{r.body}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/dashboard/OrderActivity.tsx api/portal/orders/'[id]'/activity.ts
git commit -m "feat(portal/ui): Activity tab — per-order notification feed"
```

---

### Task 25: End-to-end staging smoke + HANDOFF.md update

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Run the full loop on staging**

Deploy to staging via Vercel (push to `dev` then promote to `staging`). With `LE_ALLOW_NONPROD_WRITES=true`:

1. Create a new order via the dashboard. Note the order_id.
2. Open the onboarding link in an incognito window. Fill the form. Confirm "we'll deliver shortly" appears.
3. As owner, open Deliverables tab. Add deliverable "Smoke test". Upload a small mp4. Confirm order shows `delivered`.
4. As customer, open the review link. Sign in via magic link (real email, real Supabase OTP). Confirm video plays.
5. Pin a comment at 0:05. Post. Confirm dot appears on timeline + comment renders in rail.
6. Click Request revision, type a note, submit. Confirm order flips to `revision_requested` and owner gets the email.
7. As owner, upload v2. Confirm order back to `delivered` and client gets the "new version" email.
8. As customer, click Approve & pay. Pay with Stripe test card `4242 4242 4242 4242`.
9. Confirm webhook flips order to `paid`, action bar swaps to Download, clicking Download streams the file.

- [ ] **Step 2: Append to `docs/HANDOFF.md`**

Per `CLAUDE.md` rules: add one line to "Recent shipping log" once it merges to `main`, and update "Right now" to reflect Phase 2 is shipped.

- [ ] **Step 3: Commit + open PR for promotion**

```bash
git add docs/HANDOFF.md
git commit -m "docs(handoff): Phase 2 portal deliverables shipped — pay-on-approval end-to-end"
```

Open the `feat/portal-deliverables → dev` PR, merge via `git merge --no-ff`, then `dev → staging`, then `staging → main` per the 3-tier promotion path in `CLAUDE.md`.

---

## Self-review checklist (run before handing off to execution)

- [ ] **Spec coverage:** every spec section has at least one task. Sections 4 (storage), 5 (data model), 6 (storage+upload), 7 (API), 8 (UI), 9 (notifications), 10 (testing — covered by Task 25 + inline vitest tests), 11 (env), 12 (migrations), 13 (guardrails — enforced by absence of out-of-scope tasks).
- [ ] **No placeholders:** every step has executable content. Test cases have actual code. Endpoints have full handler bodies. No "TBD" / "TODO" / "implement appropriate error handling" left in.
- [ ] **Type consistency:** `PortalDeliverable` shape matches between `portalApi.ts` and `reviewApi.ts` consumers. `OrderStatus` union matches `state.ts` exports and the migration's CHECK constraint. `EmailTemplate` enum referenced consistently across `email.ts` and `notifications.ts`.
- [ ] **Frequent commits:** each task ends with a commit. Each commit message is conventional (`feat(portal/x): …` / `migration(N): …` / `docs: …`).
- [ ] **TDD where applicable:** pure helpers (`state.ts`, `storage.ts`, `deliverables.ts`) have unit tests written first. Endpoints have manual curl smoke; UI surfaces have staging smoke. (Vitest is not stretched to cover Vercel function handlers since the project doesn't have a server-side test fixture — explicit choice, see spec §10.)

---

## Out-of-scope reminders (do not implement)

Per spec §13 — reject these if scope creep tempts you mid-execution:

- Comment threading / replies / mentions.
- Watermarking pipeline.
- Bulk-upload / multi-file selection.
- New providers (Mux, Cloudflare Stream, Bunny).
- Analytics on the review page.
- Comment-email batching cron (single-email-per-comment for v1).

Reopen a brainstorm if any of these become necessary in practice.
