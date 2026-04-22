# Judge Rubric v1 — Gemini Auto-Judge for V1 Prompt Lab

Status: **FINAL v1.0** (Window B, 2026-04-22). All 7 open questions resolved by Oliver same-day. Ready for P2 Session 1 implementation 2026-04-23.

Owner: Oliver. Designer: Window B (Audit/ML, Opus). Parent spec: [`docs/specs/2026-04-22-v1-primary-tool-and-ml-roadmap-design.md`](../specs/2026-04-22-v1-primary-tool-and-ml-roadmap-design.md) — sections "P2 — Gemini Auto-Judge" + "Risks + mitigations".

Sidecar: [`judge-excluded-legacy.md`](./judge-excluded-legacy.md) — running list of legacy iterations excluded from calibration because their prompts use banned camera-movement vocabulary (per Q3 below).

This document is the canonical rubric the Gemini judge consumes at every V1 render. P2 Session 1 implements `lib/providers/gemini-judge.ts` against this rubric verbatim. Once shipped, every change to the rubric **must bump `judge_version` per the versioning rules below** so historical ratings remain interpretable.

---

## 1. Purpose + North Star mapping

### What the judge does

For every V1 Prompt Lab iteration that finalizes with a `clip_url`, Gemini receives:

- the rendered clip (1–4s, mp4),
- the source photo (the still that seeded the render),
- the director's `director_output_json` for that scene (prompt + camera_movement + room_type + duration_seconds + director_intent),
- the source photo's `photos.analysis_json` (Gemini-eyes output from DA.1 — room_type, key_features, motion_headroom, suggested_motion, etc.),

and emits a structured rubric scorecard that is persisted to `prompt_lab_iterations.judge_rating_json` (per migration 032 in the parent spec).

### Why it exists — direct North Star mapping

| Star | Mechanism this rubric serves |
|---|---|
| **#1 No HITL** | Every render gets an automatic rating instead of waiting on Oliver. Oliver hand-rates only the ~20% the judge flags as low-confidence. |
| **#2 No hallucinations** | Two of the five axes (`geometry_coherence`, `hallucination_flags`) measure hallucination directly. `hallucinated_geometry` / `hallucinated_objects` ratings flow into the LOSER retrieval pool and into the photo-level `hallucination_risk` field used by the director's hard-ban logic (DA.2 + P4). The judge is the engine that grows that signal. |
| **#3 No wasted money** | Per-axis scores tied to `model_used` SKU let P5's Thompson router learn which SKU wins per (room × movement) bucket without paying Oliver's time tax. |
| **#4 Right SKU per (room × movement)** | Same — the bandit cannot bootstrap without judge-grown SKU-tagged signal. Phase B's "32 buckets, 0 winners" verdict (Window D, 2026-04-21) is exactly the data sparsity this judge dissolves. |

### Explicit non-goals of this rubric

- **Not for production scenes.** Production renders are not in scope for P2 Session 1. (Lab → prod is the P7 promote-flywheel decision, separately gated.)
- **Not a replacement for Oliver's taste.** The rubric is calibrated *against* Oliver's tags, not in opposition. It expands his throughput; it does not redefine "good".
- **Not an end-frame interpolation grader.** P2 covers single-image V1 (Kling v2 family). End-frame and paired-image grading is a future v2 rubric.

---

## 2. Rubric axes (final)

Five axes per scorecard. All numeric axes are integers in `{1, 2, 3, 4, 5}`. There is no "0" or "N/A" — when the judge cannot score an axis (e.g., bad clip), it must drop confidence to ≤ 2 and abstain (see Section 5 — "low-confidence behavior"). Vocabulary in italics is the director's own (from `lib/prompts/director.ts`); the judge must use this vocabulary verbatim in its `reasoning` so the signal is grep-able and retrievable.

### Axis 1 — `motion_faithfulness` (1–5)

**Question:** Does the rendered camera motion match what the director's prompt and `camera_movement` field asked for?

| Score | Meaning |
|---|---|
| **5** | Motion verb in the prompt is executed cleanly. *push_in* moves forward; *orbit* circles a fixed anchor; *parallax* slides laterally with a depth element; *dolly* tracks at constant distance; *reveal* passes a named foreground occluder; *drone_push_in* approaches at altitude; *top_down* descends straight down; *low_angle_glide* travels near floor; *feature_closeup* holds shallow DOF; *rack_focus* shifts focal plane on a static frame. Pacing matches the duration. |
| **4** | Motion verb is recognizable but minor speed or path deviations. Slightly fast push-in. Orbit that loses anchor for a moment. Reveal where the foreground occluder is present but the pass is too quick. |
| **3** | Motion verb partially matches but degrades. Push-in that drifts sideways. Dolly that wobbles. Parallax with insufficient depth element. Confidence should usually drop with this score. |
| **2** | Motion executes the wrong verb but in-family (e.g., asked for *dolly_left_to_right*, got something closer to a *push_in*; asked for *parallax*, got a near-static shot). |
| **1** | Wrong direction, wrong verb, or no recognizable motion. Examples: prompt says "dolly right" → camera goes left; prompt says "push in" → camera retreats; prompt says "drone push in" → drone hovers without translation. |

**Failure modes the judge must flag in `hallucination_flags` (additive — flags can co-occur with any motion score):**

- `wrong_motion_direction` — direction inverted vs. prompt
- `too_fast` — motion completes before the clip duration is consumed
- `too_slow` — clip ends before the motion target is reached
- `boring_motion` — camera barely moves on a non-static-intent prompt
- `subject_drift` — anchor / target shifts during the move (only for orbits + reveals)
- `end_frame_lurch` — discontinuity at the final frames (only when end_photo_id is set; rarely for V1)

**Vocabulary the judge must reuse (verbatim from director):**
> push in, orbit, parallax, dolly left, dolly right, reveal, drone push in, top down, low angle glide, feature closeup, rack focus.
> Plus the director's pace adjectives: smooth, slow, steady, cinematic.

---

### Axis 2 — `geometry_coherence` (1–5)

**Question:** Is the architecture, layout, and physical structure visible in the rendered clip consistent with the source photo's geometry — straight walls staying straight, fixed objects holding shape, edges remaining edges?

| Score | Meaning |
|---|---|
| **5** | All structural elements (walls, floors, ceilings, fixtures, large furniture) preserve their shape across every frame. Lines remain straight. Right angles remain right angles. Material textures don't morph. |
| **4** | Geometry is preserved but minor ripple on a soft surface (curtain edge, fabric, foliage). No structural distortion. |
| **3** | Visible warping on a non-structural element OR slight perspective shift on a structural one. A curved doorframe edge that should be straight. A picture frame that bows momentarily. |
| **2** | Significant warping. A wall bows. A counter edge curves. Tile pattern distorts visibly. Or: an object morphs into a related-but-different object (faucet → spout shape change mid-shot). |
| **1** | Severe distortion. Walls melt. Furniture mutates. Architectural details collapse. Frame regions become incoherent. |

**Failure modes for `hallucination_flags`:**

- `hallucinated_geometry` — score ≤ 2 on this axis is automatic
- `hallucinated_objects` — new objects appear that aren't in the source photo
- `warped_text` — any signage / labels / readable surfaces distort

**Vocabulary the judge must reuse:**
> warped, hallucinated, distorted, morphed, structural, perspective, edges, lines.

**Hard rule:** if `geometry_coherence ≤ 2`, `hallucinated_geometry` MUST appear in `hallucination_flags`. The judge does not get to score the axis low and say everything is fine.

---

### Axis 3 — `room_consistency` (1–5)

**Question:** Does the camera stay in the same room / scene type as the source photo, without inventing rooms behind doorways or substituting an entirely different space?

| Score | Meaning |
|---|---|
| **5** | The clip never crosses into a hallucinated adjoining room. If the camera passes a doorway, what's beyond it is consistent with the source photo's visible cues (or stays plausibly out-of-focus). For exteriors: surrounding context (sky, neighboring property edges, landscape) stays consistent. |
| **4** | Camera passes a doorway and what's beyond is plausible but partially invented (e.g., generic interior visible through a doorway in the source). No jarring substitution. |
| **3** | Glimpse of a clearly-invented adjacent space, but the primary subject room stays anchored. |
| **2** | Camera traverses into an adjacent room not visible in the source photo. The "stayed in room" check fails. |
| **1** | Camera teleports. Mid-clip cut to a different room. Outdoor view replaced with a different street. |

**Failure modes for `hallucination_flags`:**

- `bad_framing` — primary subject leaves frame mid-clip
- `subject_drift` — subject identity changes mid-clip (beyond reasonable parallax)

**Vocabulary the judge must reuse:**
> stayed in room, crossed into, doorway, beyond, adjoining, anchored, teleported.

**Note on legacy "stayed in room" tag:** Oliver's tag taxonomy uses *"stayed_in_room"* as a positive marker on 4–5★ ratings. The judge's `room_consistency = 5` is the structural equivalent. The judge does NOT emit *"stayed_in_room"* as a flag — flags are negative-only.

---

### Axis 4 — `hallucination_flags` (string array, possibly empty)

**Question:** Which specific failure modes from the canonical taxonomy are present in this clip?

The judge emits a (possibly empty) array of strings drawn from this **closed enum** (mirrors `lib/rating-taxonomy.ts::NEGATIVE_RATING_REASONS` + `subject_drift` + `end_frame_lurch`):

```
camera_shake          flicker            hallucinated_geometry
hallucinated_objects  warped_text        subject_drift
end_frame_lurch       overexposed        underexposed
color_cast            bad_framing        boring_motion
too_fast              too_slow           wrong_motion_direction
jumpy
```

Plus exactly two free-form escape-hatch flags allowed when nothing fits:

- `other_visual` — describe in `reasoning`
- `other_motion` — describe in `reasoning`

The judge MUST NOT invent new flag strings beyond this enum. Validation at write time (`gemini-judge.ts`) rejects unknown flags. Reason: stable retrieval keys for the loser pool. Flag drift is the #1 way the judge silently breaks the ML loop.

**Cross-axis hard rules (enforced in code, not just doc):**

- `geometry_coherence ≤ 2` → `hallucinated_geometry` must be present
- `motion_faithfulness == 1` AND prompt named a direction → `wrong_motion_direction` must be present
- `room_consistency ≤ 2` → at least one of `bad_framing` / `subject_drift` must be present
- Empty array allowed only when ALL three numeric axes ≥ 4

---

### Axis 5 — `confidence` (1–5)

**Question:** How confident is the judge in its own ratings on this clip?

| Score | Meaning |
|---|---|
| **5** | Clip is unambiguous on all axes. Motion clear. Geometry clear. Room context clear. Few-shot calibration examples directly support this scoring. |
| **4** | Mostly clear with one ambiguous axis (e.g., motion verb between two valid interpretations). |
| **3** | Two ambiguous axes OR clip technical quality reduces certainty (low resolution, partial occlusion). The default for borderline scenes. |
| **2** | Judge is guessing on most axes. Output should be considered preliminary. |
| **1** | Judge cannot meaningfully evaluate (clip won't load, clip duration < 0.5s, frames are mostly black). |

**Behavior tied to confidence:**

- `confidence ≥ 4` → judge rating is treated as authoritative; flows into retrieval, bandit signal, all downstream.
- `confidence == 3` → rating persists but UI surfaces a "low confidence" chip; iteration enters Oliver's "rate these first" priority queue (P6).
- `confidence ≤ 2` → rating persists but is **excluded from training signal**: not used by retrieval, not used by Thompson router, not used as few-shot calibration. Iteration is queued for mandatory human rating.
- `confidence == 1` AND clip is unloadable → write `judge_rating_json = null`, log `cost_event` with `metadata.judge_error = "unscorable"`, do not retry within the same iteration.

This deferral pathway is the rubric's primary defense against bias amplification (Section 5).

---

## 3. Output JSON schema (strict)

Every Gemini judge call returns a single JSON object matching exactly this shape. `gemini-judge.ts` validates with a zod schema before insert; any deviation drops the result and logs `cost_event metadata.judge_error = "schema_violation"` so we can detect rubric drift.

```jsonc
{
  // === required numeric axes (integer 1–5) ===
  "motion_faithfulness": 1 | 2 | 3 | 4 | 5,
  "geometry_coherence":  1 | 2 | 3 | 4 | 5,
  "room_consistency":    1 | 2 | 3 | 4 | 5,
  "confidence":          1 | 2 | 3 | 4 | 5,

  // === required derived field ===
  // overall = round_half_up( (motion_faithfulness + geometry_coherence + room_consistency) / 3 )
  // Computed in code from the three axes; the judge should NOT emit this field.
  // Listed here so the schema reader knows where it ends up in the row.
  // → persisted to prompt_lab_iterations.judge_rating_overall
  "overall_DERIVED_DO_NOT_EMIT": 1 | 2 | 3 | 4 | 5,

  // === required flags array ===
  // Closed enum (see Axis 4). May be empty only when all 3 numeric axes ≥ 4.
  "hallucination_flags": [
    "hallucinated_geometry" | "hallucinated_objects" | "warped_text" |
    "subject_drift"         | "end_frame_lurch"      | "camera_shake" |
    "flicker"               | "overexposed"          | "underexposed" |
    "color_cast"            | "bad_framing"          | "boring_motion" |
    "too_fast"              | "too_slow"             | "wrong_motion_direction" |
    "jumpy"                 | "other_visual"         | "other_motion"
  ],

  // === required reasoning ===
  // ≤ 500 chars, single paragraph, must reuse director vocabulary
  // listed in Axis 1–3. No markdown, no bullets, no JSON inside.
  // Reasoning anchors the rating to specific clip evidence
  // ("the push-in stalls at second 2", "the wall behind the island warps").
  "reasoning": "string (≤500 chars)",

  // === required calibration trace (for debugging + audit) ===
  // List of iteration_ids the judge used as few-shot in this call.
  // Empty array on cold-start (no calibration examples for this bucket yet).
  // Bounded length 0..10 — code rejects calls that try to stuff more.
  "calibration_examples_used": ["uuid", ...]
}
```

### Persisted columns (per migration 032 in the parent spec)

| Column | Source |
|---|---|
| `judge_rating_json` | the full object above (minus `overall_DERIVED_DO_NOT_EMIT` — that lives in `judge_rating_overall`) |
| `judge_rating_overall` | computed `round_half_up(mean(3 numeric axes))` |
| `judge_rated_at` | `now()` at insert |
| `judge_model` | e.g. `"gemini-3-flash"` — from the actual model invoked, NOT from a hardcoded literal in this rubric |
| `judge_version` | `"v1.0"` initially; bumped per Section 6 |

### Validation rules (in `gemini-judge.ts`)

1. All four numeric fields present, each in `{1,2,3,4,5}`.
2. `hallucination_flags` is an array; every element is in the closed enum; no duplicates.
3. `reasoning` is a non-empty string ≤ 500 chars; rejects if it contains JSON braces, code fences, or markdown bullet syntax (rubric drift smell).
4. `calibration_examples_used` is an array of UUIDs; length ≤ 10.
5. Cross-axis rules (Axis 4 hard rules) hold.
6. On any validation failure: drop result, log error, do NOT retry within the same iteration. Queue for Oliver.

---

## 4. 5-shot calibration pool (v0)

These are the seed few-shot examples for the very first judge calls. They are pulled from `prompt_lab_iterations` 2026-04-22 — five rated 5★ across diverse (room × movement) buckets, five rated 1★ across the failure-mode spectrum. Each carries an **ideal-rubric-answer** the judge should emit when reasoning by analogy.

After P2 Session 2 ships and Oliver's corrections start landing, this pool is **superseded per-bucket** by entries from `judge_calibration_examples` (table created in P2 Session 2 migration 033). This v0 pool persists as the cold-start fallback for any (room × movement) bucket with < 3 corrected examples.

**Provider/SKU note:** legacy `prompt_lab_iterations` rows store `provider` only ('kling' | 'runway' | …), not the per-SKU `model_used` that P1 is adding today. The 5★ pool below is mostly Kling v2-family (Lab Q4 2025 / Q1 2026 era). Per the resolved Q4 (Section 7), calibration examples are re-balanced via stratified sampling across SKUs once **either** ≥ 5 V1 renders per SKU on each of the top-10 buckets land, **or** 14 days after V1 daily-driver date — whichever comes first.

**Banned-enum exclusion (per Q3):** the pool-builder script reads [`docs/state/judge-excluded-legacy.md`](./judge-excluded-legacy.md) as its denylist. Any iteration whose `director_output_json.camera_movement` matches a removed enum value (currently: `drone_pull_back`, `pull_out`, `tilt_up`, `tilt_down`, `crane_up`, `crane_down`, `slow_pan`, `orbital_slow`) is excluded from calibration regardless of star rating. Example B5 below is the seed entry — it's INCLUDED in this v0 doc as the null-clip / banned-enum *teaching anchor*, but it would be filtered out of any auto-rebuilt calibration pool.

---

### Pool A — Five 5★ winners (positive anchors)

#### A1. `f76a563d` — aerial / drone_push_in / kling

- **Source photo:** aerial of single-family home with screened lanai + concrete seawall.
- **Director prompt:** *"smooth cinematic drone flying forward at rooftop height toward the screened lanai and concrete seawall"*
- **Duration:** 4s. **Tags Oliver assigned:** `clean motion, cinematic, perfect`.
- **Clip:** [supabase://property-videos/.../f76a563d.mp4](https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/prompt-lab/8601b93c-361d-40de-9616-24e3b88a6a00/f76a563d-b1b3-4375-8b89-ad4ffc4821b2.mp4)

**Ideal judge answer:**
```json
{
  "motion_faithfulness": 5,
  "geometry_coherence":  5,
  "room_consistency":    5,
  "confidence":          5,
  "hallucination_flags": [],
  "reasoning": "Clean drone push in at rooftop altitude moving forward toward the named lanai-and-seawall target. Roofline geometry holds across all frames; no warping on the screen mesh or seawall edges. Surrounding context (sky, water) is consistent with the source. Pacing matches 4s.",
  "calibration_examples_used": []
}
```
**Why it's a 5★:** clean execution of every axis. Anchor for "drone push in done right".

---

#### A2. `f32ab4c8` — kitchen / push_in / kling

- **Source photo:** kitchen with stainless french-door fridge + open doorway to adjacent room.
- **Director prompt:** *"slow cinematic straight push with gentle drift right toward the white-trimmed open doorway past the stainless french-door refrigerator"*
- **Duration:** 3.5s. **Tags:** `clean motion, cinematic, stayed in room`.
- **Clip:** [supabase://...f32ab4c8.mp4](https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/prompt-lab/b7cc4727-23b1-4d41-a00e-2417de2edf5e/f32ab4c8-e18d-43dc-9b68-212018f5ae51.mp4)

**Ideal judge answer:**
```json
{
  "motion_faithfulness": 5,
  "geometry_coherence":  5,
  "room_consistency":    5,
  "confidence":          5,
  "hallucination_flags": [],
  "reasoning": "Push in executes with the prompted gentle right drift toward the doorway. Refrigerator edges and cabinet faces remain straight. Camera approaches the doorway but stays anchored in the kitchen — no invented adjoining room. Pace matches the 3.5s window.",
  "calibration_examples_used": []
}
```
**Why included:** the doorway-passing case. Tests the judge's ability to credit `room_consistency=5` when the camera approaches a portal but doesn't traverse it.

---

#### A3. `b91e83f2` — living_room / reveal / kling

- **Source photo:** living room with gray sectional sofa in foreground; linear fireplace + shiplap ceiling in background.
- **Director prompt:** *"smooth cinematic reveal past the gray sofa into the glowing linear fireplace and shiplap ceiling beyond"*
- **Duration:** 4s. **Tags:** `clean motion, cinematic, perfect`.
- **Clip:** [supabase://...b91e83f2.mp4](https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/prompt-lab/22fcd455-b37b-42b9-b7db-d85ad68ccaf1/b91e83f2-0d0d-42de-a977-e4ad55a8118d.mp4)

**Ideal judge answer:**
```json
{
  "motion_faithfulness": 5,
  "geometry_coherence":  5,
  "room_consistency":    5,
  "confidence":          5,
  "hallucination_flags": [],
  "reasoning": "Reveal correctly passes the named foreground occluder (the gray sofa) into the fireplace+shiplap hero. Sofa silhouette remains coherent during the pass. Fireplace geometry and shiplap ceiling lines stay straight. Stayed anchored in the living room. Strong example of reveal motion.",
  "calibration_examples_used": []
}
```
**Why included:** *reveal* is the highest-difficulty motion (per director.ts hard rules — needs a named foreground occluder that exists in `key_features`). The judge needs an anchor for what a successful reveal looks like, not just the easier push-ins.

---

#### A4. `935a4737` — master_bedroom / push_in / kling

- **Source photo:** master bedroom with tufted wingback headboard + geometric star pendant lights.
- **Director prompt:** *"slow cinematic straight push curving right toward the tufted wingback headboard and geometric star pendants"*
- **Duration:** 4s. **Tags:** `perfect, stayed in room, clean motion`.
- **Clip:** [supabase://...935a4737.mp4](https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/prompt-lab/215b9e04-e258-46a0-8087-7fe7963636b5/935a4737-d5e4-41df-81eb-f93aa3732e2b.mp4)

**Ideal judge answer:**
```json
{
  "motion_faithfulness": 5,
  "geometry_coherence":  5,
  "room_consistency":    5,
  "confidence":          5,
  "hallucination_flags": [],
  "reasoning": "Slow push in with the prompted right curve lands on the tufted headboard hero. Pendant lights hold their geometric star shape across frames. No wall warp. No invented adjoining space — camera stays in the bedroom. Pacing reads slow and cinematic, matching the prompt adjective.",
  "calibration_examples_used": []
}
```
**Why included:** master_bedroom push_in is one of the highest-volume buckets across the whole pool. The bandit needs lots of clean signal here.

---

#### A5. `5995b883` — pool / push_in / runway

- **Source photo:** outdoor pool deck with kidney-shaped turquoise pool + mosaic-tile spa.
- **Director prompt:** *"slow cinematic straight push with gentle curve left centering the turquoise kidney pool and mosaic tile spa"*
- **Duration:** 4s. **Tags:** `clean motion, cinematic, perfect`.
- **Clip:** [supabase://...5995b883.mp4](https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/prompt-lab/ffb7c821-338f-4fec-bc65-0a13f48eb162/5995b883-fe15-4a04-8895-9ad5b36a1876.mp4)

**Ideal judge answer:**
```json
{
  "motion_faithfulness": 5,
  "geometry_coherence":  5,
  "room_consistency":    5,
  "confidence":          5,
  "hallucination_flags": [],
  "reasoning": "Push in with prompted left curve centers on the kidney pool + mosaic spa. Pool coping and tile pattern hold shape. Surrounding deck and landscaping consistent with source. Provider here is runway, but rubric is SKU-agnostic — the executed motion matches the prompt and the geometry is preserved.",
  "calibration_examples_used": []
}
```
**Why included:** only Runway example in the 5★ pool. Per "SKU-bias" guardrails (Section 5), the calibration set must show the judge that a 5★ on one provider looks identical in rubric terms to a 5★ on another. Defends against "Kling = good / Runway = bad" leakage.

---

### Pool B — Five 1★ losers (negative anchors)

#### B1. `e2c35317` — exterior_front / push_in / kling

- **Source photo:** front of house with arched entry portico + dark wood front door.
- **Director prompt:** *"steady cinematic push in toward the arched entry portico and dark wood front door"*
- **Duration:** 4s. **Tags:** `warped geometry, hallucinated architecture`.
- **Clip:** [supabase://...e2c35317.mp4](https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/prompt-lab/ed6ee8a2-ec4d-4694-9d13-cc0636464226/e2c35317-0a9c-4267-b90a-df84a9363a02.mp4)

**Ideal judge answer:**
```json
{
  "motion_faithfulness": 4,
  "geometry_coherence":  1,
  "room_consistency":    3,
  "confidence":          5,
  "hallucination_flags": ["hallucinated_geometry", "hallucinated_objects"],
  "reasoning": "Push in motion executes correctly toward the portico target. But the arch warps mid-push, the front door geometry collapses, and architectural details around the entry mutate into invented forms. Surrounding facade context partially invents detail not present in the source. Classic exterior front-door hallucination.",
  "calibration_examples_used": []
}
```
**Why included:** demonstrates a critical pattern — **the motion can be correct (push_in did push in) but the render still rates 1★ because geometry collapsed.** The judge must NOT collapse the rating to 1 across all axes; per-axis decomposition is the whole point. Pure-motion-fidelity scoring would miss this; geometry+hallucination axes catch it.

---

#### B2. `9f373673` — aerial / drone_push_in / kling

- **Source photo:** aerial of stone-clad gabled facade with standing-seam silver metal roof.
- **Director prompt:** *"smooth cinematic drone flying forward descending low toward the standing-seam silver metal roof and stone-clad gabled facade"*
- **Duration:** 4s. **Tags:** `warped geometry, hallucinated architecture`.
- **Clip:** [supabase://...9f373673.mp4](https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/prompt-lab/b4f245ac-8d4b-4d99-b4cd-ade595cd43f1/9f373673-623c-4542-a2b3-9360506f15dd.mp4)

**Ideal judge answer:**
```json
{
  "motion_faithfulness": 4,
  "geometry_coherence":  1,
  "room_consistency":    2,
  "confidence":          5,
  "hallucination_flags": ["hallucinated_geometry", "hallucinated_objects"],
  "reasoning": "Drone push in with descent does execute the prompted motion. But the roof's standing-seam pattern morphs into inconsistent geometry, the gable warps, and surrounding property edges invent buildings/landscape not present in the source. Aerial hallucination is the highest-cost failure for prod — this is the loser anchor.",
  "calibration_examples_used": []
}
```
**Why included:** mirror of A1 — same room+motion bucket as a 5★ winner. Side-by-side calibration trains the judge on what separates a successful drone push_in from a failed one. Also: aerial hallucinations propagate into neighborhoods that don't exist, the most marketing-toxic failure mode.

---

#### B3. `fcac3b1d` — dining / push_in / kling

- **Source photo:** dining area with round pedestal dining table + tropical slider beyond.
- **Director prompt:** *"slow cinematic straight push with extremely slight curve toward the round pedestal dining table and tropical slider beyond"*
- **Duration:** 4s. **Tags:** `warped geometry, low quality, too fast`.
- **Clip:** [supabase://...fcac3b1d.mp4](https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/prompt-lab/5ca9a5a7-9e74-4a40-bb25-95e97d667436/fcac3b1d-cdcd-461e-bacd-c92c884d254f.mp4)

**Ideal judge answer:**
```json
{
  "motion_faithfulness": 2,
  "geometry_coherence":  2,
  "room_consistency":    4,
  "confidence":          4,
  "hallucination_flags": ["too_fast", "hallucinated_geometry"],
  "reasoning": "Push in completes faster than the 4s clip duration, leaving the last second drifting. Pedestal table base warps and tropical slider geometry distorts mid-push. Camera does stay in the dining room — no adjoining-room hallucination. Multi-axis failure but not catastrophic on every axis; primary failures are pacing and geometry.",
  "calibration_examples_used": []
}
```
**Why included:** trains the judge on **co-occurring but distinct flags** (`too_fast` + `hallucinated_geometry`). Tests its ability to flag pacing as a separate failure from geometry. Also a confidence=4 example — slight ambiguity on motion score (was the push too fast or just brisk?).

---

#### B4. `682fc0f3` — kitchen / dolly_left_to_right / kling

- **Source photo:** kitchen with dark espresso island + stainless appliance wall.
- **Director prompt:** *"smooth cinematic dolly right across the dark espresso island toward the stainless appliance wall"*
- **Duration:** 3.5s. **Tags:** `wrong motion direction, hallucinated architecture`.
- **Clip:** [supabase://...682fc0f3.mp4](https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/prompt-lab/c8bf9ef3-c01b-4339-be4d-0d52be1e0e5a/682fc0f3-9326-45b7-8fb6-facd803580c7.mp4)

**Ideal judge answer:**
```json
{
  "motion_faithfulness": 1,
  "geometry_coherence":  2,
  "room_consistency":    3,
  "confidence":          5,
  "hallucination_flags": ["wrong_motion_direction", "hallucinated_objects"],
  "reasoning": "Dolly right was prompted; rendered camera tracks left, inverting the named direction. Appliance-wall geometry invents detail not present in source. Prompted target (stainless wall) is reached only briefly because the camera traveled the wrong way first. Wrong direction is the dominant failure.",
  "calibration_examples_used": []
}
```
**Why included:** the canonical **wrong_motion_direction** example. Trains the judge that when the prompt names a direction (right / left / forward / backward) and the rendered camera goes the opposite way, motion_faithfulness = 1 and the flag is mandatory.

---

#### B5. `a7249526` — aerial / drone_pull_back / (render failed, no clip)

- **Source photo:** aerial of stone-clad gabled facade.
- **Director prompt:** *"smooth cinematic drone rising backward and upward from the stone-clad gabled facade keeping the subject property centered"*
- **Duration:** 4s. **Tags:** `wrong motion direction`.
- **Clip:** **null** — render failed before producing a clip; iteration was rated 1★ on the failure itself.
- **Note:** prompt uses `drone_pull_back`, an enum value that has been **removed from the director vocabulary** (DA director, 2026-04-19) because pullouts hallucinate revealed geometry. Editor reverses a `drone_push_in` in post for that feel.

**Ideal judge answer:** *the judge should not be invoked on a row with `clip_url IS NULL`.* If somehow it is invoked:
```json
{
  "motion_faithfulness": 1,
  "geometry_coherence":  1,
  "room_consistency":    1,
  "confidence":          1,
  "hallucination_flags": ["other_motion"],
  "reasoning": "No clip available to score (render failed). This is a guardrail example — judge_rating_json should be left null and a cost_event with judge_error='no_clip' logged. The iteration is queued for human review, not auto-rated.",
  "calibration_examples_used": []
}
```
**Why included:** the **null-clip / unscorable** anchor. Trains the judge (and the implementation) on the mandatory abstention pathway. Also surfaces an enum-history issue: B5's prompt uses `drone_pull_back`, a banned movement. Per the resolved Q3 (Section 7), the pool-builder filters such rows out via the [`judge-excluded-legacy.md`](./judge-excluded-legacy.md) denylist; B5 is preserved here in this v0 hand-curated pool as a teaching anchor for the abstention path.

---

### Calibration pool summary

| Iteration | Rating | Bucket (room / movement) | Provider | Key flags | Role |
|---|---|---|---|---|---|
| f76a563d | 5★ | aerial / drone_push_in | kling | clean | drone success anchor |
| f32ab4c8 | 5★ | kitchen / push_in | kling | clean, stayed_in_room | doorway-but-stayed anchor |
| b91e83f2 | 5★ | living_room / reveal | kling | clean | hardest-motion anchor |
| 935a4737 | 5★ | master_bedroom / push_in | kling | clean, stayed_in_room | high-volume bucket anchor |
| 5995b883 | 5★ | pool / push_in | runway | clean | SKU-diversity anchor |
| e2c35317 | 1★ | exterior_front / push_in | kling | hallucinated_geometry, hallucinated_objects | per-axis decomposition anchor |
| 9f373673 | 1★ | aerial / drone_push_in | kling | hallucinated_geometry, hallucinated_objects | mirrors A1 — winner-vs-loser pair |
| fcac3b1d | 1★ | dining / push_in | kling | too_fast, hallucinated_geometry | co-occurring flags anchor |
| 682fc0f3 | 1★ | kitchen / dolly_left_to_right | kling | wrong_motion_direction | direction-inversion anchor |
| a7249526 | 1★ | aerial / drone_pull_back | (failed) | (none) | null-clip abstention anchor |

Five rooms × five motions × two providers. Five distinct failure modes covered. One winner-vs-loser direct comparison (A1 ↔ B2, both aerial drone_push_in). One pre-DA banned-enum example (B5).

---

## 5. Failure modes + guardrails

The single biggest risk in installing the judge is **invisible degradation of the ML loop**. Three specific failure modes the rubric structurally guards against:

### 5a. Judge drift / echo chamber

**Failure:** Gemini biases toward Oliver's current preferences. Oliver corrects → judge over-weights corrections → exploration narrows → router converges on a local optimum → V1 stops finding new winners.

**Structural guardrails in the rubric:**

1. **Independent axes.** Each axis is rated against its own criterion, not against a single "good/bad" judgment. The judge cannot collapse all signal into one number. Per-axis decomposition (B1 above is the canonical example) prevents the judge from inheriting a vibes-based pass/fail.

2. **Calibration scoping.** Few-shot examples passed into a judge call are filtered to the **same (room × movement) bucket** as the iteration being judged. A correction Oliver makes on a kitchen `dolly_right` does not contaminate judge calls on bedroom `push_in`s. (Implemented in `gemini-judge.ts` per spec P2 Session 2 Deliverable 4.)

3. **Closed flag enum.** Hallucination flags cannot drift into novel labels that retrieval doesn't know how to index. Forces convergence on the canonical taxonomy from `lib/rating-taxonomy.ts`.

4. **Confidence-gated training signal.** A `confidence ≤ 2` rating is excluded from retrieval and the bandit (Axis 5 rules). The judge cannot confidently-wrongly steer the loop — its low-confidence ratings simply abstain.

5. **Monthly calibration-drift audit.** Per parent spec P7. Every month, sample 50 judged-without-Oliver iterations; have Oliver re-rate; measure agreement-rate decay. > 10pt decay triggers a `judge_version` minor bump and rubric tightening.

### 5b. Per-SKU bias

**Failure:** the judge subtly rewards `kling-v2-6-pro` (the dominant SKU in the rating pool) and penalizes lower-volume SKUs (`v2-master`, `o3-pro`, `v3-pro`, `v3-std`) just because the calibration pool is skewed. P5's bandit then never gets a fair trial.

**Structural guardrails:**

1. **Rubric is SKU-agnostic.** No axis references a SKU. The judge does not see `model_used` in the input. Period. (`gemini-judge.ts` MUST NOT pass it.) The judge sees: clip + source photo + director_output_json + photo_analysis. SKU enters the analysis pipeline only after the judge writes its rating.

2. **Calibration pool balanced across SKUs (target).** The v0 pool above is honest: 8/10 are kling. **Q4 (Section 7) flags this for re-balance once V1 emits SKU-tagged renders.** P2 Session 2 should add a script that auto-rebuilds the calibration pool monthly with stratified sampling across SKUs.

3. **A5 is intentionally Runway.** Sets the precedent that "5★ looks like 5★ regardless of provider".

4. **Judge-vs-human SKU agreement audit.** Once SKU-tagged renders exist, compute judge-mean rating per SKU and human-mean rating per SKU; any per-SKU divergence > 0.5 points flags rubric bias for review.

### 5c. Confidence < 3 behavior — defer or deceive?

**Failure:** if the judge is asked to commit to a rating it cannot justify, it commits anyway (LLM compulsion to produce a number). Garbage signal flows downstream.

**Structural guardrails:**

1. **Mandatory abstention pathway.** Confidence ≤ 2 → rating excluded from retrieval/bandit; iteration enters Oliver's queue (Axis 5 rules). The judge is *allowed* to abstain — and the rubric explicitly tells it to.

2. **Confidence is rated independently.** Not derived from the other axes. The judge's prompt instructs it to rate confidence on its own ability to discriminate, not on whether the clip is good.

3. **Confidence == 3 is the default for ambiguity.** Surfaces in UI as a "low confidence" chip (P2 Session 2 deliverable 1) and bumps iteration up Oliver's "rate these first" priority queue (P6).

4. **Calibration loop reinforces appropriate uncertainty.** When Oliver's correction overrides a `confidence=5` judge rating, the next call's calibration prompt includes that override — the judge learns "you were too confident here; be more cautious on similar bucket."

### 5d. Other guardrails worth naming

- **Reasoning text retention.** Every judge call's `reasoning` is persisted (in `judge_rating_json`). If the judge starts producing nonsense reasoning, it shows up in QA before it shows up as bad downstream behavior.
- **Cost ceiling.** Per parent spec P2 Risks: per-day spend ceiling on judge calls; kill switch above $10/day.
- **Schema-violation kill.** Any malformed judge output (Section 3 validation rules) drops the result rather than persisting partial signal. The judge cannot "almost work" silently.

---

## 6. Rubric versioning

Persisted to `prompt_lab_iterations.judge_version`. Format: `v{major}.{minor}` — e.g., `"v1.0"`.

### Bump rules

**Major bump (`v1.0 → v2.0`)** — required when:
- Adding or removing a rubric axis (e.g., v2 adds `pacing` as its own axis).
- Changing the JSON schema in a way that breaks deserialization (renamed field, changed type).
- Replacing the underlying judge model when the new model produces materially different ratings on the same clip (compare on a calibration set; if mean per-axis delta > 0.4, treat as major).
- Removing or renaming a value in `hallucination_flags` enum.
- **Q6 promotion trigger fires**: `too_fast` OR `too_slow` flags fire on > 20% of iterations across any 7-day rolling window. Promote duration-faithfulness to its own axis.

**Minor bump (`v1.0 → v1.1`)** — required when:
- Tightening or loosening anchor wording for a 1/3/5 score on an existing axis.
- Adding a value to `hallucination_flags` enum (additive only — removals are major).
- Adding a cross-axis hard rule.
- Replacing the calibration pool wholesale (v0 → v1 of the pool).
- Updating rubric prose that the judge reads (it sees this document essentially verbatim — see below).
- **Q2 escalation trigger fires**: `motion_faithfulness` agreement with Oliver < 70% on the v0 calibration pool. Switch judge input from 6-frame sample to full clip; bump version.
- **Q4 v0 retirement trigger fires**: whichever comes first — (a) ≥ 5 V1 renders per SKU on each of the top-10 (room × movement) buckets (top-10 recomputed at trigger time), OR (b) 14 days after V1 daily-driver date. Regenerate calibration pool via stratified sampling across SKUs; bump version.
- **Q7 cold-start relaxation fires**: per-axis variance > 1.5 on iterations from buckets with zero in-bucket calibration examples. Enable cross-bucket borrowing via image-embedding cosine to nearest bucket; bump version.

**No bump** — when:
- Changing the *implementation* of `gemini-judge.ts` without changing the rubric content (refactor, retry logic, cost-event metadata).
- Changing the `judge_model` field value within a model family that the calibration set proves equivalent (e.g., `gemini-3-flash-001 → gemini-3-flash-002` with identical ratings on the calibration pool).
- Adding new calibration examples to the bucket-scoped pool (incremental, expected — that's the loop).

### How the judge sees this rubric

`gemini-judge.ts` constructs the system prompt by templating from this document. Section 2 (axes), Section 3 (schema), Section 5a–5c (failure modes), and the few-shot examples from Section 4 are loaded into the prompt. Sections 1 (Purpose) and 6 (Versioning) are **not** in the judge's prompt — they're for humans reading this doc.

When `judge_version` bumps, the templating function reads the rubric content frozen at that version. We do NOT mutate prior judge_version's prompt. (Implementation detail: store rubric content as versioned snapshots; `judge_version` selects the snapshot.)

### Re-baseline trigger

Any major version bump triggers a **re-baseline pass**: re-judge the entire calibration pool under the new version, compare to prior judge ratings, write delta report to `docs/audits/judge-rebaseline-vN-vN+1.md`. If mean per-axis drift > 0.5 across the pool, halt rollout and Oliver reviews before activating the new version on live calls.

---

## 7. Resolved decisions (Oliver, 2026-04-22)

All seven Window-B-flagged questions resolved by Oliver same-day. The original questions are preserved verbatim in italics for traceability. The decision is the line that follows. Anchor markers (`<!-- Q1 -->` …) retained so cross-references in this doc and downstream docs continue to resolve.

<!-- Q1 -->
**Q1 — Source photo input: full image or `analysis_json`?** *Original question: pass photo bytes (true visual comparison, ~1¢/call delta) or analysis_json text (cheaper but a degraded signal)?*
**Decision (Oliver, 2026-04-22): pass photo BYTES.** Text is a degraded signal; bytes preserve hallucination-detection fidelity. The +1¢ per call is negligible against the cost of a missed hallucination, and cost-tracking captures it (migration 032 lands on main with `provider='google'` already allowed for the judge call). Implementation: `gemini-judge.ts` fetches the source photo bytes (via signed URL or storage SDK) and passes them inline alongside the clip. NOT the `analysis_json` text.

<!-- Q2 -->
**Q2 — Frame sampling vs. full clip?** *Original question: sample 6 frames per clip (cheap) or full-clip (accurate)?*
**Decision (Oliver, 2026-04-22): 6 FRAMES TO START.** Sample first frame + last frame + 4 evenly spaced intermediates. **Mandatory escalation trigger** (defined here, NOT a later judgment call): if P2 Session 2 calibration audit shows `motion_faithfulness` agreement with Oliver's ratings **< 70%** on the v0 pool, escalate to full-clip input and bump `judge_version` to v1.1. This trigger is also written into Section 6's minor-bump list.

<!-- Q3 -->
**Q3 — How does the judge handle banned-enum prompts in legacy data?** *Original question: filter banned-enum rows at pool-builder level, or have the judge ignore the `camera_movement` field?*
**Decision (Oliver, 2026-04-22): FILTER AT POOL-BUILDER LEVEL.** A judge calibrated on banned vocabulary (e.g., `drone_pull_back`, `tilt_up`, `crane_up`, `pull_out`, `slow_pan`, `orbital_slow`) will score against obsolete mental models. Excluded rows are preserved in the sidecar file [`docs/state/judge-excluded-legacy.md`](./judge-excluded-legacy.md) with iteration_id + reason so the exclusion list is auditable if judge behavior surprises us later. Example B5 (`a7249526`) is the seed entry. The pool-builder script (P2 Session 2 deliverable) reads this list as its denylist.

<!-- Q4 -->
**Q4 — When does the v0 calibration pool retire?** *Original question: pool is heavily Kling; when do we swap in SKU-balanced examples?*
**Decision (Oliver, 2026-04-22): WHICHEVER COMES FIRST — (a) ≥ 5 V1 renders per SKU on each of the top-10 (room × movement) buckets, OR (b) 2 weeks of V1 use (P1 daily-driver date + 14d).** Pool retirement triggers a calibration-pool regenerate via the P2 Session 2 stratified-sampling script and a `judge_version` minor bump (v1.0 → v1.1). Top-10 buckets are recomputed at retirement time from V1 render counts (do NOT hard-code today's top-10 here; the distribution shifts as Oliver works). This rule is also written into Section 6's minor-bump list.

<!-- Q5 -->
**Q5 — Rerender provenance: should the judge see the prior iteration's rating?** *Original question: when judging a rerender, show the judge the prior iteration's clip + rating, or only the current one?*
**Decision (Oliver, 2026-04-22): NO. NO EXCEPTIONS.** Showing the prior rating would anchor the judge and collapse the variance P2 needs to detect iteration-over-iteration improvement. Each iteration is judged independently on its own clip, prompt, source photo, and bucket-scoped few-shot. Rerender chain comparisons happen downstream — in retrieval, in the bandit, in Oliver's "rate these first" panel — never inside the judge call.

<!-- Q6 -->
**Q6 — Where does duration-faithfulness fit?** *Original question: add a 6th `duration_faithfulness` axis or keep `too_fast` / `too_slow` as flags under `motion_faithfulness`?*
**Decision (Oliver, 2026-04-22): FLAGS ONLY.** No 6th axis. **Mandatory promotion trigger** (defined here, NOT a later judgment call): if `too_fast` OR `too_slow` flags fire on **> 20% of iterations across any 7-day window** (rolling), escalate to a `judge_version` MAJOR bump that promotes duration-faithfulness to its own axis. This trigger is also written into Section 6's major-bump list. Until then, the existing flags carry the signal.

<!-- Q7 -->
**Q7 — Can the judge see `judge_calibration_examples` from OTHER buckets when the target bucket is cold?** *Original question: borrow few-shot from neighboring buckets, or stay strict same-bucket?*
**Decision (Oliver, 2026-04-22): STRICT SAME-BUCKET.** Zero cross-bucket borrowing in v1.0. Cold buckets fall back to the v0 pool in Section 4. If P2 Session 2's calibration audit shows judge instability on cold buckets (defined as: per-axis variance > 1.5 on iterations from buckets with zero in-bucket calibration examples), revisit and consider borrowing from the structurally-nearest bucket via image-embedding cosine. Image embeddings are a P3 primitive anyway, so the relaxation has a natural landing point. Not today.

---

## Appendix — quick reference card (for the judge prompt)

A compressed version that fits in the judge's system prompt. Templated from this rubric at `judge_version="v1.0"`.

```
JUDGE THIS CLIP. RETURN JSON ONLY.

You are an automated judge for a real-estate cinematography pipeline.
You see: a 4s mp4 clip, the source still photo, the director's
prompt+camera_movement, and the source photo's analysis. You return
a 5-axis rubric scorecard.

AXES:
- motion_faithfulness 1-5 — does the rendered camera motion match the
  prompted camera_movement (push_in / orbit / parallax / dolly /
  reveal / drone_push_in / top_down / low_angle_glide / feature_closeup
  / rack_focus)?
- geometry_coherence 1-5 — do walls, fixtures, edges hold their shape
  across all frames? Score ≤2 → hallucinated_geometry MUST be flagged.
- room_consistency 1-5 — does the camera stay in the source room
  without inventing adjoining spaces?
- confidence 1-5 — your own confidence in this scorecard. ≤2 means
  this rating will be discarded; abstain when unsure.
- hallucination_flags array from CLOSED ENUM (see schema). Empty only
  if all 3 numeric axes ≥ 4.

RULES:
- Use the director vocabulary verbatim in reasoning.
- Reasoning ≤ 500 chars, single paragraph, no bullets.
- You will see {N} few-shot examples from this bucket (room × movement).
  Anchor your scoring against them.
- DO NOT invent flag strings.
- DO NOT see model_used / SKU. Rate the clip, not the provider.
- WHEN UNSURE, drop confidence. The system has a defer pathway.

OUTPUT EXACTLY THIS JSON SHAPE:
{...}
```

End of rubric v1.0.
