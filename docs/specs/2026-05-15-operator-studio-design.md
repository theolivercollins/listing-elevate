# Operator Studio — Design

**Date:** 2026-05-15
**Author:** Oliver + Claude (Opus 4.7) with Gemini 2.5 Pro second-opinion pass
**Status:** approved (v2 — re-phased after Gemini adversarial review) → implementation pending on `feat/operator-studio`

## Revision history
- **v1 → v2 (2026-05-15):** Gemini adversarial review surfaced that v1's Phase 1 produced unbranded videos with no in-tool delivery loop and no efficient revision path — i.e. a technical exercise, not a usable internal tool. Re-carved phases: brand-kit injection (was F/P2), preview-link delivery (was H/P2), and inline clip swap (was G/P3) are pulled into Phase 1; full `playbooks` CRUD/UI is pushed to Phase 2 (Phase 1 stores the column but no UI). Also: explicit token-generation utility task, dedicated invoice-data integration test, explicit unique index on `property_previews.token`.

## Problem

Oliver is taking on a small set of paying clients (real-estate agents/brokerages) and producing their listing videos himself, inside the platform, using the existing AI pipeline + Lab. The current public Upload wizard, package-pricing flow, email-as-delivery loop, and dropped order-form fields are designed for a self-serve buyer — they get in the way of operator-as-producer.

Goal: minutes of operator attention per listing, end-to-end, with branding applied, an in-tool revision loop, and per-client cost/margin visibility for an external monthly invoice.

## Non-goals

- In-app payments. Billing happens outside the product (manual monthly invoice).
- Customer-facing dashboards for these clients. They get a private preview URL, nothing else.
- Replacing the public Upload flow. Operator Studio sits alongside it. Operator-created `properties` rows are tagged `order_mode = 'operator'`; the public flow remains `order_mode = 'customer'` (default).
- A second Lab. We deep-link into Lab Listings; we do not rebuild it.
- A new auth system. Reuse `<RequireAdmin />` and `requireAdmin()`.

## Surfaces this reuses (verified inventory)

- **Pipeline:** `lib/pipeline.ts` `runPipeline(propertyId)` — 6 stages, live. Triggered by `POST /api/pipeline/[propertyId].ts`.
- **Assembly:** `lib/providers/assembly-router.ts` — Creatomate primary, Shotstack fallback. Not stubbed.
- **Lab Listings (per-scene iterate + rate):** `src/pages/dashboard/LabListings.tsx`, `LabListingDetail.tsx`. Backed by `prompt_lab_listings`, `prompt_lab_listing_scenes`, `prompt_lab_listing_scene_iterations`.
- **Cost tracking:** `cost_events` (nullable property_id). Per-property rollup via `properties.total_cost_cents` updated by `addPropertyCost`.
- **Admin auth:** `user_profiles.role = 'admin'`, `<RequireAdmin />`, `requireAdmin()`.
- **Properties schema** (migration `054_properties_order_form.sql`): all order-form fields persisted including the previously-dropped `selected_*`, `add_voiceover`, `add_voice_clone`, `add_custom_request`, `custom_request_text`, `days_on_market`, `sold_price`.
- **Brand kit:** `user_profiles.brokerage`, brand color/logo fields — captured-but-never-rendered (a long-standing gap closed by this spec).

## Design

A single new operator surface mounted at `/dashboard/studio`, plus targeted backend additions. Eight modules, decomposed so each is independently testable.

### A. Schema + ownership

New tables (single migration `055_operator_studio.sql`):

- `clients` — `id`, `name`, `contact_email`, `phone`, `monthly_rate_cents` (nullable), `notes`, `brand_logo_url`, `brand_primary_hex`, `brand_secondary_hex`, `agent_name`, `agent_headshot_url`, `voice_id` (nullable, ElevenLabs), `default_playbook_id` (nullable FK → `playbooks`), `archived_at`, `created_at`, `updated_at`.
- `playbooks` — `id`, `client_id` (nullable; null = global), `name`, `orientation` ('vertical'|'horizontal'|'both'), `duration_seconds`, `music_style` (text), `voiceover_enabled` (bool), `assembly_template_id` (nullable), `prompt_router_preferences` (jsonb), `created_at`.
- `property_previews` — `property_id` FK, `token` (text, unique, 32-char base32 random), `created_at`, `expires_at` (nullable), `viewed_count` (int), `last_viewed_at`.
- `property_revision_notes` — `id`, `property_id` FK, `source` ('operator'|'client_preview'), `body` (text), `created_at`. Append-only event log; supersedes/augments single-field `custom_request_text` for the operator workflow.

Existing-table additions (same migration):
- `properties.order_mode` — text, default 'customer', check in ('customer','operator').
- `properties.client_id` — uuid, nullable FK → `clients(id)`.
- `properties.playbook_id` — uuid, nullable FK → `playbooks(id)`.
- `properties.ingest_source` — text, nullable ('manual','zillow','redfin','sierra','mls','drive_link').
- `properties.ingest_source_url` — text, nullable.

RLS: keep `properties` user-isolated; admin reads bypass via service-role. New tables (`clients`, `playbooks`, `property_previews`, `property_revision_notes`) are admin-only via service-role; no public RLS policies. `property_previews` is read via signed-token route, server-side only — never queried from the browser.

### B. Operator route shell

- New page `src/pages/dashboard/studio/StudioHome.tsx` mounted at `/dashboard/studio`, behind `<RequireAdmin />`.
- Kanban index: columns `Inbox` → `Rendering` → `Needs Review` → `Delivered`. Each card = a `properties` row where `order_mode = 'operator'`. Card shows client name + brand color dot, address, cost-to-date, age. Drag advances status; drop-target writes a `properties.status` transition.
- Side panel: client filter, "+ New Listing" button, this-month rollup (count delivered, sum of `cost_events.cost_cents`, margin vs `monthly_rate_cents`).
- Side-tab nav: `Studio` (this page) | `Clients` | `Playbooks`.

### C. Magic-link intake

- New input on Studio Home + standalone page `src/pages/dashboard/studio/StudioNew.tsx`: paste a URL (Zillow/Redfin/Sierra/MLS), pick a client, optionally pick playbook, "Ingest".
- New endpoint `POST /api/admin/studio/ingest`: body `{ url, client_id, playbook_id? }`. Server-side:
  1. Resolve source from URL host.
  2. Run scraper (Apify + Playwright; reuse the path proven by Custom Listing Pages and Listing Intake Agent).
  3. Upload photos to `property-photos` bucket.
  4. Create `properties` row with `order_mode='operator'`, `client_id`, `playbook_id`, `ingest_source`, `ingest_source_url`, scraped address/beds/baths/sqft, photo refs.
  5. Trigger `POST /api/pipeline/[propertyId]`.
  6. Return `{ property_id }`.
- Fallbacks: (a) drag-drop folder upload, (b) Google Drive share-link (already supported by the existing async ingest path — reuse). Both write the same shape minus `ingest_source_url`.
- Scraper cost: write a `cost_events` row with `stage='intake'`, `provider='apify'`, units = page count.

### D. Clients + Playbooks CRUD

- `src/pages/dashboard/studio/Clients.tsx`, `ClientEdit.tsx`, `Playbooks.tsx`, `PlaybookEdit.tsx`.
- Endpoints under `/api/admin/studio/clients` and `/api/admin/studio/playbooks` (list/get/create/update/archive).
- Brand kit form posts logo + headshot to `property-photos` bucket under `clients/{id}/...` prefix.
- Soft-delete via `archived_at`. Archived clients hidden from default lists; still queryable in invoice rollup.

### E. Property Command Center

- `src/pages/dashboard/studio/PropertyCommandCenter.tsx` at `/dashboard/studio/properties/:id`. Collapses what `/dashboard/properties/:id` shows plus operator actions:
  - Ingest source (URL + scraped metadata + edit-in-place).
  - Client + playbook selectors (writable; changing playbook does not retro-rerun the pipeline — operator must explicitly hit "Re-render").
  - Pipeline status strip (stage + per-scene state) — subscribe to existing events.
  - Final preview (when assembled).
  - Per-scene clip strip with "Iterate in Lab" button per scene.
  - Director's notes panel (renders `property_revision_notes`, append-on-submit).
  - Preview link panel: "Generate" → returns shareable URL + view count.
  - Cost-to-date with per-provider breakdown.
- All actions hit existing admin endpoints where possible; new endpoints only for swap-clip and preview-link creation.

### F. Brand-kit injection at assembly

- Extend `lib/providers/assembly-router.ts` (and the Creatomate/Shotstack adapter beneath it):
  - If `properties.client_id` is set, fetch `clients` row and inject template variables: `logo_url`, `primary_hex`, `secondary_hex`, `agent_name`, `agent_headshot_url`, `brokerage`.
  - Update the Creatomate template (or add a new "operator" template variant) to consume those vars on intro + end cards.
- No behavior change when `client_id` is null (public-order path unaffected).
- Add an integration test that asserts the variables flow through to the Creatomate request payload.

### G. Inline clip swap (Command Center ↔ Lab Listings)

- "Iterate in Lab" deep-link: `/dashboard/development/lab-listings/{labListingId}?scene={sceneIdx}&from_property={propertyId}` — creates a `prompt_lab_listings` row mirrored from the property (if one does not exist) and jumps to the scene.
- New endpoint `POST /api/admin/studio/properties/:id/scenes/:sceneIdx/swap-clip`:
  - Body: `{ iteration_id }` (a `prompt_lab_listing_scene_iterations.id`).
  - Validates the iteration's room_type matches the scene, copies the clip URL into the property's scene record, marks the scene `replaced_at`.
  - Re-triggers only the assembly stage (not the whole pipeline). New helper `lib/pipeline.ts:rerunAssembly(propertyId)` that skips intake→generation.
- Cost: a new assembly call writes a `cost_events` row tagged `metadata.reason='clip_swap'`.

### H. Private preview link delivery

- `POST /api/admin/studio/properties/:id/preview-link` — creates a `property_previews` row, returns full URL.
- `GET /preview/:token` (public route, no auth) — server-side resolves token → property, renders a minimal page: video player, address, brokerage logo (if client_id), single "Request a change" textarea. POSTing the textarea creates a `property_revision_notes` row with `source='client_preview'` and increments a server-side flag that surfaces a badge on the Kanban card.
- Token TTL: nullable expiry (default 90 days). View count + last-viewed timestamp written on each fetch.

### I. Per-client invoice rollup

- On `Clients.tsx`, each row: month-to-date video count, raw cost sum from `cost_events` (joined via `properties.client_id`), contracted `monthly_rate_cents`, margin.
- "Copy invoice summary" button on the client detail: produces a plaintext block (date range selectable, default month-to-date):
  ```
  CLIENT: <name>
  PERIOD: <YYYY-MM-DD> to <YYYY-MM-DD>
  VIDEOS DELIVERED: <n>
    - <address> (delivered <date>)
    ...
  RAW COST: $<X.XX>
  CONTRACTED RATE: $<Y.YY>
  ```
- This is paste-into-invoice text. We do not generate PDFs or call Stripe.

## Cost tracking

Every new server path that calls an external API writes a `cost_events` row. Specifically:
- Apify scrape in C → `provider='apify'`, `stage='intake'`.
- Creatomate/Shotstack swap in G → `provider='creatomate'|'shotstack'`, `stage='assembly'`, `metadata.reason='clip_swap'`.
- All other calls (analysis, scripting, generation) already flow through the existing pipeline writers, unchanged.

Per the cost-tracking memory: **never ship with null or zero cost fields**. Each new writer has a unit test that asserts a row is emitted with `cost_cents > 0` (or with a documented zero-cost rationale).

## Testing strategy

- **Unit:** pure modules (token generation, invoice formatter, magic-link URL parser, brand-kit variable injector) — vitest.
- **Integration:** the four new admin endpoints (`ingest`, `clients` CRUD, `swap-clip`, `preview-link`) — vitest against a Supabase mock or local stack.
- **End-to-end smoke:** a script `scripts/operator-studio-smoke.ts` that runs the full ingest → pipeline → assembly → preview-link round trip against the dev Supabase using a tiny test listing. Gated by `LE_ALLOW_NONPROD_WRITES=true` per the prod-isolation rule in CLAUDE.md.
- **Verification before completion:** every phase ends with `pnpm vitest && pnpm exec tsc --noEmit && pnpm run doctor`.

## Risks + mitigations

- **Scraping fragility (Zillow/Redfin terms + rate limits).** Mitigation: degrade gracefully to manual photo upload + manual metadata when scraper fails; surface the scrape error inline; never block the operator on a failed scrape.
- **Shared prod Supabase.** Mitigation: every new destructive endpoint guards on `requireAdmin()` + `VERCEL_ENV` check matching the existing pattern; new tables ship with admin-only RLS.
- **Preview link leakage.** Mitigation: 32-char base32 token, opaque, no enumeration; nullable TTL; views logged. No PII rendered beyond address + agent name.
- **Operator-vs-customer drift.** Mitigation: `order_mode` is a single source of truth; existing customer-flow code paths add `WHERE order_mode='customer'` only where they already filter by `submitted_by`; everything else is shared.

## Definition of done (whole feature)

1. Operator can paste a Sierra/Zillow URL, pick a client, hit Ingest, and walk away — the pipeline produces an assembled video with the client's logo + colors applied.
2. Operator can open a finished property, click a scene's "Iterate in Lab", pick a winning iteration, "Swap & Re-assemble", and see the updated video in <2 minutes (excluding render time).
3. Operator generates a preview link, sends it, client watches + submits one revision via the textarea, the revision lands on the Kanban card.
4. End-of-month, operator opens a client row, hits "Copy invoice summary", and pastes the result into their external invoice.
5. All four flows write `cost_events` rows; the Finances page shows the per-client + per-property cost broken out.
