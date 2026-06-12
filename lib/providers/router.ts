import type { RoomType, VideoProvider, CameraMovement } from "../db.js";
import type { PipelineMode } from "../types.js";
import type { IVideoProvider } from "./provider.interface.js";
import { AtlasProvider } from "./atlas.js";
import { KlingProvider } from "./kling.js";
import { RunwayProvider } from "./runway.js";
import { VeoProvider } from "./veo.js";
import { V1_ATLAS_SKUS, V1_DEFAULT_SKU, type V1AtlasSku } from "./atlas.js";
import { pickArm, type ThompsonDecision, type BucketArms } from "./thompson-router.js";

export { V1_ATLAS_SKUS, V1_DEFAULT_SKU };
export type { V1AtlasSku };

// ─── V1 RESOLVE DECISION (LAB / SINGLE-IMAGE) ────────────────────────────────

export interface ResolveDecisionInput {
  roomType: string;
  movement: string | null;
  skuOverride?: V1AtlasSku | null;
}

/**
 * resolveDecision — returns a ProviderDecision for a non-paired Lab scene
 * with an explicit Atlas SKU.
 *
 * - If `skuOverride` is provided and is a member of `V1_ATLAS_SKUS`, it is
 *   used as the modelKey.
 * - Otherwise (null, undefined, or an invalid/excluded SKU such as
 *   kling-v3-pro or kling-v2-1-pair), falls back to `V1_DEFAULT_SKU`.
 *
 * This function is the P1 deliverable for SKU-aware routing. It does NOT
 * handle paired-scene routing — use `selectProviderForScene()` for that.
 */
export function resolveDecision(input: ResolveDecisionInput): ProviderDecision {
  const override = input.skuOverride;
  const skuIsValid =
    override != null &&
    (V1_ATLAS_SKUS as readonly string[]).includes(override);
  const sku: V1AtlasSku = skuIsValid ? override : V1_DEFAULT_SKU;

  return {
    provider: "atlas",
    modelKey: sku,
    fallback: undefined,
  };
}

// ─── PROVIDER DECISION SHAPE ─────────────────────────────────────────────────
//
// Phase C.1: ProviderDecision is the structured routing result used by
// pipeline.ts and the resubmit / retry endpoints. It carries enough
// information to instantiate the provider AND pass the correct model
// override (e.g. "kling-v3-pro" for paired scenes).
//
// provider:  which backend to call
// modelKey:  for "atlas" routes — which Atlas SKU (e.g. "kling-v3-pro").
//            When absent, AtlasProvider uses the ATLAS_VIDEO_MODEL env var.
// fallback:  next decision to try if the primary errors with shouldFailover=true.
//
// Callers that only need an IVideoProvider instance can call
// buildProviderFromDecision(decision) to get one.
//
// BACKWARD COMPAT: selectProvider() still returns IVideoProvider for callers
// (prompt-lab.ts, poll-scenes.ts) that were written before this shape existed.
// New pipeline code uses selectDecision() + selectProviderForScene() which
// return ProviderDecision.

export interface ProviderDecision {
  provider: VideoProvider;            // "atlas" | "kling" | "runway" | "higgsfield"
  modelKey?: string;                   // atlas SKU key; undefined → use env default
  fallback?: ProviderDecision;
}

// ─── PRODUCTION ROUTING TABLE ────────────────────────────────────────────────
//
// Lab-parity routing: production picks the SAME SKU Prompt Lab uses by default
// (Atlas kling-v2-6-pro = V1_DEFAULT_SKU). Native Kling and Runway are kept as
// movement-specific failovers, not primaries. This closes the quality gap
// between Lab iterations and customer renders that surfaced on the 13fe5a96
// rerun (2026-05-18) — native Kling v2 looked visibly worse than the Lab-
// rendered iterations Oliver had been reviewing.
//
// Priority rules:
//
//   1. PAIRED SCENES (end_photo_id set): atlas + kling-v3-pro. Short-
//      circuits in selectProviderForScene() before movement is consulted.
//
//   2. ALL OTHER SCENES: atlas + kling-v2-6-pro (Lab default). Failover
//      branches by movement:
//        - drone / exterior (RUNWAY_MOVEMENTS) → Runway gen4_turbo
//        - interior (INTERIOR_MOVEMENTS) → native Kling (free pre-paid credits)
//        - unknown / null → no failover
//
// Failover only fires on a permanent Atlas error in the current attempt; see
// runGenerationSubmit's `excluded` tracking.

// Interior movements: Atlas primary, native Kling failover.
const INTERIOR_MOVEMENTS: ReadonlySet<CameraMovement> = new Set([
  "push_in",
  "orbit",
  "parallax",
  "dolly_left_to_right",
  "dolly_right_to_left",
  "reveal",
  "low_angle_glide",
  "rack_focus",
]);

// Drone / exterior / closeup movements: Atlas primary, Runway failover.
const RUNWAY_MOVEMENTS: ReadonlySet<CameraMovement> = new Set([
  "drone_push_in",
  "top_down",
  "feature_closeup",
]);

// Lab-parity primary decision — Atlas + V1_DEFAULT_SKU, used as the bottom of
// every fallback chain (last resort when everything else is excluded).
const LAB_PARITY_PRIMARY: ProviderDecision = {
  provider: "atlas",
  modelKey: V1_DEFAULT_SKU,
  fallback: undefined, // terminal
};

// ─── INTERNAL MOVEMENT-BASED DECISION FUNCTION ──────────────────────────────

/**
 * Core movement-based routing logic for production pipeline scenes.
 * Returns a ProviderDecision for an unpaired scene.
 * Does NOT handle the paired-scene rule — use selectProviderForScene() for that.
 * Does NOT set a V1 Atlas SKU — use resolveDecision() for Lab/V1 renders.
 */
function resolveMovementDecision(
  _roomType: RoomType,
  movement: CameraMovement | null,
  preference: VideoProvider | null,
  excluded: VideoProvider[],
): ProviderDecision {
  // Scene-level preference honours admin overrides and Lab provider picks
  // without routing through the table.
  if (preference && !excluded.includes(preference)) {
    return {
      provider: preference,
      fallback: excluded.length === 0 ? LAB_PARITY_PRIMARY : undefined,
    };
  }

  // Compute the movement-specific failover (Runway for drone niche, native
  // Kling for interior efficiency). Skipped if that provider already failed
  // this attempt or there's no natural failover for the movement.
  const drone = !!movement && RUNWAY_MOVEMENTS.has(movement);
  const interior = !!movement && INTERIOR_MOVEMENTS.has(movement);
  let movementFailover: ProviderDecision | undefined;
  if (drone && !excluded.includes("runway")) {
    movementFailover = { provider: "runway", fallback: undefined };
  } else if (interior && !excluded.includes("kling")) {
    movementFailover = { provider: "kling", fallback: undefined };
  }

  // Lab parity: Atlas kling-v2-6-pro primary for everything.
  if (!excluded.includes("atlas")) {
    return {
      provider: "atlas",
      modelKey: V1_DEFAULT_SKU,
      fallback: movementFailover,
    };
  }

  // Atlas already failed this attempt — fall through to movement-specific
  // provider as primary, or last-resort Atlas if no failover is available.
  return movementFailover ?? LAB_PARITY_PRIMARY;
}

// ─── PROVIDER INSTANTIATION ─────────────────────────────────────────────────
//
// Converts a ProviderDecision into an IVideoProvider instance.
// modelKey is NOT injected into the provider constructor — instead it is
// forwarded via GenerateClipParams.modelOverride at call time. AtlasProvider
// already handles modelOverride via its resolveModel() method.

export function buildProviderFromDecision(decision: ProviderDecision): IVideoProvider {
  switch (decision.provider) {
    case "atlas":
      return new AtlasProvider();
    case "kling":
      return new KlingProvider();
    case "runway":
      return new RunwayProvider();
    case "veo":
      // Lane B (2026-05-26): Veo 3.1 Preview — Premium 4K SKU.
      // Routes direct to the Gemini API; does NOT go through Atlas.
      return new VeoProvider();
    default:
      // higgsfield / unknown — fall back to Atlas (always available).
      return new AtlasProvider();
  }
}

// ─── PUBLIC API ──────────────────────────────────────────────────────────────

/**
 * selectDecision — returns a ProviderDecision for an unpaired scene.
 * Used by pipeline.ts, resubmit.ts, and retry.ts after Phase C.1.
 * For paired scenes use selectProviderForScene().
 */
export function selectDecision(
  roomType: RoomType,
  movement: CameraMovement | null,
  preference: VideoProvider | null,
  excluded: VideoProvider[] = [],
): ProviderDecision {
  return resolveMovementDecision(roomType, movement, preference, excluded);
}

/**
 * selectProviderForScene — routing entry point for runGenerationSubmit.
 *
 * Handles the paired-scene rule FIRST:
 * - Paired scenes (end_photo_id set) ALWAYS route to atlas + kling-v3-pro
 *   (declares endFrameField "end_image"). This mirrors DQ.3 in the Lab.
 * - Unpaired scenes fall through to the movement-based routing table.
 *
 * @param scene.endPhotoId  end_photo_id from the scene row
 * @param scene.movement    CameraMovement for the scene
 * @param scene.roomType    RoomType for the scene
 * @param scene.preference  VideoProvider preference from the scene row
 * @param excluded          Providers already tried in this submission attempt
 */
export function selectProviderForScene(
  scene: {
    endPhotoId: string | null | undefined;
    movement: CameraMovement | null;
    roomType: RoomType;
    preference: VideoProvider | null;
  },
  excluded: VideoProvider[] = [],
  mode: PipelineMode = "v1",
): ProviderDecision {
  // RULE DQ.3: Paired scenes ALWAYS use atlas + kling-v3-pro (Kling 3.0 Pro,
  // endFrameField "end_image" — upgraded from kling-v2-1-pair 2026-06-10).
  // This rule wins over pipeline_mode — v1.1 never replaces the paired path.
  // If atlas itself is excluded, fall through to the movement table
  // as best-effort (better to try something than nothing).
  if (scene.endPhotoId && !excluded.includes("atlas")) {
    return {
      provider: "atlas",
      modelKey: "kling-v3-pro",
      fallback: undefined, // terminal — no fallback preserves paired semantics
    };
  }

  // v1.1 — Seedance push-in for every non-paired scene, routed through
  // Atlas (Seedance is hosted as an Atlas SKU; no separate provider).
  // Falls back to the default V1 Atlas SKU if the Seedance render hits
  // a permanent error (e.g. capacity / model outage). Skips when atlas
  // is already excluded mid-failover — there's no other home for Seedance.
  if (mode === "v1.1" && !excluded.includes("atlas")) {
    return {
      provider: "atlas",
      modelKey: "seedance-pro-pushin",
      fallback: {
        provider: "atlas",
        modelKey: V1_DEFAULT_SKU,
        fallback: undefined,
      },
    };
  }

  return resolveMovementDecision(scene.roomType, scene.movement, scene.preference, excluded);
}

// ─── SEEDANCE PROMPT NORMALIZATION ───────────────────────────────────────────
//
// Seedance under v1.1 only ever does push-in. The scene's stored prompt may
// contain orbit/parallax/tilt language carried over from the v1 prompt grader
// — strip that and prepend a stable push-in directive at render time. The
// stored scene.prompt is NOT mutated; this is render-time only so the audit
// trail in the DB stays human-authored.

const MOVEMENT_VERB_PATTERN =
  /\b(?:slow(?:ly)?|smoothly|gently|gracefully|subtle|wide|tight|fast|quick(?:ly)?)?\s*(?:orbit(?:s|ing)?|rotate(?:s|d|ing)?|tilt(?:s|ed|ing)?|pan(?:s|ned|ning)?|parallax(?:es|ed|ing)?|swing(?:s|ing)?|sweep(?:s|ing)?|dolly\s+out|pull(?:s|ing)?\s+back|pull\s+away|fly(?:s|ing)?\s+through|fly\s+over|fly\s+around|circle(?:s|d|ing)?|spin(?:s|ning)?|crane(?:s|d|ing)?(?:\s+up|\s+down)?|truck(?:s|ed|ing)?|whip(?:s|ped|ping)?\s+pan)\b[^.;]*[.;]?/gi;

export function stripMovementVerbs(prompt: string): string {
  return prompt.replace(MOVEMENT_VERB_PATTERN, "").replace(/\s{2,}/g, " ").trim();
}

const SEEDANCE_PUSHIN_PREAMBLE =
  "Slow, steady push in toward the room. Camera moves smoothly forward on a fixed dolly. No tilt, no rotation, no parallax, no orbit.";

export function forceSeedancePushInPrompt(originalPrompt: string): string {
  const stripped = stripMovementVerbs(originalPrompt);
  if (!stripped) return SEEDANCE_PUSHIN_PREAMBLE;
  return `${SEEDANCE_PUSHIN_PREAMBLE} ${stripped}`;
}

/**
 * selectProvider — BACKWARD-COMPATIBLE wrapper that returns an IVideoProvider
 * instance directly. Kept for callers that were written before Phase C.1
 * introduced ProviderDecision (prompt-lab.ts, poll-scenes.ts).
 *
 * New code should use selectDecision() or selectProviderForScene() + buildProviderFromDecision()
 * to access the modelKey and fallback chain.
 */
export function selectProvider(
  roomType: RoomType,
  movement: CameraMovement | null,
  preference: VideoProvider | null,
  excluded: VideoProvider[] = [],
): IVideoProvider {
  const decision = resolveMovementDecision(roomType, movement, preference, excluded);
  return buildProviderFromDecision(decision);
}

// ─── ASYNC THOMPSON ROUTING ──────────────────────────────────────────────────
//
// resolveDecisionAsync — wraps resolveDecision with an optional Thompson-
// sampling layer. Controlled by USE_THOMPSON_ROUTER=true env flag.
//
// The synchronous resolveDecision is always called first so that staticSku is
// unconditionally available for shadow-log writes (A/B comparison).

/**
 * Load bucket arms from router_bucket_stats for a given (roomType, movement)
 * bucket. Returns null on any error or if the bucket has no V1 SKU arms.
 */
async function loadBucketArms(
  roomType: string,
  movement: string | null,
): Promise<BucketArms | null> {
  if (!movement) return null;
  try {
    const { getSupabase } = await import("../client.js");
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("router_bucket_stats")
      .select("sku, alpha, beta, enabled, trial_count")
      .eq("room_type", roomType)
      .eq("camera_movement", movement);
    if (error || !data || data.length === 0) return null;

    // Filter to V1 SKUs only — any other SKU in DB (e.g. kling-v2-1-pair) is ignored.
    const validSkus = V1_ATLAS_SKUS as readonly string[];
    const arms = (
      data as Array<{
        sku: string;
        alpha: string | number;
        beta: string | number;
        enabled: boolean;
        trial_count: number;
      }>
    )
      .filter((row) => validSkus.includes(row.sku))
      .map((row) => ({
        sku: row.sku as V1AtlasSku,
        alpha: Number(row.alpha),
        beta: Number(row.beta),
        enabled: row.enabled,
        trial_count: row.trial_count,
      }));

    if (arms.length === 0) return null;

    return {
      room_type: roomType,
      camera_movement: movement,
      arms,
    };
  } catch {
    return null;
  }
}

/**
 * resolveDecisionAsync — async variant of resolveDecision that optionally
 * applies Thompson sampling when USE_THOMPSON_ROUTER=true.
 *
 * Always returns `staticSku` (from the synchronous path) so callers can
 * write shadow-log rows for A/B comparison regardless of the flag state.
 *
 * Does NOT replace resolveDecision — old callers continue to work unchanged.
 */
export async function resolveDecisionAsync(input: ResolveDecisionInput): Promise<{
  decision: ProviderDecision;
  thompson?: ThompsonDecision;
  staticSku: V1AtlasSku;
}> {
  const staticDecision = resolveDecision(input);
  const staticSku = staticDecision.modelKey as V1AtlasSku;

  if (process.env.USE_THOMPSON_ROUTER !== "true") {
    return { decision: staticDecision, staticSku };
  }

  const bucketArms = await loadBucketArms(input.roomType, input.movement);
  if (!bucketArms) {
    return { decision: staticDecision, staticSku };
  }

  const thompson = pickArm(bucketArms, V1_DEFAULT_SKU);
  return {
    decision: { provider: "atlas", modelKey: thompson.sku, fallback: undefined },
    thompson,
    staticSku,
  };
}

// ─── ENABLED PROVIDERS ───────────────────────────────────────────────────────
//
// Returns providers with credentials configured in the environment.
// The pipeline uses this to size the maxFailovers budget.

export function getEnabledProviders(): VideoProvider[] {
  const enabled: VideoProvider[] = [];
  if (process.env.ATLASCLOUD_API_KEY) enabled.push("atlas");
  if (process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY) enabled.push("kling");
  if (process.env.RUNWAY_API_KEY) enabled.push("runway");
  // Lane B (2026-05-26): Veo uses the same GEMINI_API_KEY as the photo
  // analyzer. No extra credential — just gate on key presence.
  if (process.env.GEMINI_API_KEY) enabled.push("veo");
  return enabled;
}
