export type PropertyStatus =
  | "pending_payment"
  | "queued"
  | "analyzing"
  | "scripting"
  | "generating"
  | "qc"
  | "assembling"
  | "complete"
  | "failed"
  | "needs_review"
  | "archived"
  | "delivered";

export type RoomType =
  | "kitchen"
  | "living_room"
  | "master_bedroom"
  | "bedroom"
  | "bathroom"
  | "exterior_front"
  | "exterior_back"
  | "pool"
  | "aerial"
  | "dining"
  | "hallway"
  | "garage"
  | "foyer"
  // Added 2026-04-19 (Phase 2.5 vocab expansion).
  | "office"
  | "laundry"
  | "closet"
  | "basement"
  | "deck"
  | "powder_room"
  | "stairs"
  | "media_room"
  | "gym"
  | "mudroom"
  | "other";

export type DepthRating = "high" | "medium" | "low";

// 11-verb cinematography vocabulary matched to real-estate shot types.
// Pullouts (pull_out, drone_pull_back) were removed 2026-04-19 — the AI
// never generates outward motion; the assembly stage reverses an inward
// clip in post when a pullout feel is wanted (see Phase 2.6).
// See docs/PROJECT-STATE.md for the full taxonomy and per-room routing.
export type CameraMovement =
  // Active 11-verb vocabulary the AI is allowed to generate.
  | "push_in"
  | "orbit"                 // renamed from orbital_slow
  | "parallax"
  | "dolly_left_to_right"
  | "dolly_right_to_left"
  | "reveal"                // pass foreground element to expose background
  | "drone_push_in"         // aerial approach
  | "top_down"              // overhead bird's-eye
  | "low_angle_glide"       // floor-height glide making ceilings feel taller
  | "feature_closeup"       // extreme close-up with shallow depth of field on one hero feature
  | "rack_focus"            // 2026-04-19 — focus pull between near and far subject (static camera)
  // Legacy — present ONLY so historical scene rows still typecheck.
  // The photo analyzer and director MUST NOT emit these for new runs.
  | "pull_out"              // deleted 2026-04-19 — pullouts reversed in post instead
  | "drone_pull_back"       // deleted 2026-04-19 — same as pull_out, aerial variant
  | "orbital_slow"
  | "slow_pan"
  | "tilt_up"               // deleted — awkward
  | "crane_up"              // deleted — awkward
  | "tilt_down"             // deleted — same problem as tilt_up
  | "crane_down";           // deleted — source photo has no overhead start frame

export type SceneStatus =
  | "pending"
  | "generating"
  | "qc_pass"
  | "qc_soft_reject"
  | "qc_hard_reject"
  | "retry_1"
  | "retry_2"
  | "failed"
  | "needs_review";

export type VideoProvider = "runway" | "kling" | "higgsfield" | "atlas";

export type PipelineMode = "v1" | "v1.1";

export type LogStage =
  | "intake"
  | "analysis"
  | "scripting"
  | "generation"
  | "qc"
  | "assembly"
  | "delivery";

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface Property {
  id: string;
  created_at: string;
  updated_at: string | null;
  address: string;
  price: number;
  bedrooms: number;
  bathrooms: number;
  listing_agent: string;
  brokerage: string | null;
  status: PropertyStatus;
  photo_count: number;
  selected_photo_count: number;
  total_cost_cents: number;
  processing_time_ms: number | null;
  horizontal_video_url: string | null;
  vertical_video_url: string | null;
  thumbnail_url: string | null;
  submitted_by: string | null;
  selected_package: string | null;
  selected_duration: number | null;
  selected_orientation: string | null;
  add_voiceover: boolean;
  add_voice_clone: boolean;
  add_custom_request: boolean;
  custom_request_text: string | null;
  days_on_market: number | null;
  sold_price: number | null;
  // Operator Studio Phase 1 — set when order_mode = 'operator'
  client_id: string | null;
  order_mode: 'customer' | 'operator';
  // ElevenLabs voiceover outputs — pipeline-written, not set at order creation.
  voiceover_script: string | null;
  voiceover_audio_url: string | null;
  voiceover_voice_id_used: string | null;
  voiceover_chars: number | null;
  voiceover_duration_seconds: number | null;
  // Stripe billing — added migration 059.
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_payment_status: "unpaid" | "pending" | "paid" | "refunded" | "failed" | "cancelled";
  stripe_paid_at: string | null;
  stripe_amount_cents: number | null;
  // v1.1 Seedance push-in toggle — added migration 062.
  pipeline_mode: PipelineMode;
}

export interface UserProfile {
  id: string;
  user_id: string;
  role: "admin" | "user";
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  brokerage: string | null;
  logo_url: string | null;
  colors: Record<string, string> | null;
  presets: unknown[] | null;
  created_at: string;
  updated_at: string;
  // ElevenLabs voice-clone state — added migration 057.
  elevenlabs_voice_id: string | null;
  voice_clone_status: "none" | "requested" | "enrolling" | "ready" | "failed";
  voice_clone_created_at: string | null;
  voice_clone_paid_cents: number | null;
  voice_clone_paid_at: string | null;
  voice_clone_sample_url: string | null;
  // Stripe — added migration 059.
  stripe_customer_id: string | null;
}

export interface Photo {
  id: string;
  property_id: string;
  created_at: string;
  file_url: string;
  file_name: string | null;
  room_type: RoomType | null;
  quality_score: number | null;
  aesthetic_score: number | null;
  depth_rating: DepthRating | null;
  selected: boolean;
  discard_reason: string | null;
  key_features: string[] | null;
}

export interface Scene {
  id: string;
  property_id: string;
  photo_id: string;
  scene_number: number;
  camera_movement: CameraMovement;
  prompt: string;
  duration_seconds: number;
  status: SceneStatus;
  provider: VideoProvider | null;
  provider_task_id: string | null;
  generation_cost_cents: number | null;
  generation_time_ms: number | null;
  clip_url: string | null;
  attempt_count: number;
  qc_verdict: string | null;
  qc_issues: Record<string, unknown>[] | null;
  qc_confidence: number | null;
  // Phase 2.7: end-frame keyframe support
  end_photo_id: string | null;
  end_image_url: string | null;
}

export interface PipelineLog {
  id: string;
  property_id: string;
  scene_id: string | null;
  created_at: string;
  stage: LogStage;
  level: LogLevel;
  message: string;
  metadata: Record<string, unknown> | null;
}

// ─── Prompt Lab assembly (migration 068) ───────────────────────────────────────
// Matches prompt_lab_assemblies table schema exactly.
export interface PromptLabAssembly {
  id: string;
  session_id: string;
  iteration_order: string[];          // ordered array of iteration UUIDs
  assembled_url: string | null;
  status: "queued" | "assembling" | "complete" | "failed";
  error: string | null;
  duration_seconds: number | null;
  pipeline_version: "v1" | "v1.1";
  created_at: string;
  completed_at: string | null;
}

export interface DailyStats {
  id: string;
  date: string;
  properties_completed: number;
  properties_failed: number;
  total_clips_generated: number;
  total_retries: number;
  total_cost_cents: number;
  avg_processing_time_ms: number | null;
  avg_cost_per_video_cents: number | null;
}
