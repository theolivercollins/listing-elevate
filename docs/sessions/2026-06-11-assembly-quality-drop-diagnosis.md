# Assembly quality drop — diagnosis (5019 San Massimo Dr run, 2026-06-11)

Task: root-cause why the assembled video looks visibly worse than the source clips.
Test case: property `a30212b2-088a-40a2-9c7a-f4ec16d04e45` (5019 San Massimo Dr, Punta Gorda),
latest run, status `complete`, `assembly_provider = creatomate`, `template_id = null`.

## Measured numbers (ffprobe, 2026-06-11)

### Source clips (7 scenes, all 24 fps, H.264 Main, 5.04 s each)

| Scene | Provider | Resolution | Aspect | Video bitrate |
|---|---|---|---|---|
| 1 | atlas (kling-v3-pro, paired) | 1660x1244 | ~4:3 | **52.9 Mbps** |
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
  the Seedance descriptors in `lib/providers/atlas.ts` set `forceSourceAspectRatio: "16:9"`
  via `lib/services/source-aspect.ts` (center-crop photo to 16:9 before i2v) — but NO
  Kling path got that treatment: neither direct-native Kling NOR any Atlas-routed Kling
  SKU (`atlas.ts` even asserted Kling geometry is "fixed in-model", which this run
  disproves — scene 1's Atlas kling-v3-pro clip is 4:3 because its drone photo was).
- Scene 1 (atlas kling-v3-pro, paired, 1660x1244) also isn't 16:9 — cover-fit scales
  it 1.157x and crops ~25% of its height (1244→1439 scaled, 359px cropped) — but its
  pixel area is 1080p-class so it survives much better.
  [Correction 2026-06-11, adversarial panel: this row was originally misattributed to
  "atlas (Seedance)" and the crop loss overstated as ~31%. The run's pipeline_logs
  (`Scene 1: submitted to atlas model=kling-v3-pro`, metadata modelKey, and the 48c
  cost event matching kling-v3-pro's priceCentsPerClip) prove it was Atlas
  kling-v3-pro. NO Seedance clip exists in this run — every v1.1 Seedance submission
  failed over (see addendum).]

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

1. **Get true 16:9 clips out of EVERY Kling path** (scope extended 2026-06-11 by the
   adversarial panel — originally this item covered only the direct-native path):
   apply the existing `source-aspect.ts` 16:9 center-crop before submission on
   (a) the direct-native Kling `generateClip` call, and (b) every Atlas-routed Kling
   SKU via `forceSourceAspectRatio: "16:9"` — including BOTH start and end frames on
   paired SKUs (kling-v3-pro / kling-v2-1-pair), since cropping only the start frame
   would mismatch the pair's geometry. On the 2.07 MP SKUs this yields true 1920x1080;
   on the 0.92 MP v2-master/native path it yields a uniform 16:9 ~1280x720 (1.5x clean
   upscale instead of 1.64x + crop — improvement, not elimination). Zero provider cost
   change (Kling bills per clip / per second of the same duration).
2. With >=1080p sources in place, Creatomate's fixed ~6 Mbps 1080p24 encode is
   acceptable-but-not-maximal. If Oliver wants more headroom the only Creatomate
   levers are a larger canvas (e.g. 2560x1440 RenderScript — more encoder bitrate,
   higher Creatomate credit burn ~proportional to resolution; cost model at
   `creatomate.ts:701` assumes 1080p30 and would need updating) or a different
   assembler. Don't change canvas until sources actually exceed 1080p.
3. Audit existing Kling clip resolutions across recent properties before assuming
   `mode: "pro"` ever returns 1080p-class output for non-16:9 inputs.
   **EXECUTED 2026-06-11 — see addendum below.** Headline: native/v2-master Kling has a
   fixed ~0.92 MP (720p-class) budget and NEVER returns 1080p-class output for any
   input; Atlas kling-v2-6-pro / v3-pro have a ~2.07 MP (1080p-class) budget. Both
   shape output to the input image's aspect.

## Addendum (2026-06-11, post-adversarial-panel): Kling pixel-budget audit + why this run hit the fallback

### Measured pixel budgets (ffprobe over Storage clips; zero-cost audit)

| Path | Samples | Measured | Pixel area | Class |
|---|---|---|---|---|
| native Kling v2-master (this run, scenes 2-7) | 6 | 1172x784 @ 24fps | 0.92 MP = exact 1280x720 area | 720p |
| Atlas kling-v2-master (Lab iterations 2026-05-08..26) | 4 | 1172x784 @ 24fps | 0.92 MP | 720p |
| Atlas kling-v2-6-pro (Lab iterations 2026-04-30..05-26) | 6 | 1760x1176 / 1764x1172 / 1688x1224 @ 24fps | 2.07 MP = exact 1920x1080 area (within 0.3%) | 1080p |
| Atlas kling-v3-pro (this run, scene 1, paired) | 1 | 1660x1244 @ 24fps | 2.065 MP | 1080p |

Conclusions: (1) each Kling SKU has a FIXED output pixel budget — v2-master 0.92 MP
regardless of host (native or Atlas), v2.6-pro / v3-pro 2.07 MP; (2) output SHAPE
follows the input image's aspect across all of them (three different input aspects
above, same budget). Therefore a 16:9 input on a 2.07 MP SKU = 1920x1080; a 16:9
input on v2-master = ~1280x720. The old "Kling output res is fixed in-model"
comments were wrong and have been corrected in `atlas.ts` / `labModels.ts`.

### Why 6 of 7 scenes rendered on the 720p-class fallback at all

`pipeline_logs` for this run: every non-paired scene submitted v1.1 Seedance via
Atlas and got **HTTP 402 "insufficient balance"**, excluded Atlas, and failed over
to direct-native Kling (`Scene N: submitted to kling (failover 1)`). The quality
ceiling of this video was set by an unfunded Atlas account, not by routing intent.

Ops actions for "maximum quality every time":
1. **Top up the Atlas balance** (and consider a balance alert) — with Atlas healthy,
   v1.1 scenes render Seedance 1080p-SR and paired scenes kling-v3-pro 1080p-class;
   the 720p-class native fallback only exists for Atlas outages.
2. Note for reruns: `scenes.provider` is overwritten with the provider actually used
   and is read back as the routing preference on resubmission (`lib/pipeline.ts`
   `preference = scene.provider`), so this property's scenes 2-7 would stick to
   native Kling on a rerun even after the balance is fixed. Clearing the provider
   column on rerun (or routing preference from a separate column) is a follow-up
   decision — flagged, not changed, in this fix.

### Verification status of the fix itself

The 16:9-crop-for-Kling fix is verified by unit tests (crop invoked for start AND
end frames on Atlas Kling SKUs; direct-Kling URL path) plus the measured budget
data above (16:9 input + 2.07 MP budget ⇒ 1920x1080 — the same input→output aspect
copying already verified live for Seedance on 2026-05-28). A live end-to-end probe
(one paid Atlas Kling render from a 16:9-cropped source, ffprobed at 1920x1080) is
BLOCKED on the Atlas balance top-up; run it with the first funded render before
promoting this branch beyond staging.
