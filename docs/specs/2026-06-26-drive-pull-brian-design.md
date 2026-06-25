# Pull from Google Drive (Operator Studio, Brian-only) — design

**Date:** 2026-06-26
**Status:** Approved (chat), ready for implementation
**Branch:** `feat/drive-pull-brian-d7`

## Goal

Speed up Brian Helgemo's listing-video intake. Inside the existing Operator Studio
**New Order** screen, when Brian is the selected client, the operator can browse his
Google Drive `2026 listing photos` parent folder, pick one address subfolder, and have the
system **(a)** enrich the listing via Redfin from the folder name and **(b)** download that
folder's `Final` photos straight into the order — pre-filling the New Order form. The
operator then reviews and clicks the existing **Generate** button. **No auto-render.**

This is the manual, in-app counterpart to the (separate, unmerged) Drive→Telegram intake
automation. It reuses that branch's low-level Drive client but none of its
Telegram/webhook/cron machinery.

## Drive layout (source of truth)

```
2026 listing photos/            ← parent (DRIVE_PARENT_FOLDER_ID)
  Macedonia Dr 171/             ← property folder; name = address
    Final/                      ← photos to use live here
      IMG_001.jpg ...
  Some Other St 42/
    Final/ ...
```

If a property folder has **no** `Final` subfolder, fall back to images directly in the
property folder (so the feature still works for folders not yet organized).

## UX flow (`/dashboard/studio/video/new`, `StudioNew.tsx`)

1. Operator selects a client in the existing `ClientPicker`.
2. When the selected client id === `DRIVE_PULL_CLIENT_ID` (Brian), a **`DrivePullPanel`**
   renders below the picker. Hidden for every other client.
3. Panel shows **"Browse 2026 listing photos"**. Click → `GET /api/admin/studio/drive/folders`
   returns the address subfolders (`{ id, name, photoCount }[]`). Render as a selectable list.
4. Operator picks a folder → `POST /api/admin/studio/drive/pull { folderId }`:
   - resolve `Final` subfolder (fallback: folder root), `listFinalImages`, `downloadFile`
     each, `uploadPhotosToStorage` into `property-photos` under a temp path
     (`drive-pull/<folderId>/...`),
   - run the folder name through `lookupMlsByAddress(name, null)` (Redfin → Realtor fallback),
   - return `{ address, metadata, photo_storage_paths[], photoCount }`.
5. `DrivePullPanel` populates existing `StudioNew` form state: address field, Redfin
   metadata fields (price/bedrooms/bathrooms/sqft/description where present), and appends
   `photo_storage_paths` to the form's photo list with thumbnails.
6. Operator reviews and clicks the existing **Generate** button. The existing
   `POST /api/admin/studio/ingest` (`manualIngest`) path creates the property + photo rows
   from `photo_storage_paths` — **unchanged**.

The pull endpoint does **not** create a property; the form's existing submit does.

## Components / units

1. **`lib/drive/client.ts`** — cherry-picked from `worktree-feat+drive-telegram-intake`.
   Service-account JWT, read-only Drive v3, raw `fetch` (no `googleapis` SDK). Keep
   `listPropertyFolders`, `findFinalSubfolder`, `countFinalImages`, `listFinalImages`,
   `downloadFile`. **Drop** the change-feed/webhook helpers (`getStartPageToken`,
   `listChanges`, `watchChanges`, `stopChannel`) — not needed here. Auth from
   `GOOGLE_DRIVE_SA_JSON` (base64 SA key).

2. **`GET /api/admin/studio/drive/folders`** — admin-guarded. Returns address subfolders of
   `DRIVE_PARENT_FOLDER_ID` with a photo count each. Sorted by name. Errors: missing env →
   503 with a clear message; Drive auth failure → 502.

3. **`POST /api/admin/studio/drive/pull`** — admin-guarded. Body `{ folderId }` (must be a
   child of the parent — validated). Downloads Final images, uploads to `property-photos`,
   runs Redfin lookup, returns the pre-fill payload. Respects the existing non-prod
   write-guard (`VERCEL_ENV==='production' || LE_ALLOW_NONPROD_WRITES`) for the storage
   writes.

4. **`DrivePullPanel`** (`src/components/studio/DrivePullPanel.tsx`) — the conditional UI.
   Props: `clientId`, callbacks to set form address/metadata/photos. Two states: browse
   (folder list) and pulling (spinner + result). Errors surfaced inline (toast).

5. **Gating** — `DRIVE_PULL_CLIENT_ID` env holds Brian's client row id. Panel + endpoints
   no-op/forbid for any other client. Widening later = change/extend the env.

## Config / env

| Var | Purpose |
|---|---|
| `GOOGLE_DRIVE_SA_JSON` | base64 service-account key (read-only Drive scope) |
| `DRIVE_PARENT_FOLDER_ID` | the `2026 listing photos` folder id |
| `DRIVE_PULL_CLIENT_ID` | Brian's `clients.id` (gates the feature) |

`APIFY_API_TOKEN` (Redfin) already present in `.env.local`.

## Setup (collaborative, before/parallel to build)

1. Install gcloud (`brew install --cask google-cloud-sdk`); Oliver runs `! gcloud auth login`.
2. Script (CLI): pick/create project, enable Drive API, create service account + JSON key,
   base64 it → save to `~/credentials.md` + LE `.env.local` + Vercel env (preview).
3. Oliver shares `2026 listing photos` with the SA email (Viewer) in Drive; capture the
   folder id from the URL. Save Brian's `clients.id` (from `GET /api/admin/studio/clients`).

## Out of scope (YAGNI)

No Telegram, no Drive change-feed/webhook, no cron auto-detection, no auto-render, no
multi-client support (Brian only). All deferred to the separate Drive→Telegram branch or
future work.

## Testing

- `lib/drive/client.ts` keeps its existing unit tests (RSA-keypair signing path), pruned to
  the retained functions.
- Endpoint tests: folder-list shape, pull payload shape, gating (non-Brian client → 403),
  missing-env → 503, `Final`-missing fallback. Mock the Drive client + Redfin lookup.
- `DrivePullPanel`: renders only for Brian; populates form state on pull.
