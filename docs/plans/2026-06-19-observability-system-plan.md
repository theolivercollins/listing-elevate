# Observability System Plan

**Created:** 2026-06-19  
**Status:** Quick-wins shipped (Phases 0a-0c); full system (Phases 1-4) deferred to a dedicated window.  
**Owner decision:** quick-wins-first while actively generating videos; no schema migration until a dedicated build window.

---

## North star

Every pipeline failure, cost spend, and render decision is traceable from a single shared `run_id` — queryable in-app without external dashboards. A support request ("why didn't the video generate?") is answerable in under 60 seconds from the Logs viewer.

---

## Architecture: unified run_id correlation key

All-Supabase storage (no external observability SaaS). Three existing tables gain a shared `run_id` UUID that joins them:

- **`pipeline_logs`** — per-event structured log lines (stage, level, message, metadata)
- **`cost_events`** — per-API-call cost records (provider, unit_type, cost_cents)
- **`scenes`** (future: a `scene_provenance` sidecar) — which model, which atlas task, what cost, which run

`run_id` is generated once per pipeline execution and threaded through all three surfaces. Queries like "show me all logs + costs for run X" become a single JOIN. Additive to existing tables — no column removals, no row deletions.

---

## Owner decisions (made 2026-06-19)

| Decision | Choice |
|---|---|
| Storage backend | All-Supabase; no external dashboard (Datadog, LogRocket, etc.) |
| Atlas actual cost | Invoice importer + estimate fallback: `est_cost_cents` always written at render time; `actual_cost_cents` reconciled later from Atlas billing CSV export matched by `provider_task_id` |
| Log retention strategy | Retain + version (never delete; run_id lets you scope to current attempt) |
| Client error capture | Hand-rolled React error boundary + `withLogging` API wrapper (no third-party SDK) |
| Build timing | Deferred — quick-wins only while video generation is active |

---

## Phases

### Phase 0 — Quick-wins (SHIPPED 2026-06-19, no migration)

**0a — Rerun preserves log history** (commit 9e07d41)  
`api/properties/[id]/rerun.ts` no longer deletes `pipeline_logs`. Nulls `scene_id` first (FK release), then deletes+regenerates scenes. Abort-before-cascade guard: if the null-update errors, it throws before touching scenes. Adds a tombstone log line "Rerun initiated — prior attempt logs retained". 8 tests.

**0b — Logs viewer: filterable, live, honest** (commit edc6286)  
`src/pages/dashboard/Logs.tsx` — no API/schema changes; the existing `GET /api/logs` already accepted filter params. What changed client-side: stage/level/property-id filters wired to the API, real 5s `refetchInterval` (React Query), "Live · 5s" / "Paused" toggle replaces the former fake "Streaming / last 60s" label, pagination (limit 60→100, prev/next), active-filter chips, result count, joined property address column, inline error state. Note: "Warn+Error" mode client-post-filters a server page — visible count can trail server total until a server-side `level IN (...)` is added.

**0c — Cost-constraint-drift guard** (commit 0d37e12)  
`lib/__tests__/cost-constraint-drift.test.ts` — static test (no DB) asserting every `provider` and `unit_type` value in the TypeScript union (`lib/db.ts:397,399`) is present in the latest DB CHECK constraints (migration 085 for provider, 089 for unit_type). Tolerates one explicitly documented `KNOWN_PENDING_DRIFT` entry at a time. Found a real untracked-spend bug on first run (see Known Issues below).

---

### Phase 1 — Per-video provenance + non-swallowing logger (migration 090, PENDING)

**Deliverables:**
- Migration 090: (a) add `run_id UUID` to `pipeline_logs` and `cost_events` (nullable, indexed); (b) add `compute_units` to `cost_events_unit_type_check` constraint (fixes the known compute_units bug); (c) optionally add `model` + `date` columns to cost_events for per-video model breakdown.
- Thread `run_id` through `runPipeline` and pass it to every `log()` and `recordCostEvent()` call.
- Replace silent `.catch(() => {})` swallows on cost_event inserts with logged errors (so a CHECK violation surfaces immediately rather than silently dropping spend).
- Per-video model+date+Atlas-cost provenance queryable via `run_id`.

**Success criterion:** after a failed render, an operator can filter the Logs viewer by property and see both attempt 1 (prior run_id) and attempt 2 (current run_id) without interleaving.

---

### Phase 2 — Capture every 404/error (no migration)

**Deliverables:**
- `withLogging` wrapper on API routes: any unhandled error or 404 writes a `pipeline_logs` row with `level='error'`, `stage`, `metadata.url`, `metadata.statusCode`.
- Client React error boundary: catches render crashes, POSTs to a lightweight `/api/client-error` endpoint, displays a recoverable "Something went wrong" panel instead of a blank page.

**Success criterion:** a 404 on any API route produces a `pipeline_logs` row visible in the Logs viewer within 5 seconds.

---

### Phase 3 — Organized in-app log viewer (no migration)

**Deliverables:**
- Run timeline view: group log rows by `run_id`, show start/end timestamps, error count, cost total per run.
- Cost provenance panel per run: table of `cost_events` with `provider`, `unit_type`, `est_cost_cents`, `actual_cost_cents` (null until reconciled).
- Server-side `level IN ('warn','error')` filter on `GET /api/logs` (closes the client-post-filter gap from Phase 0b).

**Success criterion:** clicking a property shows its run history; clicking a run shows logs + cost breakdown side-by-side.

---

### Phase 4 — Partitioning / retention + Atlas invoice reconciliation (schema migration, DEFERRED)

**Deliverables:**
- `pipeline_logs` partitioned by month (or aged rows moved to cold storage) so the Logs viewer stays fast as volume grows.
- `scripts/atlas-invoice-import.ts`: parse Atlas billing CSV export, match rows by `provider_task_id`, write `actual_cost_cents` back to `cost_events`. Run after each Atlas invoice cycle.
- Reconciliation dashboard: `est_cost_cents` vs `actual_cost_cents` by provider/SKU/period.

**Success criterion:** monthly Atlas invoice reconcilable to within 5% of `cost_events` estimates via the import script, with discrepancies surfaced in the dashboard.

---

## Known issues

### compute_units untracked-spend bug (P0, fix = migration 090)

**Found by:** cost-constraint-drift test (0d37e12) on first run.

**Impact:** `unit_type='compute_units'` is emitted by `lib/mls/scrape-realtor.ts`, `lib/mls/scrape-redfin.ts`, and `lib/compass/scrape-listing.ts` on every Apify/Browserbase scrape — but `compute_units` is absent from the `cost_events_unit_type_check` DB constraint. Every `recordCostEvent` call for scraping hits a `23514 CHECK violation` that is silently swallowed by `.catch()` call-sites. Apify/Browserbase scraping spend has never been recorded in prod since the system launched.

**Fix:** migration 090 drops and recreates `cost_events_unit_type_check` with `compute_units` included (see `085_cost_events_bunny.sql` as a template). After migration, carve the KNOWN_PENDING_DRIFT entry out of `lib/__tests__/cost-constraint-drift.test.ts`.

**Carved into:** `KNOWN_PENDING_DRIFT` array in the drift test with a 2026-06-19 TODO comment, so the test stays green until the migration lands.

### pipeline_logs predates the migration numbering system

`pipeline_logs` was created before the numbered migration sequence began. Its DDL is not in `supabase/migrations/`. If Phase 1 adds columns to it, use `ALTER TABLE` in migration 090 rather than a full table recreation.

### "Warn+Error" filter is client-post-filtered

In Phase 0b, selecting "Warn + Error" in the Logs viewer omits the level filter from the API request and post-filters the returned page client-side. This means the visible row count can be lower than the server-reported total. The correct fix (Phase 3) is a server-side `level IN ('warn','error')` parameter on `GET /api/logs`.
