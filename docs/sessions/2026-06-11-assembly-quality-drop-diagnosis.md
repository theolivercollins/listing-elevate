# Assembly quality drop — diagnosis (5019 San Massimo Dr run, 2026-06-11)

Task: root-cause why the assembled video looks visibly worse than the source clips.
Test case: property `a30212b2-088a-40a2-9c7a-f4ec16d04e45` (5019 San Massimo Dr, Punta Gorda),
latest run, status `complete`, `assembly_provider = creatomate`, `template_id = null`.

## Measured numbers (ffprobe, 2026-06-11)

### Source clips (7 scenes, all 24 fps, H.264 Main, 5.04 s each)

| Scene | Provider | Resolution | Aspect | Video bitrate |
|---|---|---|---|---|
| 1 | atlas (Seedance) | 1660x1244 | ~4:3 | **52.9 Mbps** |
| 2 | kling v2-master pro | 1172x784 | ~3:2 | 26.5 Mbps |
| 3 | kling | 1172x784 | ~3:2 | 15.6 Mbps |
| 4 | kling | 1172x784 | ~3:2 | 12.6 Mbps |
| 5 | kling | 1172x784 | ~3:2 | 14.1 Mbps |
| 6 | kling | 1172x784 | ~3:2 | 20.0 Mbps |
| 7 | kling | 1172x784 | ~3:2 | 10.1 Mbps |

### Final assembled video (Creatomate render `6749e1ab-bcb2-45c5-809c-ab6f444029a6.mp4`)

- 1920x1080, **24 fps**, H.264 High, yuv420p
- Video bitrate **5.96 Mbps** (container 6.29 Mbps), 29.83 s, 23.4 MB

## Render path actually used

- `template_id` is null -> pipeline took the code-generated RenderScript branch:
  `lib/pipeline.ts:1267` ternary falls through to `provider.assemble(...)` ->
  `CreatomateProvider.assemble` (`lib/providers/creatomate.ts:522`) ->
  `buildCreatomateTimeline` (`lib/providers/creatomate.ts:193`).
- Stored `assembly_timeline` confirms: 7 clips trimmed to 4.286 s each, transition "fade",
  provider creatomate, rendered_at 2026-06-11T18:39:55Z.
- Clips are uploaded to storage byte-for-byte from the provider
  (`api/cron/poll-scenes.ts:118-124` — `downloadClip` buffer -> `storage.upload`, no ffmpeg).
  The `lib/utils/ffmpeg.ts` crf-less libx264 path (`assembleVideo`, lines 175-296) is NOT in
  this pipeline anymore (`api/cron/poll-scenes.ts:23` "No more ffmpeg in this cron").
  **Double-transcode suspect: refuted.** Shotstack suspects: moot — Creatomate rendered this.

## Root causes (in order of visible impact)

### 1. Six of seven source clips are sub-1080p 3:2 and get cover-upscaled 1.64x

- Canvas is hardcoded 1920x1080 (`lib/providers/creatomate.ts:202-203`) — correct target.
- The video elements set no `fit`/`width`/`height` (`lib/providers/creatomate.ts:221-227`);
  Creatomate's documented default is `fit: "cover"` -> a 1172x784 clip is scaled by
  max(1920/1172, 1080/784) = **1.64x** to 1920x1284, then ~204 px is cropped vertically.
  Every Kling frame is therefore a 0.92 MP image stretched across a 2.07 MP canvas —
  this is the dominant softness Oliver sees.
- Why the Kling clips are 1172x784: `lib/pipeline.ts:902-908` passes the raw listing photo
  URL plus `aspectRatio: "16:9"`, and `lib/providers/kling.ts:73-79` forwards
  `aspect_ratio` to Kling image2video — but Kling i2v output geometry follows the INPUT
  IMAGE aspect, not `aspect_ratio` (evidence: 1172/784 = 1.495 ~= the 3:2 MLS photo).
  The codebase already knows and solves this for Seedance:
  `lib/providers/atlas.ts:165` sets `forceSourceAspectRatio: "16:9"` via
  `lib/services/source-aspect.ts` (center-crop photo to 16:9 before i2v) — the direct
  Kling path never got that treatment (`lib/providers/atlas.ts:62` even asserts Kling
  geometry is "fixed in-model", which this run disproves).
- Scene 1 (atlas 1660x1244) also isn't 16:9 — cover-fit scales 1.157x and crops ~31% of
  its height — but it's above 1080p so it survives much better.

### 2. Creatomate re-encodes at ~6 Mbps with no quality knob available

- Sources are 10-53 Mbps; the final is 5.96 Mbps — a 2-9x bitrate crush on grainy,
  high-detail AI footage, compounding the upscale.
- We send no quality parameter (`submitRenderScript`, `lib/providers/creatomate.ts:538-556`
  sends the RenderScript + `render_scale: 1` only), and none exists: Creatomate's render
  endpoint accepts only `render_scale`/`max_width`/`max_height` for sizing, and
  RenderScript top-level properties have **no bitrate/quality/codec field** (verified in
  Creatomate docs "Create a Render" + "Top-level properties in RenderScript", 2026-06-11).
  ~6 Mbps 1080p24 is Creatomate's fixed encode for this content.

### Non-issue worth recording

- `buildCreatomateTimeline` requests `frame_rate: 30` (`lib/providers/creatomate.ts:463`,
  also `:178` in the concat builder) but the measured output is 24 fps — matching the
  docs' default of "highest frame rate among input videos". Whatever the reason it wasn't
  honored, 24 fps output over 24 fps sources is the *right* outcome (no resampling
  judder). The fix task should set `frame_rate` to follow the sources (or omit it), not
  "repair" it to 30.

## What the fix task should do (recommendation)

1. **Get true >=1080p 16:9 clips out of Kling**: apply the existing
   `source-aspect.ts` 16:9 center-crop to photos before the direct-Kling
   `generateClip` call (same pattern as Seedance, `atlas.ts:165`). This removes the
   1.64x upscale — the dominant quality loss — at zero provider cost change
   (Kling bills per clip, `kling_units` unchanged).
2. With >=1080p sources in place, Creatomate's fixed ~6 Mbps 1080p24 encode is
   acceptable-but-not-maximal. If Oliver wants more headroom the only Creatomate
   levers are a larger canvas (e.g. 2560x1440 RenderScript — more encoder bitrate,
   higher Creatomate credit burn ~proportional to resolution; cost model at
   `creatomate.ts:701` assumes 1080p30 and would need updating) or a different
   assembler. Don't change canvas until sources actually exceed 1080p.
3. Audit existing Kling clip resolutions across recent properties before assuming
   `mode: "pro"` ever returns 1080p-class output for non-16:9 inputs.
