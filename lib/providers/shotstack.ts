export interface AssemblyClip {
  url: string;
  durationSeconds: number;
}

export interface AssemblyOverlays {
  address: string;
  price: string;
  details: string;
  agent: string;
  brokerage?: string | null;
  /** Brokerage logo URL — rendered as a corner watermark when present.
   *  Creatomate honors this; Shotstack currently ignores it. */
  logoUrl?: string | null;
  /** Brand primary color as a hex string (e.g. "#10b981") used to tint
   *  the closing overlay accent line. Defaults to a neutral white. */
  primaryColor?: string | null;
  /** Brand secondary color, used as a softer accent. */
  secondaryColor?: string | null;
}

export type ClipTransition =
  | "carouselLeft"
  | "carouselRight"
  | "carouselUp"
  | "carouselDown"
  | "slideLeft"
  | "slideRight"
  | "slideUp"
  | "slideDown"
  | "reveal"
  | "zoom"
  | "fade"
  | "fadeFast"
  | "fadeSlow"
  | "none";

export interface AssembleVideoParams {
  clips: AssemblyClip[];
  overlays: AssemblyOverlays;
  aspectRatio: "16:9" | "9:16";
  /** Transition between clips. Default: "none" (hard cuts). */
  transition?: ClipTransition;
  /** Background music. Creatomate honors this; Shotstack currently ignores it. */
  music?: AssemblyMusic | null;
}

export interface AssemblyMusic {
  /** Public URL Creatomate can fetch (mp3/m4a/wav). */
  url: string;
  /** Volume in 0..1. Default 0.18 keeps the music subtle under overlays. */
  volume?: number;
}

export interface AssemblyJob {
  jobId: string;
  environment: "stage" | "v1";
}

export interface AssemblyResult {
  status: "processing" | "complete" | "failed";
  videoUrl?: string;
  durationSeconds?: number;
  renderTimeMs?: number;
  error?: string;
}

export interface IVideoAssemblyProvider {
  name: "shotstack" | "creatomate";
  assemble(params: AssembleVideoParams): Promise<AssemblyJob>;
  checkStatus(job: AssemblyJob): Promise<AssemblyResult>;
}

type ShotstackTransition = { in?: string; out?: string };

interface ShotstackVideoClip {
  asset: { type: "video"; src: string; trim?: number };
  start: number;
  length: number;
  transition?: ShotstackTransition;
}

interface ShotstackTitleClip {
  asset: {
    type: "title";
    text: string;
    style: string;
    color: string;
    size: string;
    position?: string;
    background?: string;
  };
  start: number;
  length: number;
  transition?: ShotstackTransition;
}

interface ShotstackTimeline {
  background: string;
  tracks: Array<{ clips: Array<ShotstackVideoClip | ShotstackTitleClip> }>;
}

interface ShotstackRenderPayload {
  timeline: ShotstackTimeline;
  output: {
    format: "mp4";
    resolution: "hd" | "1080";
    aspectRatio: "16:9" | "9:16";
  };
}

const TRANSITION_OVERLAP_SECONDS = 0.5;
const OPENING_OVERLAY_DURATION = 2.5;
const CLOSING_OVERLAY_DURATION = 4.0;

export function buildShotstackTimeline(
  params: AssembleVideoParams
): ShotstackRenderPayload {
  const { clips, overlays, aspectRatio, transition: clipTransition = "none" } = params;

  if (clips.length === 0) {
    throw new Error("buildShotstackTimeline: clips array is empty");
  }

  const videoClips: ShotstackVideoClip[] = [];
  let cursor = 0;
  // Only overlap clips when there's an actual transition to animate through.
  // With hard cuts ("none"), back-to-back placement is correct.
  const overlap = clipTransition === "none" ? 0 : TRANSITION_OVERLAP_SECONDS;

  clips.forEach((clip, i) => {
    const isFirst = i === 0;
    const start = isFirst ? 0 : cursor - overlap;
    const length = clip.durationSeconds;

    // Only apply transition.in on clips 2+. Do NOT set transition.out on the
    // outgoing clip — stacking in+out on adjacent clips causes a double
    // animation / black flash. The incoming clip's transition alone is enough.
    const transition: ShotstackTransition = {};
    if (!isFirst && clipTransition !== "none") {
      transition.in = clipTransition;
    }

    videoClips.push({
      asset: { type: "video", src: clip.url },
      start,
      length,
      ...(Object.keys(transition).length > 0 ? { transition } : {}),
    });

    cursor = start + length;
  });

  const totalLength = cursor;
  const closingStart = Math.max(0, totalLength - CLOSING_OVERLAY_DURATION);

  const priceLine = `${overlays.price} | ${overlays.details}`;
  const agentLine = overlays.brokerage
    ? `${overlays.agent} | ${overlays.brokerage}`
    : overlays.agent;

  // Vertical (9:16) needs larger text because the frame is narrower and
  // videos are viewed on phones. Horizontal (16:9) sizes are more reserved.
  const isVertical = aspectRatio === "9:16";
  const titleSize = isVertical ? "x-large" : "large";
  const agentSize = isVertical ? "large" : "medium";

  const openingOverlay: ShotstackTitleClip = {
    asset: {
      type: "title",
      text: overlays.address,
      style: "minimal",
      color: "#ffffff",
      size: titleSize,
      position: "center",
    },
    start: 0,
    length: OPENING_OVERLAY_DURATION,
    transition: { in: "fade", out: "fade" },
  };

  const closingPriceOverlay: ShotstackTitleClip = {
    asset: {
      type: "title",
      text: priceLine,
      style: "minimal",
      color: "#ffffff",
      size: titleSize,
      position: "center",
    },
    start: closingStart,
    length: CLOSING_OVERLAY_DURATION,
    transition: { in: "fade", out: "fade" },
  };

  const closingAgentOverlay: ShotstackTitleClip = {
    asset: {
      type: "title",
      text: agentLine,
      style: "minimal",
      color: "#ffffff",
      size: agentSize,
      position: "bottom",
    },
    start: closingStart,
    length: CLOSING_OVERLAY_DURATION,
    transition: { in: "fade", out: "fade" },
  };

  return {
    timeline: {
      background: "#000000",
      tracks: [
        // Top track = overlays (rendered on top)
        { clips: [openingOverlay, closingPriceOverlay, closingAgentOverlay] },
        // Bottom track = video clips
        { clips: videoClips },
      ],
    },
    output: {
      format: "mp4",
      resolution: "1080",
      aspectRatio,
    },
  };
}

export class ShotstackProvider implements IVideoAssemblyProvider {
  readonly name = "shotstack" as const;
  private readonly apiKey: string;
  private readonly environment: "stage" | "v1";
  private readonly baseUrl: string;

  constructor() {
    const env = (process.env.SHOTSTACK_ENV ?? "stage").toLowerCase();
    this.environment = env === "production" || env === "v1" ? "v1" : "stage";

    const key =
      this.environment === "v1"
        ? process.env.SHOTSTACK_API_KEY
        : process.env.SHOTSTACK_API_KEY_STAGE ?? process.env.SHOTSTACK_API_KEY;

    if (!key) {
      throw new Error(
        "SHOTSTACK_API_KEY (or SHOTSTACK_API_KEY_STAGE for sandbox) is required"
      );
    }
    this.apiKey = key;
    this.baseUrl = `https://api.shotstack.io/edit/${this.environment}`;
  }

  async assemble(params: AssembleVideoParams): Promise<AssemblyJob> {
    const payload = buildShotstackTimeline(params);

    const response = await fetch(`${this.baseUrl}/render`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Shotstack render submit failed: ${response.status} ${err}`);
    }

    const data = (await response.json()) as {
      success: boolean;
      message?: string;
      response?: { id: string; message?: string };
    };

    if (!data.success || !data.response?.id) {
      throw new Error(
        `Shotstack render submit rejected: ${data.message ?? "unknown error"}`
      );
    }

    return { jobId: data.response.id, environment: this.environment };
  }

  async checkStatus(job: AssemblyJob): Promise<AssemblyResult> {
    const response = await fetch(`${this.baseUrl}/render/${job.jobId}`, {
      headers: { "x-api-key": this.apiKey },
    });

    if (!response.ok) {
      throw new Error(`Shotstack status check failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      success: boolean;
      response?: {
        status: "queued" | "fetching" | "rendering" | "saving" | "done" | "failed";
        url?: string;
        error?: string;
        duration?: number;
        renderTime?: number;
      };
    };

    const r = data.response;
    if (!r) return { status: "failed", error: "Empty response" };

    if (r.status === "done") {
      return {
        status: "complete",
        videoUrl: r.url,
        durationSeconds: r.duration,
        renderTimeMs: r.renderTime != null ? r.renderTime * 1000 : undefined,
      };
    }
    if (r.status === "failed") {
      return { status: "failed", error: r.error ?? "Render failed" };
    }
    return { status: "processing" };
  }
}

// ---------------------------------------------------------------------------
// Cost helpers
// ---------------------------------------------------------------------------

// Shotstack bills per output-minute, rounded UP. A 37s video bills as 1 minute.
// Default to the "Ingest" plan rate; override via env for higher-tier plans.
const SHOTSTACK_CENTS_PER_MINUTE = parseInt(
  process.env.SHOTSTACK_CENTS_PER_MINUTE ?? "20",
  10,
);

/** Compute Shotstack cost in cents for a rendered output of the given duration.
 *  Rounds duration up to the nearest minute (Shotstack's billing granularity).
 *
 *  Deprecation shim: if SHOTSTACK_CENTS_PER_RENDER is set in the environment
 *  (legacy flat-rate config), its value is returned directly with a warn log
 *  so old deployments don't silently change cost estimates on redeploy.
 *  Remove this shim once all environments use SHOTSTACK_CENTS_PER_MINUTE.
 */
export function shotstackCostCents(outputDurationSeconds: number): number {
  const legacyFlat = process.env.SHOTSTACK_CENTS_PER_RENDER;
  if (legacyFlat !== undefined) {
    const flat = parseFloat(legacyFlat);
    console.warn(
      `[shotstack] SHOTSTACK_CENTS_PER_RENDER is deprecated — ` +
        `switch to SHOTSTACK_CENTS_PER_MINUTE (default 20¢/min). ` +
        `Using legacy flat value: ${flat}¢`,
    );
    return Math.round(flat);
  }
  const minutes = Math.ceil(outputDurationSeconds / 60);
  return minutes * SHOTSTACK_CENTS_PER_MINUTE;
}

export async function pollAssemblyUntilComplete(
  provider: IVideoAssemblyProvider,
  job: AssemblyJob,
  timeoutMs = 240_000,
  intervalMs = 5_000
): Promise<AssemblyResult> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await provider.checkStatus(job);
    if (result.status === "complete" || result.status === "failed") return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { status: "failed", error: "Shotstack render timed out" };
}
