# V2.1 Pair-Picker — single-day design

**Date**: 2026-05-23
**Branch**: `worktree-gen2-v21-today` (off `main`)
**Goal**: Ship a working pair-picker + Apprentice Labeler loop + outcome feedback + observability + fall-through in one day so Oliver can start labeling and growing the dataset by EOD.

## Background

V1 today: single-image Kling 2.6 Pro / Seedance 2.0 / Runway, Gemini analyzer picks motion, no pairing. Operator rates iterations; recipes mined but loosely fed back.

V2.1 ambition: **Kling 3 Omni paired renders** (only stable with start+end frames). Picker selects pairs, Oliver labels via Director's Cut UX, Apprentice (Gemini 2.5 Pro) bootstraps from ~20 labels and replaces Oliver on routine pairs, outcome judge closes the loop. Fall-through to V1 single-image (with Seedance 2.0 already on main) when room confidence < 97% or no candidate pair scores high enough.

## Hard constraints

- **Worktree-only**. No push, no migration apply to remote.
- **No sequence planner, no audio, no chyrons, no SR/4K, no realtor blind-test loop.** Pure pair-picker + render + fall-through.
- **97% room-confidence gate**: Gemini's `room_confidence` per photo must be ≥0.97 for that photo to enter pair candidate generation. Below = single-image fall-through.
- **No destructive DB ops**. Additive migrations only (`gen2_*` tables).
- **Seedance 2.0 already on main** (`seedance-pro-pushin` Atlas SKU, slug `bytedance/seedance-2.0/image-to-video`). Don't re-add.

## Module structure

```
lib/gen2-v21/
  types.ts                              # Phase 0 contract for every subagent
  scene-graph/
    extractor.ts                        # Gemini 2.5 Pro pass
    consistency-pass.ts                 # Ambiguity-only re-check
    portal-detector.ts                  # visible_portals[] per photo
    bearing-vector.ts                   # camera_bearing_vector per photo
    schema.ts                           # JSON schema + retry
    index.ts
  candidates/
    rule-generator.ts                   # deterministic same-room/walkthrough/wide-detail/aerial-entry/exterior
    bearing-compat.ts                   # 180-degree opposing-pair filter
    portal-gate.ts                      # is_open_path filter
    index.ts
  picker/
    features.ts                         # 10-feature extractor
    lightgbm.ts                         # train + infer (using nodejs-lightgbm or pure-JS impl)
    heuristic-fallback.ts               # cold-start static scorer
    retrain-trigger.ts                  # every 10 labels
    index.ts
  apprentice/
    labeler.ts                          # Gemini 2.5 Pro few-shot wrapper
    agreement-tracker.ts                # rolling agreement vs operator
    mode-switcher.ts                    # Director's Cut / Apprentice Review / Autopilot
    index.ts
  outcome-feedback/
    worker.ts                           # async background poller
    state-machine.ts                    # pending->polling->completed
    judge.ts                            # Gemini call rating rendered clip
    retrain-hook.ts                     # feeds back to picker
    index.ts
  guardrail/
    line-delta.ts                       # sharp-based LSD proxy
    flow-turbulence.ts                  # frame-diff entropy
    multi-take.ts                       # reroll orchestration (max 2 retries)
    index.ts
  fall-through/
    router.ts                           # 97% gate + V1 single-image route
    sku-selector.ts                     # Kling 2.6 vs Seedance 2.0 A/B
    index.ts
  telemetry/
    audit-log.ts                        # label_id, hashes, model version
    rolling-accuracy.ts                 # last-N predictions vs labels
    feature-importance.ts               # LightGBM gain snapshots
    held-out-eval.ts                    # nightly cron
    index.ts

api/gen2/lab/
  extract-scene-graph.ts                # POST {listingId}
  pair-queue.ts                         # GET ?listingId&limit=20
  pair-label.ts                         # POST {listingId, photo_a, photo_b, verdict, tag, hash_a, hash_b}
  render-pair.ts                        # POST {pair_label_id}
  apprentice-predict.ts                 # POST {pair_candidate_id}
  audit-log.ts                          # GET ?label_id
  observability.ts                      # GET {listing_id|global}
  mode-state.ts                         # GET/POST mode

src/pages/dashboard/v21/
  DirectorsCutLab.tsx                   # frame pair + center column + filmstrip
  ApprenticeReview.tsx                  # variant: agree/disagree on AI labels
  ObservabilityPanel.tsx                # accuracy chart + feature weights + cold-start countdown
  V21LabIndex.tsx                       # mode switcher + property selector + entry route

supabase/migrations/
  067_gen2_scene_graphs.sql
  068_gen2_pair_candidates.sql
  069_gen2_pair_labels.sql
  070_gen2_picker_models.sql
  071_gen2_render_outcomes.sql
  072_gen2_apprentice_predictions.sql

scripts/
  v21-smoke.ts                          # end-to-end on 3 properties
```

## Schema (the contract)

### `lib/gen2-v21/types.ts` — written first, every module imports from this

```typescript
// Scene graph
export type ShotType = "wide" | "medium" | "close" | "aerial" | "detail";
export type BearingVector =
  | "looking_into_room"
  | "looking_out_of_room"
  | "parallel_to_wall_N"
  | "parallel_to_wall_E"
  | "parallel_to_wall_S"
  | "parallel_to_wall_W"
  | "unknown";

export interface VisiblePortal {
  portal_id: string;
  from_room_id: string;
  to_room_id: string | null; // null when unknown
  screen_position: { x: number; y: number; bbox: { x1: number; y1: number; x2: number; y2: number } };
  depth_estimate: "near" | "mid" | "far";
  is_open_path: boolean; // false for mirrors/windows
  confidence: number; // 0..1
}

export interface PhotoSceneFacts {
  photo_id: string;
  room_id: string;
  room_confidence: number; // 0..1; gate is 0.97
  sub_region: string | null;
  camera_bearing_vector: BearingVector;
  shot_type: ShotType;
  focal_subject: string | null;
  visible_features: string[];
  visible_portals: VisiblePortal[];
}

export interface RoomFacts {
  room_id: string;
  room_type: string; // "kitchen" | "primary_bedroom" | etc — open vocab
  features: string[];
  photo_ids: string[];
  // Adjacency is DERIVED from photos' visible_portals where is_open_path=true.
}

export interface PropertySceneGraph {
  listing_id: string;
  photos: PhotoSceneFacts[];
  rooms: RoomFacts[];
  front_orientation: "N" | "E" | "S" | "W" | "unknown";
  exterior_shots: { photo_id: string; type: "aerial" | "front" | "back" | "side" | "drone_descent" }[];
  extracted_at: string; // ISO
  model_version: string; // e.g. "gemini-2.5-pro@2026-05-23"
}

// Candidate pairs
export type CandidateType =
  | "same_room_different_angle"
  | "walkthrough_via_portal"
  | "wide_to_detail"
  | "aerial_to_entry"
  | "exterior_walkaround";

export interface PairCandidate {
  candidate_id: string;
  listing_id: string;
  photo_a_id: string;
  photo_b_id: string;
  candidate_type: CandidateType;
  heuristic_score: number; // 0..1 from rule-based scorer
  reasoning: string;
  portal_id: string | null; // for walkthrough_via_portal
}

// Labels
export type Verdict = "good" | "bad" | "tie";
export type TransitionTag = "push_in" | "walk_through" | "reveal" | "orbit" | "drone_descent" | null;

export interface PairLabel {
  label_id: string;
  listing_id: string;
  photo_a_id: string;
  photo_b_id: string;
  scene_graph_version: string;
  model_version_at_prediction: string | null;
  model_prediction_at_time: number | null; // 0..1
  operator_verdict: Verdict;
  transition_tag: TransitionTag;
  thumbnail_hash_a: string;
  thumbnail_hash_b: string;
  source_mode: "directors_cut" | "apprentice_review" | "autopilot_audit";
  apprentice_predicted_verdict: Verdict | null;
  apprentice_was_wrong: boolean | null;
  created_at: string;
}

// Picker
export interface PickerFeatures {
  same_room: 0 | 1;
  portal_distance: number; // 0 same, 1 adjacent, 2 two-rooms, 999 = inf
  shot_type_delta: number;
  zoom_delta: number;
  focal_subject_overlap: number; // 0..1
  lighting_delta: number; // 0..1
  embedding_cosine_sim: number; // 0..1
  bearing_compatibility_score: number; // 0..1
  portal_centeredness: number; // 0..1
  is_open_path_flag: 0 | 1;
}

export interface PickerPrediction {
  score: number; // 0..1
  confidence: number; // 0..1, model's calibrated certainty
  top_3_features: Array<{ name: keyof PickerFeatures; weight: number }>;
  model_version: string;
  used_fallback_heuristic: boolean;
}

// Apprentice
export interface ApprenticePrediction {
  candidate_id: string;
  predicted_verdict: Verdict;
  predicted_transition_tag: TransitionTag;
  confidence: number;
  reasoning: string;
  model_version: string;
  few_shot_label_ids: string[]; // which operator labels were used as examples
}

// Outcome feedback
export type OutcomeStatus = "pending" | "submitted" | "polling" | "rendered" | "judged" | "completed" | "failed";
export interface RenderOutcome {
  outcome_id: string;
  pair_label_id: string;
  atlas_job_id: string | null;
  video_url: string | null;
  judge_score: number | null; // 0..1
  judge_reasoning: string | null;
  status: OutcomeStatus;
  cost_cents: number;
  retry_count: number;
  created_at: string;
  completed_at: string | null;
}

// Mode state
export type LabMode = "directors_cut" | "apprentice_review" | "autopilot";
export interface ModeState {
  listing_id: string | null; // global if null
  current_mode: LabMode;
  apprentice_agreement_rate: number; // rolling
  total_labels: number;
  recommended_mode: LabMode;
  updated_at: string;
}
```

## Migrations

`gen2_scene_graphs` (listing_id PK, JSONB payload following `PropertySceneGraph`, model_version, extracted_at).
`gen2_pair_candidates` (FK to listings + photos, candidate_type CHECK, heuristic_score).
`gen2_pair_labels` (FK enforced, thumbnail hashes, model_version_at_prediction, source_mode).
`gen2_picker_models` (model_id, listing_count_at_train, label_count_at_train, weights_blob, accuracy_held_out).
`gen2_render_outcomes` (FK to pair_label, status, judge_score).
`gen2_apprentice_predictions` (FK to candidate, agreement_with_operator boolean nullable).

All FK-enforced. All additive. Written to `supabase/migrations/067-072_*.sql`. **NOT applied to remote in this sprint.**

## Fall-through

```typescript
// lib/gen2-v21/fall-through/router.ts
export function routePhoto(
  photo: PhotoSceneFacts,
  candidates: PairCandidate[],
  pickerScore: PickerPrediction | null,
): "v21_pair" | "v1_single_image" {
  if (photo.room_confidence < 0.97) return "v1_single_image";
  if (candidates.length === 0) return "v1_single_image";
  if (pickerScore && pickerScore.score < 0.5) return "v1_single_image";
  return "v21_pair";
}
```

V1 fall-through uses existing pipeline at `lib/pipeline.ts`. SKU selector picks between `kling-v2-6-pro` (default) and `seedance-pro-pushin` (already on main).

## Mode-switch logic

- Initial: `directors_cut` (always)
- After 10 labels: train Apprentice, compute agreement rate on next 10 predictions
- Agreement ≥0.70 → propose `apprentice_review` (operator can decline)
- Agreement ≥0.90 on rolling 50-pair window → propose `autopilot` (operator can decline)
- Always force-switchable from the UI

## Observability

UI panel shows:
- Rolling accuracy (last 20/50/100 labels vs predictions)
- Top-3 feature weights (live, updates on retrain)
- Apprentice agreement rate (when Apprentice active)
- Cold-start countdown (labels until LightGBM takes over from heuristic)
- Held-out listing eval (nightly, surfaced as a number)
- Current mode + recommended mode

## Verification gates

Each subagent runs before reporting DONE:
- `pnpm exec tsc --noEmit` clean on their files
- `pnpm exec vitest run lib/gen2-v21/<their-dir>/` passing
- Their files import only from `lib/gen2-v21/types.ts` and well-known dependencies (no cross-module imports between subagent directories — keeps boundaries clean)

## What ships at EOD today

1. Branch `worktree-gen2-v21-today` (off main)
2. ~50 source files across `lib/gen2-v21/`, `api/gen2/lab/`, `src/pages/dashboard/v21/`
3. 6 migration files in `supabase/migrations/` (NOT applied)
4. Smoke test passing on 3 real properties from dev Supabase (Gemini scene-graph extracts, candidates generate, label persists, Kling 3 Omni render submits)
5. Oliver can sit down at `/dashboard/development/lab?v=v21` and start labeling

## Deferred to next sprint(s)

- Temporal super-resolution to 4K
- Property memory + cross-clip semantic identity
- Sequence planner / video assembly
- Audio + chyrons
- Realtor blind-test loop
- Live retrain dashboard polish (charts)
