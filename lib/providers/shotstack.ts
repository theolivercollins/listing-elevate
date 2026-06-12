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
  /** AI voiceover narration. Creatomate honors this; Shotstack ignores it. */
  voiceover?: AssemblyVoiceover | null;
}

export interface AssemblyMusic {
  /** Public URL Creatomate can fetch (mp3/m4a/wav). */
  url: string;
  /** Volume in 0..1. Default 0.18 keeps the music subtle under overlays. */
  volume?: number;
}

export interface AssemblyVoiceover {
  /** Public URL Creatomate can fetch (mp3). */
  url: string;
  /** Volume in 0..1. Default 1.0 — narration sits on top of ducked music. */
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
  // "auto" lets Shotstack place clips sequentially (start) and use each
  // asset's natural duration (length) — used by the plain concat path where
  // per-clip durations aren't known up front.
  start: number | "auto";
  length: number | "auto";
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

/** Shotstack HTML clip — used for rich text overlays with full CSS control. */
interface ShotstackHtmlClip {
  asset: {
    type: "html";
    html: string;
    css?: string;
    width?: number;
    height?: number;
    background?: string;
    position?: string;
  };
  start: number;
  length: number;
  offset?: { x?: number; y?: number };
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
    /** Render quality tier. Defaults to "medium" server-side — always set to
     *  "high" so the assembled video matches the source clip quality.
     *  Shotstack bills per output-minute regardless of quality tier. */
    quality: "low" | "medium" | "high";
    /** Output frame rate. Defaults to 25fps server-side. Our AI-generated
     *  source clips (Kling/Seedance/Runway/Veo) measure 24fps (ffprobe on the
     *  2026-06-11 5019 San Massimo run — see docs/sessions/2026-06-11-assembly-
     *  quality-drop-diagnosis.md). Match the sources at 24 so Shotstack never
     *  runs a 24→25 frame-rate resample, which softens motion. */
    fps: number;
  };
}

const TRANSITION_OVERLAP_SECONDS = 0.5;
const OPENING_OVERLAY_DURATION = 2.5;
const CLOSING_OVERLAY_DURATION = 4.0;

/**
 * Build a minimal Shotstack render payload that concatenates the given clip
 * URLs back-to-back with hard cuts — no overlays, no music, no transitions.
 *
 * This is the Prompt Lab "Create Video" assembly path: it replaces the old
 * local-FFmpeg concat (which produced a single large MP4 that blew past
 * Supabase's storage upload size limit). Shotstack renders in the cloud and
 * hosts the result, so nothing large is uploaded to our own storage.
 *
 * Uses `start: "auto"` + `length: "auto"` so Shotstack sequences the clips
 * using each asset's natural duration — we don't need to know per-clip
 * durations (Prompt Lab iterations don't store them).
 */
export function buildShotstackConcatTimeline(
  clipUrls: string[],
  aspectRatio: "16:9" | "9:16" = "16:9",
): ShotstackRenderPayload {
  if (clipUrls.length === 0) {
    throw new Error("buildShotstackConcatTimeline: clipUrls array is empty");
  }

  const videoClips: ShotstackVideoClip[] = clipUrls.map((src) => ({
    asset: { type: "video", src },
    start: "auto",
    length: "auto",
  }));

  return {
    timeline: {
      background: "#000000",
      tracks: [{ clips: videoClips }],
    },
    output: {
      format: "mp4",
      resolution: "1080",
      aspectRatio,
      quality: "high",
      fps: 24, // match 24fps AI source clips — never resample (Shotstack default is 25)
    },
  };
}

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
      quality: "high",
      fps: 24, // match 24fps AI source clips — never resample (Shotstack default is 25)
    },
  };
}

// ---------------------------------------------------------------------------
// Just Listed layout — Shotstack port of the Creatomate Just Listed #01
// template. Code-defined timeline (no Shotstack-side template required) so the
// layout is version-controlled + LLM-editable. Mirrors the Creatomate
// layout: 8 clips back-to-back, opening overlay with category title + street
// + city/state, closing overlay with agent + brokerage, two thin line
// graphics. All overlays use Shotstack HTML clips for full styling control.
// ---------------------------------------------------------------------------

export interface JustListedOverlays {
  street: string;
  cityState: string;
  category: string;        // "Just Listed" / "Just Pended" / "Just Closed"
  agent: string;
  brokerage: string | null;
}

export interface JustListedParams {
  clips: AssemblyClip[];
  overlays: JustListedOverlays;
  aspectRatio: "16:9" | "9:16";
}

const JL_OPENING_DURATION = 3.5;
const JL_CLOSING_DURATION = 3.5;

function htmlOverlay(
  start: number,
  length: number,
  html: string,
  css: string,
  width: number,
  height: number,
  yOffset = 0,
): ShotstackHtmlClip {
  return {
    asset: {
      type: "html",
      html,
      css,
      width,
      height,
      background: "transparent",
      position: "center",
    },
    start,
    length,
    offset: yOffset !== 0 ? { y: yOffset } : undefined,
    transition: { in: "fade", out: "fade" },
  };
}

/**
 * Build a Shotstack Edit-API payload that matches the Creatomate
 * Just Listed #01 layout. Render at 1920×1080 by default; pass
 * aspectRatio "9:16" for vertical 1080×1920.
 */
export function buildShotstackJustListedTimeline(
  params: JustListedParams,
): ShotstackRenderPayload {
  const { clips, overlays, aspectRatio } = params;
  if (clips.length === 0) {
    throw new Error("buildShotstackJustListedTimeline: clips array is empty");
  }

  const isVertical = aspectRatio === "9:16";
  const W = isVertical ? 1080 : 1920;
  const H = isVertical ? 1920 : 1080;

  // Video clips — hard cuts back-to-back, no transitions.
  const videoClips: ShotstackVideoClip[] = [];
  let cursor = 0;
  for (const clip of clips) {
    videoClips.push({
      asset: { type: "video", src: clip.url },
      start: cursor,
      length: clip.durationSeconds,
    });
    cursor += clip.durationSeconds;
  }
  const totalLength = cursor;
  const closingStart = Math.max(0, totalLength - JL_CLOSING_DURATION);

  // ── Opening overlay block ────────────────────────────────────────────
  // Big category title (e.g. "Just Listed"), then street address, then
  // city/state below. Layout mirrors Creatomate Just Listed #01.
  const sharedFontImport =
    "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');";

  const categoryOverlay = htmlOverlay(
    0,
    JL_OPENING_DURATION,
    `<div class="cat">${escapeHtml(overlays.category)}</div>`,
    `${sharedFontImport}
     .cat { font-family: 'Inter', sans-serif; font-weight: 700;
            font-size: ${isVertical ? 140 : 120}px; color: #ffffff;
            text-align: center; line-height: 1; letter-spacing: -0.02em;
            text-shadow: 0 2px 12px rgba(0,0,0,0.4); }`,
    Math.round(W * 0.9),
    Math.round(H * 0.25),
    isVertical ? -0.15 : -0.1,
  );

  const streetOverlay = htmlOverlay(
    0,
    JL_OPENING_DURATION,
    `<div class="street">${escapeHtml(overlays.street)}</div>`,
    `${sharedFontImport}
     .street { font-family: 'Inter', sans-serif; font-weight: 600;
               font-size: ${isVertical ? 56 : 48}px; color: #ffffff;
               text-align: center; line-height: 1.2;
               text-shadow: 0 2px 8px rgba(0,0,0,0.5); }`,
    Math.round(W * 0.9),
    100,
    isVertical ? 0.1 : 0.08,
  );

  const cityStateOverlay = htmlOverlay(
    0,
    JL_OPENING_DURATION,
    `<div class="city">${escapeHtml(overlays.cityState)}</div>`,
    `${sharedFontImport}
     .city { font-family: 'Inter', sans-serif; font-weight: 400;
             font-size: ${isVertical ? 40 : 32}px; color: rgba(255,255,255,0.9);
             text-align: center; line-height: 1.2; letter-spacing: 0.05em;
             text-shadow: 0 2px 8px rgba(0,0,0,0.5); }`,
    Math.round(W * 0.9),
    80,
    isVertical ? 0.18 : 0.16,
  );

  // Thin white accent line between street and city/state — mirrors the
  // Creatomate "Line" shape element.
  const accentLine = htmlOverlay(
    0,
    JL_OPENING_DURATION,
    `<div class="line"></div>`,
    `.line { width: 60px; height: 2px; background: #ffffff; margin: 0 auto; }`,
    80,
    10,
    isVertical ? 0.14 : 0.12,
  );

  // ── Closing overlay block ────────────────────────────────────────────
  const agentOverlay = htmlOverlay(
    closingStart,
    JL_CLOSING_DURATION,
    `<div class="agent">${escapeHtml(overlays.agent)}</div>`,
    `${sharedFontImport}
     .agent { font-family: 'Inter', sans-serif; font-weight: 600;
              font-size: ${isVertical ? 60 : 52}px; color: #ffffff;
              text-align: center; line-height: 1.1;
              text-shadow: 0 2px 8px rgba(0,0,0,0.5); }`,
    Math.round(W * 0.9),
    100,
    isVertical ? -0.05 : -0.03,
  );

  const brokerageOverlay = overlays.brokerage
    ? htmlOverlay(
        closingStart,
        JL_CLOSING_DURATION,
        `<div class="brkr">${escapeHtml(overlays.brokerage)}</div>`,
        `${sharedFontImport}
         .brkr { font-family: 'Inter', sans-serif; font-weight: 400;
                 font-size: ${isVertical ? 40 : 32}px;
                 color: rgba(255,255,255,0.85); text-align: center;
                 line-height: 1.2; letter-spacing: 0.05em;
                 text-shadow: 0 2px 8px rgba(0,0,0,0.5); }`,
        Math.round(W * 0.9),
        80,
        isVertical ? 0.06 : 0.05,
      )
    : null;

  const closingLine = htmlOverlay(
    closingStart,
    JL_CLOSING_DURATION,
    `<div class="line"></div>`,
    `.line { width: 60px; height: 2px; background: #ffffff; margin: 0 auto; }`,
    80,
    10,
    isVertical ? 0.02 : 0.01,
  );

  const overlayClips: Array<ShotstackVideoClip | ShotstackTitleClip | ShotstackHtmlClip> = [
    categoryOverlay,
    streetOverlay,
    accentLine,
    cityStateOverlay,
    agentOverlay,
    closingLine,
  ];
  if (brokerageOverlay) overlayClips.push(brokerageOverlay);

  return {
    timeline: {
      background: "#000000",
      tracks: [
        // Top track: overlays
        { clips: overlayClips as Array<ShotstackVideoClip | ShotstackTitleClip> },
        // Bottom track: video clips
        { clips: videoClips },
      ],
    },
    output: {
      format: "mp4",
      resolution: "1080",
      aspectRatio,
      quality: "high",
      fps: 24, // match 24fps AI source clips — never resample (Shotstack default is 25)
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;"
      : c === "<" ? "&lt;"
      : c === ">" ? "&gt;"
      : c === "\"" ? "&quot;"
      : "&#39;",
  );
}

/**
 * Resolve which Shotstack environment to use and the matching API key.
 *
 * The endpoint MUST match the key: sending a production key to the sandbox
 * endpoint (or vice-versa) is a 403 ("This API key belongs to the Production
 * environment and cannot be used with the Sandbox API"). The previous logic
 * defaulted to "stage" and then reused the production key on the sandbox
 * endpoint when no stage key was set — which is exactly that 403.
 *
 * Rules (endpoint and key can never mismatch):
 *   - Honor SHOTSTACK_ENV ("production"/"v1" or "stage"/"sandbox") only when
 *     that environment's key is actually configured.
 *   - Otherwise use whichever single key IS configured (prod key → v1,
 *     stage key → sandbox). This makes prod work with only SHOTSTACK_API_KEY
 *     set, regardless of SHOTSTACK_ENV.
 *   - If both keys exist and SHOTSTACK_ENV is unset, default to sandbox.
 *   - If neither key exists, throw a clear configuration error.
 */
export function resolveShotstackConfig(
  env: NodeJS.ProcessEnv = process.env,
): { environment: "stage" | "v1"; apiKey: string } {
  const prodKey = env.SHOTSTACK_API_KEY?.trim() || undefined;
  const stageKey = env.SHOTSTACK_API_KEY_STAGE?.trim() || undefined;
  const raw = (env.SHOTSTACK_ENV ?? "").toLowerCase().trim();
  const explicit =
    raw === "production" || raw === "v1"
      ? "v1"
      : raw === "stage" || raw === "sandbox"
        ? "stage"
        : undefined;

  if (!prodKey && !stageKey) {
    throw new Error(
      "Shotstack is not configured: set SHOTSTACK_API_KEY (production) or " +
        "SHOTSTACK_API_KEY_STAGE (sandbox).",
    );
  }

  let environment: "stage" | "v1";
  if (explicit === "v1" && prodKey) environment = "v1";
  else if (explicit === "stage" && stageKey) environment = "stage";
  else if (prodKey && !stageKey) environment = "v1";
  else if (stageKey && !prodKey) environment = "stage";
  else environment = explicit ?? "stage"; // both keys present, no usable explicit → sandbox

  const apiKey = (environment === "v1" ? prodKey : stageKey)!;
  return { environment, apiKey };
}

export class ShotstackProvider implements IVideoAssemblyProvider {
  readonly name = "shotstack" as const;
  private readonly apiKey: string;
  readonly environment: "stage" | "v1";
  private readonly baseUrl: string;

  constructor() {
    const { environment, apiKey } = resolveShotstackConfig();
    this.environment = environment;
    this.apiKey = apiKey;
    this.baseUrl = `https://api.shotstack.io/edit/${this.environment}`;
  }

  async assemble(params: AssembleVideoParams): Promise<AssemblyJob> {
    return this.submitRender(buildShotstackTimeline(params));
  }

  /**
   * Concatenate the given clip URLs into a single video (hard cuts, no
   * overlays/music) and submit the render. Used by the Prompt Lab
   * "Create Video" assembly path.
   */
  async assembleConcat(
    clipUrls: string[],
    aspectRatio: "16:9" | "9:16" = "16:9",
  ): Promise<AssemblyJob> {
    return this.submitRender(buildShotstackConcatTimeline(clipUrls, aspectRatio));
  }

  private async submitRender(payload: ShotstackRenderPayload): Promise<AssemblyJob> {
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
