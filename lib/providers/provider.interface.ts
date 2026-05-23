import type { VideoProvider } from "../db.js";

export interface GenerateClipParams {
  sourceImage: Buffer;
  /**
   * Optional HTTPS URL to the source image. When provided, providers that
   * natively accept URL-based inputs (e.g. Runway) should prefer this over
   * base64-encoding `sourceImage`, which avoids Runway's 5MB data-URL cap.
   */
  sourceImageUrl?: string;
  /**
   * Optional end-frame image URL for providers that support start+end
   * keyframe interpolation. Atlas Cloud's Kling v3.0 Pro (end_image) and
   * Wan 2.7 (last_image) map this to their model-specific field. When
   * null/undefined, the provider generates a single-frame clip.
   */
  endImageUrl?: string;
  /**
   * Per-render override for AtlasProvider's model selection. When set,
   * takes precedence over the ATLAS_VIDEO_MODEL env var. Lets per-scene
   * model A/B work without env gymnastics.
   */
  modelOverride?: string;
  prompt: string;
  durationSeconds: number;
  aspectRatio: "16:9" | "9:16";
}

export interface GenerationJob {
  jobId: string;
  estimatedSeconds: number;
}

export interface GenerationResult {
  status: "processing" | "complete" | "failed";
  videoUrl?: string;
  costCents?: number;
  providerUnits?: number;
  providerUnitType?: "credits" | "kling_units" | "tokens";
  error?: string;
}

export interface IVideoProvider {
  name: VideoProvider;
  generateClip(params: GenerateClipParams): Promise<GenerationJob>;
  checkStatus(jobId: string): Promise<GenerationResult>;
  downloadClip(videoUrl: string): Promise<Buffer>;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollUntilComplete(
  provider: IVideoProvider,
  jobId: string,
  timeoutMs: number = 270_000,
  intervalMs: number = 5_000
): Promise<GenerationResult> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await provider.checkStatus(jobId);
    if (result.status === "complete" || result.status === "failed") {
      return result;
    }
    await sleep(intervalMs);
  }
  return { status: "failed", error: "Generation timed out" };
}
