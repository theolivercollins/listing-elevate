# Share tab → Bunny Stream rebuild (2026-06-09)

**Goal:** Migrate Share-tab video hosting from Supabase Storage to **Bunny Stream** (cheaper delivery, HLS adaptive streaming, real player, thumbnails, resumable uploads with true progress), and rebuild the Share UI to a Vimeo-style backend (player + appearance + share panels). Iterate until complete, pushed to prod, and verified working via Claude-in-Chrome.

## Bunny config (stored in ~/credentials.md + Vercel env)
- Library ID: **679131** ("ListingElevate")
- CDN hostname: **vz-01cb8232-b48.b-cdn.net**
- API key: per-library Stream key (redact as `f36a…45d0`)
- Env vars: `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_CDN_HOSTNAME`

## Status
- [x] Verify key + library, store creds
- [x] `lib/providers/bunny-stream.ts` (create / TUS-auth / get / delete / embed+hls+thumb+mp4 URLs) — **validated end-to-end** via `scripts/bunny-smoke.ts` (create→upload→transcode→delete on real API)
- [ ] Migration `077`: add `creatives.bunny_video_id text`; uploads set it (Supabase render path unchanged)
- [ ] API `bunny-upload`: create Bunny video + mint TUS signature → `{videoId, libraryId, signature, expiration, endpoint}`
- [ ] API create/index: accept `{bunny_video_id}`; `share/[token]` + admin `withUrls` return Bunny embed/hls/thumbnail; download via `bunnyMp4Url`
- [ ] Client: `tus-js-client` upload to Bunny with **real progress** (fixes "stuck at 10%"); fall back to Supabase if Bunny unconfigured
- [ ] Player: `Presentation.tsx` / `Embed.tsx` render Bunny iframe (or hls.js) instead of `<video src>`
- [ ] Vimeo-style UI: appearance panel (player primary/accent/bg colors, controls hide/show, autoplay/loop) + enhanced share panel (privacy, viewer permissions, link, embed presets) wired to Bunny iframe params
- [ ] Set Vercel env (3 vars) on prod+preview
- [ ] Deploy → verify upload + playback + share link + download live in Claude-in-Chrome

## Privacy note
Bunny "unlisted" = anyone with the embed URL can view (same as Vimeo unlisted). Our `/api/share` still gates expiry/password before handing out the embed URL. For hard private/password, enable Bunny **Token Authentication** on the library and sign embed URLs (follow-up).

## Architecture
Upload: client → `POST /api/admin/studio/creatives/bunny-upload` (server creates Bunny video + TUS sig) → `tus-js-client` PUTs file directly to `video.bunnycdn.com/tusupload` (key never reaches browser, real progress, resumable) → `POST /api/admin/studio/creatives` with `bunny_video_id`. Playback: Bunny iframe `iframe.mediadelivery.net/embed/679131/{guid}`. `creatives` table + Share UI shell stay; only storage + playback change.
