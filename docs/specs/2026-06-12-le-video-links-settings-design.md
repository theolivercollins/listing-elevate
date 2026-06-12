# LE Video v2 — Sub-project B: Link & Settings Model

Date: 2026-06-12 · Status: approved (Oliver, in-session — proceed to plan+build) · Branch: `feat/le-video-links-settings`
Part of: LE Video v2 (A library ✓ → **B link/settings model** → C engagement → D watch-page redesign)
Builds on: preview-links-v2 (link `kind` client/public + `label` + capability toggles + revoke, all shipped); LE Video hub + SharePanel (`src/components/studio/share/SharePanel.tsx`).

## Goal

Make the two shareable links first-class and clearly controllable, and restructure the share/settings panel so it reads with "reasoning and structure" instead of a flat list of switches:

- **Agent link** (`kind='client'`) — the realtor reviews the deliverable: download / approve / request-changes, each per-link toggle.
- **Customer link** (`kind='public'`) — the branded showcase the agent shares onward: no login, **all capabilities OFF by default**, operator toggles on what's allowed.
- **Client branding toggle** — when ON, the customer link shows the agent's brand (logo/name/headshot/brokerage from `clients`); OFF = clean unbranded showcase. Per-link.
- **Restructured settings panel** — grouped, explained sections per link (this is the "screenshot 2" surface; panel layout to be refined against Oliver's reference).

This sub-project deliberately lays the panel scaffolding for **C** (comments + ratings enable toggles slot into the same per-link structure) so we don't restructure twice.

## Scope decisions (locked with Oliver)

- Three tiers: **operator** (dashboard), **agent link** (`client`), **customer link** (`public`). Both links have per-link capability toggles.
- Customers never log in; the customer link's capabilities are **all off by default**, operator enables per link.
- Branding = the **agent's** brand, operator-controlled per link, OFF = clean.
- Customer link is **operator-minted** for now (agent self-serve portal deferred).

## 1. Data — migration 087 (additive only; write file, do NOT apply — Oliver gates)

> Verify 087 is the free next number against `supabase_migrations.schema_migrations` (by `name`) AND a fresh `origin/main` fetch before naming — parallel branches apply to the shared DB ahead of merge (082/084/085 precedent). Bump + update refs if taken.

```sql
-- Per-link "show the agent's branding" flag. Default true preserves today's
-- behavior (brand row renders). Operator sets false for a clean/unbranded link.
alter table property_previews
  add column if not exists show_branding boolean not null default true;
```

That is the only schema change B needs — capability columns (`allow_download/allow_approve/allow_revision`), `kind`, `label`, `revoked_at` already exist (083/084). Comments/ratings tables are **C**, not here.

## 2. Capability model per kind

`createPreviewLink(propertyId, expiresAt, kind, label)` already sets kind-based defaults (client → all-on; public → all-off). B formalizes the **meaningful capability set per kind** so the UI shows the right switches:

| Capability | Agent link (`client`) | Customer link (`public`) |
|---|---|---|
| `allow_download` | default ON | default OFF |
| `allow_approve` | default ON | n/a (hidden — approval is an agent action) |
| `allow_revision` | default ON | n/a (hidden — revisions are an agent action) |
| `show_branding` | default ON | default ON |
| comments / ratings (C) | n/a | default OFF (added in C) |

The PATCH endpoint (`api/admin/studio/properties/[id]/preview-links/[previewId].ts`) gains `show_branding` in its capability whitelist. Server-side enforcement unchanged in shape: the watch-page API already gates actions on the booleans; B adds `show_branding` to the GET payload and the watch page honors it.

## 3. Watch-page branding honor (`api/preview/[token].ts` + `PreviewPage.tsx`)

- GET `/api/preview/:token` returns `show_branding` (fallback `true` pre-087, like other meta fields).
- `PreviewPage` renders the `pd-brand-row` only when `show_branding` is true. When false: no logo/agent/brokerage; the discreet "Crafted with Listing Elevate" footer remains (it's the LE mark, not the agent's brand). No other layout change in B (the full Vimeo redesign is D).

## 4. Settings panel restructure (`src/components/studio/share/SharePanel.tsx`)

> This is the "screenshot 2" surface. The structure below is the proposed reorganization; **final layout to be refined against Oliver's reference screenshot** before/during build. Architecture (sections, toggles, data) is fixed; visual arrangement is the flex point.

Replace the flat toggle list with two clearly-reasoned link cards:

**Card: Agent review link** — "For the agent who ordered this video."
- URL + copy + open; view count + last viewed; Approved badge when approved.
- **What the agent can do** (grouped, each toggle has a one-line explanation):
  - *Download the video* — `allow_download`
  - *Approve the final cut* — `allow_approve`
  - *Request changes* — `allow_revision`
- Expiry display + **Revoke** (with confirm; revoked → link 404s).

**Card: Customer share link** — "What the agent shares with their clients. No login; nothing's on unless you turn it on."
- Create button if none (mints `kind='public'`); otherwise URL + copy + open + views.
- **Appearance:** *Show agent branding* — `show_branding` (logo/name/brokerage on the page).
- **What viewers can do** (all default OFF): *Download* — `allow_download`; *(Comments / Ratings — added in C, shown disabled-with-"coming soon" until C ships, or omitted; decide at build)*.
- Expiry + Revoke.

Each card carries a short italic explainer (the "reasoning"), and toggles are grouped under labeled subsections ("What the agent can do" / "Appearance" / "What viewers can do") rather than a flat switch list. Inter only, no monospace, DESIGN-GUIDE §9. The panel is shared by the video hub and the existing ShareDialog (both already consume SharePanel) — restructure once, both update.

## 4b. Glitch fix — no screen flash on toggle/create/select (Oliver-reported, REQUIRED)

**Symptom:** clicking any capability toggle (download/approve/request-change), creating a link, or selecting a link makes the whole panel/screen flash every time.

**Root cause (confirmed):** in `src/pages/dashboard/studio/VideoHub.tsx`, every mutation handler (`onToggle`, `onCreateLink`, `onSetLabel`, `onRevoke`) ends with `await fetchBundle()`, and `fetchBundle()` calls `setLoading(true)` → the entire hub unmounts to its loading state → `setLoading(false)` re-renders → visible flash. The same blocking-refetch pattern exists in the `ShareDialog`/`Share.tsx` consumers.

**Fix (foundational — do this FIRST; the restructure sits on it):** make mutations **optimistic + local** — update the specific link's field in local `bundle` state immediately, fire the PATCH/POST in the background, and reconcile/roll-back on error. Do **not** call the loading-flipping `fetchBundle()` on a mutation. If a server reconcile is wanted, do a **silent** refetch that never touches the global `loading` flag (which must drive only the initial mount). Result: toggling a switch updates that switch in place with zero flash; creating a link appends it without a full reload; selecting a link doesn't remount. Apply the same fix to every SharePanel consumer (hub + ShareDialog). Add a regression test asserting `setLoading(true)` / the loading branch is NOT entered on a capability toggle.

## 5. API surface (all admin-gated)

- `POST .../preview-link` — unchanged (already takes `kind` + `label`); confirm public-kind default capabilities are all-off.
- `PATCH .../preview-links/[previewId]` — add `show_branding` to the capability whitelist (boolean).
- `GET .../preview-links` + hub bundle — include `show_branding` in returned link rows.
- `GET /api/preview/:token` (public) — include `show_branding` (fallback true pre-087).
- No new routes; no vercel.json change.

## 6. Back-compat & rollout

- Pre-087 (`show_branding` absent): PATCH omits it from the RETURNING select when not in the body (same 42703-tolerant pattern as `label`/`revoked_at`); GET reads fall back to `true` (branding shows — current behavior). The panel's branding toggle returns a clean 503/no-op pre-migration like other new-column controls.
- Rollout: merge code → Oliver applies 087 → branding toggle becomes functional. Everything else (capability restructure, customer-link card) works without 087.

## 7. Testing (TDD, vitest/happy-dom)

- PATCH accepts/validates `show_branding`; pre-migration tolerance (no 500).
- GET payloads include `show_branding` with true-fallback.
- `PreviewPage` hides the brand row when `show_branding=false`, shows it when true/absent.
- SharePanel: agent card shows download/approve/revision; customer card shows branding + download (+ off-by-default), hides approve/revision; create-customer-link path; revoke confirm.
- Full suite green, build clean, headless mount check of the built watch page (branded + unbranded) and the hub SharePanel before any prod push.

## Out of scope (later sub-projects)

Comments + ratings + notifications (C); the full Vimeo watch-page redesign + player parity (D); agent self-serve portal; QR codes; per-tenant theming beyond the existing brand fields.
