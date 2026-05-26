// V2.1 shared types — the contract every gen2-v21 module imports. Do not modify without updating docs/specs/2026-05-23-v21-pair-picker-design.md.

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
  | "exterior_walkaround"
  /** Safety-net fallback added 2026-05-26: same-room pair that matched no typed rule. */
  | "same_room_fallback";

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
