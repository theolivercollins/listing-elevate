import { supabase } from "./supabase";
import type { JudgeRubricResult } from "../../lib/prompts/judge-rubric.js";
import type { PromptLabAssembly, PromptLabModelFeedback } from "../../lib/types.js";

export interface LabSession {
  id: string;
  created_by: string;
  image_url: string;
  image_path: string;
  label: string | null;
  archetype: string | null;
  batch_label: string | null;
  archived: boolean;
  created_at: string;
  /** Pipeline version this session was created under. v1 = legacy mixed-movement; v1.1 = Seedance push-in. */
  pipeline_version: 'v1' | 'v1.1';
  iteration_count?: number;
  best_rating?: number | null;
  completed?: boolean;
  pending_render?: boolean;
  ready_for_approval?: boolean;
  iteration_needs_attention?: boolean;
  has_feedback?: boolean;
}

export interface LabIteration {
  id: string;
  session_id: string;
  iteration_number: number;
  analysis_json: Record<string, unknown> | null;
  analysis_prompt_hash: string | null;
  director_output_json: {
    camera_movement: string;
    prompt: string;
    duration_seconds: number;
    room_type: string;
    [k: string]: unknown;
  } | null;
  director_prompt_hash: string | null;
  clip_url: string | null;
  provider: string | null;
  model_used: string | null;
  provider_task_id: string | null;
  render_error: string | null;
  render_submitted_at: string | null;
  render_queued_at: string | null;
  cost_cents: number;
  rating: number | null;
  tags: string[] | null;
  user_comment: string | null;
  refinement_instruction: string | null;
  created_at: string;
  /** Human-readable order number (e.g. `V1-00001`) — assigned by DB trigger. */
  order_id: string | null;
  retrieval_metadata: {
    exemplars?: Array<{
      id: string;
      prompt: string;
      rating: number;
      distance: number;
      room_type?: string;
      camera_movement?: string;
    }>;
    losers?: Array<{
      id: string;
      prompt: string;
      rating: number;
      distance: number;
      room_type?: string;
      camera_movement?: string;
    }>;
    recipe?: {
      id: string;
      archetype: string;
      prompt_template: string;
      distance: number;
    } | null;
  } | null;
  // Judge fields (populated after JUDGE_ENABLED=true render finalization)
  judge_rating_json: JudgeRubricResult | null;
  judge_rating_overall: number | null;
  judge_error: string | null;
  judge_model: string | null;
  judge_version: string | null;
  /** Pipeline version inherited from the parent session. */
  pipeline_version: 'v1' | 'v1.1';
}

export type { JudgeRubricResult };

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function uploadLabImage(file: File): Promise<{ url: string; path: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `prompt-lab/${session.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("property-photos").upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw error;
  const { data: pub } = supabase.storage.from("property-photos").getPublicUrl(path);
  return { url: pub.publicUrl, path };
}

export function listSessions(opts?: { includeArchived?: boolean; pipelineVersion?: 'v1' | 'v1.1' }): Promise<{ sessions: LabSession[] }> {
  const parts: string[] = [];
  if (opts?.includeArchived) parts.push("include_archived=true");
  if (opts?.pipelineVersion) parts.push(`pipeline_version=${encodeURIComponent(opts.pipelineVersion)}`);
  const params = parts.length ? `?${parts.join("&")}` : "";
  return fetchJSON(`/api/admin/prompt-lab/sessions${params}`);
}

export function createSession(body: { image_url: string; image_path: string; label?: string; archetype?: string; batch_label?: string; pipelineVersion?: 'v1' | 'v1.1' }): Promise<LabSession> {
  const { pipelineVersion, ...rest } = body;
  return fetchJSON("/api/admin/prompt-lab/sessions", {
    method: "POST",
    body: JSON.stringify({ ...rest, ...(pipelineVersion ? { pipeline_version: pipelineVersion } : {}) }),
  });
}

export function getSession(sessionId: string): Promise<{ session: LabSession; iterations: LabIteration[] }> {
  return fetchJSON(`/api/admin/prompt-lab/${sessionId}`);
}

export function updateSession(sessionId: string, patch: { label?: string | null; archetype?: string | null; batch_label?: string | null; archived?: boolean }): Promise<LabSession> {
  return fetchJSON(`/api/admin/prompt-lab/${sessionId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteSession(sessionId: string): Promise<void> {
  return fetchJSON(`/api/admin/prompt-lab/${sessionId}`, { method: "DELETE" });
}

export function analyzeSession(sessionId: string): Promise<{ iteration: LabIteration; retrieval: unknown }> {
  return fetchJSON("/api/admin/prompt-lab/analyze", { method: "POST", body: JSON.stringify({ session_id: sessionId }) });
}

export function refineIteration(body: {
  iteration_id: string;
  rating?: number | null;
  tags?: string[] | null;
  comment?: string | null;
  chat_instruction: string;
}): Promise<{ iteration: LabIteration; retrieval: unknown }> {
  return fetchJSON("/api/admin/prompt-lab/refine", { method: "POST", body: JSON.stringify(body) });
}

export function rateIteration(body: {
  iteration_id: string;
  rating?: number | null;
  tags?: string[] | null;
  comment?: string | null;
}): Promise<{ iteration: LabIteration; auto_promoted: { id: string; archetype: string } | null }> {
  return fetchJSON("/api/admin/prompt-lab/rate", { method: "POST", body: JSON.stringify(body) });
}

export function renderIteration(
  iterationId: string,
  provider?: "kling" | "runway" | null,
  sku?: string | null,
  resolution?: string | null,
): Promise<LabIteration & { renderError?: string }> {
  return fetchJSON("/api/admin/prompt-lab/render", {
    method: "POST",
    body: JSON.stringify({
      iteration_id: iterationId,
      provider: provider ?? null,
      sku: sku ?? undefined,
      resolution: resolution ?? undefined,
    }),
  });
}

export function rerenderWithProvider(
  sourceIterationId: string,
  provider: "kling" | "runway" | "atlas",
  sku?: string | null,
  resolution?: string | null,
): Promise<{ iteration: LabIteration; queued?: boolean; message?: string }> {
  return fetchJSON("/api/admin/prompt-lab/rerender", {
    method: "POST",
    body: JSON.stringify({
      source_iteration_id: sourceIterationId,
      provider,
      sku: sku ?? undefined,
      resolution: resolution ?? undefined,
    }),
  });
}

export type BatchSelectionStatus = "selected" | "not_selected" | "discarded";

export interface BatchSelectionItem {
  session_id: string;
  image_url: string | null;
  label: string | null;
  room_type: string | null;
  aesthetic_score: number | null;
  video_viable: boolean | null;
  status: BatchSelectionStatus;
  rank: number | null;
  reason: string;
}

export interface BatchSelectionResponse {
  batch_label: string | null;
  target: number;
  max_per_room: number;
  selected_count: number;
  discarded_count: number;
  not_selected_count: number;
  unanalyzed: Array<{ session_id: string; image_url: string | null; label: string | null }>;
  items: BatchSelectionItem[];
}

/**
 * Runs the production selectPhotos() algorithm against every session in a
 * batch and returns a per-session verdict with reason. `batchLabel = null`
 * targets the Unbatched pseudo-group.
 */
export function fetchBatchSelection(batchLabel: string | null): Promise<BatchSelectionResponse> {
  return fetchJSON("/api/admin/prompt-lab/batch-selection", {
    method: "POST",
    body: JSON.stringify({ batch_label: batchLabel }),
  });
}

// ─── Assembly API ─────────────────────────────────────────────────────────────

/**
 * POST /api/admin/prompt-lab/assemble
 * Assembles the given iterations (in order) into a single MP4 via FFmpeg.
 * Returns the assembly id, the URL of the assembled video, and its duration.
 */
export async function assembleLab(
  sessionId: string,
  iterationIds: string[],
): Promise<{ id: string; assembled_url: string; duration_seconds: number }> {
  return fetchJSON("/api/admin/prompt-lab/assemble", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId, iteration_ids: iterationIds }),
  });
}

/**
 * GET /api/admin/prompt-lab/assemblies?session_id=<>
 * Returns the most recent assemblies for the given session (newest first).
 */
export async function listAssemblies(sessionId: string): Promise<PromptLabAssembly[]> {
  return fetchJSON(`/api/admin/prompt-lab/assemblies?session_id=${encodeURIComponent(sessionId)}`);
}

export type { PromptLabAssembly };

// ─── Model Feedback API ───────────────────────────────────────────────────────

export { type PromptLabModelFeedback };

/**
 * Returns all qualitative feedback rows for one iteration, ordered ASC by
 * created_at. Used by ModelFeedbackPanel on mount.
 */
export function listIterationFeedback(iterationId: string): Promise<PromptLabModelFeedback[]> {
  return fetchJSON(
    `/api/admin/prompt-lab/model-feedback?iteration_id=${encodeURIComponent(iterationId)}`
  );
}

/**
 * Creates a new feedback row for an iteration. The server fills the
 * denormalized fields (session_id, model_used, pipeline_version,
 * resolution_used, author) from the parent iteration row and auth context.
 */
export function createIterationFeedback(
  iterationId: string,
  comment: string
): Promise<PromptLabModelFeedback> {
  return fetchJSON("/api/admin/prompt-lab/model-feedback", {
    method: "POST",
    body: JSON.stringify({ iteration_id: iterationId, comment }),
  });
}

/**
 * Returns recent feedback for a given model + pipeline_version, newest first.
 * Used by the aggregate model-level view (future) and retrieval debugging.
 */
export function listRecentModelFeedback(
  model: string,
  pipelineVersion: string,
  limit?: number
): Promise<PromptLabModelFeedback[]> {
  const parts = [
    `model=${encodeURIComponent(model)}`,
    `pipeline_version=${encodeURIComponent(pipelineVersion)}`,
  ];
  if (limit != null) parts.push(`limit=${limit}`);
  return fetchJSON(`/api/admin/prompt-lab/model-feedback?${parts.join("&")}`);
}

export function overrideJudgeRating(
  iterationId: string,
  correctedRatingJson: JudgeRubricResult,
  correctionReason?: string,
): Promise<{ ok: boolean; calibration_example_id: string }> {
  return fetchJSON("/api/admin/prompt-lab/override-judge", {
    method: "POST",
    body: JSON.stringify({
      iteration_id: iterationId,
      corrected_rating_json: correctedRatingJson,
      correction_reason: correctionReason ?? undefined,
    }),
  });
}
