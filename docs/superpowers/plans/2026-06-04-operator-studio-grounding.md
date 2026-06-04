# Operator Studio Grounding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Operator Studio listing videos trustworthy — eliminate the camera-move-vs-source-frame hallucination seen on the 200 Leach Dr run, make Gemini actually watch each rendered clip and re-render hallucinated ones, and let operators bulk-upload photos via a ZIP/folder.

**Architecture:** Three independent thrusts. (A) **Render safety** — Operator orders run pipeline v1.1, which routes every non-paired scene to the Seedance push-in SKU and strips all non-push-in movement verbs at render time; push-in from any frame is geometrically safe, so the drone/top-down fabrication class disappears. (B) **QC guard** — the already-built `judgeLabIteration` Gemini video judge gets wired into the production clip-completion path (currently hardcoded `auto_pass`), with a verdict→status mapping and a capped re-render-on-hallucination loop. (C) **Bulk intake** — a ZIP/folder uploader in the Operator Studio "new" form, extracted client-side to the existing photo-upload path. Defense-in-depth: the director is coerced to push-in under v1.1, and the photo analyzer stops marking `drone_push_in`/`top_down` headroom true on eye-level photos (protects v1 customer orders).

**Tech Stack:** TypeScript, Vitest (`pnpm exec vitest run <path>`), Supabase (prod `vrhmaeywqsohlztoouxu`), Vercel serverless crons, Gemini 2.5 Flash (`@google/genai`), React (Vite), JSZip.

**Root cause reference:** `docs/sessions/2026-06-04-operator-studio-hallucination-rootcause.md`.

**Key facts the implementer must know:**
- Operator ingest (`lib/operator-studio/ingest.ts`) never sets `pipeline_mode` → migration default `'v1'`. That is why 200 Leach got the full 11-verb director and a `drone_push_in` + `top_down` from eye-level ground photos.
- `selectProviderForScene(scene, excluded, mode)` in `lib/providers/router.ts`: when `mode === 'v1.1'` and the scene isn't paired, it returns `{provider:'atlas', modelKey:'seedance-pro-pushin', fallback:{...V1_DEFAULT_SKU}}`. At render (`lib/pipeline.ts:898`), `decision.modelKey === 'seedance-pro-pushin'` triggers `forceSeedancePushInPrompt(scene.prompt)` which strips movement verbs and prepends a stable push-in directive. So v1.1 = push-in-only at render with **no code change** beyond setting the mode.
- Production QC is fake: `runQCForScene` (`lib/pipeline.ts:981-1006`) and `api/cron/poll-scenes.ts:150-157` both hardcode `qc_verdict:'auto_pass', qc_confidence:1.0`. The real judge `judgeLabIteration` (`lib/providers/gemini-judge.ts:95`) is wired only into Prompt Lab.
- The judge already watches the video: it sends `clipUrl` as `fileData(video/mp4)` to Gemini and returns `JudgeRubricResult` (`lib/prompts/judge-rubric.ts:60`) — scores `motion_faithfulness`, `geometry_coherence`, `room_consistency` (1-5), computed `overall`, and `hallucination_flags: HallucinationFlag[]`. Gated by `JUDGE_ENABLED==='true'`.
- Reference wiring pattern: `api/admin/prompt-lab/finalize-with-judge.ts:48-110` (fetch photo bytes non-fatally → `judgeLabIteration({clipUrl, photoBytes, directorPrompt, cameraMovement, roomType, iterationId})` → persist).
- App-layer env isolation rule (CLAUDE.md): destructive/provider-calling code paths in non-prod must be gated by `process.env.VERCEL_ENV === 'production' || process.env.LE_ALLOW_NONPROD_WRITES === 'true'`. The judge calls a paid provider — keep it behind `JUDGE_ENABLED` as it already is; do not add new always-on provider calls.
- No build-time typecheck gate (Vite/Vercel build doesn't run `tsc`). For any task touching runtime call sites, run `pnpm exec tsc --noEmit` on completion and fix errors — runtime ReferenceErrors otherwise ship to prod.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `lib/types/operator-studio.ts` | Add optional `pipeline_mode` to `ManualIngestInput` | 1 |
| `lib/operator-studio/ingest.ts` | Default operator orders to `pipeline_mode:'v1.1'` | 1 |
| `lib/qc/judge-scene.ts` (new) | Production judge wrapper: judge a scene's clip → verdict | 2 |
| `lib/qc/judge-scene.test.ts` (new) | Unit tests for verdict mapping | 2 |
| `lib/pipeline.ts` | Call judge from `runQCForScene`; re-render loop | 3,4 |
| `api/cron/poll-scenes.ts` | Call judge on cron-recovered clips instead of auto_pass | 3 |
| `lib/prompts/director.ts` + `lib/pipeline.ts` (`runScripting`) | Coerce planned `camera_movement` to `push_in` under v1.1 | 5 |
| `lib/providers/gemini-analyzer.ts` | Gate `drone_push_in`/`top_down` headroom on `camera_height` | 6 |
| `src/pages/dashboard/studio/StudioNew.tsx` (+ helper) | ZIP/folder photo upload | 7 |
| (verification only) | Operator v1.1 order assembles via Creatomate, Shotstack fallback | 8 |

---

## Task 1: Operator orders default to pipeline v1.1 (the 200 Leach fix)

**Files:**
- Modify: `lib/types/operator-studio.ts` (add `pipeline_mode?` to `ManualIngestInput`)
- Modify: `lib/operator-studio/ingest.ts:100-124` (set `pipeline_mode` on insert)
- Test: `api/admin/studio/__tests__/ingest.test.ts` (existing) or `lib/operator-studio/__tests__/ingest.test.ts`

**Context:** This is the single highest-leverage change. Setting `pipeline_mode:'v1.1'` makes `selectProviderForScene` route every non-paired scene to `seedance-pro-pushin`, which forces a stripped push-in prompt at render — no drone/top-down fabrication possible.

- [ ] **Step 1: Read current code.** Read `lib/types/operator-studio.ts` (find the `ManualIngestInput` type) and `lib/operator-studio/ingest.ts` (the insert at lines 100-124) and the existing ingest test to learn the mock shape.

- [ ] **Step 2: Write the failing test.** In the ingest test file, add a test asserting the inserted property row carries `pipeline_mode:'v1.1'` when no override is given, and respects an explicit `pipeline_mode:'v1'` override. Mirror the existing test's Supabase mock (capture the object passed to `.insert(...)`).

```ts
it("defaults operator orders to pipeline_mode v1.1", async () => {
  const insertedRow = await runManualIngestAndCaptureInsert({ /* no pipeline_mode */ });
  expect(insertedRow.pipeline_mode).toBe("v1.1");
});

it("honors an explicit pipeline_mode override", async () => {
  const insertedRow = await runManualIngestAndCaptureInsert({ pipeline_mode: "v1" });
  expect(insertedRow.pipeline_mode).toBe("v1");
});
```

- [ ] **Step 3: Run test to verify it fails.** `pnpm exec vitest run <ingest test path>` — expect FAIL (`pipeline_mode` undefined on the captured insert).

- [ ] **Step 4: Implement.** Add `pipeline_mode?: 'v1' | 'v1.1' | null` to `ManualIngestInput`. In `manualIngest`, destructure it and add to the insert object: `pipeline_mode: input.pipeline_mode ?? 'v1.1',`.

- [ ] **Step 5: Run test to verify it passes.** `pnpm exec vitest run <ingest test path>` — expect PASS. Then `pnpm exec tsc --noEmit` — expect no new errors in touched files.

- [ ] **Step 6: Commit.**
```bash
git add lib/types/operator-studio.ts lib/operator-studio/ingest.ts <test path>
git commit -m "fix(operator-studio): default operator orders to pipeline v1.1 (push-in only) — closes 200 Leach hallucination class"
```

---

## Task 2: Production scene-judge wrapper

**Files:**
- Create: `lib/qc/judge-scene.ts`
- Test: `lib/qc/judge-scene.test.ts`

**Context:** A thin, pure-logic-testable wrapper around `judgeLabIteration` that (a) decides pass/fail from a `JudgeRubricResult`, and (b) orchestrates the judge call for a production scene. Keep the **decision function** pure and separately testable from the **I/O orchestration** so the verdict mapping has fast unit tests with no network.

- [ ] **Step 1: Read** `lib/providers/gemini-judge.ts` (`JudgeInput`/`JudgeOutput`, `JudgeDisabledError`), `lib/prompts/judge-rubric.ts` (`JudgeRubricResult`, `HallucinationFlag`, the score fields and `overall`), and `api/admin/prompt-lab/finalize-with-judge.ts:48-110` (call pattern).

- [ ] **Step 2: Write the failing test** for the pure verdict mapping:

```ts
import { sceneVerdictFromRubric } from "./judge-scene.js";
import type { JudgeRubricResult } from "../prompts/judge-rubric.js";

const base: JudgeRubricResult = {
  motion_faithfulness: 5, geometry_coherence: 5, room_consistency: 5,
  overall: 5, hallucination_flags: [], notes: "",
} as JudgeRubricResult;

it("passes a clean clip", () => {
  expect(sceneVerdictFromRubric(base).verdict).toBe("qc_pass");
});

it("hard-rejects fabricated geometry", () => {
  const r = { ...base, geometry_coherence: 1, hallucination_flags: ["hallucinated_geometry"] };
  const v = sceneVerdictFromRubric(r as JudgeRubricResult);
  expect(v.verdict).toBe("qc_hard_reject");
  expect(v.shouldRerender).toBe(true);
});

it("hard-rejects when the camera exits the room", () => {
  const r = { ...base, room_consistency: 1, hallucination_flags: ["camera_exited_room"] };
  expect(sceneVerdictFromRubric(r as JudgeRubricResult).verdict).toBe("qc_hard_reject");
});

it("soft-rejects a mediocre but non-fabricated clip", () => {
  const r = { ...base, motion_faithfulness: 2, overall: 2, hallucination_flags: ["motion_too_static"] };
  expect(sceneVerdictFromRubric(r as JudgeRubricResult).verdict).toBe("qc_soft_reject");
});
```

- [ ] **Step 3: Run test to verify it fails.** `pnpm exec vitest run lib/qc/judge-scene.test.ts` — FAIL (module not found).

- [ ] **Step 4: Implement `judge-scene.ts`.** Two exports:

```ts
import { judgeLabIteration, JudgeDisabledError } from "../providers/gemini-judge.js";
import type { JudgeRubricResult, HallucinationFlag } from "../prompts/judge-rubric.js";

export type SceneVerdict = "qc_pass" | "qc_soft_reject" | "qc_hard_reject";

const HARD_FLAGS: ReadonlySet<HallucinationFlag> = new Set([
  "hallucinated_geometry", "hallucinated_architecture",
  "camera_exited_room", "wrong_motion_direction",
] as HallucinationFlag[]);

export function sceneVerdictFromRubric(r: JudgeRubricResult): {
  verdict: SceneVerdict; shouldRerender: boolean; reason: string;
} {
  const hasHardFlag = r.hallucination_flags.some((f) => HARD_FLAGS.has(f));
  const fabricated = hasHardFlag || r.geometry_coherence <= 2 || r.room_consistency <= 2;
  if (fabricated) {
    return { verdict: "qc_hard_reject", shouldRerender: true,
      reason: `fabrication: flags=[${r.hallucination_flags.join(",")}] geom=${r.geometry_coherence} room=${r.room_consistency}` };
  }
  if (r.overall <= 2) {
    return { verdict: "qc_soft_reject", shouldRerender: false,
      reason: `low overall=${r.overall}` };
  }
  return { verdict: "qc_pass", shouldRerender: false, reason: "clean" };
}

export interface JudgeSceneResult {
  verdict: SceneVerdict;
  shouldRerender: boolean;
  reason: string;
  rubric: JudgeRubricResult | null;
  judgeRan: boolean; // false when JUDGE_ENABLED is off
}

/** Orchestrates the judge call for one production scene. Falls back to a pass
 *  with judgeRan=false when JUDGE_ENABLED is off, preserving current behavior. */
export async function judgeProductionScene(input: {
  clipUrl: string; sceneId: string; directorPrompt: string;
  cameraMovement: string; roomType: string; sourcePhotoUrl?: string | null;
}): Promise<JudgeSceneResult> {
  let photoBytes: Buffer | undefined;
  try {
    if (input.sourcePhotoUrl) {
      const r = await fetch(input.sourcePhotoUrl);
      if (r.ok) photoBytes = Buffer.from(await r.arrayBuffer());
    }
  } catch { /* non-fatal */ }

  try {
    const rubric = await judgeLabIteration({
      clipUrl: input.clipUrl, photoBytes,
      directorPrompt: input.directorPrompt,
      cameraMovement: input.cameraMovement, roomType: input.roomType,
      iterationId: input.sceneId,
    });
    const v = sceneVerdictFromRubric(rubric);
    return { ...v, rubric, judgeRan: true };
  } catch (err) {
    if (err instanceof JudgeDisabledError) {
      return { verdict: "qc_pass", shouldRerender: false, reason: "judge_disabled", rubric: null, judgeRan: false };
    }
    // Judge call failed (network/quota). Do NOT block delivery on judge outages —
    // pass the clip but mark judgeRan=false so callers can log it.
    return { verdict: "qc_pass", shouldRerender: false, reason: `judge_error: ${err instanceof Error ? err.message : String(err)}`, rubric: null, judgeRan: false };
  }
}
```

> Note: confirm the exact field names on `JudgeRubricResult` while reading judge-rubric.ts (Step 1). If a `notes` field doesn't exist, drop it from the test fixture. Do NOT invent fields.

- [ ] **Step 5: Run test to verify it passes.** `pnpm exec vitest run lib/qc/judge-scene.test.ts` — PASS. `pnpm exec tsc --noEmit` — clean.

- [ ] **Step 6: Commit.**
```bash
git add lib/qc/judge-scene.ts lib/qc/judge-scene.test.ts
git commit -m "feat(qc): production scene-judge wrapper with verdict mapping"
```

---

## Task 3: Wire the judge into clip completion (replace hardcoded auto_pass)

**Files:**
- Modify: `lib/pipeline.ts` (`runQCForScene`, ~981-1006)
- Modify: `api/cron/poll-scenes.ts` (~145-176, the completion update block)
- Test: `lib/pipeline.test.ts` (or a new `lib/qc/qc-integration.test.ts`)

**Context:** Both completion paths must run `judgeProductionScene` and use its verdict instead of always-`auto_pass`. When `judgeRan` is false (judge disabled/errored), behavior must be identical to today (clip passes) so this is safe to ship before `JUDGE_ENABLED=true` is set in prod.

- [ ] **Step 1: Read** `runQCForScene` and the call site that marks scenes `qc_pass` inline, plus `poll-scenes.ts:145-176`. Note how to fetch the scene's source photo URL (the scene has `photo_id`; the photo row has `file_url`).

- [ ] **Step 2: Write the failing test** — with `judgeProductionScene` mocked to return a `qc_hard_reject`, assert the scene is updated to status `qc_hard_reject` (not `qc_pass`) and `qc_verdict`/`qc_issues` reflect the rubric. With the mock returning `judgeRan:false`, assert the scene still becomes `qc_pass` (back-compat).

```ts
vi.mock("../qc/judge-scene.js", () => ({
  judgeProductionScene: vi.fn(),
}));
// ... test 1: hard_reject mock -> scene status qc_hard_reject
// ... test 2: judgeRan:false mock -> scene status qc_pass
```

- [ ] **Step 3: Run test to verify it fails.** `pnpm exec vitest run <test path>` — FAIL.

- [ ] **Step 4: Implement.** In both paths, after the clip is downloaded+stored and the public URL is known, call:

```ts
const judged = await judgeProductionScene({
  clipUrl: publicUrl, sceneId: scene.id, directorPrompt: scene.prompt,
  cameraMovement: scene.camera_movement ?? "unknown",
  roomType: scene.room_type ?? "other",
  sourcePhotoUrl: photoFileUrl, // fetch from photos via scene.photo_id
});
const newStatus = judged.verdict === "qc_pass" ? "qc_pass"
  : judged.verdict === "qc_soft_reject" ? "needs_review" : "qc_hard_reject";
await supabase.from("scenes").update({
  status: newStatus,
  clip_url: publicUrl,
  qc_verdict: judged.judgeRan ? judged.verdict : "auto_pass",
  qc_confidence: judged.rubric ? judged.rubric.overall / 5 : 1.0,
  qc_issues: judged.rubric?.hallucination_flags?.length
    ? judged.rubric.hallucination_flags.map((f) => ({ flag: f })) : null,
}).eq("id", scene.id);
```
Keep cost-event recording for generation unchanged (the judge records its own cost_event inside `judgeLabIteration`). Re-render handling for `qc_hard_reject` is Task 4 — for now a hard-reject just sets the status (the finalize loop already routes non-`qc_pass` scenes to `needs_review`).

- [ ] **Step 5: Run tests.** `pnpm exec vitest run <test path>` — PASS. Run the full pipeline + poll-scenes suites: `pnpm exec vitest run lib/pipeline.test.ts api/cron` — PASS. `pnpm exec tsc --noEmit` — clean.

- [ ] **Step 6: Commit.**
```bash
git add lib/pipeline.ts api/cron/poll-scenes.ts <test path>
git commit -m "feat(qc): Gemini judge watches every production clip; hallucinated clips no longer auto-pass"
```

---

## Task 4: Re-render hallucinated scenes (feedback loop)

**Files:**
- Modify: `lib/pipeline.ts` (completion path) and/or `api/cron/poll-scenes.ts`
- Test: `lib/qc/judge-scene.test.ts` or pipeline test

**Context:** "Gemini gives feedback and improves." On `qc_hard_reject` with `shouldRerender` and `attempt_count < MAX_QC_RERENDERS` (default 2), re-submit the scene instead of leaving it `qc_hard_reject`. Append a short, judge-derived corrective note to the render prompt (e.g. "Avoid: <flags>. Keep the camera inside the room; do not invent geometry."). Cap attempts → `needs_review`.

- [ ] **Step 1: Read** how a scene is re-submitted today — the failover loop in `lib/pipeline.ts` (~882-930) increments `attempt_count` and sets status `generating`. Reuse that submit machinery; do not duplicate it.

- [ ] **Step 2: Write the failing test** — `judgeProductionScene` returns `qc_hard_reject, shouldRerender:true`; with `attempt_count=1`, assert the scene is re-submitted (status `generating`, `attempt_count=2`); with `attempt_count` at the cap, assert it lands `needs_review`.

- [ ] **Step 3: Run test → FAIL.** `pnpm exec vitest run <test path>`.

- [ ] **Step 4: Implement** a `MAX_QC_RERENDERS = Number(process.env.MAX_QC_RERENDERS ?? 2)` guard. On hard-reject under the cap, call the existing scene-submit helper with a corrective prompt suffix derived from `judged.rubric.hallucination_flags`; otherwise set `needs_review`. Keep the corrective-suffix builder a small pure function and unit-test it.

- [ ] **Step 5: Run tests → PASS.** Full suite for touched files; `pnpm exec tsc --noEmit` clean.

- [ ] **Step 6: Commit.**
```bash
git add lib/pipeline.ts api/cron/poll-scenes.ts lib/qc/judge-scene.ts <test path>
git commit -m "feat(qc): re-render hallucinated scenes with judge feedback, capped at MAX_QC_RERENDERS"
```

---

## Task 5: Coerce director output to push-in under v1.1 (belt-and-suspenders)

**Files:**
- Modify: `lib/pipeline.ts` (`runScripting`, ~501-610) — after parsing the director JSON, before inserting scenes
- Test: `lib/pipeline.test.ts` (scripting section) or a focused new test

**Context:** Render already forces push-in for v1.1, but the **stored** `scenes.camera_movement` still says `drone_push_in`/`top_down` (misleading audit, and a latent risk if the render override ever changes). When the property is v1.1, coerce every non-paired planned scene's `camera_movement` to `'push_in'` before insert. Leave paired scenes (those with `end_photo_id`) untouched — the router keeps them on `kling-v2-1-pair`.

- [ ] **Step 1: Read** `runScripting` — find where the director's parsed scenes are mapped to insert rows, and how the property's `pipeline_mode` is (or isn't) available there. Fetch `pipeline_mode` with the property if needed.

- [ ] **Step 2: Write the failing test** — given a property with `pipeline_mode:'v1.1'` and a director plan containing a `drone_push_in` and a `top_down` scene, assert all inserted non-paired scenes have `camera_movement:'push_in'`; given `pipeline_mode:'v1'`, assert movements are preserved.

- [ ] **Step 3: Run test → FAIL.**

- [ ] **Step 4: Implement** a pure helper `coerceToPushInForV11(scenes, mode)` that maps `camera_movement` to `'push_in'` for non-paired scenes when `mode==='v1.1'`, and call it in `runScripting` before the scene insert.

- [ ] **Step 5: Run tests → PASS.** `pnpm exec tsc --noEmit` clean.

- [ ] **Step 6: Commit.**
```bash
git add lib/pipeline.ts <test path>
git commit -m "fix(director): coerce stored camera_movement to push_in under v1.1"
```

---

## Task 6: Analyzer gates vertical-perspective headroom on camera_height (protects v1)

**Files:**
- Modify: `lib/providers/gemini-analyzer.ts` (post-process the analysis before returning)
- Test: `lib/providers/gemini-analyzer.test.ts` (create if absent) — pure post-process function

**Context:** The 200 Leach analyzer marked `drone_push_in:true` and `top_down:true` on eye-level ground photos with rationale about what a *real drone* could do. An image-to-video model can't synthesize an aerial/overhead viewpoint from an eye-level still without fabricating geometry. For v1 customer orders (still full-vocabulary), force these two headroom flags FALSE unless `camera_height ∈ {aerial, elevated, overhead}`.

- [ ] **Step 1: Read** `gemini-analyzer.ts` — find where `motion_headroom` and `camera_height` are assembled into the returned `ExtendedPhotoAnalysis`.

- [ ] **Step 2: Write the failing test** for a pure `gateVerticalHeadroom(analysis)`:

```ts
it("forces drone_push_in/top_down false on eye-level photos", () => {
  const a = gateVerticalHeadroom({
    camera_height: "eye_level",
    motion_headroom: { push_in: true, drone_push_in: true, top_down: true, orbit: false, parallax: true, pull_out: true },
  } as any);
  expect(a.motion_headroom.drone_push_in).toBe(false);
  expect(a.motion_headroom.top_down).toBe(false);
  expect(a.motion_headroom.push_in).toBe(true); // unrelated flags untouched
});

it("leaves them true on aerial photos", () => {
  const a = gateVerticalHeadroom({
    camera_height: "aerial",
    motion_headroom: { drone_push_in: true, top_down: true },
  } as any);
  expect(a.motion_headroom.drone_push_in).toBe(true);
});
```

- [ ] **Step 3: Run test → FAIL.**

- [ ] **Step 4: Implement** `gateVerticalHeadroom` and apply it to the analyzer's result before return. (Also append a one-line note to `motion_headroom_rationale` for the gated flags, e.g. "gated: source is eye_level, not aerial".)

- [ ] **Step 5: Run tests → PASS.** `pnpm exec tsc --noEmit` clean.

- [ ] **Step 6: Commit.**
```bash
git add lib/providers/gemini-analyzer.ts <test path>
git commit -m "fix(analyzer): gate drone_push_in/top_down headroom on camera_height"
```

---

## Task 7: ZIP / folder bulk photo upload in Operator Studio

**Files:**
- Modify: `src/pages/dashboard/studio/StudioNew.tsx` (photo step)
- Create: `src/lib/studio/extract-photos.ts` (+ test) — pure ZIP/folder → File[] extractor
- Add dep: `jszip`

**Context:** Operators currently add photos one-by-one. Let them drop a `.zip` or select a folder; extract image entries and feed them into the existing photo-upload path (same storage upload + `photo_storage_paths` that `manualIngest` consumes). Scope for now: one upload = the photo set for one listing (no per-subfolder multi-listing split — note that as a follow-up).

- [ ] **Step 1: Read** `StudioNew.tsx` to learn the current photo-upload state + how `photo_storage_paths` is built and posted to `/api/admin/studio/ingest`. Confirm the accepted image types (jpg/jpeg/png/heic/webp).

- [ ] **Step 2: Write the failing test** for `extractImageFiles(zipOrFiles)`:

```ts
it("extracts image entries from a zip blob, ignoring non-images and macOS junk", async () => {
  const zip = await buildTestZip({ "a.jpg": img, "b.png": img, "notes.txt": txt, "__MACOSX/x": junk });
  const files = await extractImageFiles(zip);
  expect(files.map(f => f.name).sort()).toEqual(["a.jpg", "b.png"]);
});
```

- [ ] **Step 3: Run test → FAIL.** `pnpm exec vitest run src/lib/studio/extract-photos.test.ts`.

- [ ] **Step 4: Implement** `extractImageFiles` using JSZip: load the zip, filter entries by image extension (skip `__MACOSX/`, dotfiles, directories), return `File[]`. Also accept a plain `FileList`/`File[]` from a `webkitdirectory` folder input and just filter to images (no unzip).

- [ ] **Step 5: Wire into `StudioNew.tsx`** — add a "Upload ZIP / folder" control (`<input type="file" accept=".zip">` and a second `<input type="file" webkitdirectory multiple>`), run `extractImageFiles`, then push the resulting files through the **existing** per-photo storage-upload routine. Enforce the existing min/max photo counts. No backend change — `manualIngest` already takes `photo_storage_paths`.

- [ ] **Step 6: Run tests → PASS.** `pnpm exec vitest run src/lib/studio` and `pnpm run build` (Vite) — build clean.

- [ ] **Step 7: Commit.**
```bash
git add src/pages/dashboard/studio/StudioNew.tsx src/lib/studio/extract-photos.ts src/lib/studio/extract-photos.test.ts package.json pnpm-lock.yaml
git commit -m "feat(operator-studio): ZIP/folder bulk photo upload"
```

---

## Task 8: Verify end-to-end assembly (Creatomate default, Shotstack fallback)

**Files:** none (verification) — record findings in `docs/sessions/2026-06-04-operator-studio-hallucination-rootcause.md`.

**Context:** Oliver: keep Creatomate default, Shotstack fallback. No code change — confirm an operator v1.1 order assembles. Do NOT trigger a real paid render without Oliver's go-ahead (provider calls + cost). Verification is read/static + dry-run only.

- [ ] **Step 1:** Confirm `lib/providers/assembly-router.ts` resolves Creatomate first when `CREATOMATE_API_KEY` is set and Shotstack when not / when `ASSEMBLY_PROVIDER=shotstack`. Quote the resolution logic.
- [ ] **Step 2:** Confirm `runAssembly` is invoked once all scenes settle (`api/cron/poll-scenes.ts:236-246`) and that with the new judge a `qc_hard_reject` scene routes the property to `needs_review` (not auto-assembled). Verify the finalize gate still requires the scenes to be `qc_pass`.
- [ ] **Step 3:** Run the assembly-related test suites: `pnpm exec vitest run lib/providers lib/assembly` — PASS.
- [ ] **Step 4:** Write a short verification note (what was confirmed, what still needs a live render to prove). If a live re-run of 200 Leach is wanted, flag it for Oliver as a gated action (it spends provider credits on prod).

- [ ] **Step 5: Commit.**
```bash
git add docs/sessions/2026-06-04-operator-studio-hallucination-rootcause.md
git commit -m "docs: operator-studio assembly verification notes"
```

---

## Post-implementation
- Final full-suite run: `pnpm exec vitest run` and `pnpm run build`.
- Final code review (subagent-driven-development dispatches this).
- Prod rollout gates for Oliver (do NOT do these without his green light): set `JUDGE_ENABLED=true` on Vercel prod (turns on the real QC guard — has per-clip Gemini cost ~2¢); optionally re-run 200 Leach Dr to confirm the fix on real output.
- Update `docs/HANDOFF.md` "Right now" + shipping log before any push to `main`.

## Spec coverage self-check
- "Prompting correct on operator studio" → Tasks 1, 5 (v1.1 push-in end to end) + 6 (analyzer).
- "Not hallucinating like 200 Leach" → Tasks 1, 5, 6 (eliminate the move class) + 2, 3, 4 (judge catches + re-renders any residual).
- "Gemini watches clips back / feedback / improve" → Tasks 2, 3, 4.
- "Bulk upload via ZIP/folder" → Task 7.
- "Pieces together using Shotstack / 100%" → Task 8 (Creatomate default, Shotstack fallback per Oliver).
