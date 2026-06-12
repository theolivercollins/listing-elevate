# LE Video — design

Date: 2026-06-11 · Status: approved (Oliver, in-session) · Branch: `feat/le-video`
Builds on: `docs/specs/2026-06-11-preview-links-v2-design.md` (shipped to prod; migration 083 applied)

## Goal

Make the **video** the managed object — "Vimeo inside Listing Elevate, proprietary." Preview links and Share merge into one system: a link to a video with a kind, capabilities, a label, and its own analytics. Oliver's bar: a real place to manage videos/links, connected to share, and it must look super good — not boilerplate.

## Surfaces

### 1. Library — `/dashboard/studio/videos`
New "Videos" tab in StudioNav. Every property with a delivered video (horizontal or vertical URL non-null), as a cinematic poster grid: hero photo (via `resolveHeroPhotoUrl`), street address + locality, client name, 16:9/9:16 badges, view count, approved badge, date. Filter by client + date range; text search on address. Empty/loading states styled. Pagination (page size ~24).

### 2. Video hub — `/dashboard/studio/videos/[propertyId]`
The management page for one video:
- **Player** — `<LEPlayer>` (below), orientation switcher when both renders exist.
- **Share panel** — ALL links for this video. Each link: kind chip (Client/Public), editable **label** ("Sent to Brian", "IG bio"), copy URL, capability toggles (existing PATCH), view stats, approved badge, **revoke** (sets `revoked_at`; revoked links render as expired on the watch page), expiry display. "New link" per kind (existing POST + new `label`). This panel is a shared component (`SharePanel`) extracted from the v2 ShareDialog; PropertyCommandCenter's dialog reuses it and gains an "Open video hub →" link.
- **Analytics** — top cards: total plays, unique viewers, avg completion %; per-link table: plays / unique sessions / completion / last viewed (computed from `preview_view_events`, with legacy `viewed_count` shown as "page views"). No third-party analytics.
- **Activity** — approvals + revision notes (existing `property_revision_notes`), newest first.
- **Downloads** — per-orientation (existing admin download endpoint).

### 3. Watch page (public, existing) — proprietary player + beacons
- Replace native `controls` with `<LEPlayer>`: LE-styled control bar (play/pause, scrubber with buffered range, elapsed/total time, mute/volume, fullscreen), large center play affordance over the poster, auto-hiding controls during playback, keyboard accessible (space/arrows/f/m), `playsInline`. No new deps — hand-rolled over `<video>`, styled within `preview-design.css` tokens.
- **Beacons**: `LEPlayer` emits playback events; the watch page posts them via `navigator.sendBeacon` to the events endpoint. `session_id` = `crypto.randomUUID()` kept in `sessionStorage`. Events: `view` (page load), `play` (first play per session), `progress_25/50/75`, `complete`. Beacons must NEVER affect playback — fire-and-forget, all errors swallowed.
- Revoked links → the existing expired state.

### 4. Embed (P2, optional) — `/preview/:token/embed`
Minimal chrome-less page: just `<LEPlayer>` filling the viewport, `noindex`. vercel.json: SPA route `{ "src": "/preview/([^/]+)/embed", "dest": "/index.html" }` positioned ABOVE the bare `/preview/([^/]+)` OG-shim route (more-specific path wins). Sierra custom pages accept iframes → agents can embed their film on their own site. Respects kind/capabilities (no action buttons ever; it's view-only by nature). If time-boxed out, ship P1 without it and note it.

## Data — migration 084 (additive only; write file, do NOT apply — Oliver gates)

```sql
alter table property_previews
  add column if not exists label text,
  add column if not exists revoked_at timestamptz;

create table if not exists preview_view_events (
  id uuid primary key default gen_random_uuid(),
  preview_id uuid not null references property_previews(id) on delete cascade,
  session_id text not null,
  event text not null check (event in ('view','play','progress_25','progress_50','progress_75','complete')),
  position_seconds numeric,
  orientation text check (orientation in ('horizontal','vertical')),
  referrer text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists idx_preview_events_preview on preview_view_events(preview_id, created_at desc);
create index if not exists idx_preview_events_session on preview_view_events(preview_id, session_id);
```

Aggregates compute `distinct session_id` per event type (dedupe at read time — the beacon endpoint inserts append-only; clamp `user_agent`/`referrer` to 512 chars).

## API

- **`POST /api/preview/:token/events`** (public) — body `{ session_id, event, position_seconds?, orientation? }`. Validates token well-formed + link exists + not expired/revoked; whitelists `event`; clamps strings; inserts; returns 204 always on handled paths (including pre-migration insert failure — never break the watch page). No auth, no PII beyond UA/referrer.
- **`GET /api/admin/studio/videos`** — library query (admin-gated): properties with a video URL, joined client name + hero photo + link/view aggregates; `?client_id=&q=&page=`.
- **`GET /api/admin/studio/videos/[id]`** — hub bundle: property, video URLs, hero, all preview links (with per-link event aggregates), revision notes, totals.
- **Extend existing**: `POST .../preview-link` accepts `label`; `PATCH .../preview-links/[previewId]` accepts `label` and `revoked` (true → stamp `revoked_at`, false → clear). `fetchByToken` treats `revoked_at` set as expired.
- vercel.json: routes for `/api/preview/([token])/events`, `/api/admin/studio/videos(/[id])`, `/embed/([token])` — sub-routes above bare catches, all before SPA fallback; extend the route-coverage test.

## Back-compat & rollout

Code must tolerate migration 084 not being applied: events endpoint swallows insert errors (204); library/hub select new columns with fallbacks (label→null, revoked_at→null, events→empty aggregates) — same `fetchPreviewMeta`-style guard pattern as v2. Rollout: merge code → Oliver green-lights 084 → analytics start accumulating. Nothing breaks in the window; analytics just read zero.

## Design bar

Follow `docs/design/DESIGN-GUIDE.md` (canonical radii/spacing/shadows/type, PageHeading pattern) for Studio surfaces; watch page stays in `preview-design.css` language. Inter only — **no monospace anywhere** (CLAUDE.md rule). Library grid and player chrome are the two "this looks expensive" moments: deliberate hover states, real empty states, tabular-nums for stats, no default-browser UI visible.

## Testing

TDD throughout: events endpoint (validation, revoked/expired 404, pre-migration 204, clamping), aggregates math (distinct-session dedupe), library query filters, label/revoke PATCH, `fetchByToken` revoked behavior, LEPlayer component tests (play/pause/seek/fullscreen/keyboard, beacon callback firing, milestone thresholds fire once per session), route-coverage test extended, headless mount check of built bundle for `/preview/*` and the new Studio routes before any prod push.

## Out of scope

Customer-dashboard exposure, folders/collections, comments-on-timeline, password-protected links, per-tenant player theming, video replacement/versioning.
