# Client Portal — Phase 2: Deliverables, Review, Pay-on-Approval

Date: 2026-05-10
Branch: `feat/portal-deliverables` (continues from Phase 1 work through commit `a11e520`)
Status: design — implementation plan to follow

## 1. Summary

Phase 1 shipped the front half of the portal: owner creates an order, client lands on a tokenized link, fills onboarding (billing details), **pays inline via Stripe's embedded Payment Element** (PaymentIntent + `client_secret`), webhook flips the order to `paid`. Phase 2 builds out the back half — owner uploads deliverables, client reviews them, comments at timestamps, requests revisions, and approves — **and inverts the payment timing**: payment now happens **after** approval, not before delivery. The Payment Element mechanism stays the same; it just renders on the review page after Approve, not during onboarding.

The phase delivers a complete client experience: from onboarding through pay-on-approval download.

## 2. Scope

**In scope**

- Owner uploads deliverables (v1, v2, …) to an order via a new **Deliverables** tab on `OrderDetail`.
- Client reviews at `/review/<token>` with a responsive layout (sidebar on desktop ≥1024px, theater stack on mobile/tablet).
- Client can **Comment** (with optional timestamp pin), **Request revision** (with required note), or **Approve**.
- Approve = pay: clicking Approve creates a Stripe PaymentIntent and reveals an inline Payment Element below the action bar (same UX pattern Phase 1 uses on the onboarding page). Successful payment unlocks download.
- Standard Supabase session auth gates client actions (password OR magic link, returning users skip).
- Notifications fire to owner (in-app + email) and client (email) per the matrix in §8.
- Phase 1 rewrite: onboarding stops creating the Stripe invoice; the post-onboarding email becomes a "we'll deliver shortly" confirmation.
- Activity tab on `OrderDetail` renders the per-order notification feed.

**Deferred (Phase 3 candidates)**

- Multi-turn comment threading, replies, mentions.
- Comment resolution / "marked addressed" state.
- Multi-user collaboration on the client side (one customer = one reviewer is sufficient).
- Live presence, typing indicators, frame annotations.

**Non-goals**

- Watermarking pre-payment streams. Trust + short-lived signed URLs is the chosen protection model.
- Resumable / multipart uploads (single signed upload is fine up to 2GB; revisit if uploads grow).

## 3. User flows

### Owner happy path

1. Order is in `awaiting_delivery` (set on onboarding completion — see §4).
2. Owner opens `/dashboard/orders/<id>` → **Deliverables** tab.
3. Clicks `+ Add deliverable` → modal: title input + drag-drop file picker. Uploads.
4. Order transitions `awaiting_delivery` → `delivered`. Client emailed: "Your video is ready to review at `<review_url>`".
5. Owner can copy the review link or upload a new version any time from the deliverable card.

### Client approve path

1. Clicks email link → `/review/<token>`. If no Supabase session, sees the video poster but the action bar is replaced by sign-in (password OR magic link to the email on file).
2. Signed in. Watches video. Clicks **Approve & pay $X**. Server flips the order `in_review` → `approved` → `awaiting_payment`, creates a Stripe PaymentIntent (metadata `flow='approve_pay'`), and returns its `client_secret`.
3. Review page mounts Stripe's Payment Element inline below the action bar (same component Phase 1 uses on onboarding). Client confirms payment.
4. `payment_intent.succeeded` webhook fires: order flips `awaiting_payment` → `paid`, client gets email receipt with a fresh download link, owner gets in-app + email notification. Review page polls the order status and swaps the action bar for a **Download** button.

### Revision loop

1. Client pins a comment at 0:08 ("Transition feels rushed"). Pins another at 0:19 ("Love this shot"). Clicks **Request revision** with a summary note. Order flips to `revision_requested`. Owner gets in-app + email.
2. Owner uploads v2 in the same deliverable card. Order flips back to `delivered`. Client emailed: "New version uploaded".
3. Client reviews v2. Old version + its comments remain accessible via a version selector. Comments are pinned to the version they were left on.
4. Loop continues until client clicks **Approve & pay**.

## 4. Order state machine

```
awaiting_onboarding ─[client submits onboarding]→ awaiting_delivery
                                                       │
                              [owner uploads v1]───────┘
                                       │
                                       ▼
                                   delivered ←─────────┐
                                       │               │
                              [client opens]           │
                                       │      [owner uploads v2+]
                                       ▼               │
                                  in_review            │
                                       │               │
                  ┌────────────────────┼───────────────┤
                  │                    │               │
       [request revision]        [approve & pay]       │
                  │                    │               │
                  ▼                    ▼               │
          revision_requested ──────────┤               │
                  └──────────[owner uploads v2+]───────┘
                                       │
                              [client clicks Approve]
                                       │
                                       ▼
                                   approved
                                       │
                            [PaymentIntent created]
                                       │
                                       ▼
                              awaiting_payment
                                       │
                          [payment_intent.succeeded]
                                       │
                                       ▼
                                     paid (= released, downloadable)
```

`canceled` is reachable from any non-terminal state via an owner action.

**State transitions are server-side.** UI renders `portal_orders.status` as a cached value; never derives it client-side. A pure helper `computeNextOrderStatus(current, event)` lives in `lib/portal/state.ts` and is the only place the transition table is encoded.

## 5. Data model

Migration 047 created `portal_customers`, `portal_orders`, `portal_deliverables`, `portal_deliverable_versions`, `portal_comments`, `portal_notifications` with RLS. Migration 049 added `portal_orders.stripe_payment_intent_id`. Phase 2 adds one small follow-up:

### Migration 050 — state machine + approval timestamp + upload lifecycle

```sql
-- 050_portal_pay_on_approval.sql
BEGIN;

-- 1. Extend portal_orders.status CHECK with awaiting_delivery (new state between
--    onboarding completion and first upload — empty in Phase 1, populated in Phase 2).
ALTER TABLE portal_orders DROP CONSTRAINT IF EXISTS portal_orders_status_check;
ALTER TABLE portal_orders ADD CONSTRAINT portal_orders_status_check
  CHECK (status IN (
    'awaiting_onboarding',
    'awaiting_delivery',     -- NEW: onboarded, not yet uploaded
    'delivered',
    'in_review',
    'revision_requested',
    'approved',              -- client clicked approve; PaymentIntent created
    'awaiting_payment',      -- PaymentIntent created, awaiting payment_intent.succeeded
    'paid',                  -- terminal: download unlocked
    'canceled',
    -- Legacy values retained for any pre-existing rows; not used by new code paths.
    'in_progress'
  ));

-- 2. Record when the client clicked Approve (distinct from paid_at which the
--    webhook stamps).
ALTER TABLE portal_orders
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- 3. Track upload lifecycle on versions so we can distinguish a row that has a
--    signed upload URL outstanding from one whose object actually exists in storage.
ALTER TABLE portal_deliverable_versions
  ADD COLUMN IF NOT EXISTS upload_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (upload_status IN ('pending', 'uploaded', 'failed'));

CREATE INDEX IF NOT EXISTS portal_versions_upload_status_idx
  ON portal_deliverable_versions(deliverable_id, upload_status);

COMMIT;
```

`stripe_payment_intent_id` is reused for the Phase 2 approve-pay PaymentIntent. (Phase 1's onboarding flow currently writes a PaymentIntent to this column; under Phase 2 the onboarding endpoint stops doing that — see §7 — and the column is only populated when the client approves.)

`stripe_invoice_id` / `stripe_invoice_url` are unused by current Phase 1 (the invoice path was replaced by embedded Payment Element). They stay on the table for legacy data only.

### Storage bucket

Create a private bucket named `deliverables`:

```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('deliverables', 'deliverables', false)
  ON CONFLICT (id) DO NOTHING;
```

Object path convention: `<owner_id>/<order_id>/<deliverable_id>/v<version>.<ext>`. RLS is bypassed by server-issued signed URLs; the bucket is never publicly listed.

## 6. Storage + upload

- **Bucket:** `deliverables` (private).
- **Upload flow (direct browser → Supabase):**
  1. Owner clicks `+ Add deliverable` / `Upload new version` → client calls `POST .../versions` with file metadata.
  2. Server inserts a row in `portal_deliverable_versions` with `upload_status='pending'` and returns `{ version_id, signed_upload_url, storage_path }`.
  3. Browser PUTs the file to `signed_upload_url`. Bytes do not pass through Vercel — avoids the 4.5MB function body limit and saves bandwidth.
  4. On upload success, browser calls `POST .../versions/:vid/finalize`. Server verifies the object exists in storage (HEAD request via storage admin SDK), sets `upload_status='uploaded'`, advances order state via `computeNextOrderStatus`.
- **Constraints (server-validated on initiate):** mime starts with `video/`; `file_size_bytes ≤ 2 * 1024 ** 3`; extension in `{mp4, mov, webm}`. Reject with `400` on violation.
- **Streaming (review page):** server returns a signed URL with **5-minute TTL** on every page load and on every version-selector switch. The React player refreshes the source if the URL is about to expire.
- **Download (post-payment):** `GET /api/portal/review/:token/download` always issues a fresh **1-hour TTL** signed URL with `download` set on the Storage API (forces `Content-Disposition: attachment`). Works indefinitely after payment.

## 7. API surface

All endpoints under `api/portal/`. Errors return JSON `{ error: string }` with appropriate status.

### Owner endpoints (auth = order owner via Supabase session + RLS check)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/portal/orders/:id/deliverables` | `{ title }` | `{ deliverable_id }` |
| POST | `/api/portal/orders/:id/deliverables/:did/versions` | `{ file_name, mime_type, file_size_bytes, upload_note? }` | `{ version_id, signed_upload_url, storage_path }` |
| POST | `/api/portal/orders/:id/deliverables/:did/versions/:vid/finalize` | — | `{ status: 'uploaded', order_status }` |
| DELETE | `/api/portal/orders/:id/deliverables/:did` | — | `{ ok: true }` (only allowed if no versions are `uploaded`) |

### Review endpoints (token-gated reads; session-gated writes)

| Method | Path | Auth | Returns / effect |
|---|---|---|---|
| GET | `/api/portal/review/:token` | public (token) | `{ deliverable, versions, latest_version, stream_url, comments, order_status, price_cents }` |
| GET | `/api/portal/review/:token/versions/:vid/stream` | public (token) | `{ stream_url }` (5-min TTL) |
| POST | `/api/portal/review/:token/comments` | session required, user must match `portal_customers.user_id` or be order owner | `{ comment_id }`. Body: `{ body, video_timestamp_seconds?, kind: 'comment' \| 'revision_request' }`. `revision_request` flips order to `revision_requested`. |
| POST | `/api/portal/review/:token/approve` | session required, must be customer user | Creates `kind='approval'` row, sets `approved_at`, flips order `→ approved`, creates Stripe PaymentIntent (metadata `flow='approve_pay', portal_order_id=<id>`), flips order `→ awaiting_payment`, returns `{ client_secret }`. Idempotency-keyed on `portal-approve-<order_id>` so retries return the existing PaymentIntent's `client_secret`. |
| GET | `/api/portal/review/:token/status` | session required | Returns `{ order_status }`. Used by the review page to poll after Payment Element confirms, so the UI knows when the webhook has flipped the order to `paid`. |
| GET | `/api/portal/review/:token/download` | session required, order must be `paid` | 302 to a fresh 1-hour signed download URL. |
| POST | `/api/portal/review/:token/sign-in/magic-link` | public (token) | Sends Supabase OTP to the email on `portal_customers`. |

### Phase 1 endpoints — required edits

- **`api/portal/onboard/[token].ts`:**
  - POST handler: keep step 1 (create/reuse Stripe Customer) and step 2 (persist billing details + `onboarded_at`). **Delete step 3** (PaymentIntent creation). After billing is saved, set `portal_orders.status = 'awaiting_delivery'`. Return `{ status: 'awaiting_delivery' }` instead of `{ client_secret }`.
  - GET handler: remove the "resume PaymentIntent" branch — there is no payment to resume during onboarding any more. The endpoint just hydrates the form. The token stays alive until terminal state, same as today.
  - Frontend (`src/pages/Onboard.tsx`): drop the Payment Element mount branch on the onboarding page. After submit, show a "Thanks — we'll send your video for review shortly" confirmation. Returning to the link in `awaiting_delivery` shows the same confirmation (idempotent).
- **`api/portal/stripe-webhook.ts`:** existing `payment_intent.succeeded` handler already keys off `metadata.portal_order_id` — keep it. Disambiguate by reading `metadata.flow`: `'approve_pay'` → Phase 2 path (flip to `paid`, email receipt with review-page link, owner notification). Anything else → log + ignore for new orders. (Old onboarding-flow PaymentIntents in flight at deploy time finish via the same handler since they share metadata shape.)
- **`lib/portal/email.ts`:** add three new templates — `deliverable_ready_v1` ("Your video is ready to review"), `deliverable_ready_vn` ("New version uploaded for review"), `payment_receipt` (sent on `paid`, includes review-page link). Update the existing post-onboarding email to a "we'll deliver shortly" confirmation.

## 8. UI surface

**Style:** every new surface follows `DESIGN_STYLE.md`. Geist sans for everything visible; JetBrains Mono for IDs, timestamps, durations, eyebrows. Hairline borders, square corners (radius 0–2px on buttons), ink-only accent (no hue tints), section eyebrows preceded by a 14–18px × 1px hairline, status pills are mono uppercase with oklch dots/chips. No drop shadows. No italics. No emoji. The implementation plan must reference this guide for every UI component.

### Owner — `/dashboard/orders/:id`

`OrderDetail.tsx` grows three tabs:

- **Overview** — existing stage rail + customer info + payment info. Status pill at top reflects the new state machine.
- **Deliverables** — new. Empty state: single primary CTA `+ Add deliverable`. Populated state: header + add button + stacked deliverable cards (1px hairline, no radius). Each card:
  - Title (sans Heading), status pill, mono `Vn · size · uploaded Xh ago`.
  - Collapsed version history (mono row per version with upload note).
  - Actions: `Upload new version` (drag-drop, opens inline progress strip), `Copy review link`, `Comments (N)` (expands inline list of comments).
- **Activity** — chronological notification feed for this order (newest first). Each row is mono timestamp + sans body, hairline-divided.

Modal for `+ Add deliverable`: title underline-input + drop zone with `Drop file or browse` microcopy. Upload progress shows as a thin top-of-card hairline that fills left-to-right.

### Client — `/review/:token`

Responsive hybrid layout:

- **≥1024px** — two-column: video + timeline on the left, comments rail on the right.
- **<1024px** — single column: video → timeline → action bar → comments feed. Action bar sits above the comment feed so `Approve & pay` is always reachable without scrolling past comments.

Components:

- **Top bar** — mono micro-eyebrow (`123 Sunset Dr · v2 of 3`), status pill on the right.
- **Video player** — HTML5 `<video>` with custom controls (play/pause, scrub, fullscreen, time). Timeline strip below shows ink-faint dots at every comment's `video_timestamp_seconds`. Click a dot → seek; click a comment → seek.
- **Version selector** — mono `v1 v2 v3` chip row, current version highlighted by an ink underline.
- **Comments rail** — each comment renders as: mono `MM:SS` (only if pinned) → sans body 14px → mono author + relative time, faint. 1px hairline between rows. Compose box at the bottom is an underline-input textarea + `Pin to current moment` toggle (mono micro-label) + `Post`.
- **Action bar** — `Request revision` (secondary, transparent + 1px border) and `Approve & pay $X` (primary, ink fill, square corners). Always operates on the latest `uploaded` version; a `pending` (still-uploading) version is invisible to the client.
- **Approve-and-pay state** — after clicking `Approve & pay`, the action bar is replaced by an inline Payment Element panel (mounted with the `client_secret` returned by the approve endpoint). Cancel link below reverts to the action bar without consuming the PaymentIntent. The same Stripe component already used on the onboarding page; reuse the wrapper from `src/pages/Onboard.tsx` rather than re-implementing.
- **Auth-gated state** — when unauthenticated, the action bar and compose box are replaced by a hairline-divided sign-in panel with `email` underline input + two buttons: `Continue with password` and `Email me a magic link`. Email is pre-filled from `portal_customers`.
- **Post-payment state** — action bar replaced by a single `Download` button. The video keeps playing the same source (no chrome change beyond the action bar swap). The review page polls `GET .../status` for up to 30s after Payment Element confirms, in case the webhook takes a moment.

## 9. Notifications

`portal_notifications` table receives one row per owner-facing event. Emails fire via Resend (`lib/portal/email.ts`).

| Event | Client email | Owner in-app | Owner email |
|---|---|---|---|
| Onboarding complete | "Thanks — we'll deliver shortly" | `onboarding_completed` | — |
| v1 uploaded | "Your video is ready to review" + review URL | — | — |
| v2+ uploaded | "New version uploaded" + review URL | — | — |
| Comment posted | — | `comment_added` | ✓ (digest: 1/min max) |
| Revision requested | — | `revision_requested` (high priority) | ✓ (immediate) |
| Approved (pre-payment) | — | `approval_received` | ✓ (immediate) |
| Paid | "Receipt + download link" | `order_paid` | ✓ (immediate) |

**Cost tracking** — every Resend `send` writes a `cost_events` row with `provider='resend'`, even on free-tier $0 sends (CLAUDE.md convention).

**Comment emails — v1 simplification:** one email per comment, no batching. If burst behavior becomes a problem in practice, add a digest cron later. Keeps the v1 plan simple.

## 10. Testing strategy

- **Vitest API tests** (`api/portal/__tests__/`):
  - Token-only review endpoints reject without a valid token.
  - Session-required endpoints reject without a session.
  - Cross-tenant access denied (RLS smoke).
  - `computeNextOrderStatus` unit-tested for every legal transition + every illegal transition is rejected.
- **Storage integration** — `scripts/test/portal-upload-finalize.ts` runs against the staging Supabase project: upload → finalize → stream URL → download URL. Skipped in CI; run manually on staging before promotion to main.
- **Playwright smoke** (`tests/e2e/portal-review.spec.ts`): anonymous user lands on `/review/<token>` → sees video → action bar shows sign-in → magic-link sign-in (stubbed in test) → posts a comment → requests revision (owner state flips, verified via API) → owner uploads v2 (via API) → client approves → Stripe Checkout opens (intercepted, success simulated) → download link appears.
- **Manual smoke before promotion to main:** full loop on staging using a real Stripe test card.

## 11. Environment + non-prod safety

Per `CLAUDE.md`, every destructive write path checks `process.env.VERCEL_ENV === 'production' || process.env.LE_ALLOW_NONPROD_WRITES === 'true'`. Phase 2 additions inheriting this rule:

- `portal_deliverable_versions` inserts (finalize handler).
- Storage `deliverables` bucket writes.
- Stripe Checkout Session creation.
- Resend sends.

Supabase is shared across dev/staging/main. Storage writes from non-prod environments will be allowed under the LE_ALLOW_NONPROD_WRITES toggle for staging smoke testing; dev branch deployments default to no real Stripe / no real Resend.

## 12. Migrations checklist

1. `050_portal_pay_on_approval.sql` — state machine extension (`awaiting_delivery`) + `approved_at` + `upload_status` on versions (§5). (Migrations 048 + 049 already shipped in Phase 1.)
2. Create `deliverables` storage bucket via Supabase MCP (`storage.buckets` insert + RLS-bypassed via service-role on server).
3. No data backfill required — Phase 1 orders are either `awaiting_onboarding`, `awaiting_payment`, or `paid`. The Phase 2 onboarding-endpoint edit means new orders never enter `awaiting_payment` via onboarding; in-flight orders at deploy time finish through the existing PaymentIntent handler.

## 13. Out-of-scope guardrails

The implementation plan must reject scope creep on these specific items unless explicitly re-approved:

- No comment threading / replies / mentions.
- No watermarking pipeline.
- No new providers (no Mux, no Cloudflare Stream, no Bunny). Supabase Storage + native `<video>` only.
- No analytics / view tracking on the review page.
- No bulk-upload / multi-file selection in the `+ Add deliverable` modal (one file per version, one version per upload).

## 14. References

- `CLAUDE.md` — session-start brief, governance, cost-tracking convention.
- `docs/HANDOFF.md` — Phase 1 completion state.
- `supabase/migrations/047_portal_deliverables.sql` — base schema this phase extends.
- `docs/DESIGN_STYLE.md` — visual language (binding for every UI component built in this phase).
- `api/portal/onboard/[token].ts`, `api/portal/stripe-webhook.ts` — Phase 1 endpoints to be edited.
- `src/pages/dashboard/OrderDetail.tsx`, `src/pages/Onboard.tsx`, `src/lib/portalApi.ts` — Phase 1 surfaces this phase extends.
