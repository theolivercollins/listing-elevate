/**
 * Video Editor Types
 *
 * Shared types for the revision engine, tools, and API endpoints.
 */

// ---------------------------------------------------------------------------
// Assembly Timeline — the JSON blob persisted on properties.assembly_timeline
// ---------------------------------------------------------------------------

export interface AssemblyTimelineClip {
  url: string;
  durationSeconds: number;
}

export interface AssemblyTimelineOverlays {
  address: string;
  price: string;
  details: string;
  agent: string;
  brokerage?: string | null;
}

export interface AssemblyTimeline {
  clips: AssemblyTimelineClip[];
  overlays: AssemblyTimelineOverlays;
  transition: string;
  provider: string;
  rendered_at: string;
}

// ---------------------------------------------------------------------------
// Tool Definitions — what Claude can call
// ---------------------------------------------------------------------------

export interface ToolCallResult {
  name: string;
  args: Record<string, unknown>;
  result: { success: boolean; message: string; [key: string]: unknown };
}

// ---------------------------------------------------------------------------
// Revision — one row in video_revisions
// ---------------------------------------------------------------------------

export interface VideoRevision {
  id: string;
  property_id: string;
  created_at: string;
  user_message: string;
  tool_calls: ToolCallResult[] | null;
  reasoning: string | null;
  timeline_before: AssemblyTimeline;
  timeline_after: AssemblyTimeline;
  render_job_id: string | null;
  render_status: "pending" | "rendering" | "complete" | "failed";
  horizontal_video_url: string | null;
  vertical_video_url: string | null;
  render_error: string | null;
  cost_cents: number;
  revision_number: number;
  is_active: boolean;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// API request/response shapes
// ---------------------------------------------------------------------------

export interface ReviseRequest {
  message: string;
}

export interface ReviseResponse {
  revisionId: string;
  status: "rendering" | "failed";
  reasoning?: string;
  toolCalls?: ToolCallResult[];
  error?: string;
}

export interface ApplyRevisionResponse {
  ok: boolean;
  horizontalVideoUrl?: string;
  verticalVideoUrl?: string;
}

export interface RollbackResponse {
  ok: boolean;
  restoredToRevision: number;
}
