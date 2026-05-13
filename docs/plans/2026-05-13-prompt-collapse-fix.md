# Prompt Collapse Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Eliminate the "same motion repeated across scenes" symptom in production renders by wiring the recipe library into prod, fixing the DA.3 prompt/movement mismatch, and rendering all retrieved recipes instead of just the first.

**Architecture:** Three discrete, independently-shippable phases on one branch `feat/prompt-collapse-fix`:
1. DA.3 rewrites `scene.prompt` whenever it overrides `camera_movement` so the SKU and prompt agree.
2. Production `runScripting` fetches per-photo retrieval bundles (recipes + exemplars + losers, compatibility-filtered against motion_headroom) and renders them per photo. Top-K rendering bug in `renderRecipeBlock` fixed.
3. Verification + HANDOFF.

**Tech Stack:** TypeScript / Node 20, vitest, Supabase, Anthropic SDK, existing retrieval RPCs (`match_lab_recipes`, `match_rated_examples`, `match_loser_examples`).

**Branch:** `feat/prompt-collapse-fix` (off `origin/dev`). Final merge: `feat/prompt-collapse-fix → dev → staging → main`.

Spec: [`docs/specs/2026-05-13-prompt-collapse-fix-design.md`](../specs/2026-05-13-prompt-collapse-fix-design.md).

---

## Phase 1 — DA.3 prompt-rewrite guard

### Task 1.1: New module `lib/prompts/rewrite-on-motion-override.ts`

**Files:**
- Create: `lib/prompts/rewrite-on-motion-override.ts`
- Test: `lib/prompts/__tests__/rewrite-on-motion-override.test.ts`

- [ ] **Step 1: Write failing tests** (see file content under Task 1.1 implementation below)
- [ ] **Step 2: Run vitest, expect FAIL (module not found)**
- [ ] **Step 3: Write implementation**
- [ ] **Step 4: Run vitest, expect PASS**
- [ ] **Step 5: Commit (spec + plan + impl + tests bundled)**

### Task 1.2: Apply rewrite in prod DA.3 site (`lib/pipeline.ts`)

After `scene.camera_movement = replacement;` in the DA.3 loop, also call `rewritePromptForNewMotion` with `director_intent.subject` as fallback.

- [ ] **Step 1: Add import + rewrite call**
- [ ] **Step 2: tsc + vitest green**
- [ ] **Step 3: Commit**

### Task 1.3: Apply rewrite in listings-lab DA.3 site (`lib/prompt-lab-listings.ts`)

Mirror Task 1.2 in the listings-lab path.

- [ ] **Step 1: Add import + rewrite call**
- [ ] **Step 2: tsc + vitest green**
- [ ] **Step 3: Commit**

## Phase 2 — Per-photo retrieval into prod + top-K rendering + headroom filter

### Task 2.1: Fix `renderRecipeBlock` to render top-K with similarity scores

Replace `recipes[0]`-only render with top-K (default 3) using `1 - distance` as similarity.

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run vitest, expect FAIL (current renders only first)**
- [ ] **Step 3: Replace renderRecipeBlock with top-K version**
- [ ] **Step 4: vitest green**
- [ ] **Step 5: Commit**

### Task 2.2: New module `lib/prompts/per-photo-retrieval.ts`

`fetchPerPhotoRetrievalBundle` + `filterRecipesByMotionHeadroom` + `renderPerPhotoBlock`.

- [ ] **Step 1: Write failing tests for filterRecipesByMotionHeadroom**
- [ ] **Step 2: vitest FAIL**
- [ ] **Step 3: Write implementation**
- [ ] **Step 4: vitest PASS**
- [ ] **Step 5: Commit**

### Task 2.3: Wire per-photo retrieval into `runScripting`

Replace generic top-5 `learningBlock` with per-photo retrieval block in `lib/pipeline.ts`.

- [ ] **Step 1: Add imports + replace learningBlock**
- [ ] **Step 2: tsc + vitest green**
- [ ] **Step 3: Commit**

## Phase 3 — Verify + HANDOFF

- [ ] **Step 1: vitest full suite**
- [ ] **Step 2: tsc clean**
- [ ] **Step 3: pnpm run doctor**
- [ ] **Step 4: Update HANDOFF.md Right Now + Recent shipping log**
- [ ] **Step 5: Write session notes**
- [ ] **Step 6: Commit docs**
- [ ] **Step 7: Wait for Oliver to OK push + PR**

---

## Implementation details

### Task 1.1 — `rewrite-on-motion-override.ts` full code

```ts
// lib/prompts/rewrite-on-motion-override.ts
//
// When the DA.3 validator overrides scene.camera_movement post-director,
// the original scene.prompt still names the OLD motion verb. Sending that
// prompt to a SKU selected for the NEW motion produces output where the
// SKU and prompt disagree. This module rewrites the prompt text to match
// the new motion using a deterministic template-fill — no extra LLM call,
// constant latency.

import type { CameraMovement } from "../types.js";

const MOTION_TEMPLATES: Record<
  CameraMovement,
  { modifier: string; format: (subject: string) => string }
> = {
  push_in: {
    modifier: "slow cinematic",
    format: (s) => `slow cinematic push in toward ${s}`,
  },
  orbit: {
    modifier: "smooth cinematic",
    format: (s) => `smooth cinematic orbit around ${s}`,
  },
  parallax: {
    modifier: "smooth cinematic",
    format: (s) => `smooth cinematic parallax across ${s}`,
  },
  dolly_left_to_right: {
    modifier: "smooth cinematic",
    format: (s) => `smooth cinematic dolly right across ${s}`,
  },
  dolly_right_to_left: {
    modifier: "smooth cinematic",
    format: (s) => `smooth cinematic dolly left across ${s}`,
  },
  reveal: {
    modifier: "smooth cinematic",
    format: (s) => `smooth cinematic reveal past ${s}`,
  },
  drone_push_in: {
    modifier: "smooth cinematic",
    format: (s) => `smooth cinematic drone flying forward at rooftop height toward ${s}`,
  },
  top_down: {
    modifier: "smooth cinematic",
    format: (s) => `smooth cinematic top down of ${s}`,
  },
  low_angle_glide: {
    modifier: "steady cinematic",
    format: (s) => `steady cinematic low angle glide toward ${s}`,
  },
  feature_closeup: {
    modifier: "cinematic",
    format: (s) => `cinematic slow push in with shallow depth of field on ${s}, background softly blurred`,
  },
  rack_focus: {
    modifier: "cinematic",
    format: (s) => `cinematic rack focus on ${s}, static camera`,
  },
};

const SUBJECT_EXTRACTION_PATTERNS: RegExp[] = [
  / toward (the .+)$/i,
  / around (the .+)$/i,
  / across (the .+)$/i,
  / through (the .+)$/i,
  / past (the .+)$/i,
  / on (the .+?)(?:, background.*)?$/i,
  / of (the .+)$/i,
  / centered on (the .+)$/i,
  / into (the .+)$/i,
];

function extractSubject(prompt: string): string | null {
  for (const pattern of SUBJECT_EXTRACTION_PATTERNS) {
    const m = prompt.match(pattern);
    if (m && m[1]) {
      return m[1].replace(/ (?:and|, revealing) .+$/i, "").trim();
    }
  }
  return null;
}

export function rewritePromptForNewMotion(
  originalPrompt: string,
  newMotion: CameraMovement | string,
  subjectFallback?: string,
): string {
  const template = MOTION_TEMPLATES[newMotion as CameraMovement];
  if (!template) {
    return originalPrompt;
  }
  const extracted = extractSubject(originalPrompt);
  const subject = extracted ?? subjectFallback ?? "the focal subject";
  return template.format(subject);
}
```

### Task 1.1 — test file full code

```ts
// lib/prompts/__tests__/rewrite-on-motion-override.test.ts
import { describe, it, expect } from "vitest";
import { rewritePromptForNewMotion } from "../rewrite-on-motion-override.js";

describe("rewritePromptForNewMotion", () => {
  it("replaces low_angle_glide with feature_closeup template, preserving subject", () => {
    const result = rewritePromptForNewMotion(
      "steady cinematic low angle glide toward the fireplace flanked by built-in shelving",
      "feature_closeup",
    );
    expect(result).toBe(
      "cinematic slow push in with shallow depth of field on the fireplace flanked by built-in shelving, background softly blurred",
    );
  });

  it("replaces push_in with low_angle_glide phrasing, preserving subject", () => {
    const result = rewritePromptForNewMotion(
      "slow cinematic push in toward the waterfall granite island",
      "low_angle_glide",
    );
    expect(result).toBe(
      "steady cinematic low angle glide toward the waterfall granite island",
    );
  });

  it("replaces dolly_right with orbit, preserving subject", () => {
    const result = rewritePromptForNewMotion(
      "smooth cinematic dolly right across the bank of cabinets against the left-back wall",
      "orbit",
    );
    expect(result).toBe(
      "smooth cinematic orbit around the bank of cabinets against the left-back wall",
    );
  });

  it("falls back to subjectFallback when subject can't be extracted", () => {
    const result = rewritePromptForNewMotion(
      "weirdly malformed prompt without canonical pattern",
      "feature_closeup",
      "the freestanding tub",
    );
    expect(result).toBe(
      "cinematic slow push in with shallow depth of field on the freestanding tub, background softly blurred",
    );
  });

  it("falls back to a generic safe template when subject extraction fails AND no fallback given", () => {
    const result = rewritePromptForNewMotion(
      "weirdly malformed prompt without canonical pattern",
      "feature_closeup",
    );
    expect(result).toBe(
      "cinematic slow push in with shallow depth of field on the focal subject, background softly blurred",
    );
  });

  it("returns the original prompt unchanged when newMotion is unknown (no-op safety)", () => {
    const original = "slow cinematic push in toward the bed";
    const result = rewritePromptForNewMotion(original, "unknown_motion");
    expect(result).toBe(original);
  });

  it("rewrites top_down preserving subject", () => {
    const result = rewritePromptForNewMotion(
      "smooth cinematic drone flying forward at rooftop height toward the front facade",
      "top_down",
    );
    expect(result).toBe(
      "smooth cinematic top down of the front facade",
    );
  });
});
```

### Task 2.1 — top-K `renderRecipeBlock` replacement

Replace function at `lib/prompt-lab.ts:390`:

```ts
export function renderRecipeBlock(
  recipes: RetrievedRecipe[],
  opts: { maxK?: number } = {},
): string {
  if (recipes.length === 0) return "";
  const maxK = opts.maxK ?? 3;
  const top = recipes.slice(0, maxK);
  const lines = top.map((r, idx) => {
    const similarity = Math.round((1 - r.distance) * 100);
    const model = r.model_used ?? r.provider ?? "auto";
    return [
      `  ${idx + 1}. [${similarity}% match · ${r.room_type} · ${r.camera_movement} · ${model} · applied ${r.times_applied}×]`,
      `     archetype: ${r.archetype}`,
      `     template:  ${r.prompt_template}`,
    ].join("\n");
  });
  return `\n\n━━━ VALIDATED RECIPE MATCHES ━━━\nThese are ${top.length} prior winning prompt templates whose photo embedded close to this one. Each was rated 4-5★ multiple times. Adapt the template that best matches THIS photo's composition by substituting a named feature from key_features. Prefer the highest-similarity match unless its motion clearly doesn't fit this frame.\n\n${lines.join("\n\n")}\n━━━ END RECIPE MATCHES ━━━`;
}
```

### Task 2.2 — `per-photo-retrieval.ts` full code

```ts
// lib/prompts/per-photo-retrieval.ts
import {
  retrieveMatchingRecipes,
  retrieveSimilarIterations,
  retrieveSimilarLosers,
  renderRecipeBlock,
  renderExemplarBlock,
  renderLoserBlock,
  type RetrievedRecipe,
  type RetrievedExemplar,
} from "../prompt-lab.js";
import { getSupabase } from "../db.js";

type HeadroomKey =
  | "push_in" | "pull_out" | "orbit" | "parallax" | "drone_push_in" | "top_down";

interface MotionRequirement {
  requires?: HeadroomKey[];
  requiresAny?: HeadroomKey[];
  always?: true;
}

const MOTION_HEADROOM_REQUIREMENTS: Record<string, MotionRequirement> = {
  push_in: { requires: ["push_in"] },
  orbit: { requires: ["orbit"] },
  parallax: { requires: ["parallax"] },
  dolly_left_to_right: { requires: ["parallax"] },
  dolly_right_to_left: { requires: ["parallax"] },
  reveal: { requiresAny: ["parallax", "push_in"] },
  drone_push_in: { requires: ["push_in", "drone_push_in"] },
  top_down: { requires: ["top_down"] },
  low_angle_glide: { requires: ["push_in"] },
  feature_closeup: { always: true },
  rack_focus: { always: true },
};

export function filterRecipesByMotionHeadroom(
  recipes: RetrievedRecipe[],
  headroom: Record<string, boolean> | null,
): RetrievedRecipe[] {
  if (!headroom) return recipes;
  return recipes.filter((r) => {
    const req = MOTION_HEADROOM_REQUIREMENTS[r.camera_movement];
    if (!req) return true;
    if (req.always) return true;
    if (req.requires) return req.requires.every((k) => headroom[k] === true);
    if (req.requiresAny) return req.requiresAny.some((k) => headroom[k] === true);
    return true;
  });
}

export interface PerPhotoBundle {
  recipes: RetrievedRecipe[];
  exemplars: RetrievedExemplar[];
  losers: RetrievedExemplar[];
}

interface FetchOpts {
  recipeLimit?: number;
  exemplarLimit?: number;
  loserLimit?: number;
  distanceThreshold?: number;
}

export async function fetchPerPhotoRetrievalBundle(params: {
  photoId: string;
  roomType: string;
  motionHeadroom: Record<string, boolean> | null;
  opts?: FetchOpts;
}): Promise<PerPhotoBundle> {
  const { photoId, roomType, motionHeadroom, opts = {} } = params;
  const supabase = getSupabase();
  const { data: photoRow } = await supabase
    .from("photos")
    .select("image_embedding")
    .eq("id", photoId)
    .maybeSingle();
  const raw = (photoRow as { image_embedding?: unknown } | null)?.image_embedding;
  let embedding: number[] | null = null;
  if (Array.isArray(raw)) embedding = raw as number[];
  else if (typeof raw === "string" && raw.startsWith("[")) {
    try { embedding = JSON.parse(raw) as number[]; } catch { embedding = null; }
  }
  if (!embedding) return { recipes: [], exemplars: [], losers: [] };

  const [recipesRaw, exemplars, losers] = await Promise.all([
    retrieveMatchingRecipes(embedding, roomType, {
      distanceThreshold: opts.distanceThreshold ?? 0.35,
      limit: opts.recipeLimit ?? 3,
    }),
    retrieveSimilarIterations(embedding, {
      minRating: 4,
      limit: opts.exemplarLimit ?? 5,
    }),
    retrieveSimilarLosers(embedding, {
      maxRating: 2,
      limit: opts.loserLimit ?? 3,
    }),
  ]);

  const recipes = filterRecipesByMotionHeadroom(recipesRaw, motionHeadroom);
  return { recipes, exemplars, losers };
}

export function renderPerPhotoBlock(photoId: string, bundle: PerPhotoBundle): string {
  const { recipes, exemplars, losers } = bundle;
  if (recipes.length === 0 && exemplars.length === 0 && losers.length === 0) {
    return "";
  }
  const sections = [
    renderRecipeBlock(recipes),
    renderExemplarBlock(exemplars),
    renderLoserBlock(losers),
  ].filter(Boolean).join("");
  return `\n\n══════ RETRIEVAL FOR PHOTO ${photoId} ══════${sections}\n══════ END RETRIEVAL FOR PHOTO ${photoId} ══════`;
}
```

### Task 2.3 — pipeline.ts replacement block

Replace the existing `learningBlock` construction in `lib/pipeline.ts` `runScripting` (around lines 522-550) with:

```ts
let learningBlock = "";
try {
  const bundles = await Promise.all(
    photoData.map((p) =>
      fetchPerPhotoRetrievalBundle({
        photoId: p.id,
        roomType: p.room_type,
        motionHeadroom: p.motion_headroom ?? null,
      }).then((bundle) => ({ photoId: p.id, bundle })),
    ),
  );
  const blocks = bundles
    .map(({ photoId, bundle }) => renderPerPhotoBlock(photoId, bundle))
    .filter(Boolean);
  if (blocks.length > 0) {
    learningBlock = `\n\nPER-PHOTO RETRIEVAL — for each photo below you'll find recipes (validated winning templates), exemplars (4-5★ past prompts on visually similar photos), and losers (1-2★ past prompts on visually similar photos). Use these to PICK ONE template per photo and adapt it — do NOT blend templates. Prefer the highest-similarity recipe whose motion fits this frame. Steer clear of patterns in the loser blocks.${blocks.join("")}`;
  }
} catch (err) {
  await log(propertyId, "scripting", "warn",
    `Per-photo retrieval failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
}
```

Add imports at top:

```ts
import {
  fetchPerPhotoRetrievalBundle,
  renderPerPhotoBlock,
} from "./prompts/per-photo-retrieval.js";
```

If `fetchRatedExamples` is no longer referenced elsewhere in `pipeline.ts`, remove its import too (grep first).
