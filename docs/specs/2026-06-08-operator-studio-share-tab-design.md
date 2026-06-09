# Operator Studio — "Share" tab (Vimeo-style creative sharing)

**Date:** 2026-06-08
**Status:** Approved design → implementation
**Author:** Claude (autonomous), for Oliver
**Target:** `main` → listingelevate.com

## Goal

Add a **Share** tab inside Ops → Operator Studio (`/dashboard/studio`) where an
operator can **upload creatives** (video/image) or **pull existing rendered
property videos**, then configure Vimeo-style sharing options per creative:
**presentation page, embed code, download on/off, privacy & expiry**. Fully
operational end-to-end (upload → configure → public share/embed → view tracking).

Admin-only (sits under the existing `RequireAdmin` guard like the rest of Studio).

## Decisions (locked)

- **Source:** Both — upload arbitrary creatives AND pull from existing pipeline
  renders (`properties.horizontal_video_url` / `vertical_video_url`).
- **Toggles:** Presentation page, Embed code, Download on/off, Privacy & expiry
  (public/unlisted + optional password + optional expiry date).
- **Default access:** Unlisted (anyone with the link), password off, no expiry.
- **Storage:** New **private** `creatives` bucket for uploads → enforced via
  short-lived signed URLs minted by the share API. Pulled renders keep their
  existing public `property-videos` URL.
- **Schema:** One `creatives` table carrying asset metadata + share settings +
  unique `share_token` (mirrors the proven `property_previews` token pattern).

## Architecture

### Data model — migration `NNN_creatives.sql`

Table **`creatives`**:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `title` | text not null | defaults to filename on upload |
| `description` | text null | |
| `source` | text not null | `'upload' \| 'render'` (check) |
| `kind` | text not null | `'video' \| 'image'` (check) |
| `bucket` | text not null | `'creatives'` for uploads, `'property-videos'` for renders |
| `storage_path` | text null | path within bucket (uploads) |
| `public_url` | text null | populated for `source='render'` (already-public) |
| `thumbnail_url` | text null | poster image (optional) |
| `mime_type` | text null | |
| `duration_seconds` | numeric null | |
| `width` | int null | |
| `height` | int null | |
| `file_size_bytes` | bigint null | |
| `property_id` | uuid null | FK→properties when `source='render'` (set null on delete) |
| `share_token` | text not null unique | 32-char base32, generated server-side |
| `visibility` | text not null default `'unlisted'` | `'unlisted' \| 'public'` (check) |
| `allow_download` | boolean not null default false | |
| `allow_embed` | boolean not null default true | |
| `presentation_enabled` | boolean not null default true | |
| `password_hash` | text null | sha256 hex; null = no password |
| `expires_at` | timestamptz null | null = never |
| `view_count` | int not null default 0 | |
| `last_viewed_at` | timestamptz null | |
| `created_by` | uuid null | auth user id |
| `created_at` | timestamptz not null default now() | |
| `updated_at` | timestamptz not null default now() | |

Indexes: unique on `share_token`; btree on `created_at desc`; btree on `property_id`.

RPC **`increment_creative_view(p_token text)`** — atomic `view_count = view_count + 1`,
`last_viewed_at = now()` where `share_token = p_token`. SECURITY DEFINER so the
public (anon) share route can call it without table-level grants.

RLS: table is **service-role only** (never queried from the browser anon key),
exactly like `property_previews`. All reads/writes go through API routes that use
the service-role key. Browser uses admin API routes (admin-gated server-side).

Storage bucket **`creatives`**: private (no public policy). Files uploaded by
admin via direct REST using anon key + authenticated session OR via a server
signed-upload URL (see Upload flow). Playback only via signed URLs from the API.

### Storage — buckets

- New private bucket `creatives`. Path: `{creativeId-or-uuid}/{timestamp}_{sanitizedName}`.
- Pulled renders: no copy — `creatives` row references the existing public
  `property-videos` URL via `public_url`, `bucket='property-videos'`.

### API routes (Vercel serverless under `/api`)

**Public (no auth):**
- `GET  /api/share/[token]` → resolves `creatives` by `share_token`. Enforces:
  `expires_at` (410 if expired), `password_hash` (401 + `{ requiresPassword:true }`
  if set and not satisfied). Returns `{ title, description, kind, allow_download,
  allow_embed, presentation_enabled, playbackUrl, posterUrl, width, height,
  downloadUrl|null }`. For `source='upload'` mints a short-lived (2h) **signed
  URL** from the private `creatives` bucket; for `source='render'` returns the
  stored public URL. Calls `increment_creative_view`.
- `POST /api/share/[token]` body `{ password }` → verifies sha256, on success
  returns same payload as GET (sets nothing server-side; stateless verify). 401 on mismatch.

**Admin (server-side gated — same approach as existing `/api/admin/studio/*`):**
- `GET  /api/admin/studio/creatives` → list (newest first) with computed share URLs.
- `POST /api/admin/studio/creatives` → two modes:
  - `{ mode:'upload', storage_path, title, kind, mime_type, file_size_bytes,
    width?, height?, duration_seconds? }` → insert `source='upload'`, bucket
    `creatives`, generate `share_token`.
  - `{ mode:'render', property_id, orientation:'horizontal'|'vertical', title }`
    → look up the property's video URL, insert `source='render'`, `public_url`,
    bucket `property-videos`, generate `share_token`.
- `GET  /api/admin/studio/creatives/renders` → list properties that have a
  `horizontal_video_url` or `vertical_video_url` (id, address, both urls) for the
  "Add from renders" picker.
- `PATCH /api/admin/studio/creatives/[id]` → update settings: `title, description,
  visibility, allow_download, allow_embed, presentation_enabled, expires_at`, and
  `password` (hashed server-side; empty string clears it). Bumps `updated_at`.
- `DELETE /api/admin/studio/creatives/[id]` → delete row; if `source='upload'`
  also remove the storage object.

All write routes guard with `process.env.VERCEL_ENV === 'production' ||
process.env.LE_ALLOW_NONPROD_WRITES === 'true'` before mutating (per CLAUDE.md
app-layer isolation, since Supabase is shared across envs).

For the signed **upload** URL: add `POST /api/admin/studio/creatives/upload-url`
returning a Supabase signed upload token (`createSignedUploadUrl`) for the
private bucket, so the browser can PUT directly without exposing the service key.

### Public viewer pages (React routes, no auth)

- `/v/:token` — **presentation**: branded full-screen viewer. Fetches
  `/api/share/:token`. Shows player (video) or image, title, optional download
  button (when `allow_download`), password gate when `requiresPassword`, expiry
  / not-found states. Hidden if `presentation_enabled=false` (404-style message).
- `/embed/:token` — **embed**: minimal, chrome-less, responsive 16:9 player meant
  for `<iframe>`. Respects `allow_embed` (refuses with a small message if false).
  No site shell; sets permissive framing.

Register both in `src/App.tsx` outside the dashboard/admin tree (public), and add
any needed rewrites to `vercel.json` (token param), mirroring `/api/preview`.

### Admin UI — `src/pages/dashboard/studio/Share.tsx`

Rendered inside `StudioShell` with `StudioNav` (new `Share` tab added). Uses
`.studio-*` classes + `--le-*` tokens. Components (new, under
`src/components/studio/share/`):

- `ShareLibrary` — responsive grid of `CreativeCard`s (thumbnail/poster, title,
  view count, visibility badge, kind icon). Empty state with upload CTA.
- Toolbar: **Upload** (opens `UploadDropzone`) and **Add from renders** (opens
  `RenderPicker` modal listing `/creatives/renders`).
- `UploadDropzone` — drag-drop/select; requests signed upload URL, PUTs to the
  private bucket with progress, reads basic metadata (duration/dimensions via a
  temporary `<video>`/`<img>`), then POSTs `mode:'upload'`.
- `CreativeSettingsPanel` — slide-over/drawer (Vimeo-style) for a selected
  creative with a live player and sections:
  - **General** — title, description.
  - **Privacy** — unlisted/public segmented, password toggle + field, expiry date.
  - **Embed** — size presets (responsive / 640×360 / 1280×720) + copyable
    `<iframe src="…/embed/:token">` snippet; disabled when `allow_embed=false`.
  - **Sharing** — copy `/v/:token` presentation link + QR (lightweight inline
    SVG QR, no new heavy dep if avoidable).
  - **Download** — on/off toggle.
  - Saves via PATCH (debounced or explicit Save), DELETE with confirm.

Client API helpers in `src/lib/share-api.ts` (list, create, patch, delete,
get-upload-url, list-renders).

## Data flow

1. **Upload:** browser → `POST /creatives/upload-url` → signed token → PUT file to
   private `creatives` bucket → `POST /creatives {mode:'upload', storage_path,…}`
   → row + `share_token`. Card appears.
2. **Pull render:** open picker → `GET /creatives/renders` → pick property+orientation
   → `POST /creatives {mode:'render',…}` → row referencing public URL.
3. **Configure:** edit in `CreativeSettingsPanel` → `PATCH /creatives/:id`.
4. **Share:** copy `/v/:token` or embed `<iframe>`.
5. **View:** visitor → page → `GET /api/share/:token` (enforces settings, mints
   signed/public URL, increments view) → plays. Password → `POST` verify.

## Error handling

- Share API: 404 unknown token / presentation disabled; 410 expired; 401
  `{requiresPassword:true}` when locked; signed-URL failures → 502 with message.
- Upload: partial/failed PUT surfaces inline; oversized files rejected client-side
  (cap e.g. 500 MB) before requesting a token.
- Admin writes blocked in non-prod without `LE_ALLOW_NONPROD_WRITES` → 403 with
  clear message (so preview deploys don't mutate shared Supabase).

## Testing

- **Unit:** token generation uniqueness; password hash/verify; share-settings
  enforcement (expiry/visibility/password) as a pure function over a creative row;
  signed-URL selection logic (upload vs render).
- **API:** share route returns correct payload + 401/410/404 per settings; admin
  create (both modes) + patch + delete happy paths; non-prod write guard returns 403.
- **Integration (real):** one real run — upload a small video, configure embed +
  download + expiry, hit `/api/share/:token`, confirm signed URL plays, confirm
  view_count increments, confirm password gate, confirm expiry returns 410.
- Keep the existing 703-test suite green.

## Out of scope (YAGNI)

- Per-view analytics beyond a counter + last_viewed_at.
- Folders/collections, comments/reactions, multiple tokens per creative.
- Transcoding/thumbnails generation pipeline (use poster from first frame if easy;
  otherwise a neutral placeholder). Re-encode is not done here.
- Customer-facing dashboards (explicit product non-goal). Share links only.

## Files (new/changed)

New:
- `supabase/migrations/NNN_creatives.sql`
- `api/share/[token].ts`
- `api/admin/studio/creatives/index.ts`
- `api/admin/studio/creatives/[id].ts`
- `api/admin/studio/creatives/renders.ts`
- `api/admin/studio/creatives/upload-url.ts`
- `lib/operator-studio/creatives.ts` (server helpers: token gen, hash, settings enforcement, signed URLs)
- `src/pages/dashboard/studio/Share.tsx`
- `src/pages/share/Presentation.tsx` (`/v/:token`)
- `src/pages/share/Embed.tsx` (`/embed/:token`)
- `src/components/studio/share/{ShareLibrary,CreativeCard,UploadDropzone,RenderPicker,CreativeSettingsPanel}.tsx`
- `src/lib/share-api.ts`
- styles: extend `src/styles/studio-design.css` (share-specific classes)
- tests under existing test dir.

Changed:
- `src/components/studio/StudioNav.tsx` (+ Share tab)
- `src/App.tsx` (admin Share route + public `/v/:token`, `/embed/:token`)
- `vercel.json` (rewrites for `/api/share/:token`, `/v/:token`, `/embed/:token` if SPA fallback needs it)
- `docs/HANDOFF.md` (shipping log line before merge to main)
