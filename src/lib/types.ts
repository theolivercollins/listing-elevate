export type PropertyStatus = "queued" | "analyzing" | "scripting" | "generating" | "qc" | "assembling" | "complete" | "failed" | "needs_review" | "archived" | "delivered";
export type SceneStatus = "pending" | "generating" | "qc_pass" | "qc_soft_reject" | "qc_hard_reject" | "retry_1" | "retry_2" | "failed" | "needs_review";

/**
 * Runtime const tuple of all PropertyStatus values.
 * Typed as `satisfies readonly PropertyStatus[]` so TypeScript errors if this drifts from the union.
 * Used by tests to assert ORDER_STATUS_MAP has exhaustive coverage.
 */
export const ALL_PROPERTY_STATUSES = [
  "queued",
  "analyzing",
  "scripting",
  "generating",
  "qc",
  "assembling",
  "complete",
  "failed",
  "needs_review",
  "archived",
  "delivered",
] as const satisfies readonly PropertyStatus[];

/**
 * Runtime const tuple of all SceneStatus values.
 * Typed as `satisfies readonly SceneStatus[]` so TypeScript errors if this drifts from the union.
 * Used by tests to assert ORDER_STATUS_MAP has exhaustive coverage.
 */
export const ALL_SCENE_STATUSES = [
  "pending",
  "generating",
  "qc_pass",
  "qc_soft_reject",
  "qc_hard_reject",
  "retry_1",
  "retry_2",
  "failed",
  "needs_review",
] as const satisfies readonly SceneStatus[];
export type LogLevel = "info" | "warn" | "error" | "debug";
export type PipelineStage = "intake" | "analysis" | "scripting" | "generation" | "qc" | "assembly" | "delivery";
export type RoomType = "kitchen" | "living_room" | "master_bedroom" | "bedroom" | "bathroom" | "exterior_front" | "exterior_back" | "pool" | "aerial" | "dining" | "hallway" | "garage" | "other";
export type CameraMovement =
  | "push_in" | "pull_out" | "orbit" | "parallax"
  | "dolly_left_to_right" | "dolly_right_to_left"
  | "reveal" | "drone_push_in" | "drone_pull_back" | "top_down" | "low_angle_glide"
  | "feature_closeup"
  // Legacy compat only — not emitted by new runs
  | "orbital_slow" | "slow_pan" | "tilt_up" | "crane_up" | "tilt_down" | "crane_down";

export interface Property {
  id: string;
  created_at: string;
  updated_at: string;
  address: string;
  price: number;
  bedrooms: number;
  bathrooms: number;
  listing_agent: string;
  brokerage: string;
  status: PropertyStatus;
  photo_count: number;
  selected_photo_count: number;
  total_cost_cents: number;
  processing_time_ms: number;
  horizontal_video_url: string | null;
  vertical_video_url: string | null;
  thumbnail_url: string | null;
}

export interface Photo {
  id: string;
  property_id: string;
  file_url: string;
  file_name: string;
  room_type: RoomType;
  quality_score: number;
  aesthetic_score: number;
  depth_rating: "high" | "medium" | "low";
  key_features: string[] | null;
  composition: string | null;
  selected: boolean;
  discard_reason: string | null;
  video_viable: boolean | null;
  suggested_motion: CameraMovement | null;
  motion_rationale: string | null;
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
  provider: "runway" | "kling" | "atlas";
  generation_cost_cents: number;
  generation_time_ms: number;
  clip_url: string | null;
  attempt_count: number;
  qc_verdict: string | null;
  qc_issues: any;
  qc_confidence: number;
}

export interface PipelineLog {
  id: string;
  property_id: string;
  scene_id: string | null;
  created_at: string;
  stage: PipelineStage;
  level: LogLevel;
  message: string;
  metadata: any;
}

export interface SceneRating {
  id: string;
  scene_id: string;
  property_id: string;
  rating: number;
  comment: string | null;
  tags: string[] | null;
  rated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromptRevision {
  id: string;
  prompt_name: string;
  version: number;
  body: string;
  note: string | null;
  created_at: string;
}

export interface LearningData {
  totalRatings: number;
  avgAll: number | null;
  winners: Array<{
    id: string;
    rating: number;
    comment: string | null;
    tags: string[] | null;
    created_at: string;
    scene_id: string;
    scene_number: number;
    room_type: string;
    camera_movement: string;
    prompt: string;
    provider: string | null;
    clip_url: string | null;
    duration_seconds: number | null;
    property_id: string | null;
    property_address: string | null;
  }>;
  losers: LearningData["winners"];
  combos: Array<{ room_type: string; camera_movement: string; avg_rating: number; count: number }>;
  providers: Array<{ provider: string; avg_rating: number; count: number }>;
  trend: Array<{ day: string; avg_rating: number; count: number }>;
}

export interface CostEvent {
  id: string;
  scene_id: string | null;
  stage: "analysis" | "scripting" | "generation" | "qc" | "assembly";
  provider: "anthropic" | "runway" | "kling" | "atlas";
  units_consumed: number | null;
  unit_type: "tokens" | "credits" | "kling_units" | null;
  cost_cents: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export type TokenProvider = "runway" | "kling" | "atlas" | "anthropic" | "openai" | "other";

export interface TokenPurchase {
  id: string;
  created_at: string;
  purchased_at: string;
  provider: TokenProvider;
  amount_cents: number;
  units: number;
  unit_type: string | null;
  note: string | null;
}

export interface Expense {
  id: string;
  created_at: string;
  incurred_at: string;
  category: string;
  description: string | null;
  amount_cents: number;
}

export interface RevenueEntry {
  id: string;
  created_at: string;
  received_at: string;
  source: string;
  property_id: string | null;
  amount_cents: number;
  note: string | null;
}

export type BillingPeriod = "monthly" | "yearly";
export type SubscriptionStatus = "active" | "paused" | "cancelled";

export interface Subscription {
  id: string;
  provider: string;
  amount_cents: number;
  billing_period: BillingPeriod;
  started_at: string;
  next_charge_at: string;
  status: SubscriptionStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyStat {
  id: string;
  date: string;
  properties_completed: number;
  properties_failed: number;
  total_clips_generated: number;
  total_retries: number;
  total_cost_cents: number;
  avg_processing_time_ms: number;
  avg_cost_per_video_cents: number;
}

export const statusStages: { key: PropertyStatus; label: string }[] = [
  { key: "queued", label: "Queued" },
  { key: "analyzing", label: "Analyzing" },
  { key: "scripting", label: "Scripting" },
  { key: "generating", label: "Generating" },
  { key: "qc", label: "QC" },
  { key: "assembling", label: "Assembling" },
];

export function getStatusColor(status: PropertyStatus | SceneStatus): string {
  switch (status) {
    case "complete":
    case "qc_pass":
      return "bg-primary text-primary-foreground";
    case "queued":
    case "pending":
      return "bg-muted text-muted-foreground";
    case "analyzing":
    case "scripting":
    case "generating":
      return "bg-info text-info-foreground";
    case "qc":
      return "bg-info text-info-foreground";
    case "assembling":
      return "bg-info text-info-foreground";
    case "failed":
    case "qc_hard_reject":
      return "bg-destructive text-destructive-foreground";
    case "needs_review":
    case "qc_soft_reject":
      return "bg-warning text-warning-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function getRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
