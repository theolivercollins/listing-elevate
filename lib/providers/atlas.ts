import type {
  IVideoProvider,
  GenerateClipParams,
  GenerationJob,
  GenerationResult,
} from "./provider.interface.js";
import { ensureSourceAspectRatio } from "../services/source-aspect.js";

// Atlas Cloud model descriptors. Add new entries here to make them
// selectable via ATLAS_VIDEO_MODEL without touching call sites.
//
// IMPORTANT on pricing: Atlas's published rates on Kling SKUs (e.g.
// "$0.095 for kling-v3-pro") are PER SECOND of generated video, not
// per clip. A standard 5-second render bills 5x the per-second rate.
// `priceCentsPerClip` below is the per-second rate × 5 (default clip
// length). If the render duration differs, compute dynamically via
// priceCentsPerSecond × actualSeconds.
// Resolution values accepted across Atlas-hosted models. The `-SR` variants
// are Seedance 2.0's super-resolution tiers (FlashVSR pass folded into the
// main model 2026-06 — they replaced the retired standalone "upscaled"/2K
// variant). Kling SKUs only ever use "1080p"; "4k" is reserved for future
// SKUs (Veo-class) so UI mirrors can share the union.
export type AtlasResolution =
  | "480p"
  | "720p"
  | "720p-SR"
  | "1080p"
  | "1080p-SR"
  | "1440p-SR"
  | "4k";

export interface AtlasModelDescriptor {
  slug: string;                                   // `model` value Atlas expects
  // Kling SKUs accept `end_image`; Bytedance Seedance 2.0 accepts `last_image`
  // (confirmed against the live Atlas input schema 2026-06-10:
  // static.atlascloud.ai/model/schema/bytedance-seedance-2.0-image-to-video.json).
  endFrameField: "end_image" | "last_image" | null;
  allowedDurations: readonly number[] | "continuous";
  durationRange?: { min: number; max: number };
  priceCentsPerSecond: number;   // canonical per-second rate
  priceCentsPerClip: number;     // priceCentsPerSecond × 5 (standard clip)
  /**
   * Optional render resolution forwarded to the underlying Replicate model
   * via the `resolution` input field. When set, Atlas passes it through to
   * the model (Seedance 2.0 accepts '480p' | '720p' | '720p-SR' | '1080p' |
   * '1080p-SR' | '1440p-SR'). When unset, the model uses its own default —
   * for Bytedance Seedance that's '720p', which observably underuses the
   * model's native quality.
   * Kling variants IGNORE this field entirely. MEASURED 2026-06-11 (ffprobe
   * audit; docs/sessions/2026-06-11-assembly-quality-drop-diagnosis.md):
   * each Kling SKU has a fixed output PIXEL BUDGET whose shape follows the
   * INPUT image's aspect ratio — v2.6 Pro / v3 Pro ≈ 2.07 MP (the exact
   * 1920×1080 area: 3:2 in → 1760×1176 out), v2 Master ≈ 0.92 MP (the exact
   * 1280×720 area: 3:2 in → 1172×784 out). Kling geometry is therefore
   * controlled via `forceSourceAspectRatio`, not this field.
   *
   * This is the descriptor-level DEFAULT. It can be overridden per-render
   * via `GenerateClipParams.resolution` (UI quality dropdown).
   */
  resolution?: AtlasResolution;
  /**
   * Ordered list of resolutions the underlying model can produce. First
   * entry is the default selection in the UI. When unset or single-element,
   * the UI hides the resolution picker (no meaningful choice to make).
   * Seedance has a real multi-res picker; Kling SKUs have no picker — their
   * pixel budget is fixed per-SKU (1080p-class on v2.6/v3, 720p-class on
   * v2 Master; see `resolution` docblock above).
   */
  supportedResolutions?: ReadonlyArray<AtlasResolution>;
  /**
   * Optional `generate_audio` flag forwarded to the underlying Replicate
   * model. Only Bytedance Seedance 2.0 generates audio by default — set
   * this to `false` on the Seedance descriptor so we get silent video.
   * Kling/Runway etc. don't generate audio so this is a no-op there.
   *
   * Real-estate listing clips never want model-generated music; the
   * assembly stage adds curated music from a separate track.
   */
  generateAudio?: boolean;
  /**
   * When set, the source image (and the end image, when the SKU takes one)
   * is center-cropped to this aspect ratio (and uploaded to Storage) BEFORE
   * submission. Required for every i2v model that derives its OUTPUT aspect
   * ratio from the INPUT image and ignores the `aspect_ratio` field:
   * - Bytedance Seedance 2.0 — a 3:2 listing photo otherwise yields a 4:3
   *   clip (1664×1248) instead of 16:9 1080p (verified live 2026-05-28).
   * - ALL Kling SKUs — measured 2026-06-11 (ffprobe audit across scene clips
   *   and Lab iterations): Kling copies the input aspect onto its fixed
   *   per-SKU pixel budget, so a 3:2 photo yields a 3:2 clip (1760×1176 on
   *   v2.6 Pro / v3 Pro, 1172×784 on v2 Master) that the assembler must
   *   cover-upscale + crop onto the 1920×1080 canvas — the dominant quality
   *   loss diagnosed on the 5019 San Massimo run. The earlier comment here
   *   claiming Kling geometry is "fixed in-model" was wrong.
   * "16:9" → a 1920×1080 crop. Runway stays unset: it takes an explicit
   * output `ratio` parameter of its own.
   */
  forceSourceAspectRatio?: "16:9";
}

// Default clip duration in seconds for cost estimation. Atlas accepts
// 5 or 10 per its allowedDurations; we almost always render 5s.
export const DEFAULT_ATLAS_CLIP_SECONDS = 5;

// Seven Kling SKUs registered. End-frame support is set per-model:
// - v3-pro / v3-std / v2-6-pro / o3-pro: accept `end_image` (works in
//   our probes, matches Kling's native i2v API).
// - v2-1-pair: the "start-end-frame" SKU purpose-built for paired
//   renders. Best choice when user has a real paired scene.
// - v2-master: master-class i2v that does NOT accept end_image in
//   Kling native; forced to single-start. Our scene.use_end_frame
//   toggle already lets the user render without a pair.
// Prices below: priceCentsPerSecond rounded from Atlas's published
// per-second rate. priceCentsPerClip = perSec × 5 (standard duration).
export const ATLAS_MODELS: Record<string, AtlasModelDescriptor> = {
  "kling-v3-pro": {
    slug: "kwaivgi/kling-v3.0-pro/image-to-video",
    endFrameField: "end_image",
    allowedDurations: [5, 10],
    priceCentsPerSecond: 10,     // $0.095/s
    priceCentsPerClip: 48,       // $0.475 for 5s
    supportedResolutions: ["1080p"],  // ~2.07 MP budget (measured 1660×1244 from a 4:3 pair, 2026-06-11); 16:9 in → 1920×1080
    forceSourceAspectRatio: "16:9",   // copies input aspect (NOT fixed in-model) — crop start+end to 16:9 for true 1080p
  },
  "kling-v3-std": {
    slug: "kwaivgi/kling-v3.0-std/image-to-video",
    endFrameField: "end_image",
    allowedDurations: [5, 10],
    priceCentsPerSecond: 8,      // $0.071/s
    priceCentsPerClip: 36,       // $0.355 for 5s
    supportedResolutions: ["1080p"],  // budget not yet measured for this SKU; v3 family measures ~2.07 MP
    forceSourceAspectRatio: "16:9",   // copies input aspect (NOT fixed in-model) — crop start+end to 16:9
  },
  "kling-v2-6-pro": {
    slug: "kwaivgi/kling-v2.6-pro/image-to-video",
    endFrameField: "end_image",
    allowedDurations: [5, 10],
    // OBSERVED 2026-04-20: wallet delta was $0.60 for a 5s render (expected $0.30
    // from original docs reading). Atlas is billing at $0.12/s, not $0.06/s.
    // Either the published docs were stale, Atlas applies a markup, or the clip
    // silently ran at 10s. Updated provisionally to match observed billing.
    // ⚠️  Other SKU rates have NOT been independently verified — cross-check
    // kling-v3-pro, kling-v3-std, kling-v2-1-pair, and kling-o3-pro against
    // Atlas invoice before high-volume Phase B work.
    priceCentsPerSecond: 12,     // $0.120/s (observed — 2x our original reading; pending Atlas invoice verification)
    priceCentsPerClip: 60,       // $0.600 for 5s
    supportedResolutions: ["1080p"],  // ~2.07 MP budget (measured 1760×1176 / 1688×1224 from 3:2 sources, 2026-06-11); 16:9 in → 1920×1080
    forceSourceAspectRatio: "16:9",   // copies input aspect (NOT fixed in-model) — crop start+end to 16:9 for true 1080p
  },
  "kling-v2-1-pair": {
    slug: "kwaivgi/kling-v2.1-i2v-pro/start-end-frame",
    endFrameField: "end_image",
    allowedDurations: [5, 10],
    priceCentsPerSecond: 8,      // $0.076/s
    priceCentsPerClip: 38,       // $0.380 for 5s
    supportedResolutions: ["1080p"],  // ~2.07 MP budget (measured 1660×1244 on 2026-06-04 paired run); 16:9 in → 1920×1080
    forceSourceAspectRatio: "16:9",   // copies input aspect (NOT fixed in-model) — BOTH frames cropped so pair geometry matches
  },
  "kling-v2-master": {
    slug: "kwaivgi/kling-v2.0-i2v-master",
    endFrameField: null,
    allowedDurations: [5, 10],
    priceCentsPerSecond: 23,     // $0.221/s
    priceCentsPerClip: 111,      // $1.105 for 5s
    supportedResolutions: ["720p"],   // ~0.92 MP budget (measured 1172×784 from 3:2 sources, 2026-06-11) — 720p-class, NOT 1080p; 16:9 in → ~1280×720
    forceSourceAspectRatio: "16:9",   // copies input aspect — crop still removes the assembler's cover-crop (uniform 1.5x upscale instead)
  },
  "kling-o3-pro": {
    slug: "kwaivgi/kling-video-o3-pro/image-to-video",
    endFrameField: "end_image",
    allowedDurations: [5, 10],
    priceCentsPerSecond: 10,     // $0.095/s
    priceCentsPerClip: 48,       // $0.475 for 5s
    supportedResolutions: ["1080p"],  // budget not yet measured for this SKU; modern Kling pro SKUs measure ~2.07 MP
    forceSourceAspectRatio: "16:9",   // copies input aspect (NOT fixed in-model) — crop start+end to 16:9
  },
  // v1.1 pipeline mode (added 2026-05-23) — Bytedance Seedance 2.0 push-in via Atlas.
  //
  // Slug fixed 2026-06-10 against the LIVE Atlas catalog (GET /api/v1/models):
  // the standalone "image-to-video-upscaled" variant was RETIRED by Atlas —
  // every submit against it returned 400 "not found", which silently failed
  // all v1.1 scenes over to the Kling fallback. Atlas folded the upscaled/2K
  // tier into the main model as resolution values: the schema now enumerates
  // resolution: ['480p','720p','720p-SR','1080p','1080p-SR','1440p-SR']
  // (default 720p) — "2k" is no longer valid. The `-SR` tiers run the
  // FlashVSR super-resolution pass that the old upscaled variant provided.
  //
  // Default resolution "1080p-SR": SR is the quality tier that replaced the
  // old 2K upscale, and 1080p matches our delivery output. Both slug and
  // resolution remain env-overridable for instant rollback without a deploy
  // (SEEDANCE_ATLAS_SLUG / SEEDANCE_RESOLUTION) if Atlas shuffles the
  // catalog again.
  //
  // Note: Seedance 2.0 supports `last_image` upstream. The push-in SKU keeps
  // endFrameField null on purpose — pair renders go through the separate
  // `seedance-pair` SKU below so the push-in prompt preamble never leaks
  // onto paired scenes. Paired scenes still DEFAULT to kling-v3-pro.
  "seedance-pro-pushin": {
    slug: process.env.SEEDANCE_ATLAS_SLUG ?? "bytedance/seedance-2.0/image-to-video",
    endFrameField: null,         // Seedance pairs not enabled (see note above)
    allowedDurations: [5, 10],   // schema allows 4-15s; we stick to 5/10
    resolution: (process.env.SEEDANCE_RESOLUTION as AtlasResolution | undefined) ?? "1080p-SR",
    supportedResolutions: ["1080p-SR", "1440p-SR", "1080p", "720p-SR", "720p", "480p"],
    generateAudio: false,        // Seedance 2.0 generates music by default — kill it; assembly adds curated audio
    forceSourceAspectRatio: "16:9",  // Seedance copies the INPUT image's AR → crop 3:2 sources to 16:9 (see source-aspect.ts)
    priceCentsPerSecond: 9.6,    // $0.096/s (live Atlas catalog 2026-06-10) — verify against invoice
    priceCentsPerClip: 48,       // 9.6 × 5
  },
  // OPT-IN pair mode (added 2026-06-10) — Bytedance Seedance 2.0 with
  // start+end-frame interpolation via the `last_image` input field
  // (confirmed against the live Atlas input schema for
  // bytedance-seedance-2.0-image-to-video; same format rules as `image`).
  //
  // IMPORTANT: this SKU is NEVER a routing default. Paired scenes
  // (end_photo_id set) keep defaulting to kling-v3-pro (RULE DQ.3 in
  // router.ts). seedance-pair is only reachable as an explicit operator /
  // Lab choice (Checkpoint A regenerate model picker, Lab SKU pickers).
  //
  // A separate key (instead of reusing seedance-pro-pushin) keeps the
  // forceSeedancePushInPrompt preamble OFF pair renders: every call site
  // keys that override on the exact string 'seedance-pro-pushin', so pair
  // renders use the scene's own prompt (incl. its trajectory clause).
  "seedance-pair": {
    slug: process.env.SEEDANCE_ATLAS_SLUG ?? "bytedance/seedance-2.0/image-to-video",
    endFrameField: "last_image", // Seedance 2.0 end-frame param (schema-confirmed 2026-06-10)
    allowedDurations: [5, 10],   // schema allows 4-15s; we stick to 5/10
    resolution: (process.env.SEEDANCE_RESOLUTION as AtlasResolution | undefined) ?? "1080p-SR",
    supportedResolutions: ["1080p-SR", "1440p-SR", "1080p", "720p-SR", "720p", "480p"],
    generateAudio: false,        // Seedance 2.0 generates music by default — kill it; assembly adds curated audio
    forceSourceAspectRatio: "16:9",  // Seedance copies the INPUT image's AR → crop 3:2 sources to 16:9 (see source-aspect.ts)
    priceCentsPerSecond: 9.6,    // $0.096/s (live Atlas catalog 2026-06-10) — verify against invoice
    priceCentsPerClip: 48,       // 9.6 × 5
  },
};

// ─── V1 ATLAS SKU ALLOW-LIST ─────────────────────────────────────────────────
//
// Atlas SKUs valid as first-try defaults for V1 (single-image) Lab renders.
// Must be kept in sync with `ATLAS_MODELS` above.
//
// Excluded intentionally:
//   - `kling-v3-pro`: shake profile optimized for paired renders. Rendering
//     it on single-image buckets pollutes the rating signal because it
//     will never actually be routed there in production. Policy decision
//     2026-04-21 (see docs/sessions/2026-04-21-park-router.md).
//   - `kling-v2-1-pair`: paired-only SKU (start+end-frame). Routed by
//     `selectProviderForScene()` when `scene.endPhotoId` is set. Not a
//     valid first-try default for unpaired scenes.
//   - `kling-v3-std` + `kling-o3-pro`: removed from user-facing SKU dropdown
//     2026-04-23 per Oliver ("we will not use them"). Still kept in
//     ATLAS_MODELS for possible future re-add; not routable from the UI.

export const V1_ATLAS_SKUS = [
  "kling-v2-6-pro",
  "kling-v2-master",
] as const;

export type V1AtlasSku = (typeof V1_ATLAS_SKUS)[number];

export const V1_DEFAULT_SKU: V1AtlasSku = "kling-v2-6-pro";

// ─── v1.1 SKU ALLOW-LIST ─────────────────────────────────────────────────────
//
// SKUs valid for v1.1 Lab sessions (multi-model picker).  Seedance is the
// default; the rest are modern Kling/Runway variants.  Kept in sync with
// `V1_1_LAB_SKUS` in `src/lib/labModels.ts` (which the UI imports).
//
// API-layer files import from here (not from src/) so tsconfig.api.json
// can resolve the constant without expanding its include globs.
export const V1_1_LAB_SKUS = [
  "seedance-pro-pushin",
  "kling-v3-pro",
  "kling-v2-6-pro",
  "kling-v2-master",
  "runway-gen4-native",
  // Lane B (2026-05-26): Veo 3.1 Preview added as Premium 4K SKU.
  // Routes through VeoProvider, not Atlas. Validation accepts it
  // because the combined allow-list includes it here.
  "veo-3-1-preview",
  // Opt-in Seedance 2.0 pair mode (2026-06-10). Only meaningful on paired
  // scenes — never a default; paired scenes still default to kling-v3-pro.
  "seedance-pair",
] as const;
export type V1_1LabSku = (typeof V1_1_LAB_SKUS)[number];
export const V1_1_DEFAULT_SKU: V1_1LabSku = "seedance-pro-pushin";

/** Compute the expected cost in cents for a finalized Atlas render.
 *  Uses the model's per-second rate × clip duration (defaults to 5s).
 *  Returns 0 if the model key is unknown.
 */
export function atlasClipCostCents(modelKey: string, durationSeconds: number = DEFAULT_ATLAS_CLIP_SECONDS): number {
  const descriptor = ATLAS_MODELS[modelKey];
  if (!descriptor) return 0;
  return descriptor.priceCentsPerSecond * durationSeconds;
}

const ENDPOINT = "https://api.atlascloud.ai/api/v1/model/generateVideo";
const PREDICTION_BASE = "https://api.atlascloud.ai/api/v1/model/prediction";

/**
 * Thrown when Atlas returns HTTP 402 or an "insufficient balance" body.
 * Classified as PERMANENT by classifyProviderError (pattern match on
 * 'atlas_insufficient_balance') — retrying an unfunded account is pointless.
 * Consumers must surface this to the operator (needs_review / degraded with
 * the error message visible) rather than auto-failing-over silently.
 */
export class AtlasInsufficientBalanceError extends Error {
  readonly code = 402;
  constructor(detail?: string) {
    super(
      `atlas_insufficient_balance${detail ? `: ${detail}` : ""}`,
    );
    this.name = "AtlasInsufficientBalanceError";
  }
}

export interface AtlasSubmitBody {
  model: string;
  image: string;
  prompt: string;
  duration: number;
  aspect_ratio?: string;
  cfg_scale?: number;
  negative_prompt?: string;
  end_image?: string;
  /** Seedance 2.0 end-frame field — the video interpolates from `image` to
   *  this frame. Only sent for descriptors with endFrameField "last_image"
   *  (the opt-in `seedance-pair` SKU). Kling SKUs use `end_image` instead. */
  last_image?: string;
  /** Forwarded to the underlying Replicate model when set. Seedance 2.0
   *  honors '480p' | '720p' | '720p-SR' | '1080p' | '1080p-SR' | '1440p-SR'
   *  (the -SR tiers run the FlashVSR super-resolution pass). Kling variants
   *  ignore it (their output res is fixed per-SKU). Atlas passes through
   *  unrecognized fields to the model's input schema, so it's safe to send. */
  resolution?: AtlasResolution;
  /** Forwarded to Seedance 2.0 to disable native audio/music generation.
   *  Ignored by other models. */
  generate_audio?: boolean;
}

// Kling v3-pro introduces noticeable camera shake/vibration on push-ins
// and orbits that v2 did not. This negative-prompt string is applied to
// every Atlas render by default. Separate from the positive prompt
// stabilization language we inject upstream — both levers together
// reduce shake more than either alone.
export const ATLAS_DEFAULT_NEGATIVE_PROMPT =
  "shaky camera, handheld, wobble, vibration, jitter, camera shake, rolling shutter, unstable motion";

// Pure builder — easy to test. Callers pass the descriptor that matches
// the env's ATLAS_VIDEO_MODEL so we only have one switch statement in
// the whole integration.
export function buildAtlasRequestBody(
  params: GenerateClipParams,
  model: AtlasModelDescriptor,
): AtlasSubmitBody {
  if (!params.sourceImageUrl) {
    throw new Error("Atlas requires sourceImageUrl (Atlas fetches the image remotely; base64 is not supported here).");
  }
  const duration = clampDuration(params.durationSeconds, model);
  const body: AtlasSubmitBody = {
    model: model.slug,
    image: params.sourceImageUrl,
    prompt: params.prompt,
    duration,
    aspect_ratio: params.aspectRatio,
    negative_prompt: ATLAS_DEFAULT_NEGATIVE_PROMPT,
  };
  if (params.endImageUrl && model.endFrameField) {
    body[model.endFrameField] = params.endImageUrl;
  }
  // Resolution priority: explicit per-render override (UI quality dropdown) wins
  // over the descriptor's static default. Falls back to the descriptor's `resolution`
  // field (currently only Seedance opts in). Kling SKUs leave this unset — Kling
  // ignores the field; its output pixel budget is fixed per-SKU and shaped by the
  // input image's aspect, which we control via forceSourceAspectRatio instead.
  const effectiveResolution = params.resolution ?? model.resolution;
  if (effectiveResolution) {
    // AtlasSubmitBody.resolution accepts the AtlasResolution union. Cast is
    // safe: the UI only offers values from the SKU's supportedResolutions array,
    // and the descriptor default is one of these.
    body.resolution = effectiveResolution as AtlasResolution;
  }
  // Forward generate_audio when the descriptor opts in (Seedance 2.0 only —
  // kills its default music track). Atlas passes through to Replicate's
  // Seedance input schema. Other models ignore the field.
  if (model.generateAudio !== undefined) {
    body.generate_audio = model.generateAudio;
  }
  return body;
}

function clampDuration(requested: number, model: AtlasModelDescriptor): number {
  if (model.allowedDurations === "continuous") {
    const { min, max } = model.durationRange!;
    return Math.max(min, Math.min(max, Math.round(requested)));
  }
  // Fixed allowed set — snap to the closest allowed value.
  const allowed = model.allowedDurations as readonly number[];
  let best = allowed[0];
  let bestDist = Math.abs(requested - best);
  for (const d of allowed) {
    const dist = Math.abs(requested - d);
    if (dist < bestDist) { best = d; bestDist = dist; }
  }
  return best;
}

export interface AtlasSubmitResponse {
  code: number;
  message?: string;
  msg?: string;
  data?: {
    id?: string;
    model?: string;
    urls?: { get?: string };
    status?: string;
  } | null;
}

export function parseAtlasSubmitResponse(resp: AtlasSubmitResponse): string {
  if (resp.code !== 200) {
    const msg = resp.message || resp.msg || "unknown error";
    // 402 is a permanent billing failure — surface it distinctly so consumers
    // can mark the scene/variant needs_review without silently failing over.
    if (resp.code === 402 || /insufficient.*balance|payment required/i.test(msg)) {
      throw new AtlasInsufficientBalanceError(msg);
    }
    throw new Error(`Atlas submit failed: code=${resp.code} msg=${msg}`);
  }
  const id = resp.data?.id;
  if (!id) throw new Error("Atlas submit response missing data.id");
  return id;
}

export function extractAtlasOutputUrl(
  outputs: Array<string | { url?: string }> | { url?: string } | string | null | undefined,
): string | null {
  if (!outputs) return null;
  if (typeof outputs === "string") return outputs;
  if (Array.isArray(outputs)) {
    const first = outputs[0];
    if (typeof first === "string") return first;
    return first?.url ?? null;
  }
  return outputs.url ?? null;
}

export class AtlasProvider implements IVideoProvider {
  name = "atlas" as const;
  private apiKey: string;
  private model: AtlasModelDescriptor;

  constructor(modelOverride?: string) {
    const key = process.env.ATLASCLOUD_API_KEY;
    if (!key) throw new Error("ATLASCLOUD_API_KEY is required for AtlasProvider");
    this.apiKey = key;
    const modelName = modelOverride ?? process.env.ATLAS_VIDEO_MODEL ?? "kling-v2-6-pro";
    const descriptor = ATLAS_MODELS[modelName];
    if (!descriptor) throw new Error(`AtlasProvider model=${modelName} not in ATLAS_MODELS. Valid: ${Object.keys(ATLAS_MODELS).join(", ")}`);
    this.model = descriptor;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private resolveModel(override?: string): AtlasModelDescriptor {
    if (!override) return this.model;
    const descriptor = ATLAS_MODELS[override];
    if (!descriptor) {
      throw new Error(`modelOverride=${override} is not registered. Valid: ${Object.keys(ATLAS_MODELS).join(", ")}`);
    }
    return descriptor;
  }

  async generateClip(params: GenerateClipParams): Promise<GenerationJob> {
    const modelForCall = this.resolveModel(params.modelOverride);
    // Seedance AND every Kling SKU copy the input image's aspect ratio onto
    // their output and ignore `aspect_ratio` (Kling measured 2026-06-11 —
    // see forceSourceAspectRatio docblock). Crop the source to 16:9 first so
    // the clip fills the SKU's pixel budget at 16:9 (1920×1080 on the
    // 2.07 MP SKUs) instead of a 3:2/4:3 snap the assembler would have to
    // cover-upscale + crop. No-op for models without the flag.
    // For pair SKUs (forceSourceAspectRatio + an endFrameField — seedance-pair,
    // kling-v3-pro, kling-v2-1-pair, …) the END frame is cropped the same
    // way — a 3:2 end frame against a 16:9 first frame would skew the
    // interpolation geometry.
    let effectiveParams = params;
    if (modelForCall.forceSourceAspectRatio && params.sourceImageUrl) {
      const prepared = await ensureSourceAspectRatio(params.sourceImageUrl);
      if (prepared !== params.sourceImageUrl) {
        effectiveParams = { ...effectiveParams, sourceImageUrl: prepared };
      }
      if (params.endImageUrl && modelForCall.endFrameField) {
        const preparedEnd = await ensureSourceAspectRatio(params.endImageUrl);
        if (preparedEnd !== params.endImageUrl) {
          effectiveParams = { ...effectiveParams, endImageUrl: preparedEnd };
        }
      }
    }
    const body = buildAtlasRequestBody(effectiveParams, modelForCall);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    });
    // Detect 402 at the HTTP layer before attempting JSON parse — the body
    // may be HTML or plain-text when the billing gateway rejects the request.
    if (res.status === 402) {
      const detail = await res.text().catch(() => "");
      throw new AtlasInsufficientBalanceError(detail.slice(0, 200) || res.statusText);
    }
    const parsed = (await res.json()) as AtlasSubmitResponse;
    if (!res.ok) {
      throw new Error(`Atlas API error: HTTP ${res.status} ${res.statusText} — ${JSON.stringify(parsed).slice(0, 200)}`);
    }
    const jobId = parseAtlasSubmitResponse(parsed);
    return { jobId, estimatedSeconds: 90 };
  }

  async checkStatus(jobId: string): Promise<GenerationResult> {
    const res = await fetch(`${PREDICTION_BASE}/${jobId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Atlas status check failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
    }
    const parsed = (await res.json()) as {
      code: number;
      data?: {
        status?: string;
        outputs?: Array<string | { url?: string }> | { url?: string } | string | null;
      } | null;
    };
    const status = parsed.data?.status ?? "unknown";
    if (status === "processing" || status === "pending" || status === "queued") {
      return { status: "processing" };
    }
    if (status === "failed" || status === "error") {
      return { status: "failed", error: `Atlas job ${jobId} reported status=${status}` };
    }
    // Success variants Atlas might use
    if (status === "succeeded" || status === "completed" || status === "success") {
      const url = extractAtlasOutputUrl(parsed.data?.outputs);
      if (!url) return { status: "failed", error: `Atlas job ${jobId} finished without an output URL` };
      return {
        status: "complete",
        videoUrl: url,
        costCents: this.model.priceCentsPerClip,
      };
    }
    return { status: "processing" };
  }

  async downloadClip(videoUrl: string): Promise<Buffer> {
    const res = await fetch(videoUrl);
    if (!res.ok) {
      throw new Error(`Atlas downloadClip failed: HTTP ${res.status} ${res.statusText}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
