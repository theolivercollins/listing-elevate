import type {
  IVideoProvider,
  GenerateClipParams,
  GenerationJob,
  GenerationResult,
} from "./provider.interface.js";

// TODO(oliver): run `curl https://api.replicate.com/v1/models/bytedance/seedance-1-pro`
// and paste the latest version SHA here to pin the model version.
const SEEDANCE_VERSION_SHA =
  process.env.SEEDANCE_VERSION_SHA ?? "PINNED_VERSION_TBD";

const SEEDANCE_CENTS_PER_SECOND = 12;

export class SeedanceProvider implements IVideoProvider {
  // NOTE: 'seedance' is not yet in the VideoProvider union in lib/types.ts.
  // The coordinator step will add it; use-site errors in poll-scenes.ts etc.
  // will resolve then. Cast via `as any` to avoid TS2322 on the class field.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  name = "seedance" as any;
  private apiKey: string;
  private lastDurationSeconds = 5;

  constructor() {
    const key = process.env.REPLICATE_API_TOKEN;
    if (!key) throw new Error("REPLICATE_API_TOKEN is required");
    this.apiKey = key;
  }

  async generateClip(params: GenerateClipParams): Promise<GenerationJob> {
    // Stash durationSeconds so checkStatus can compute cost (Replicate doesn't
    // echo back cost in the prediction response). Not reentrant — fine because
    // the cron only polls one job per provider instance.
    this.lastDurationSeconds = params.durationSeconds;

    // endImageUrl is silently ignored — Seedance has no end-frame field.
    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Token ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: SEEDANCE_VERSION_SHA,
        input: {
          image: params.sourceImageUrl,
          prompt: params.prompt,
          duration: params.durationSeconds,
          resolution: "1080p",
          aspect_ratio: params.aspectRatio === "16:9" ? "16:9" : "9:16",
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Seedance (Replicate) API error: ${response.status} ${err}`);
    }

    const data = (await response.json()) as { id: string };
    return { jobId: data.id, estimatedSeconds: 120 };
  }

  async checkStatus(jobId: string): Promise<GenerationResult> {
    const response = await fetch(
      `https://api.replicate.com/v1/predictions/${jobId}`,
      {
        headers: {
          Authorization: `Token ${this.apiKey}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Seedance status check failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      status: string;
      output?: string[];
      error?: string;
    };

    if (data.status === "succeeded" && data.output?.[0]) {
      const durationSeconds = this.lastDurationSeconds;
      return {
        status: "complete",
        videoUrl: data.output[0],
        providerUnits: durationSeconds,
        // @ts-expect-error pending 'seconds' addition to providerUnitType union in coordinator step
        providerUnitType: "seconds",
        costCents: Math.round(durationSeconds * SEEDANCE_CENTS_PER_SECOND),
      };
    }

    if (data.status === "failed" || data.status === "canceled") {
      return { status: "failed", error: data.error ?? "unknown" };
    }

    // 'starting' | 'processing' → still running
    return { status: "processing" };
  }

  async downloadClip(videoUrl: string): Promise<Buffer> {
    const response = await fetch(videoUrl);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
}
