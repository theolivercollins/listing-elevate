// Veo 3.1 Preview provider via Google Gemini API.
//
// Auth: GEMINI_API_KEY (same key used for the photo analyzer).
// Endpoint: https://generativelanguage.googleapis.com/v1beta
//
// IMPORTANT — pricing is a PLACEHOLDER. Veo 3.1 Preview pricing has not
// been confirmed against an invoice. The values below cover the high end
// of the $0.30–$0.60/sec range surfaced by research; update after the
// first real invoice. priceCentsPerSecond values:
//   4k    →  50¢/s  (most expensive tier)
//   1080p →  25¢/s  (estimated)
//   720p  →  15¢/s  (estimated)
// For a standard 5s clip: 4K = $2.50, 1080p = $1.25, 720p = $0.75.
//
// Lane B (2026-05-26): initial implementation for v1.1 Premium 4K SKU.

import type {
  IVideoProvider,
  GenerateClipParams,
  GenerationJob,
  GenerationResult,
} from "./provider.interface.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const GENERATE_MODEL = "models/veo-3.1-generate-preview";

export type VeoResolution = "4k" | "1080p" | "720p";

// ─── Cost helper ─────────────────────────────────────────────────────────────
//
// ⚠️  PLACEHOLDER RATES — verify against first Gemini invoice and adjust.
// These are guesses that cover the high end of the range we've seen quoted;
// err on the side of over-attribution rather than under.

export function getCostCentsForVeo(
  durationSeconds: number,
  resolution: VeoResolution,
): number {
  const perSecond =
    resolution === "4k" ? 50
    : resolution === "1080p" ? 25
    : 15; // 720p
  return Math.ceil(durationSeconds) * perSecond;
}

// Veo max duration is 8 seconds. Values above are clamped.
export const VEO_MAX_DURATION_SECONDS = 8;

function clampVeoDuration(requested: number): number {
  return Math.min(VEO_MAX_DURATION_SECONDS, Math.max(1, Math.round(requested)));
}

// ─── Veo operation response shapes ──────────────────────────────────────────
//
// The Gemini Files API has been inconsistent across preview versions;
// handle multiple shapes so we don't hard-fail on a minor schema drift.

interface VeoOperationResponse {
  name?: string;
  done?: boolean;
  error?: { code?: number; message?: string };
  response?: {
    // Shape A: response.video.uri (documented)
    video?: { uri?: string } | string;
    // Shape B: response.uri (observed in some preview builds)
    uri?: string;
    // Shape C: response.videos array (Vertex-style fallback)
    videos?: Array<{ uri?: string }>;
  };
}

function extractVeoVideoUrl(op: VeoOperationResponse): string | null {
  const r = op.response;
  if (!r) return null;

  // Shape A: response.video.uri
  if (r.video) {
    if (typeof r.video === "string") return r.video;
    if (typeof r.video.uri === "string" && r.video.uri) return r.video.uri;
  }

  // Shape B: response.uri
  if (typeof r.uri === "string" && r.uri) return r.uri;

  // Shape C: response.videos[0].uri
  if (Array.isArray(r.videos) && r.videos.length > 0) {
    const first = r.videos[0];
    if (first?.uri) return first.uri;
  }

  return null;
}

// ─── VeoProvider ─────────────────────────────────────────────────────────────

export class VeoProvider implements IVideoProvider {
  name = "veo" as const;
  private apiKey: string;

  constructor() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is required for VeoProvider");
    this.apiKey = key;
  }

  // Convert an image (URL or Buffer) to base64-encoded JPEG bytes.
  // Veo requires bytesBase64Encoded — it does not accept remote URLs.
  private async toBase64(params: GenerateClipParams): Promise<string> {
    if (params.sourceImageUrl) {
      // Download the remote image, then re-encode as base64.
      const res = await fetch(params.sourceImageUrl);
      if (!res.ok) {
        throw new Error(
          `VeoProvider: failed to fetch source image from ${params.sourceImageUrl} (HTTP ${res.status})`,
        );
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.toString("base64");
    }
    // Fall back to the pre-fetched Buffer (callers always populate this).
    return params.sourceImage.toString("base64");
  }

  async generateClip(params: GenerateClipParams): Promise<GenerationJob> {
    const imageB64 = await this.toBase64(params);
    const duration = clampVeoDuration(params.durationSeconds);

    // Resolution defaults to '4k' for the Premium SKU; callers may pass
    // a lower resolution via a future GenerateClipParams.resolution field.
    // For now, default to 4k as this is the reason operators choose Veo.
    const resolution: VeoResolution = "4k";

    const body = {
      instances: [
        {
          prompt: params.prompt,
          image: {
            bytesBase64Encoded: imageB64,
          },
        },
      ],
      parameters: {
        resolution,
        durationSeconds: duration,
        aspectRatio: params.aspectRatio, // "16:9" | "9:16"
      },
    };

    const url =
      `${BASE}/${GENERATE_MODEL}:predictLongRunning?key=${this.apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `VeoProvider generateClip failed: HTTP ${res.status} — ${text.slice(0, 300)}`,
      );
    }

    const json = (await res.json()) as { name?: string };
    if (!json.name) {
      throw new Error(
        `VeoProvider generateClip: response missing operation name — ${JSON.stringify(json).slice(0, 200)}`,
      );
    }

    // estimatedSeconds for Veo 3.1 is ~3–5 min; use 4 min as default.
    return { jobId: json.name, estimatedSeconds: 240 };
  }

  async checkStatus(operationName: string): Promise<GenerationResult> {
    // Poll via GET {BASE}/{operationName}?key={KEY}
    const url = `${BASE}/${operationName}?key=${this.apiKey}`;
    const res = await fetch(url, { method: "GET" });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `VeoProvider checkStatus failed: HTTP ${res.status} — ${text.slice(0, 300)}`,
      );
    }

    const op = (await res.json()) as VeoOperationResponse;

    if (!op.done) {
      return { status: "processing" };
    }

    // done: true with an error block
    if (op.error) {
      const msg = op.error.message ?? `Veo error code ${op.error.code ?? "unknown"}`;
      return { status: "failed", error: msg };
    }

    // done: true — try to extract the video URL
    const videoUrl = extractVeoVideoUrl(op);
    if (!videoUrl) {
      return {
        status: "failed",
        error: `VeoProvider: operation marked done but no video URI found — ${JSON.stringify(op.response).slice(0, 200)}`,
      };
    }

    // Use a 5-second cost as default (we don't store requested duration in checkStatus).
    // The actual duration used is stamped by generateClip; best-effort here.
    const costCents = getCostCentsForVeo(5, "4k");

    return {
      status: "complete",
      videoUrl,
      costCents,
    };
  }

  async downloadClip(videoUrl: string): Promise<Buffer> {
    // The Gemini Files API may return either a public signed URL (no auth
    // needed) or a URL that requires the API key as a query param.
    // Try with the API key first; if it fails try without.
    let res = await fetch(`${videoUrl}?key=${this.apiKey}`);
    if (!res.ok && !videoUrl.includes("?key=")) {
      // Retry without the key — may already be a signed URL.
      res = await fetch(videoUrl);
    }
    if (!res.ok) {
      throw new Error(
        `VeoProvider downloadClip failed: HTTP ${res.status} ${res.statusText} for ${videoUrl}`,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
