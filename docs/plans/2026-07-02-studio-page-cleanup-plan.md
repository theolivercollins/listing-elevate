# Studio property page cleanup — plan (2026-07-02)

Feedback source: Oliver, on prod page `/dashboard/studio/video/properties/326f005e-4412-45ca-a8cc-6aa9eb26b0c0` (1418 Kinglet Dr). Branch: `worktree-studio-page-cleanup` off `origin/main` @ 21cab42.

## Verified root causes (prod DB + code on main)

1. **Assembled with missing clips** — scenes 2/5/6/7 have `attempt_count=0, provider=null, clip_url=null` (never submitted). Autopilot A/B path silently "accepts" scenes with missing/unjudged variants (`lib/delivery/auto-run.ts:544-557`); assembly guards only require ≥1 qc_pass clip (`lib/pipeline.ts:2457-2464` rerunAssembly, `lib/pipeline.ts:1765-1771` core); the 80% `passingThreshold` in `api/cron/poll-scenes.ts:16` is bypassed for delivery-run properties (`poll-scenes.ts:534-556`). Result: a 30s video assembled from 3 clips (assembly job expected 15s).
2. **Checkpoint B blurry, Output sharp** — PR #155 made Checkpoint B stream Bunny HLS via `HlsPlayer` with zero-config hls.js (default ABR starts low: `src/components/preview/HlsPlayer.tsx:112`) + compressed `thumbnail.jpg` poster; Output card plays the fixed `play_1080p.mp4` directly. No quality selector exists.
3. **Video shows twice** — CheckpointB card (`PropertyCommandCenter.tsx:758-776`) and Output "Final video" card (`:851-915`) render simultaneously with no mutual exclusion.
4. **"Quality below threshold" / "autopilot paused" opaque** — `resolveCheckpointB` scores heuristically (base 0.5, ±0.1 factors, threshold 0.7 at `lib/delivery/auto-run.ts:43,1022-1067`) and writes raw `paused_reason='quality below threshold: 0.50 < 0.7'`; `AutopilotPanel.tsx:335-359` shows the raw string with no explanation or guidance. (Here the gate worked: score 0.50 because 4/7 scenes degraded.)
5. **Brand Kit unclear** — section renders client logo/colors/agent with no explainer and silent gaps for missing fields (`PropertyCommandCenter.tsx:1095-1205`).
6. **Cost accuracy doubt** — totals ARE correct sums of `cost_events`; confusion is that QC re-renders (`metadata.render_outcome='qc_rerender_discarded'`) are invisible (7 Atlas charges vs 3 kept clips) and $0 rows show without context (`api/admin/studio/properties/[id].ts:12-34`, UI `:1207-1362`).
7. **Bunny player** — final videos already hosted on Bunny Stream; player is generic native `<video>`/hls.js. `bunnyEmbedUrl` (iframe.mediadelivery.net, built-in quality menu) exists (`lib/providers/bunny-stream.ts:133`) and CSP already allows `frame-src iframe.mediadelivery.net` (vercel.json:20). Creatives surface already embeds it.

## Global constraints

- UI follows `docs/design/DESIGN-GUIDE.md` (tokens only, no hardcoded radii/colors, PageHeading pattern). **No monospace UI text** — Inter everywhere.
- Worktree has no node_modules: run tools via the main repo, e.g. `/Users/oliverhelgemo/listing-elevate/node_modules/.bin/vitest run <file>` and `pnpm typecheck:baseline` equivalent (`node_modules/.bin/tsc`—use existing package scripts with `pnpm -C` if needed).
- Destructive/DB-writing paths must respect the nonprod write guard (`VERCEL_ENV==='production' || LE_ALLOW_NONPROD_WRITES==='true'`); no schema changes in this plan.
- Do not break the non-delivery (legacy cron) pipeline path.
- TDD per superpowers: failing test first where logic changes (Tasks 1, 3, 5 API).

## Tasks (sequential)

### Task 1 — Generation-completeness gate: pause autopilot instead of assembling partial videos
Files: `lib/delivery/auto-run.ts`, `lib/pipeline.ts`, tests in `lib/delivery/__tests__/` (or nearest existing test dir pattern).
- In `resolveCheckpointA` (auto-run.ts ~525-582): before auto-accepting, count ordered scenes with a usable winner clip. If usable < total non-skipped scenes for the run, call `pauseForHuman(run.id, reason)` with reason `generation incomplete: N of M scenes have no clip (scenes X, Y, Z)` instead of silently accepting degraded/missing variants. (Scenes that a human explicitly excluded don't count.)
- In `rerunAssembly` (pipeline.ts ~2457): strengthen guard — if the run's `scene_order` is present, require every scene in it to be qc_pass with clip_url; without a run, require `completedScenes.length >= passingThreshold(totalScenes)` (reuse/extract the ceil(80%) helper) instead of `> 0`. Provide `{ allowPartial: true }` opt-out param used ONLY by explicit manual operator rerun if one exists; default strict.
- Keep core assembler behavior for legacy path unchanged apart from the shared helper.
- Tests: unit tests for the new gate math + pause reason string; regression test that legacy path with 6/7 passed still assembles.

### Task 2 — One video, Bunny embed player, full-quality option
Files: `api/admin/studio/properties/[id].ts`, `src/pages/dashboard/studio/PropertyCommandCenter.tsx`, `src/components/studio/CheckpointB.tsx`.
- API: derive the Bunny video GUID server-side (parse `horizontal_video_url`/`vertical_video_url` path `https://<cdn>/<guid>/play_*.mp4` or `playlist.m3u8`) and add to the bundle: `final_video: { horizontal: { embed_url, mp4_url, hls_url } | null, vertical: {...} | null }` using `bunnyEmbedUrl` (env `BUNNY_STREAM_LIBRARY_ID`). Null when the URL isn't a Bunny URL (provider-URL fallback case).
- CheckpointB: when `embed_url` present render the Bunny iframe player (responsive 16:9, `allow="fullscreen"`, title set) — it has a built-in quality menu (up to 1080p) which satisfies "load full quality". Fallback: existing HlsPlayer with MP4 (`videoUrl`) preferred over HLS so the fallback is sharp. (HlsPlayer already handles non-.m3u8 srcs via its direct `<video src>` path — HlsPlayer.tsx:84-87 — so passing an MP4 is safe; cross-model review flagged this, verified safe.)
- Dedupe: exactly ONE final-video player on the page. When the delivery stepper shows CheckpointB, the Output card must not render players — show compact rows instead (Download horizontal/vertical buttons + open-in-new-tab links). When no active checkpoint (e.g. delivered/no run), Output card shows the embed player (same component extraction: `FinalVideoPlayer`).
- No CSP change needed (frame-src already allows iframe.mediadelivery.net). Verify X-Frame-Options concerns don't apply (we're the embedder, not the embeddee).
- Tests: API unit test for GUID derivation incl. non-Bunny fallback; component render logic can be verified by typecheck + existing test patterns if component tests exist.

### Task 3 — Autopilot pause + quality-gate clarity
Files: `lib/delivery/auto-run.ts` (resolveCheckpointB ~995-1067), `src/components/studio/AutopilotPanel.tsx`, tests.
- Build the pause reason from the actual scoring factors, human-readable, e.g.: `Final video scored 0.50 (needs 0.70): 4 of 7 scenes missing clips; listing details present; voiceover present; music present`. Keep the machine-readable prefix `quality below threshold:` OR better: write a plain sentence and have the panel treat any string safely (no parsing dependency).
- AutopilotPanel paused banner: title "Autopilot paused — needs your review"; show reason; add one guidance line mapped from reason content (missing clips → "Generate or fix the missing scenes, then resume autopilot."; generic quality → "Review the video at Checkpoint B, then resume or take over."). Show `auto_paused_at` relative time (already exists).
- Tests: reason-string unit test for the missing-clips and generic cases.

### Task 4 — Brand Kit section clarity
Files: `src/pages/dashboard/studio/PropertyCommandCenter.tsx` (brand kit section ~1095-1205).
- Add a one-line explainer under the title: "The client's branding applied to this video — logo, colors, and agent card pulled from their client profile."
- Render explicit "Not set" placeholders for missing colors/agent instead of silent gaps; keep existing incomplete-logo warning + "Complete brand kit" link.
- Pure copy/markup; design tokens only.

### Task 5 — Cost section: explain re-renders and $0 events
Files: `api/admin/studio/properties/[id].ts`, `src/pages/dashboard/studio/PropertyCommandCenter.tsx` (cost section), tests for the API reducer if a test exists/pattern allows.
- API: while reducing, per provider also count `events` and sum `rerender_cents`/`rerender_count` where `metadata.render_outcome === 'qc_rerender_discarded'`. Include in response.
- UI: per-provider row gains muted "N events" text; when rerender_count>0 add sub-line "includes N discarded QC re-renders (–$X.XX of this total)". Footer note: "Every provider call is logged, including $0 events." $0 rows keep showing.
- No change to stored data; totals unchanged (they were verified accurate for 326f005e: $3.92 Atlas = 7 real renders incl. 4 discarded re-renders).

### Task 6 — Final: whole-branch review, typecheck baseline, HANDOFF note, PR
- `pnpm typecheck:baseline` (via main-repo tooling), run touched test files, final code-reviewer pass, update `docs/HANDOFF.md` shipping log, push branch, **draft PR into `main`** (branch is based on origin/main; PRing a main-based branch into a diverged `dev` would drag main's history into dev — flagged by cross-model review).

## Out of scope (noted for Oliver)
- WHY variant generation skipped scenes 2/5/6/7 on this property (likely Atlas 402 out-of-balance mid-run — known open issue; the new gate will pause + surface it instead of shipping partial videos).
- Regenerating the Kinglet Dr video itself (operator action after merge).
