# Preview Links v2 — design

Date: 2026-06-11 · Status: approved (Oliver, in-session) · Branch: `feat/preview-links-v2`

## Goal

Turn `/preview/:token` from a boilerplate column into a real, polished place to watch the delivered listing video, and split links into two kinds with per-link capabilities:

- **Client link** — the agent reviews the deliverable: download, approve, request a change (each toggleable per link).
- **Public sharing link** — view-only showcase, safe to post anywhere; all action capabilities off.

## 1. Data model — migration 083 (additive only)

`property_previews` gains:

| Column | Type | Default | Notes |
|---|---|---|---|
| `kind` | text CHECK `('client','public')` | `'client'` | existing rows become client links |
| `allow_download` | boolean | `true` | creation default by kind: client=true, public=false |
| `allow_approve` | boolean | `true` | same kind-based creation defaults |
| `allow_revision` | boolean | `true` | same |
| `approved_at` | timestamptz | null | stamped on Approve |

Column defaults keep existing rows behaving exactly as today (client, all-on). The kind-based defaults for NEW links are applied in `createPreviewLink()`, not in DDL.

Shared Supabase across envs: **apply only with Oliver's explicit go**. Code is back-compat both before (columns absent → treat as client/all-on via select fallback) and after the migration.

## 2. Public API — `api/preview/[token].ts` (+ subroutes)

**GET `/api/preview/:token`** returns (superset of today, back-compat preserved):

```jsonc
{
  "address": "5019 San Massimo Dr, Punta Gorda, FL 33950, USA",
  "address_parts": { "street": "5019 San Massimo Dr", "locality": "Punta Gorda, FL 33950" }, // parsed server-side at first comma; locality strips ", USA"
  "video_url": "...",                       // unchanged back-compat field
  "videos": { "horizontal": "...", "vertical": null },
  "thumbnail_url": "...",                   // poster + OG image (properties.thumbnail_url)
  "brand": { "logo": null, "agent_name": "...", "name": "...", "headshot": null, "brokerage": null },
  "kind": "client",
  "capabilities": { "download": true, "approve": true, "revision": true },
  "approved_at": null
}
```

**POST `/api/preview/:token`** (revision note, existing) — now 403 `{error:"not_allowed"}` unless `allow_revision`.

**POST `/api/preview/:token/approve`** — 403 unless `allow_approve`. Stamps `property_previews.approved_at` (idempotent: re-approve returns ok with existing timestamp) and inserts a `property_revision_notes` row with source `'client_approval'` and body `'Approved via preview link'` so it shows in the property's existing activity surface. Does NOT mutate `properties.status`. Requires extending the `property_revision_notes` source CHECK to include `'client_approval'` (part of migration 083).

**GET `/api/preview/:token/download?orientation=horizontal|vertical`** — 403 unless `allow_download`; 404 if that orientation has no URL. Proxies/streams the remote MP4 with `Content-Disposition: attachment; filename="<address-slug>-<wide|vertical>.mp4"` (videos live on Creatomate/Backblaze CDN where cross-origin `download` attributes are ignored). Plan phase verifies streaming behavior on `@vercel/node`; fallback if streaming proves unworkable: redirect for Supabase-hosted files via `?download=` and proxy only CDN files.

All capability enforcement is server-side; the UI merely hides controls.

## 3. OG unfurl shim

New route handler serves `/preview/:token` page requests (vercel.json route placed before the SPA fallback): fetches the deployment's own `/index.html`, injects `og:title` (street address), `og:description` ("Listing film · <locality>" / agent name), `og:image` (thumbnail_url), `twitter:card=summary_large_image`, returns HTML. Invalid/expired tokens serve untouched index.html (SPA renders its 404 state). No SSR of page content — the SPA still hydrates and fetches as today.

## 4. PreviewPage redesign — light gallery (soft-shell)

One page, framing varies by `kind`. Visual language: warm-white gallery per the dashboard L2 soft-shell feel — generous spacing, 18px-radius elevated card, subtle shadows, Inter only (no monospace, per CLAUDE.md rule 6). New scoped stylesheet `src/styles/preview-design.css` (self-contained; the page drops `.studio-scope`).

Layout, top to bottom:
1. **Brand row** — client logo when present; otherwise a typographic lockup of agent name (intentional fallback, not missing-image).
2. **Headline** — street address large; locality as quiet sub-line.
3. **Video card** — soft elevated card, poster from `thumbnail_url`, single player. When both orientations exist: a **Wide / Vertical** pill toggle swaps the player (no stacked players). Vertical video gets a constrained-width centered frame so 9:16 looks deliberate on desktop; mobile-first sizing.
4. **Presented by** — agent headshot (when present), name, brokerage.
5. **Action row** (renders per capabilities): Download (per current orientation), Approve (primary; confirmed state if `approved_at`, with "Approved" replacing the button), Request a change (button revealing the note box — no longer dominating the page).
6. **Footer** — discreet "Crafted with Listing Elevate" line (always; it's tasteful attribution and the only LE presence on public links).

States: styled rendering-in-progress ("This listing film is still rendering") and expired/404 pages in the same visual language.

## 5. Operator side — Share dialog in PropertyCommandCenter

The current single create-link action becomes a **Share dialog** with two sections — Client review link / Public sharing link:
- Create (if none) / copy URL; shows view count + last viewed.
- Capability toggles per link (download / approve / revision), editable live.
- Approved badge when `approved_at` set.

Endpoints: `POST .../preview-link` gains `{ kind }` body (defaults `client`); new `GET .../preview-links` (list with stats) and `PATCH .../preview-links/[previewId]` (toggle capabilities, admin-gated like the rest of `/api/admin/studio/*`). Multiple links per property remain allowed; dialog surfaces the newest per kind.

## 6. Testing & rollout

- TDD on API: kind defaults at creation, capability enforcement (403 paths), approve idempotency, download gating + filename, back-compat of GET payload, token tests extended.
- UI: component-level tests for capability-conditional rendering; headless-browser mount check of the **built** bundle before any prod push (blank-screen lesson, 2026-05-28).
- Rollout order: code merges safely before migration (select fallback) → Oliver green-lights migration 083 → Share dialog fully functional.
- Out of scope: email delivery of links, per-tenant theming from `brand_primary_hex`, photo galleries on the page.
