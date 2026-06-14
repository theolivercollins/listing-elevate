// Prompt Lab core helpers — run PHOTO_ANALYSIS + DIRECTOR on a single uploaded
// image for iterative prompt refinement. See docs/PROMPT-LAB-PLAN.md.

import Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "./client.js";
import {
  PHOTO_ANALYSIS_SYSTEM,
  buildAnalysisUserPrompt,
  type PhotoAnalysisResult,
} from "./prompts/photo-analysis.js";
import {
  DIRECTOR_SYSTEM,
  buildDirectorUserPrompt,
  type DirectorOutput,
  type DirectorSceneOutput,
} from "./prompts/director.js";
import { sanitizeDirectorPrompt } from "./prompts/sanitize-director.js";
import { computeClaudeCost } from "./utils/claude-cost.js";
import { selectProvider, resolveDecision, resolveDecisionAsync, forceSeedancePushInPrompt } from "./providers/router.js";
import type { ThompsonDecision } from "./providers/thompson-router.js";
import { pollUntilComplete, type IVideoProvider, type GenerateClipParams } from "./providers/provider.interface.js";
import { KlingProvider } from "./providers/kling.js";
import { RunwayProvider } from "./providers/runway.js";
import { AtlasProvider, type V1AtlasSku } from "./providers/atlas.js";
import { VeoProvider } from "./providers/veo.js";
import { embedTextSafe, buildAnalysisText, toPgVector } from "./embeddings.js";
import { recordCostEvent } from "./db.js";
import { hostVideoOnBunny, isBunnyConfigured, bunnyStreamCostCents, deleteBunnyVideo, validateBunnyMp4Url } from "./providers/bunny-stream.js";
import type { RoomType, CameraMovement } from "./types.js";

// Lab cost_events use property_id = null. The earlier "zero-UUID sentinel"
// pattern silently violated cost_events.property_id_fkey (constraint kept
// post-migration 045) and dropped every Lab cost row from 2026-04-30 to
// 2026-05-06. recordCostEvent now accepts null and skips the
// addPropertyCost rollup when there's no property to attribute.

// ---- Types ----

export interface LabIterationRow {
  id: string;
  session_id: string;
  iteration_number: number;
  analysis_json: PhotoAnalysisResult | null;
  analysis_prompt_hash: string | null;
  director_output_json: DirectorSceneOutput | null;
  director_prompt_hash: string | null;
  clip_url: string | null;
  provider: string | null;
  cost_cents: number;
  rating: number | null;
  tags: string[] | null;
  user_comment: string | null;
  refinement_instruction: string | null;
  created_at: string;
}

export interface LabSessionRow {
  id: string;
  created_by: string;
  image_url: string;
  image_path: string;
  label: string | null;
  archetype: string | null;
  created_at: string;
}

// ---- Hash helper (FNV-1a, 32-bit, hex) — same family used in db.ts ----

function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export const ANALYSIS_PROMPT_HASH = hash32(PHOTO_ANALYSIS_SYSTEM);
export const DIRECTOR_PROMPT_HASH = hash32(DIRECTOR_SYSTEM);

// Resolve the effective DIRECTOR_SYSTEM for Lab calls — if an active
// lab_prompt_overrides row exists for prompt_name='director', use that body;
// otherwise fall back to the main DIRECTOR_SYSTEM. Production pipeline does
// NOT call this — it uses DIRECTOR_SYSTEM directly, so Lab overrides stay
// Lab-scoped.
async function resolveDirectorSystem(): Promise<{ body: string; hash: string }> {
  try {
    const { getSupabase } = await import("./client.js");
    const supabase = getSupabase();
    const { data } = await supabase
      .from("lab_prompt_overrides")
      .select("body, body_hash")
      .eq("prompt_name", "director")
      .eq("is_active", true)
      .maybeSingle();
    if (data?.body) return { body: data.body as string, hash: (data.body_hash as string) ?? hash32(data.body as string) };
  } catch { /* no-op */ }
  return { body: DIRECTOR_SYSTEM, hash: DIRECTOR_PROMPT_HASH };
}

// ---- Run photo analysis on a single image ----

export async function analyzeSingleImage(imageUrl: string): Promise<{
  analysis: PhotoAnalysisResult;
  costCents: number;
}> {
  const client = new Anthropic();
  const ANALYZE_MODEL = "claude-sonnet-4-6";
  const response = await client.messages.create({
    model: ANALYZE_MODEL,
    max_tokens: 4096,
    system: PHOTO_ANALYSIS_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "url", url: imageUrl } },
          { type: "text", text: buildAnalysisUserPrompt(1) },
        ],
      },
    ],
  });
  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("Photo analyzer returned no JSON array");
  const results: PhotoAnalysisResult[] = JSON.parse(jsonMatch[0]);
  if (!results[0]) throw new Error("Photo analyzer returned empty array");
  const usageCost = computeClaudeCost(response.usage as never, ANALYZE_MODEL);
  return { analysis: results[0], costCents: Math.round(usageCost.costCents) };
}

// ---- Retrieval: similar past iterations + matching recipes ----
//
// P3 Session 1 — image-embedding fusion weights.
// Defaults: text 40%, image 60% (image signal preferred on visual tasks).
// Override via environment variables for weight-tuning experiments without
// code deploys:
//   IMAGE_EMBEDDING_TEXT_WEIGHT  (float, 0–1, default 0.4)
//   IMAGE_EMBEDDING_IMAGE_WEIGHT (float, 0–1, default 0.6)
const TEXT_WEIGHT = Number(process.env.IMAGE_EMBEDDING_TEXT_WEIGHT ?? 0.4);
const IMAGE_WEIGHT = Number(process.env.IMAGE_EMBEDDING_IMAGE_WEIGHT ?? 0.6);

// Fetch the Gemini image embedding for a prompt_lab_sessions row.
// Returns null on any error so retrieval gracefully degrades to text-only.
async function fetchSessionImageEmbedding(sessionId: string): Promise<number[] | null> {
  try {
    const { getSupabase } = await import("./client.js");
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("prompt_lab_sessions")
      .select("image_embedding")
      .eq("id", sessionId)
      .single();
    if (error || !data?.image_embedding) return null;
    const raw = data.image_embedding as unknown;
    if (Array.isArray(raw)) return raw as number[];
    if (typeof raw === "string" && (raw as string).startsWith("[")) {
      return JSON.parse(raw as string) as number[];
    }
    return null;
  } catch (err) {
    console.error("[retrieval] fetchSessionImageEmbedding failed, falling back to text-only:", err);
    return null;
  }
}

export interface RetrievedExemplar {
  id: string;
  source: "lab" | "prod" | "listing";
  room_type: string;
  camera_movement: string;
  // M.2d: SKU-level model label. RPC returns this per-branch (listing
  // iters carry it natively; legacy lab + prod rows map provider → SKU,
  // e.g. "kling" → "kling-v2-native"). Falls back to `provider` in
  // rendering when null.
  model_used: string | null;
  prompt: string;
  rating: number;
  tags: string[] | null;
  comment: string | null;
  refinement: string | null;
  provider: string | null;
  distance: number;
}

export interface RetrievedRecipe {
  id: string;
  archetype: string;
  room_type: string;
  camera_movement: string;
  provider: string | null;
  // M.2d: SKU-level model stamped on recipe at promotion time (back-filled
  // via migration 028 for historical recipes). Canonicalizes "kling" →
  // "kling-v2-native" etc.
  model_used: string | null;
  prompt_template: string;
  composition_signature: Record<string, unknown> | null;
  times_applied: number;
  distance: number;
}

export async function retrieveSimilarIterations(
  embedding: number[],
  opts: { minRating?: number; limit?: number; sessionId?: string; pipelineVersion?: string } = {}
): Promise<RetrievedExemplar[]> {
  const { getSupabase } = await import("./client.js");
  const supabase = getSupabase();
  const imageEmbedding = opts.sessionId ? await fetchSessionImageEmbedding(opts.sessionId) : null;
  const { data, error } = await supabase.rpc("match_rated_examples", {
    query_embedding: toPgVector(embedding),
    min_rating: opts.minRating ?? 4,
    match_count: opts.limit ?? 5,
    ...(imageEmbedding ? {
      query_image_embedding: toPgVector(imageEmbedding),
      text_weight: TEXT_WEIGHT,
      image_weight: IMAGE_WEIGHT,
    } : {}),
    // v1/v1.1 isolation — when provided, RPC scopes the lab+prod+listing
    // UNION to a single pipeline_version. Undefined/null = legacy unscoped.
    ...(opts.pipelineVersion ? { p_pipeline_version: opts.pipelineVersion } : {}),
  });
  if (error || !data) return [];
  return (data as Array<{
    source: "lab" | "prod" | "listing";
    example_id: string;
    rating: number;
    analysis_json: Record<string, unknown> | null;
    director_output_json: Record<string, unknown> | null;
    prompt: string | null;
    camera_movement: string | null;
    model_used: string | null;
    clip_url: string | null;
    tags: string[] | null;
    comment: string | null;
    refinement: string | null;
    distance: number;
  }>).map((r) => {
    const dir = (r.director_output_json ?? {}) as {
      camera_movement?: string;
      prompt?: string;
      provider?: string;
      provider_preference?: string;
      scene?: { camera_movement?: string; prompt?: string; provider?: string; provider_preference?: string };
    };
    const analysis = (r.analysis_json ?? {}) as { room_type?: string };
    return {
      id: r.example_id,
      source: r.source,
      room_type: analysis.room_type ?? "other",
      camera_movement:
        r.camera_movement ?? dir.scene?.camera_movement ?? dir.camera_movement ?? "unknown",
      model_used: r.model_used ?? null,
      prompt: r.prompt ?? dir.scene?.prompt ?? dir.prompt ?? "",
      rating: r.rating,
      tags: r.tags ?? null,
      comment: r.comment ?? null,
      refinement: r.refinement ?? null,
      provider:
        dir.provider_preference ??
        dir.provider ??
        dir.scene?.provider_preference ??
        dir.scene?.provider ??
        null,
      distance: r.distance,
    };
  });
}

export async function retrieveSimilarLosers(
  embedding: number[],
  opts: { maxRating?: number; limit?: number; sessionId?: string; pipelineVersion?: string } = {}
): Promise<RetrievedExemplar[]> {
  const { getSupabase } = await import("./client.js");
  const supabase = getSupabase();
  const imageEmbedding = opts.sessionId ? await fetchSessionImageEmbedding(opts.sessionId) : null;
  const { data, error } = await supabase.rpc("match_loser_examples", {
    query_embedding: toPgVector(embedding),
    max_rating: opts.maxRating ?? 2,
    match_count: opts.limit ?? 3,
    ...(imageEmbedding ? {
      query_image_embedding: toPgVector(imageEmbedding),
      text_weight: TEXT_WEIGHT,
      image_weight: IMAGE_WEIGHT,
    } : {}),
    // v1/v1.1 isolation — see retrieveSimilarIterations.
    ...(opts.pipelineVersion ? { p_pipeline_version: opts.pipelineVersion } : {}),
  });
  if (error || !data) return [];
  return (data as Array<{
    source: "lab" | "prod" | "listing";
    example_id: string;
    rating: number;
    analysis_json: Record<string, unknown>;
    director_output_json: Record<string, unknown>;
    prompt: string | null;
    camera_movement: string | null;
    model_used: string | null;
    clip_url: string | null;
    tags: string[] | null;
    comment: string | null;
    refinement: string | null;
    distance: number;
  }>).map((r) => {
    const dir = (r.director_output_json ?? {}) as {
      camera_movement?: string;
      prompt?: string;
      provider?: string;
      provider_preference?: string;
      scene?: { camera_movement?: string; prompt?: string; provider?: string; provider_preference?: string };
    };
    const analysis = (r.analysis_json ?? {}) as { room_type?: string };
    return {
      id: r.example_id,
      source: r.source,
      room_type: analysis.room_type ?? "other",
      camera_movement:
        r.camera_movement ?? dir.scene?.camera_movement ?? dir.camera_movement ?? "unknown",
      model_used: r.model_used ?? null,
      prompt: r.prompt ?? dir.scene?.prompt ?? dir.prompt ?? "",
      rating: r.rating,
      tags: r.tags ?? null,
      comment: r.comment ?? null,
      refinement: r.refinement ?? null,
      provider:
        dir.provider_preference ??
        dir.provider ??
        dir.scene?.provider_preference ??
        dir.scene?.provider ??
        null,
      distance: r.distance,
    };
  });
}

export async function retrieveMatchingRecipes(
  embedding: number[],
  roomType: string | null,
  opts: { distanceThreshold?: number; limit?: number; sessionId?: string; pipelineVersion?: string } = {}
): Promise<RetrievedRecipe[]> {
  const { getSupabase } = await import("./client.js");
  const supabase = getSupabase();
  const imageEmbedding = opts.sessionId ? await fetchSessionImageEmbedding(opts.sessionId) : null;
  const { data, error } = await supabase.rpc("match_lab_recipes", {
    query_embedding: toPgVector(embedding),
    room_type_filter: roomType,
    distance_threshold: opts.distanceThreshold ?? 0.35,
    match_count: opts.limit ?? 3,
    ...(imageEmbedding ? {
      query_image_embedding: toPgVector(imageEmbedding),
      text_weight: TEXT_WEIGHT,
      image_weight: IMAGE_WEIGHT,
    } : {}),
  });
  if (error || !data) return [];
  const results = data as RetrievedRecipe[];

  // If a pipeline version filter is requested, fetch pipeline_version for
  // each returned recipe ID and drop any that don't match. The RPC does not
  // expose pipeline_version in its result set, so a follow-up SELECT is
  // required. Uses a single IN query to minimise round-trips.
  if (opts.pipelineVersion && results.length > 0) {
    const ids = results.map((r) => r.id);
    const { data: versionRows } = await supabase
      .from("prompt_lab_recipes")
      .select("id, pipeline_version")
      .in("id", ids);
    if (versionRows) {
      const versionMap = new Map<string, string>(
        (versionRows as Array<{ id: string; pipeline_version: string }>).map(
          (r) => [r.id, r.pipeline_version]
        )
      );
      return results.filter(
        (r) => (versionMap.get(r.id) ?? "v1") === opts.pipelineVersion
      );
    }
  }

  return results;
}

export function renderExemplarBlock(exemplars: RetrievedExemplar[]): string {
  if (exemplars.length === 0) return "";
  const lines = exemplars.map((e, idx) => {
    const parts = [
      `  ${idx + 1}. [${e.rating}★ · ${e.room_type} · ${e.camera_movement} · ${e.model_used ?? e.provider ?? "?"}]`,
      `     prompt: "${e.prompt}"`,
    ];
    if (e.tags?.length) parts.push(`     tags: ${e.tags.join(", ")}`);
    if (e.comment) parts.push(`     note: ${e.comment}`);
    if (e.refinement) parts.push(`     what worked: ${e.refinement}`);
    return parts.join("\n");
  });
  return `\n\n━━━ PAST WINNERS ON STRUCTURALLY SIMILAR PHOTOS ━━━\nThese are ${exemplars.length} prior Lab iterations on photos whose analysis embedded close to this one, rated 4+ by the admin. They are evidence of what has worked on similar compositions. Bias toward their patterns unless the current photo's specifics argue otherwise.\n\n${lines.join("\n\n")}\n━━━ END PAST WINNERS ━━━`;
}

export function renderLoserBlock(losers: RetrievedExemplar[]): string {
  if (losers.length === 0) return "";
  const lines = losers.map((e, idx) => {
    const parts = [
      `  ${idx + 1}. [${e.rating}★ · ${e.room_type} · ${e.camera_movement} · ${e.model_used ?? e.provider ?? "?"}]`,
      `     prompt: "${e.prompt}"`,
    ];
    if (e.tags?.length) parts.push(`     tags: ${e.tags.join(", ")}`);
    if (e.comment) parts.push(`     why it failed: ${e.comment}`);
    if (e.refinement) parts.push(`     admin asked to change: ${e.refinement}`);
    return parts.join("\n");
  });
  const worstRating = Math.max(...losers.map((l) => l.rating));
  return `\n\n━━━ PAST LOSERS ON STRUCTURALLY SIMILAR PHOTOS ━━━\nThese are ${losers.length} prior iterations on photos that embed close to this one, rated ${worstRating}★ or worse by the admin. Do NOT mirror these patterns. Steer away from their camera_movement choice, their framing, or whatever the tags/comments indicate went wrong. If your instinct leads you toward one of these patterns, pick a different verb or different framing.\n\n${lines.join("\n\n")}\n━━━ END PAST LOSERS ━━━`;
}

function renderPreviousAttemptsBlock(attempts: Array<{ camera_movement: string; prompt: string; rating?: number | null }>): string {
  if (attempts.length === 0) return "";
  const lines = attempts.map((a, idx) =>
    `  ${idx + 1}. [${a.camera_movement}${a.rating != null ? ` · ${a.rating}★` : ""}] "${a.prompt}"`,
  );
  return `\n\n━━━ ALREADY TRIED ON THIS PHOTO — DO NOT REPEAT ━━━\nThe following prompts were already generated for this exact photo in previous iterations. They were NOT rated 5★. You MUST produce a meaningfully different camera_movement + prompt combination. Do not rephrase — pick a different verb or a different compositional target.\n\n${lines.join("\n")}\n━━━ END ALREADY TRIED ━━━`;
}

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

// ---- Run director on a single-photo input ----

export async function directSinglePhoto(
  analysis: PhotoAnalysisResult,
  photoId: string = "lab-photo",
  exemplars: RetrievedExemplar[] = [],
  recipes: RetrievedRecipe[] = [],
  losers: RetrievedExemplar[] = [],
  previousAttempts: Array<{ camera_movement: string; prompt: string; rating?: number | null }> = []
): Promise<{ scene: DirectorSceneOutput; costCents: number }> {
  const client = new Anthropic();
  const basePrompt = buildDirectorUserPrompt([
    {
      id: photoId,
      file_name: "lab-image",
      room_type: analysis.room_type,
      aesthetic_score: analysis.aesthetic_score,
      depth_rating: analysis.depth_rating,
      key_features: analysis.key_features,
      composition: analysis.composition,
      suggested_motion: analysis.suggested_motion,
      motion_rationale: analysis.motion_rationale,
    },
  ]);
  const userPrompt =
    basePrompt +
    renderExemplarBlock(exemplars) +
    renderLoserBlock(losers) +
    renderPreviousAttemptsBlock(previousAttempts) +
    renderRecipeBlock(recipes);
  const { body: directorSystem } = await resolveDirectorSystem();
  const DIRECT_MODEL = "claude-sonnet-4-6";
  const response = await client.messages.create({
    model: DIRECT_MODEL,
    max_tokens: 2048,
    system: directorSystem,
    messages: [{ role: "user", content: userPrompt }],
  });
  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Director returned no JSON object");
  const parsed: DirectorOutput = JSON.parse(jsonMatch[0]);
  const scene = parsed.scenes?.[0];
  if (!scene) throw new Error("Director returned no scenes");
  // Hard guard: soft guidance in DIRECTOR_SYSTEM was leaking "beyond"/"through"
  // into ~22% of prod prompts (audit 2026-04-24). Enforce the ban post-parse.
  const { cleaned, edits } = sanitizeDirectorPrompt(scene.prompt, scene.camera_movement);
  if (edits.length > 0) {
    console.warn(`[director] sanitized prompt (${photoId}): ${edits.join("; ")}`);
    scene.prompt = cleaned;
  }
  const usageCost = computeClaudeCost(response.usage as never, DIRECT_MODEL);
  return { scene, costCents: Math.round(usageCost.costCents) };
}

// ---- Refine director prompt with user feedback ----

const REFINE_SYSTEM = `You are a real estate cinematographer refining a single AI-video scene prompt based on user feedback. The user will give you:
1. The photo's analysis (room, key features, composition, depth)
2. The PREVIOUS director output (camera_movement + prompt)
3. Optional structured rating + tags
4. A free-text instruction describing what to change

Your job: produce a REVISED director scene object that addresses the feedback while following ALL the rules in the main DIRECTOR_SYSTEM prompt (cinematography-verb style, under 20 words, names specific features, valid camera_movement enum, no banned verbs, etc).

The main DIRECTOR_SYSTEM rules are authoritative. Your revision must comply with them.

Return ONLY a JSON object with the shape:
{
  "camera_movement": "<one of the 11 enum values>",
  "prompt": "<revised prompt string>",
  "duration_seconds": <3-5>,
  "rationale": "<one sentence explaining what you changed and why>"
}

No preamble, no markdown, no code fences.`;

export async function refineDirectorPrompt(params: {
  analysis: PhotoAnalysisResult;
  previousScene: DirectorSceneOutput;
  rating: number | null;
  tags: string[] | null;
  comment: string | null;
  chatInstruction: string;
  exemplars?: RetrievedExemplar[];
  losers?: RetrievedExemplar[];
  recipes?: RetrievedRecipe[];
}): Promise<{ scene: DirectorSceneOutput; rationale: string; costCents: number }> {
  const client = new Anthropic();
  const userMessage = `PHOTO ANALYSIS:
${JSON.stringify(params.analysis, null, 2)}

PREVIOUS DIRECTOR OUTPUT:
camera_movement: ${params.previousScene.camera_movement}
prompt: ${params.previousScene.prompt}

USER FEEDBACK:
${params.rating !== null ? `rating: ${params.rating}/5` : "rating: not provided"}
${params.tags?.length ? `tags: ${params.tags.join(", ")}` : ""}
${params.comment ? `comment: ${params.comment}` : ""}

REFINEMENT INSTRUCTION:
${params.chatInstruction}
${renderExemplarBlock(params.exemplars ?? [])}
${renderLoserBlock(params.losers ?? [])}
${renderRecipeBlock(params.recipes ?? [])}

Remember: the revised output must comply with the full DIRECTOR_SYSTEM rules (below for reference).

---
${(await resolveDirectorSystem()).body}`;

  const REFINE_MODEL = "claude-sonnet-4-6";
  const response = await client.messages.create({
    model: REFINE_MODEL,
    max_tokens: 1024,
    system: REFINE_SYSTEM,
    messages: [{ role: "user", content: userMessage }],
  });
  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Refiner returned no JSON object");
  const parsed = JSON.parse(jsonMatch[0]) as {
    camera_movement: CameraMovement;
    prompt: string;
    duration_seconds: number;
    rationale: string;
  };
  const { cleaned: cleanedRefinePrompt, edits: refineEdits } = sanitizeDirectorPrompt(
    parsed.prompt,
    parsed.camera_movement,
  );
  if (refineEdits.length > 0) {
    console.warn(`[refine] sanitized prompt: ${refineEdits.join("; ")}`);
  }
  const scene: DirectorSceneOutput = {
    scene_number: params.previousScene.scene_number,
    photo_id: params.previousScene.photo_id,
    room_type: params.previousScene.room_type,
    camera_movement: parsed.camera_movement,
    prompt: cleanedRefinePrompt,
    duration_seconds: parsed.duration_seconds ?? 4,
    provider_preference: null,
  };
  const usageCost = computeClaudeCost(response.usage as never, REFINE_MODEL);
  return { scene, rationale: parsed.rationale ?? "", costCents: Math.round(usageCost.costCents) };
}

// ---- Render submission (fire-and-forget) + cron finalization ----

function getProviderByName(name: "kling" | "runway"): IVideoProvider {
  return name === "kling" ? new KlingProvider() : new RunwayProvider();
}

// Kling trial plan caps concurrent jobs at 5. Leave 1 slot of slack so
// parallel submissions don't race past the limit. Override via env if the
// plan changes.
const KLING_CONCURRENCY_LIMIT = Number(process.env.KLING_CONCURRENCY_LIMIT ?? 4);

export class ProviderCapacityError extends Error {
  readonly provider: "kling" | "runway";
  readonly inFlight: number;
  readonly limit: number;
  constructor(provider: "kling" | "runway", inFlight: number, limit: number) {
    super(
      `${provider} is at capacity (${inFlight}/${limit} in flight). Try Runway or wait ~90s.`,
    );
    this.provider = provider;
    this.inFlight = inFlight;
    this.limit = limit;
  }
}

// Count Kling jobs submitted but not yet finalized across both Lab and prod.
async function countKlingInFlight(): Promise<number> {
  const { getSupabase } = await import("./client.js");
  const supabase = getSupabase();
  const [lab, prod] = await Promise.all([
    supabase
      .from("prompt_lab_iterations")
      .select("id", { count: "exact", head: true })
      .eq("provider", "kling")
      .not("provider_task_id", "is", null)
      .is("clip_url", null)
      .is("render_error", null),
    supabase
      .from("scenes")
      .select("id", { count: "exact", head: true })
      .eq("provider", "kling")
      .not("provider_task_id", "is", null)
      .is("clip_url", null),
  ]);
  return (lab.count ?? 0) + (prod.count ?? 0);
}

export async function submitLabRender(params: {
  imageUrl: string;
  scene: DirectorSceneOutput;
  roomType: RoomType;
  providerOverride?: "kling" | "runway" | null;
  endImageUrl?: string | null;
  sku?: V1AtlasSku | null;
  /** v1.1 renders use the multi-model picker (Seedance default + Kling 3 etc.).
   *  The push-in prompt override and Atlas routing only apply when the resolved
   *  SKU is specifically 'seedance-pro-pushin'. */
  pipelineVersion?: "v1" | "v1.1" | null;
  /**
   * Per-render resolution override from the UI quality dropdown. Threads
   * through to the provider's generateClip call so Atlas/Veo receives the
   * explicit resolution value. When absent, each provider uses its descriptor
   * default (Seedance: '1080p'; Kling: fixed in-model).
   */
  resolution?: string | null;
}): Promise<{
  jobId: string;
  provider: string;
  sku: V1AtlasSku;
  thompson?: ThompsonDecision;
  staticSku: V1AtlasSku;
  /** Effective resolution that was forwarded to the provider. Null when the
   *  render used a fixed-res model and no override was supplied. */
  resolutionUsed: string | null;
}> {
  let provider: IVideoProvider;
  let resolvedSku: V1AtlasSku;
  let thompson: ThompsonDecision | undefined;
  let staticSku: V1AtlasSku;

  // v1.1 Seedance push-in path — only when the resolved SKU is seedance-pro-pushin.
  // Thompson sampling does not run for Seedance (single-SKU, no exploration).
  // For other v1.1 SKUs (Kling 3, Runway, etc.), fall through to the standard
  // routing paths below.
  if (params.pipelineVersion === "v1.1" && params.sku === ("seedance-pro-pushin" as V1AtlasSku)) {
    const SEEDANCE_SKU = "seedance-pro-pushin" as V1AtlasSku;
    resolvedSku = SEEDANCE_SKU;
    staticSku = SEEDANCE_SKU;
    provider = new AtlasProvider(SEEDANCE_SKU);
    // Prompt override: strip non-push-in verbs, prepend stable preamble.
    // The stored scene.prompt is NOT mutated — render-time only.
    const overriddenPrompt = forceSeedancePushInPrompt(params.scene.prompt);
    const img = await fetch(params.imageUrl);
    if (!img.ok) throw new Error(`Failed to fetch source image: ${img.status}`);
    const sourceImage = Buffer.from(await img.arrayBuffer());
    const job = await provider.generateClip({
      sourceImage,
      sourceImageUrl: params.imageUrl,
      prompt: overriddenPrompt,
      durationSeconds: params.scene.duration_seconds >= 7 ? 10 : 5,
      aspectRatio: "16:9",
      modelOverride: SEEDANCE_SKU,
      // Thread the UI quality dropdown override (or default to descriptor's value).
      resolution: (params.resolution as GenerateClipParams["resolution"]) ?? undefined,
    });
    return { jobId: job.jobId, provider: provider.name, sku: resolvedSku, staticSku, resolutionUsed: params.resolution ?? "1080p" };
  }

  // ── Lane B: Veo 3.1 Preview path ─────────────────────────────────────────
  // Veo is a first-class IVideoProvider (not Atlas). Route direct to the
  // Gemini API when the SKU is 'veo-3-1-preview'.
  //
  // Key differences from Atlas / Seedance:
  //   - No forceSeedancePushInPrompt — Veo has its own prompt style; let the
  //     director prompt through unchanged.
  //   - No Atlas-specific overrides (modelOverride, negative_prompt, etc.).
  //   - Thompson sampling doesn't run (single-SKU, no router exploration).
  //   - Duration clamped to 8s inside VeoProvider (Veo max is 8s).
  //   - Speed-ramp is skipped in poll-lab-renders for Veo clips (4K large;
  //     ramp applied at concat time only).
  if (params.sku === ("veo-3-1-preview" as V1AtlasSku)) {
    const VEO_SKU = "veo-3-1-preview" as V1AtlasSku;
    resolvedSku = VEO_SKU;
    staticSku = VEO_SKU;
    provider = new VeoProvider();
    const veoImg = await fetch(params.imageUrl);
    if (!veoImg.ok) throw new Error(`Failed to fetch source image for Veo: ${veoImg.status}`);
    const veoSourceImage = Buffer.from(await veoImg.arrayBuffer());
    const veoJob = await provider.generateClip({
      sourceImage: veoSourceImage,
      sourceImageUrl: params.imageUrl,
      prompt: params.scene.prompt,    // no push-in wrap for Veo
      durationSeconds: params.scene.duration_seconds >= 7 ? 8 : 5,
      aspectRatio: "16:9",
      // resolution field not yet on GenerateClipParams (Lane A); VeoProvider
      // defaults to 4k. TODO: thread through once Lane A lands the field.
    });
    const veoResolutionUsed = params.resolution ?? "4k";
    return { jobId: veoJob.jobId, provider: provider.name, sku: resolvedSku, staticSku, resolutionUsed: veoResolutionUsed };
  }

  if (params.providerOverride === "kling" || params.providerOverride === "runway") {
    // Escape hatch: explicit kling/runway override bypasses Atlas routing.
    provider = getProviderByName(params.providerOverride);

    // Capacity guard: if Kling is saturated, auto-fallback.
    if (provider.name === "kling") {
      const inFlight = await countKlingInFlight();
      if (inFlight >= KLING_CONCURRENCY_LIMIT) {
        if (params.providerOverride === "kling") {
          throw new ProviderCapacityError("kling", inFlight, KLING_CONCURRENCY_LIMIT);
        }
        provider = new RunwayProvider();
      }
    }
    // Audit A C3: use a synthetic SKU marker for non-Atlas providers so that
    // iteration.model_used clearly distinguishes native-Kling from Atlas-routed
    // kling-v2-6-pro. This prevents poisoning the Thompson router's arm stats.
    // Cast: "kling-v2-native" is not in V1_ATLAS_SKUS runtime list but is safe
    // as a label-only SKU persisted to the DB (model_used is a text column).
    resolvedSku = (params.providerOverride === "kling" ? "kling-v2-native" : "runway-gen4-native") as V1AtlasSku;
    // thompson stays undefined for escape-hatch path
    staticSku = resolvedSku;
  } else if (params.endImageUrl) {
    // Paired scene: DEFAULT is kling-v3-pro via Atlas (end_image support;
    // upgraded from kling-v2-1-pair 2026-06-10). An EXPLICIT 'seedance-pair'
    // SKU choice is honoured (opt-in Seedance 2.0 pair mode, last_image end
    // frame, scene's own prompt — no push-in preamble). Any other requested
    // SKU still coerces to kling-v3-pro.
    // Thompson does not run on paired scenes per P5 design.
    const pairedSku = params.sku === ("seedance-pair" as V1AtlasSku) ? "seedance-pair" : "kling-v3-pro";
    resolvedSku = pairedSku as unknown as V1AtlasSku;
    provider = new AtlasProvider(pairedSku);
    // thompson stays undefined; staticSku equals the paired SKU itself.
    staticSku = resolvedSku;
  } else {
    // Non-paired scene: resolve SKU via async router (Thompson-aware).
    const resolved = await resolveDecisionAsync({
      roomType: params.roomType,
      movement: params.scene.camera_movement,
      skuOverride: params.sku ?? null,
    });
    resolvedSku = resolved.decision.modelKey as V1AtlasSku;
    thompson = resolved.thompson;
    staticSku = resolved.staticSku;
    provider = new AtlasProvider(resolvedSku);
  }

  // Keep the Buffer path as a fallback for providers that don't accept URLs,
  // but pass the URL so Runway/Kling can skip base64 (which caps at 5MB).
  const img = await fetch(params.imageUrl);
  if (!img.ok) throw new Error(`Failed to fetch source image: ${img.status}`);
  const sourceImage = Buffer.from(await img.arrayBuffer());
  const job = await provider.generateClip({
    sourceImage,
    sourceImageUrl: params.imageUrl,
    prompt: params.scene.prompt,
    durationSeconds: params.scene.duration_seconds >= 7 ? 10 : 5,
    aspectRatio: "16:9",
    endImageUrl: params.endImageUrl ?? undefined,
    // Thread the UI quality dropdown override through to the provider body.
    resolution: (params.resolution as GenerateClipParams["resolution"]) ?? undefined,
  });
  return { jobId: job.jobId, provider: provider.name, sku: resolvedSku, thompson, staticSku, resolutionUsed: params.resolution ?? null };
}

export async function finalizeLabRender(params: {
  iterationId: string;
  sessionId: string;
  provider: "kling" | "runway" | "atlas" | "veo";
  providerTaskId: string;
}): Promise<{ done: boolean; clipUrl?: string; costCents?: number; error?: string }> {
  // Atlas finalization uses AtlasProvider; Veo uses VeoProvider; legacy
  // kling/runway use the named-provider helper.
  const providerImpl: IVideoProvider =
    params.provider === "atlas"
      ? new AtlasProvider()
      : params.provider === "veo"
        ? new VeoProvider()
        : getProviderByName(params.provider as "kling" | "runway");

  const result = await providerImpl.checkStatus(params.providerTaskId);
  if (result.status === "processing") return { done: false };
  if (result.status === "failed" || !result.videoUrl) {
    return { done: true, error: result.error ?? "render failed" };
  }

  // Persist the clip to Bunny Stream (provider CDNs expire; Bunny is cheaper
  // than Supabase Storage for video delivery and adds HLS adaptive streaming).
  // Falls back to the provider URL on any Bunny failure so delivery is never
  // blocked (zero human-in-the-loop requirement).
  let persistedUrl = result.videoUrl;
  const rehostPath = `prompt-lab/${params.sessionId}/${params.iterationId}.mp4`;
  try {
    const buffer = await providerImpl.downloadClip(result.videoUrl);
    if (isBunnyConfigured()) {
      const bunnyResult = await hostVideoOnBunny(rehostPath, buffer);
      // HEAD-validate before persisting — sends the Referer header required by
      // Bunny library 679131's referrer allow-listing (server-side fetches have
      // no Referer by default → 403). bunny_hosted reflects the actual result.
      const mp4Valid = await validateBunnyMp4Url(bunnyResult.mp4Url);
      if (mp4Valid) {
        persistedUrl = bunnyResult.mp4Url;
      } else {
        console.warn(`[finalizeLabRender] bunny mp4Url HEAD failed for ${rehostPath} — keeping provider URL`);
        deleteBunnyVideo(bunnyResult.guid).catch(() => {});
      }
      // Record Bunny hosting cost (even when cost rounds to 0¢).
      recordCostEvent({
        propertyId: null,
        sceneId: null,
        stage: "generation",
        provider: "bunny",
        unitsConsumed: 1,
        unitType: "renders",
        costCents: bunnyStreamCostCents(buffer.byteLength),
        metadata: { bunny_hosted: mp4Valid, path: rehostPath, source: "prompt_lab" },
      }).catch((err) =>
        console.error("[finalizeLabRender] bunny cost_event insert failed (non-fatal):", err),
      );
    }
  } catch { /* fall back to provider URL on any failure */ }

  const computedCostCents = Math.round(result.costCents ?? 0);

  // Emit a cost_events row for every completed Lab render. property_id is
  // null when the session isn't tied to a real property (Lab work is the
  // common case here).
  try {
    const { getSupabase: getSupabaseForCost } = await import("./client.js");
    const supabaseCost = getSupabaseForCost();
    // Look up the iteration to get session.property_id and model_used.
    const { data: iteration } = await supabaseCost
      .from("prompt_lab_iterations")
      .select("model_used, session_id")
      .eq("id", params.iterationId)
      .maybeSingle();
    const { data: session } = await supabaseCost
      .from("prompt_lab_sessions")
      .select("property_id")
      .eq("id", params.sessionId)
      .maybeSingle();

    // Audit A C3: use the actual provider from params — not hard-coded "atlas".
    // Native Kling + Runway renders must not land on the books as Atlas spend.
    await recordCostEvent({
      propertyId: (session?.property_id as string | null | undefined) ?? null,
      sceneId: null,
      stage: "generation",
      provider: params.provider ?? "atlas",
      unitsConsumed: 1,
      unitType: "renders",
      costCents: computedCostCents,
      metadata: {
        sku: (iteration?.model_used as string | null) ?? "unknown",
        surface: "lab",
        iteration_id: params.iterationId,
        session_id: params.sessionId,
      },
    });
  } catch (costErr) {
    console.error("[finalizeLabRender] cost_events insert failed (non-fatal):", costErr);
  }

  // Judging is handled by /api/cron/poll-judge on a separate minute-tick so
  // it can't be killed by Vercel terminating this request. A detached IIFE
  // used to live here; 64% of clips silently never got judged because the
  // cron's HTTP response returned before the ~21s Gemini call finished. See
  // git log for the 2026-04-24 fix.

  return {
    done: true,
    clipUrl: persistedUrl,
    costCents: computedCostCents,
  };
}

// ---- Session + iteration DB helpers ----

/**
 * Auto-promote a rated iteration to the recipe pool if it's a 4★ or 5★.
 * Called by BOTH /api/admin/prompt-lab/rate and /api/admin/prompt-lab/refine
 * so the recipe pool grows regardless of which button the operator uses.
 *
 * - 5★ → primary recipe (normal archetype prefix)
 * - 4★ → backup recipe ("backup_" archetype prefix, still retrievable)
 * - <4 → no-op
 *
 * Returns null when nothing was promoted (rating < 4, missing data, or
 * duplicate suppression upstream). Never throws — failure is logged and
 * silently swallowed so the caller's feedback write still completes.
 */
export async function autoPromoteIfWinning(params: {
  iterationRow: {
    id: string;
    analysis_json: PhotoAnalysisResult | null;
    director_output_json: DirectorSceneOutput | null;
    embedding: unknown;
    provider: string | null;
    /** pipeline_version from the iteration row. Defaults to 'v1' when absent
     *  (pre-migration-063 callers or callers that haven't been updated yet). */
    pipeline_version?: string | null;
  };
  rating: number;
  promotedBy: string;
}): Promise<{ id: string; archetype: string; tier: "primary" | "backup" } | null> {
  const { iterationRow, rating, promotedBy } = params;
  if (rating < 4 || !iterationRow.analysis_json || !iterationRow.director_output_json) return null;

  const supabase = getSupabase();
  const tier: "primary" | "backup" = rating === 5 ? "primary" : "backup";
  const analysis = iterationRow.analysis_json;
  const director = iterationRow.director_output_json;

  let vec: number[] | null = null;
  if (Array.isArray(iterationRow.embedding)) vec = iterationRow.embedding as number[];
  else if (typeof iterationRow.embedding === "string" && iterationRow.embedding.startsWith("[")) {
    try { vec = JSON.parse(iterationRow.embedding) as number[]; } catch { /* no-op */ }
  }
  if (!vec) {
    const embedded = await embedTextSafe(
      buildAnalysisText({
        roomType: analysis.room_type,
        keyFeatures: analysis.key_features ?? [],
        composition: analysis.composition,
        suggestedMotion: analysis.suggested_motion,
        cameraMovement: director.camera_movement,
      }),
    );
    if (embedded) {
      vec = embedded.vector;
      const { error: costErr } = await supabase.from("cost_events").insert({
        property_id: null,
        scene_id: null,
        stage: "embedding",
        provider: "openai",
        units_consumed: embedded.usage.totalTokens,
        unit_type: "tokens",
        cost_cents: Math.round(embedded.usage.costCents),
        metadata: {
          scope: "lab_auto_promote_embedding",
          model: embedded.model,
          tokens: embedded.usage.totalTokens,
          iteration_id: iterationRow.id,
        },
      });
      if (costErr) console.error("[embeddings] cost_events insert failed:", costErr);
    }
  }

  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const slug = Math.random().toString(36).slice(2, 6);
  const prefix = tier === "backup" ? "backup_" : "";
  const archetype = `${prefix}${analysis.room_type}_${director.camera_movement}_${stamp}_${slug}`;
  // Inherit pipeline_version from the source iteration. Default to 'v1' for
  // backward compat with pre-migration-063 callers that don't yet supply this field.
  const pipelineVersion = iterationRow.pipeline_version ?? "v1";
  try {
    const { data: recipe } = await supabase
      .from("prompt_lab_recipes")
      .insert({
        archetype,
        room_type: analysis.room_type,
        camera_movement: director.camera_movement,
        provider: iterationRow.provider,
        prompt_template: director.prompt,
        source_iteration_id: iterationRow.id,
        rating_at_promotion: rating,
        promoted_by: promotedBy,
        embedding: vec ? toPgVector(vec) : null,
        pipeline_version: pipelineVersion,
      })
      .select("id, archetype")
      .single();
    if (recipe) return { id: recipe.id as string, archetype: recipe.archetype as string, tier };
  } catch (err) {
    console.error("[auto-promote] failed:", err);
  }
  return null;
}

export async function getNextIterationNumber(sessionId: string): Promise<number> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("prompt_lab_iterations")
    .select("iteration_number")
    .eq("session_id", sessionId)
    .order("iteration_number", { ascending: false })
    .limit(1);
  const last = data?.[0]?.iteration_number ?? 0;
  return last + 1;
}

// ─── Qualitative model feedback retrieval (migration 070) ─────────────────────
//
// Returns recent feedback rows for a given model + pipeline_version combo.
// Used by the director context (per-photo-retrieval.ts) to surface operator
// notes alongside structured rating signal.
//
// MVP: most-recent N by created_at. Vector search is a v2 nice-to-have —
// when `embedding` is provided and a future RPC is wired up, swap the body
// to a cosine similarity query here. For now, the embedding parameter is
// accepted but not used (kept for API stability).
//
// Version isolation is strict: v1 feedback is NEVER shown under v1.1 and
// vice versa. Enforced by the `.eq("pipeline_version", opts.pipelineVersion)` filter.

export async function retrieveRecentModelFeedback(
  modelUsed: string,
  opts: { pipelineVersion: string; limit?: number; embedding?: number[] }
): Promise<Array<{ comment: string; created_at: string }>> {
  // Note: `opts.embedding` is accepted for future vector-search use but the
  // MVP implementation ignores it in favour of date-ordered retrieval.
  const { getSupabase } = await import("./client.js");
  const supabase = getSupabase();
  const limit = opts.limit ?? 5;

  const { data, error } = await supabase
    .from("prompt_lab_model_feedback")
    .select("comment, created_at")
    .eq("model_used", modelUsed)
    .eq("pipeline_version", opts.pipelineVersion)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return (data as Array<{ comment: string; created_at: string }>).map((r) => ({
    comment: r.comment,
    created_at: r.created_at,
  }));
}
