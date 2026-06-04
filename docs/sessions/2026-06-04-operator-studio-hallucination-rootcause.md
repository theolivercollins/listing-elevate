# Operator Studio — 200 Leach Dr hallucination root cause (2026-06-04)

## What happened
Operator Studio order `4c528c4f-411f-489a-ab0d-e8fe22c29125` — "200 Leach Dr, Punta Gorda, FL 33950" —
operator/manual ingest, 5 photos, 7 scenes, `pipeline_mode=v1`, status `complete` (2026-06-02).
Prod project: `vrhmaeywqsohlztoouxu` (reelready).

## The photos (5)
1. exterior_front — blue double doors (`IMG_4225`) — camera_height **eye_level**, tilt level
2. exterior_front — garage/driveway, white columns (`IMG_4235`) — camera_height **eye_level**, tilt level
3. living_room — grey sectional, black 8-blade fan, tray ceiling (`collov-ai`)
4. kitchen — quartz island, range, sliding door (`IMG_4061`)
5. kitchen — waterfall island, range, sink, fridge (`IMG_4070`)

## The scenes (7) — every prompt is textually grounded in a real key_feature
1. `drone_push_in` "drone flying forward at rooftop height toward the recessed entryway with white columns" ← photo 2 (EYE-LEVEL ground shot)
2. `push_in` "toward the vibrant blue double front doors" ← photo 1 ✓
3. `low_angle_glide` "toward the grey modular sectional sofa" ← photo 3 ✓
4. `feature_closeup` "on the large black eight-blade ceiling fan" ← photo 3 ✓
5. `parallax` "past the large white quartz island toward the sliding glass door" ← photo 4 ✓
6. `push_in` "toward the stainless steel electric range" ← photo 5 ✓
7. `top_down` "overhead of the concrete driveway and modern white stucco facade" ← photo 2 (EYE-LEVEL ground shot)

## Root cause
The prompt TEXT did not hallucinate — every scene references a feature that exists in the source photo.
The hallucination is **camera-move-vs-source-frame mismatch** on scenes 1 and 7.

Both exterior photos were analyzed as `camera_height=eye_level, camera_tilt=level, frame_coverage=wide_establishing`
(ordinary ground-level shots), yet the Gemini analyzer set:
- `motion_headroom.drone_push_in = true` — rationale: "open sky and clear ground area allow for a smooth aerial approach"
- `motion_headroom.top_down = true` — rationale: "the camera could rise vertically to provide an overhead view"

That rationale reasons about what a **real drone in that physical yard** could do — NOT what an
**image-to-video model can produce from this single eye-level still frame**. From a ground-level facade
photo, "fly up to rooftop height" / "rise to overhead" forces the model to fabricate the roofline and the
lot-from-above = hallucinated geometry. That is what shipped.

### Two code-level causes
1. **Analyzer** (`lib/providers/gemini-analyzer.ts` + `lib/prompts/photo-analysis.ts`):
   `drone_push_in` / `top_down` headroom can be `true` on eye-level/ground photos. These vertical-perspective
   moves should be available ONLY when the photo is already aerial/overhead
   (`camera_height ∈ {aerial, elevated, overhead}`). No coupling between `camera_height` and these two flags.
2. **QC gap**: all 7 scenes are `qc_verdict=auto_pass, qc_confidence=1, qc_issues=null`. The hallucination-flag
   judge (`lib/prompts/judge-rubric.ts` flags incl. `hallucinated_geometry`, `wrong_motion_direction`) never
   ran for this operator order, so fabricated clips shipped unreviewed.

## Fix direction (proposed, pending decisions)
- Analyzer: gate `drone_push_in`/`top_down` headroom on `camera_height` (hard FALSE for eye_level/low).
- Director-side validator: defense-in-depth — reject `drone_push_in`/`top_down` when source photo camera_height
  is not aerial/elevated/overhead, regardless of analyzer output.
- QC: ensure the judge actually runs (not blanket auto_pass) for operator orders.

## What shipped (branch worktree-operator-studio-grounding, 2026-06-04)
Plan: `docs/superpowers/plans/2026-06-04-operator-studio-grounding.md`. 8 tasks, TDD, subagent-driven.
1. **Operator orders default to v1.1** (`lib/operator-studio/ingest.ts`) — every non-paired scene renders as a stripped Seedance push-in. This alone closes the 200 Leach drone/top-down class. (SHA eeb6f48)
2. **Production scene-judge wrapper** (`lib/qc/judge-scene.ts`) — pure verdict mapping + orchestration around the existing Gemini video judge. (37938c0)
3. **Judge wired into the live cron** (`api/cron/poll-scenes.ts`) — replaced hardcoded `auto_pass`; hallucinated clips → `needs_review`/`qc_hard_reject`. Back-compat: when `JUDGE_ENABLED` is unset (current prod) behavior is unchanged. (91a8f61, +adb7de1 qc_issues shape fix)
4. **Re-render-on-hallucination loop** — `resubmitScene` extracted (shared by the resubmit endpoint + cron); cron re-renders hard-rejected scenes with judge-derived corrective feedback, capped by `MAX_QC_RERENDERS` (default 2). (97ebbf7)
5. **Director coercion under v1.1** — stored `camera_movement` forced to `push_in` for non-paired scenes (paired untouched). (5111502)
6. **Analyzer headroom gate** — `drone_push_in`/`top_down` forced false unless `camera_height ∈ {aerial,elevated,overhead}` (fixes the root analyzer bug; protects v1 customer orders). (c9e7d1b)
7. **ZIP/folder bulk upload** in Operator Studio (`StudioNew.tsx` + `src/lib/studio/extract-photos.ts`, jszip). (aa7a756)

## Task 8 — assembly verification (no code change; Oliver: keep Creatomate default)
- `lib/providers/assembly-router.ts#selectAssemblyProvider`: `ASSEMBLY_PROVIDER` override → else Creatomate (if `CREATOMATE_API_KEY`) → else Shotstack (`SHOTSTACK_API_KEY`/`_STAGE`). Matches Oliver's "Creatomate default, Shotstack fallback."
- Finalize gate (`poll-scenes.ts`): soft-reject and cap-reached hard-rejects → `needs_review`; only `qc_pass` scenes assemble. Existing rule `passed>=6 → complete` still applies (a single bad clip won't block a listing with 6+ good scenes; the bad scene is excluded).
- **Not done (gated, needs Oliver):** a LIVE re-run of 200 Leach on prod spends provider credits — flag for Oliver. The fix is verified by the analyzer/director/judge unit suites + the v1.1 render path; a live render would only confirm output pixels.

## Verification
- Full suite: **673 passed, 2 skipped, 1 failed**. The single failure (`src/v2/components/landing/MarketComparison.test.tsx`) is PRE-EXISTING and unrelated (confirmed failing at origin/main; never in this changeset). `tsc --noEmit` clean. `pnpm run build` clean.

## Prod rollout gates (do NOT do without Oliver's green light)
- Set `JUDGE_ENABLED=true` on Vercel prod to turn on the real QC guard (per-clip Gemini cost ~2¢). Until then the judge wiring is dormant and prod behavior is unchanged.
- Optional: `MAX_QC_RERENDERS` (default 2). Optional: re-run 200 Leach to confirm on real output (spends credits).

## Query trail (prod, reelready vrhmaeywqsohlztoouxu)
```sql
select * from properties where address ilike '%leach%';
select scene_number, camera_movement, prompt, qc_verdict, qc_confidence from scenes where property_id='4c528c4f-...';
select file_name, room_type, analysis_json->>'camera_height', analysis_json->'motion_headroom' from photos where property_id='4c528c4f-...';
```
