import * as crypto from "crypto";
import type {
  IVideoProvider,
  GenerateClipParams,
  GenerationJob,
  GenerationResult,
} from "./provider.interface.js";
import { ensureSourceAspectRatio } from "../services/source-aspect.js";

export class KlingProvider implements IVideoProvider {
  name = "kling" as const;
  private accessKey: string;
  private secretKey: string;
  private baseUrl = "https://api.klingai.com/v1";

  constructor() {
    const ak = process.env.KLING_ACCESS_KEY;
    const sk = process.env.KLING_SECRET_KEY;
    if (!ak || !sk) throw new Error("KLING_ACCESS_KEY and KLING_SECRET_KEY are required");
    this.accessKey = ak;
    this.secretKey = sk;
  }

  private generateJWT(): string {
    // Kling API requires a JWT signed with HMAC-SHA256 using the secret key
    const header = {
      alg: "HS256",
      typ: "JWT",
    };

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: this.accessKey,
      exp: now + 1800, // 30 min expiry
      nbf: now - 5,
    };

    const b64Header = Buffer.from(JSON.stringify(header))
      .toString("base64url");
    const b64Payload = Buffer.from(JSON.stringify(payload))
      .toString("base64url");

    const signature = crypto
      .createHmac("sha256", this.secretKey)
      .update(`${b64Header}.${b64Payload}`)
      .digest("base64url");

    return `${b64Header}.${b64Payload}.${signature}`;
  }

  private getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.generateJWT()}`,
      "Content-Type": "application/json",
    };
  }

  async generateClip(params: GenerateClipParams): Promise<GenerationJob> {
    // Kling i2v derives its OUTPUT geometry from the INPUT image's aspect
    // ratio and ignores the `aspect_ratio` field — a 3:2 MLS photo yields a
    // sub-1080p ~3:2 clip (measured 1172×784 on the 2026-06-11 5019 San
    // Massimo run; see docs/sessions/2026-06-11-assembly-quality-drop-diagnosis.md).
    // The assembler then cover-upscales it 1.64x AND crops ~204px vertically
    // onto the 1920×1080 canvas — the dominant quality loss in final videos.
    // Center-crop the source photo to a true 16:9 1920×1080 frame first (same
    // pattern as atlas.ts forceSourceAspectRatio).
    //
    // HONEST LIMIT (ffprobe audit 2026-06-11): kling-v2-master has a FIXED
    // ~0.92 MP output pixel budget — the exact 1280×720 area — shaped to the
    // input aspect. It cannot emit 1080p no matter the input. With a 16:9
    // source it returns ~1280×720, so assembly still upscales 1.5x — but
    // uniformly, with zero crop, instead of 1.64x + crop. This provider is
    // the degraded-mode FAILOVER (fires when Atlas is down, e.g. the 402
    // insufficient-balance cascade on the 5019 San Massimo run); the primary
    // Atlas SKUs are 1080p-class with the same crop applied in atlas.ts.
    // Kling bills per clip, so this changes no cost_events math.
    //
    // Kling accepts either an HTTPS URL or base64 for `image`. Prefer URL
    // when available — large photos base64-encode past provider caps. The
    // crop applies only on the URL path (ensureSourceAspectRatio operates on
    // URLs; all pipeline call sites pass one).
    const image = params.sourceImageUrl
      ? await ensureSourceAspectRatio(params.sourceImageUrl)
      : params.sourceImage.toString("base64");

    const response = await fetch(
      `${this.baseUrl}/videos/image2video`,
      {
        method: "POST",
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          // Kling v2-master. Negative_prompt intentionally OMITTED — long
          // stability anchors were making the model confused instead of
          // constrained. Short crisp cinematography prompts perform better.
          model_name: "kling-v2-master",
          image,
          prompt: params.prompt,
          cfg_scale: 0.75,
          duration: params.durationSeconds <= 5 ? "5" : "10",
          aspect_ratio: params.aspectRatio,
          mode: "pro",
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Kling API error: ${response.status} ${err}`);
    }

    const data = (await response.json()) as {
      data: { task_id: string };
    };
    return { jobId: data.data.task_id, estimatedSeconds: 120 };
  }

  async checkStatus(jobId: string): Promise<GenerationResult> {
    const response = await fetch(
      `${this.baseUrl}/videos/image2video/${jobId}`,
      {
        headers: this.getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Kling status check failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      data: {
        task_status: string;
        task_result?: { videos?: Array<{ url: string }> };
        task_status_msg?: string;
        task_info?: { external_task_id?: string };
      };
    };

    const task = data.data;
    if (task.task_status === "succeed" && task.task_result?.videos?.[0]) {
      // Kling v2-master: 10 units per 5s clip by default
      const units = 10;
      const centsPerUnit = parseFloat(process.env.KLING_CENTS_PER_UNIT ?? "0");
      return {
        status: "complete",
        videoUrl: task.task_result.videos[0].url,
        providerUnits: units,
        providerUnitType: "kling_units",
        costCents: Math.round(units * centsPerUnit),
      };
    }
    if (task.task_status === "failed") {
      return {
        status: "failed",
        error: task.task_status_msg ?? "Unknown error",
      };
    }
    return { status: "processing" };
  }

  async downloadClip(videoUrl: string): Promise<Buffer> {
    const response = await fetch(videoUrl);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
}
