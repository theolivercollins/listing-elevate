# Drive → Telegram intake & approval loop — design

**Date:** 2026-06-26
**Status:** Approved (chat), ready for implementation
**Branch:** `worktree-feat+drive-telegram-intake`

## Goal

When a new property folder's photos land in a watched Google Drive, notify Oliver on
Telegram ("🏠 New property detected: *Macedonia Dr 171* — 32 photos in Final. Generate a
video?"). Oliver approves, skips, or steers via free-text. On approval the system
auto-creates the property (enriching details from Redfin), ingests the photos, and runs
the existing generation pipeline. On completion Telegram posts the result; Oliver can
regenerate with feedback. **Human-in-the-loop by design** — nothing renders without a yes.

This replaces the previously-shelved fully-autonomous Drive auto-generation idea: detection
is automatic, generation is approval-gated, and the channel is Telegram (not Slack).

## Drive layout (source of truth)

```
2026 listing photos/            ← watched parent (WATCHED_FOLDER_ID)
  Macedonia Dr 171/             ← property folder; name = address
    Final/                      ← photos to use live here
      IMG_001.jpg ...
  Some Other St 42/
    Final/ ...
```

A property is **promptable** when its `Final` subfolder has ≥1 image AND the image count
has been **stable for `SETTLE_MINUTES` (default 10)** — so we never prompt mid-upload.

## Architecture

Six new units, each independently testable:

1. **`lib/drive/client.ts`** — Google Drive access via a **service account** (JWT). Functions:
   `listPropertyFolders(parentId)`, `findFinalSubfolder(propertyFolderId)`,
   `countFinalImages(finalFolderId)` / `listFinalImages(...)`, `downloadFile(fileId)`,
   plus change-feed helpers `getStartPageToken()`, `listChanges(pageToken)`,
   `watchChanges(pageToken, webhookUrl)`, `stopChannel(channelId, resourceId)`.
   Auth from `GOOGLE_DRIVE_SA_JSON` (base64 service-account key). Read-only scope.

2. **`lib/telegram/client.ts`** — product bot (distinct from the Claude Code bot).
   `sendMessage(text, {buttons})`, `editMessage(...)`, `answerCallback(...)`.
   Token `TELEGRAM_BOT_TOKEN`; recipient `TELEGRAM_OWNER_CHAT_ID`. Markdown + inline keyboards.

3. **DB (migration)** — two tables:
   - `drive_watch_state` — single-row channel state: `channel_id`, `resource_id`,
     `expiration`, `start_page_token`, `updated_at`.
   - `drive_intake` — one row per detected property folder:
     `id`, `drive_folder_id` (unique), `address`, `final_folder_id`, `photo_count`,
     `last_count_change_at`, `status`, `telegram_message_id`, `feedback_notes`,
     `property_id`, `created_at`, `updated_at`.
     `status ∈ {detected, awaiting_approval, approved, skipped, ingesting, generating,
     rendered, error}`.

4. **Endpoints**
   - `POST /api/drive/webhook` — receives Drive push pings. Validates the
     `X-Goog-Channel-Token` shared secret, calls `listChanges`, upserts affected
     `drive_intake` rows (resolve folder → property folder under the watched parent →
     `Final` → image count), advances + persists the page token. Idempotent. Returns 200 fast.
   - `POST /api/telegram/webhook` — receives callback_query (button taps) + messages
     (free-text). Validates `X-Telegram-Bot-Api-Secret-Token`. Maps to a `drive_intake`
     row (callback data carries the intake id; free-text maps to the most recent
     awaiting/rendered row for the owner chat). Routes to approve / skip / steer /
     regenerate handlers.
   - `GET /api/cron/drive-settle` — promotes `detected` rows whose `photo_count` has been
     stable past `SETTLE_MINUTES` to `awaiting_approval` and sends the Telegram prompt.
     Also the safety net if a webhook ping is missed (re-lists the watched parent).
   - `GET /api/cron/drive-channel-renew` — re-registers the Drive watch channel before
     expiry (channels live ≤7 days); stores new channel/token.
   - `GET /api/cron/drive-intake-poll` — for `generating` rows, checks the linked
     property's status; when it reaches `complete`/`delivered`, posts the result to
     Telegram with [🔁 Regenerate] and flips intake → `rendered`. Decouples us from
     pipeline internals (no pipeline edits).

5. **`lib/drive/orchestrate.ts`** — the approve action:
   `approveIntake(intakeId)` → enrich address via `lookupMlsByAddress(address, null)`
   (`lib/mls/lookup.ts`) → `createProperty({address, price, bedrooms, bathrooms,
   listing_agent, ...defaults})` → download `Final` images → `uploadPhotosToStorage(files,
   '<propertyId>/raw')` (`src/lib/photo-upload.ts`) → trigger the existing pipeline for the
   property → set intake `generating`, store `property_id`. `feedback_notes` (if any) are
   attached to the property's custom-request field so they steer generation.
   `regenerateIntake(intakeId, notes)` re-runs the pipeline with appended notes.

6. **Config / flags** — all behind `DRIVE_INTAKE_ENABLED`. Every write path also respects the
   existing non-prod write-guard (`VERCEL_ENV==='production' || LE_ALLOW_NONPROD_WRITES`), so
   it never creates properties or triggers renders off prod. New `/api/*` routes registered in
   `vercel.json` (crons + routes) and `GUARDED_PATHS` per project convention.

## Data flow

```
Drive change → /api/drive/webhook → listChanges → upsert drive_intake (count Final images)
                                                      │
                       /api/cron/drive-settle (count stable ≥ SETTLE_MINUTES)
                                                      │  → Telegram prompt [✅ Generate][❌ Skip]
                                  ┌───────────────────┴───────────────────┐
                          ✅ Generate                                ❌ Skip / free-text
                                  │                                        │
            approveIntake: enrich(Redfin) → createProperty            skipped / store notes
                  → download Final → uploadPhotosToStorage
                  → trigger pipeline → intake=generating
                                  │
                 /api/cron/drive-intake-poll (property complete?)
                                  │  → Telegram result + [🔁 Regenerate]
                              rendered
```

## Property auto-fill

Folder name is the address. `lookupMlsByAddress(address, null)` returns
`{price, bedrooms, bathrooms, agent, sqft, description, listingUrl}` (Apify/Redfin, Realtor
fallback, already cost-tracked). Missing fields fall back to nullable/sensible defaults
(package/duration/orientation default to the only live template combo). Oliver's free-text
feedback overrides via the custom-request path.

## Telegram UX

- **Prompt:** `🏠 New property detected: *<address>* — <N> photos in Final.\nGenerate a video?`
  buttons `[✅ Generate] [❌ Skip]`. Free-text reply before approving is stored as steering notes
  and echoed back ("Noted — will steer with: …").
- **On approve:** edit message → `⏳ Generating <address>…`.
- **On complete:** new message (so it pings) `✅ <address> is ready: <link>` + `[🔁 Regenerate]`.
  Free-text after completion = regenerate-with-notes.
- **Errors:** `⚠️ <address> failed at <stage>: <msg>` (no silent failures).

## Out of scope (v1)

- **Publish** — dropped per Oliver. No external posting; completion notification only.
- Multiple / per-client watched folders (single owner intake folder only).
- Editing the Telegram bot from the app UI.

## Security / safety

- Drive SA is **read-only**, scoped to the shared folder only.
- Both webhooks verify a shared secret header; reject otherwise.
- Telegram inbound restricted to `TELEGRAM_OWNER_CHAT_ID`.
- Non-prod write-guard enforced on every property/render-creating path.
- Service-account key + bot token are secrets (env only; never logged, never committed).

## Credentials (provisioning — Oliver, one-time)

Cannot be self-provisioned (need Oliver's authenticated Google + Telegram sessions):

1. **Google service account**: GCP console → enable Drive API → create SA → JSON key →
   share `2026 listing photos` (Viewer) with the SA email → set `GOOGLE_DRIVE_SA_JSON`
   (base64) + `DRIVE_WATCHED_FOLDER_ID` in prod env.
2. **Telegram bot**: BotFather → `/newbot` → token → set `TELEGRAM_BOT_TOKEN`; message the
   bot once, fetch `TELEGRAM_OWNER_CHAT_ID` via getUpdates → set in prod env. Set the Telegram
   webhook to `/api/telegram/webhook` with the secret token.

Then I register the Drive watch channel (one call) and flip `DRIVE_INTAKE_ENABLED=true`.

## Testing

Unit tests mock Drive + Telegram HTTP. Cover: folder→address resolution, settle/debounce
logic, webhook idempotency, approve orchestration (enrich→create→ingest→trigger) with mocked
deps, callback routing, write-guard enforcement off-prod. No live external calls in tests.
