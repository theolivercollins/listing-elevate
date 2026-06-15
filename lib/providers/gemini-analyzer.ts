// DA.1 — Gemini "eyes" for the director.
//
// Replaces Claude Sonnet 4.6 as the per-photo analyzer. Adds structured
// camera-state fields (camera_height, camera_tilt, frame_coverage, and the
// motion_headroom booleans) so the downstream director (still Claude; the
// "brain") can only pick camera movements that are geometrically possible
// from the source frame. This is the fix for the hallucinated_geometry /
// hallucinated_objects failures that Oliver diagnosed on listing
// 5dfd9008 — top_down planned from already-aerial photos, orbit planned
// from exteriors with no visible back-of-house, etc.
//
// Contract: single-image call. Returns ExtendedPhotoAnalysis + token usage
// + model id. Callers own cost_events writes (consistent with CI.2). On
// error, throws GeminiAnalysisError with the cause so callers can fall
// back to Claude.

import { GoogleGenAI, Type } from "@google/genai";
import type { RoomType, DepthRating, CameraMovement } from "../db.js";

// ─── Types ──────────────────────────────────────────────────────────────

export type CameraHeight = "aerial" | "elevated" | "eye_level" | "low" | "overhead";
export type CameraTilt = "level" | "slight" | "dutch" | "up" | "down";
export type FrameCoverage = "wide_establishing" | "medium" | "close" | "immersive";

export interface MotionHeadroom {
  push_in: boolean;
  pull_out: boolean;
  orbit: boolean;
  parallax: boolean;
  drone_push_in: boolean;
  top_down: boolean;
}

export interface ExtendedPhotoAnalysis {
  // Existing fields (kept 1:1 with PhotoAnalysisResult so downstream code —
  // buildDirectorUserPrompt, updatePhotoAnalysis, retrieval text — keeps
  // working without a schema migration).
  room_type: RoomType;
  quality_score: number;
  aesthetic_score: number;
  depth_rating: DepthRating;
  key_features: string[];
  composition: string;
  suggested_discard: boolean;
  discard_reason: string | null;
  video_viable: boolean;
  suggested_motion: CameraMovement | null;
  motion_rationale: string | null;

  // DA.1 additions — structured camera state + per-motion geometric
  // feasibility. The director consumes motion_headroom as HARD BANS on
  // camera_movement choices (see DIRECTOR_SYSTEM).
  camera_height: CameraHeight;
  camera_tilt: CameraTilt;
  frame_coverage: FrameCoverage;
  motion_headroom: MotionHeadroom;
  motion_headroom_rationale: Record<string, string>;
}

export interface GeminiAnalysisResult {
  analysis: ExtendedPhotoAnalysis;
  usage: {
    inputTokens: number;
    outputTokens: number;
    /**
     * Fractional cents. Callers that write to `cost_events.cost_cents`
     * (integer column) should Math.round() at write time.
     */
    costCents: number;
  };
  model: string;
}

export class GeminiAnalysisError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "GeminiAnalysisError";
    this.cause = cause;
  }
}

// ─── Pricing (cents per 1M tokens) ──────────────────────────────────────
//
// Gemini 3 Flash public pricing at the time of DA.1 (2026-04-21):
//   input:  $0.50 / 1M tokens = 50¢/MTok
//   output: $3.00 / 1M tokens = 300¢/MTok
//
// Fallback (gemini-2.5-flash) uses the same table; the pricing pages
// list 2.5 Flash at identical rates for single-turn use, and we accept
// small drift here — the dollar impact per listing is < $0.01. If the
// rates diverge, add a per-model entry and re-pick in computeGeminiCost.

const GEMINI_PRICING_CENTS_PER_MTOK: Record<string, { input: number; output: number }> = {
  "gemini-3-flash-preview": { input: 50, output: 300 },
  "gemini-3-flash": { input: 50, output: 300 },
  "gemini-2.5-flash": { input: 50, output: 300 },
};

function computeGeminiCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates =
    GEMINI_PRICING_CENTS_PER_MTOK[model] ??
    GEMINI_PRICING_CENTS_PER_MTOK["gemini-3-flash-preview"];
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

// ─── Model selection ────────────────────────────────────────────────────
//
// Primary: gemini-3-flash-preview (Gemini 3 Flash, exposed under this id
// in SDK v1.50 — no stable "gemini-3-flash" alias yet).
// Fallback: gemini-2.5-flash. Callers do not need to override; the caller
// sees the final model id in GeminiAnalysisResult.model so cost_events
// can record which one ran.

const PRIMARY_MODEL = "gemini-3-flash-preview";
const FALLBACK_MODEL = "gemini-2.5-flash";

// ─── System prompt ──────────────────────────────────────────────────────

const GEMINI_ANALYZER_SYSTEM = `You are analyzing a real estate listing photo for a video automation pipeline. Return JSON matching the provided schema exactly — no extra keys, no markdown, no explanation prose.

Your job is to describe what the CAMERA would be able to do from this source frame, not just what's in the photo.

Key rules for motion_headroom (true = that camera movement is geometrically possible without the downstream video model having to invent off-frame geometry):

- push_in: TRUE only if there is clear foreground space the camera could move through toward a defined subject. FALSE for already-close or immersive shots, or shots where the "forward" direction is blocked or undefined.
- pull_out: TRUE only if the frame implies there is unseen space BEHIND the camera (e.g. the subject is clearly framed and the "zoom out" would reveal adjacent architecture consistent with the scene). FALSE for close detail shots where pulling out would reveal nothing visible or plausible.
- orbit: TRUE only if the subject is visibly isolated enough that rotating 90° around it would still show coherent geometry (e.g. a hero kitchen island surrounded by clear space, or a clearly-freestanding exterior). FALSE for dense interior shots where orbit would crash into walls, or exteriors where "the other side" of the house is not inferable.
- parallax: TRUE only if there is a clear foreground OBJECT to glide past (a lounge chair, a planter, a column, a counter corner). FALSE if the frame is a flat composition with no foreground depth object.
- drone_push_in: TRUE only for aerial or elevated exterior shots with visible forward ground/canopy clearance and a distinct destination in frame. FALSE for shots already at target altitude, ground-level shots, or shots with obstacles in the forward path.
- top_down: TRUE only when the shot is NOT already top-down AND the camera could plausibly rise further without the frame becoming meaningless. FALSE for shots already at top-down or overhead angles.

For each motion_headroom field, put a one-sentence rationale in motion_headroom_rationale (keys: push_in, pull_out, orbit, parallax, drone_push_in, top_down).

camera_height:
- aerial: shot from above rooftop level
- elevated: shot from above eye-level but not aerial (stairs, drone low, slight height)
- eye_level: ~5-6ft tripod height, standard real-estate default
- low: shot from below eye level
- overhead: shot looking straight down

camera_tilt:
- level: horizon horizontal
- slight: small up/down tilt for effect
- dutch: noticeable diagonal roll
- up: camera points up (ceiling shot)
- down: camera points down (floor shot)

frame_coverage:
- wide_establishing: captures the whole space
- medium: portion of the space, context retained
- close: detail of one feature, most of the room out of frame
- immersive: feels "inside" the subject (e.g. nose-to-couch)

Other fields follow existing real-estate conventions:
- room_type: one of kitchen, living_room, master_bedroom, bedroom, bathroom, exterior_front, exterior_back, pool, aerial, dining, hallway, garage, foyer, office, laundry, closet, basement, deck, powder_room, stairs, media_room, gym, mudroom, lanai, other
- quality_score (1-10): technical quality — sharpness, exposure, staging
- aesthetic_score (1-10): how pretty the STILL photo is
- depth_rating: low | medium | high
- key_features: 3-6 SPECIFIC named features visible in this photo (not "granite island" — "dark espresso waterfall island with three bronze pendants overhead")
- composition: 1-2 sentence description of spatial layout (foreground/midground/background, leading lines)
- suggested_discard: true if photo is unusable overall (too dark/blurry/people/duplicate)
- discard_reason: short string if suggested_discard=true, else null
- video_viable: true iff usable as STARTING FRAME for i2v. FALSE for doorway traps, camera-trapped-behind-sink, fisheye, warping mirrors, head-on static vignettes with no motion path.
- suggested_motion: one of push_in, orbit, parallax, dolly_left_to_right, dolly_right_to_left, reveal, drone_push_in, top_down, low_angle_glide, feature_closeup, rack_focus — or null if not video_viable. MUST correspond to a motion_headroom value that is true. If suggested_motion would be push_in but motion_headroom.push_in is false, pick a different in-headroom motion or leave suggested_motion null.
- motion_rationale: one short sentence (under 15 words) explaining why the motion fits, naming a specific feature.

HERO SUBJECT — HARD RULE: the camera's target (the thing motion_rationale ends on) must be a piece of FURNITURE or ARCHITECTURE at human eye level — a sectional, bed, island, vanity, tub, fireplace, staircase, facade, entry door, pool, or similar. CEILINGS, ceiling fans, chandeliers, beams, HVAC, floors, rugs, and art on upper walls are ATMOSPHERIC context only — they are NEVER the subject of the motion. low_angle_glide is a camera position (near-floor) aimed at an eye-level hero; the high ceiling APPEARS taller as a side effect but is never what the camera ends on. If the only striking thing in the photo is a ceiling feature, set video_viable=false rather than invent a motion that targets the ceiling.

NEVER emit pull_out, drone_pull_back, slow_pan, orbital_slow, tilt_up, tilt_down, crane_up, or crane_down in suggested_motion — all removed from the vocabulary.`;

// ─── Response schema ────────────────────────────────────────────────────
//
// We use responseSchema (not responseJsonSchema) because it's the first-
// class path for Gemini structured output and it's supported on both
// gemini-3-flash-preview and the 2.5 fallback. Schema must be ORDERED —
// property order in the schema = property order the model emits, which
// can affect chain-of-thought quality. We put the new camera-state fields
// near the end so the model analyzes the room content first.

function buildResponseSchema() {
  return {
    type: Type.OBJECT,
    required: [
      "room_type",
      "quality_score",
      "aesthetic_score",
      "depth_rating",
      "key_features",
      "composition",
      "suggested_discard",
      "discard_reason",
      "video_viable",
      "suggested_motion",
      "motion_rationale",
      "camera_height",
      "camera_tilt",
      "frame_coverage",
      "motion_headroom",
      "motion_headroom_rationale",
    ],
    properties: {
      room_type: { type: Type.STRING },
      quality_score: { type: Type.NUMBER },
      aesthetic_score: { type: Type.NUMBER },
      depth_rating: { type: Type.STRING, enum: ["low", "medium", "high"] },
      key_features: { type: Type.ARRAY, items: { type: Type.STRING } },
      composition: { type: Type.STRING },
      suggested_discard: { type: Type.BOOLEAN },
      discard_reason: { type: Type.STRING, nullable: true },
      video_viable: { type: Type.BOOLEAN },
      suggested_motion: { type: Type.STRING, nullable: true },
      motion_rationale: { type: Type.STRING, nullable: true },
      camera_height: {
        type: Type.STRING,
        enum: ["aerial", "elevated", "eye_level", "low", "overhead"],
      },
      camera_tilt: {
        type: Type.STRING,
        enum: ["level", "slight", "dutch", "up", "down"],
      },
      frame_coverage: {
        type: Type.STRING,
        enum: ["wide_establishing", "medium", "close", "immersive"],
      },
      motion_headroom: {
        type: Type.OBJECT,
        required: ["push_in", "pull_out", "orbit", "parallax", "drone_push_in", "top_down"],
        properties: {
          push_in: { type: Type.BOOLEAN },
          pull_out: { type: Type.BOOLEAN },
          orbit: { type: Type.BOOLEAN },
          parallax: { type: Type.BOOLEAN },
          drone_push_in: { type: Type.BOOLEAN },
          top_down: { type: Type.BOOLEAN },
        },
      },
      motion_headroom_rationale: {
        type: Type.OBJECT,
        required: ["push_in", "pull_out", "orbit", "parallax", "drone_push_in", "top_down"],
        properties: {
          push_in: { type: Type.STRING },
          pull_out: { type: Type.STRING },
          orbit: { type: Type.STRING },
          parallax: { type: Type.STRING },
          drone_push_in: { type: Type.STRING },
          top_down: { type: Type.STRING },
        },
      },
    },
  } as const;
}

// ─── Vertical headroom gate ──────────────────────────────────────────────
//
// drone_push_in and top_down require the camera to ALREADY be at altitude
// (aerial / elevated / overhead). For ground-level frames the video model
// would have to fabricate unseen geometry (the roof, the lot from above),
// producing hallucinated aerial clips. This gate runs on every Gemini
// result before it leaves this module.

const AERIALISH: ReadonlySet<string> = new Set(["aerial", "elevated", "overhead"]);

export function gateVerticalHeadroom<T extends {
  camera_height?: string | null;
  motion_headroom?: Partial<Record<keyof MotionHeadroom, boolean>> | null;
  motion_headroom_rationale?: Record<string, string> | null;
}>(analysis: T): T {
  if (!analysis.motion_headroom) {
    return analysis;
  }

  const height = analysis.camera_height ?? "eye_level";
  if (AERIALISH.has(height)) {
    return analysis;
  }

  // Ground-level (or unknown): force the two vertical movements off.
  const VERTICAL_KEYS = ["drone_push_in", "top_down"] as const;
  const newHeadroom: Partial<Record<keyof MotionHeadroom, boolean>> = { ...analysis.motion_headroom };
  const newRationale: Record<string, string> = { ...(analysis.motion_headroom_rationale ?? {}) };

  let changed = false;
  for (const key of VERTICAL_KEYS) {
    if (newHeadroom[key] === true) {
      newHeadroom[key] = false;
      const prev = newRationale[key] ? `${newRationale[key]} | ` : "";
      newRationale[key] =
        `${prev}gated: source camera_height='${height}' is not aerial/elevated/overhead; image-to-video cannot synthesize this viewpoint`;
      changed = true;
    }
  }

  if (!changed) {
    return analysis;
  }

  return {
    ...analysis,
    motion_headroom: newHeadroom as T["motion_headroom"],
    motion_headroom_rationale: newRationale as T["motion_headroom_rationale"],
  };
}

// ─── Public entrypoint ──────────────────────────────────────────────────

export async function analyzePhotoWithGemini(imageUrl: string): Promise<GeminiAnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiAnalysisError(
      "GEMINI_API_KEY is not set in the environment",
    );
  }

  // Gemini Developer API (non-Vertex) takes inline base64 bytes for
  // image input. fileUri is GCS-only and HTTPS URL passthrough isn't
  // available on this API surface. Fetching once adds ~200ms but the
  // photos are already small (< 2MB from Supabase storage) and this
  // keeps the code portable when we later switch to Vertex.
  let base64: string;
  let mimeType: string;
  try {
    const r = await fetch(imageUrl);
    if (!r.ok) {
      throw new Error(`fetch ${r.status} for ${imageUrl}`);
    }
    const ct = r.headers.get("content-type") ?? "image/jpeg";
    mimeType = ct.includes("png")
      ? "image/png"
      : ct.includes("webp")
        ? "image/webp"
        : ct.includes("gif")
          ? "image/gif"
          : "image/jpeg";
    const buf = Buffer.from(await r.arrayBuffer());
    base64 = buf.toString("base64");
  } catch (err) {
    throw new GeminiAnalysisError(
      `Failed to fetch image for Gemini analyzer: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  const ai = new GoogleGenAI({ apiKey });
  const schema = buildResponseSchema();

  const callOnce = async (model: string) => {
    const res = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: base64 } },
            {
              text:
                "Analyze this real estate listing photo. Return ONLY the JSON object described by the schema — no markdown, no extra keys.",
            },
          ],
        },
      ],
      config: {
        systemInstruction: GEMINI_ANALYZER_SYSTEM,
        responseMimeType: "application/json",
        responseSchema: schema as never,
        temperature: 0.2,
      },
    });
    return res;
  };

  let res;
  let model = PRIMARY_MODEL;
  try {
    res = await callOnce(PRIMARY_MODEL);
  } catch (err) {
    // If the primary model id isn't addressable on this API key (common
    // during Gemini 3 staged rollout), fall back once to the 2.5 model.
    const msg = err instanceof Error ? err.message : String(err);
    const looksLikeModelNotFound =
      /not\s*found|not\s*supported|does\s*not\s*exist|invalid.*model|404/i.test(msg);
    if (!looksLikeModelNotFound) {
      throw new GeminiAnalysisError(`Gemini call failed on ${PRIMARY_MODEL}: ${msg}`, err);
    }
    console.warn(
      `[gemini-analyzer] ${PRIMARY_MODEL} not addressable (${msg}); retrying on ${FALLBACK_MODEL}`,
    );
    try {
      res = await callOnce(FALLBACK_MODEL);
      model = FALLBACK_MODEL;
    } catch (err2) {
      throw new GeminiAnalysisError(
        `Gemini call failed on both ${PRIMARY_MODEL} and ${FALLBACK_MODEL}: ${err2 instanceof Error ? err2.message : String(err2)}`,
        err2,
      );
    }
  }

  const text = res.text ?? "";
  if (!text) {
    throw new GeminiAnalysisError(
      `Gemini returned no text (finishReason=${res.candidates?.[0]?.finishReason ?? "unknown"})`,
    );
  }

  let parsed: ExtendedPhotoAnalysis;
  try {
    // Gemini sometimes wraps JSON in ```json fences despite
    // responseMimeType=application/json; strip if present.
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
    parsed = JSON.parse(cleaned) as ExtendedPhotoAnalysis;
  } catch (err) {
    throw new GeminiAnalysisError(
      `Gemini returned non-JSON: ${text.slice(0, 200)}`,
      err,
    );
  }

  // Defense-in-depth: if a required field is missing, supply a permissive
  // default rather than throwing — the director's validator will still
  // catch headroom violations later.
  parsed.motion_headroom = parsed.motion_headroom ?? {
    push_in: true,
    pull_out: true,
    orbit: true,
    parallax: true,
    drone_push_in: true,
    top_down: true,
  };
  parsed.motion_headroom_rationale = parsed.motion_headroom_rationale ?? {};
  parsed.camera_height = parsed.camera_height ?? "eye_level";
  parsed.camera_tilt = parsed.camera_tilt ?? "level";
  parsed.frame_coverage = parsed.frame_coverage ?? "medium";

  // Apply vertical headroom gate: drone_push_in and top_down must be false
  // unless the photo is already aerial/elevated/overhead.
  const gated = gateVerticalHeadroom(parsed);

  const usageMeta = res.usageMetadata;
  const inputTokens = usageMeta?.promptTokenCount ?? 0;
  const outputTokens = usageMeta?.candidatesTokenCount ?? 0;
  const costCents = computeGeminiCost(model, inputTokens, outputTokens);

  return {
    analysis: gated,
    usage: { inputTokens, outputTokens, costCents },
    model,
  };
}
