import type {
  IVideoProvider,
  GenerateClipParams,
  GenerationJob,
  GenerationResult,
} from "./provider.interface.js";

// Atlas Cloud model descriptors. Add new entries here to make them
// selectable via ATLAS_VIDEO_MODEL without touching call sites.
//
// IMPORTANT on pricing: Atlas's published rates on Kling SKUs (e.g.
// "$0.095 for kling-v3-pro") are PER SECOND of generated video, not
// per clip. A standard 5-second render bills 5x the per-second rate.
// `priceCentsPerClip` below is the per-second rate × 5 (default clip
// length). If the render duration differs, compute dynamically via
// priceCentsPerSecond × actualSeconds.
export interface AtlasModelDescriptor {
  slug: string;                                   // `model` value Atlas expects
  endFrameField: "end_image" | null;
  allowedDurations: readonly number[] | "continuous";
  durationRange?: { min: number; max: number };
  priceCentsPerSecond: number;   // canonical per-second rate
  priceCentsPerClip: number;     // priceCentsPerSecond × 5 (standard clip)
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
  },
  "kling-v3-std": {
    slug: "kwaivgi/kling-v3.0-std/image-to-video",
    endFrameField: "end_image",
    allowedDurations: [5, 10],
    priceCentsPerSecond: 8,      // $0.071/s
    priceCentsPerClip: 36,       // $0.355 for 5s
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
  },
  "kling-v2-1-pair": {
    slug: "kwaivgi/kling-v2.1-i2v-pro/start-end-frame",
    endFrameField: "end_image",
    allowedDurations: [5, 10],
    priceCentsPerSecond: 8,      // $0.076/s
    priceCentsPerClip: 38,       // $0.380 for 5s
  },
  "kling-v2-master": {
    slug: "kwaivgi/kling-v2.0-i2v-master",
    endFrameField: null,
    allowedDurations: [5, 10],
    priceCentsPerSecond: 23,     // $0.221/s
    priceCentsPerClip: 111,      // $1.105 for 5s
  },
  "kling-o3-pro": {
    slug: "kwaivgi/kling-video-o3-pro/image-to-video",
    endFrameField: "end_image",
    allowedDurations: [5, 10],
    priceCentsPerSecond: 10,     // $0.095/s
    priceCentsPerClip: 48,       // $0.475 for 5s
  },
  // v1.1 pipeline mode (added 2026-05-23) — push-in only via Atlas.
  // Atlas slug is env-overridable so we can chase Bytedance's release
  // train ("seedance-1-pro", "seedance-2-pro", etc.) without code
  // changes. Default targets the latest Bytedance entry on Atlas.
  // ⚠️  Price is a placeholder; verify against the first Atlas invoice
  // before high-volume use. Marked higher than Kling v2-6-pro to be
  // conservative.
  "seedance-pro-pushin": {
    slug: process.env.SEEDANCE_ATLAS_SLUG ?? "bytedance/seedance-pro/image-to-video",
    endFrameField: null,         // Seedance has no start+end-frame support
    allowedDurations: [5, 10],
    priceCentsPerSecond: 14,     // ⚠️  placeholder — verify against invoice
    priceCentsPerClip: 70,       // 14 × 5
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

export interface AtlasSubmitBody {
  model: string;
  image: string;
  prompt: string;
  duration: number;
  aspect_ratio?: string;
  cfg_scale?: number;
  negative_prompt?: string;
  end_image?: string;
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
    const body = buildAtlasRequestBody(params, modelForCall);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    });
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
