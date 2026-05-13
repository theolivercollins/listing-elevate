/**
 * Creatomate Video Assembly Provider
 *
 * Implements the IVideoAssemblyProvider interface to render assembled
 * listing videos via Creatomate's REST API. Designed as a drop-in
 * replacement for ShotstackProvider with superior overlay/branding.
 *
 * Creatomate supports two modes:
 *   1. Template + Modifications — use a pre-designed template and swap fields
 *   2. RenderScript — full JSON timeline control (like Shotstack's Edit API)
 *
 * We use mode 2 (RenderScript) for maximum LLM-editability in the revision
 * chatbot. The JSON schema is clean and LLM-friendly.
 */

import type {
  AssembleVideoParams,
  AssemblyJob,
  AssemblyResult,
  IVideoAssemblyProvider,
} from "./shotstack.js";

// ---------------------------------------------------------------------------
// Creatomate RenderScript Types
// ---------------------------------------------------------------------------

interface CreatomateElement {
  type: "video" | "text" | "image" | "audio" | "composition";
  source?: string;
  text?: string;
  track?: number;
  time?: number | string;
  duration?: number | string;
  x?: string;
  y?: string;
  width?: string;
  height?: string;
  x_anchor?: string;
  y_anchor?: string;
  font_family?: string;
  font_size?: string;
  font_weight?: string;
  color?: string;
  background_color?: string;
  color_overlay?: string;
  opacity?: string;
  // Animations
  animations?: CreatomateAnimation[];
  // Additional properties
  [key: string]: unknown;
}

interface CreatomateAnimation {
  type?: string;
  time?: string;
  duration?: string;
  easing?: string;
  scope?: string;
  fade?: boolean;
  [key: string]: unknown;
}

export interface CreatomateRenderScript {
  output_format: "mp4" | "gif" | "png" | "jpg";
  width: number;
  height: number;
  duration?: number | null;
  frame_rate?: number;
  elements: CreatomateElement[];
  // Metadata for the revision engine
  [key: string]: unknown;
}

interface CreatomateRenderResponse {
  id: string;
  status: "planned" | "waiting" | "transcribing" | "rendering" | "succeeded" | "failed";
  url?: string;
  error_message?: string;
}

// ---------------------------------------------------------------------------
// Timeline Builder
// ---------------------------------------------------------------------------

// Opening title hold scales with total video duration — buyer should be
// able to read the address comfortably. 25% of total length per Oliver
// 2026-05-13. Floored at 4s so short test renders still look reasonable.
const OPENING_OVERLAY_RATIO = 0.25;
const OPENING_OVERLAY_MIN = 4.0;
const CLOSING_OVERLAY_DURATION = 4.0;

/**
 * Build a Creatomate RenderScript from the same params the Shotstack
 * builder uses. Default is hard cuts between clips with simple fade
 * in/out on overlays — no Ken-Burns zoom, no slide transitions, no
 * scale keyframing (per Oliver's style brief 2026-05-13).
 */
export function buildCreatomateTimeline(
  params: AssembleVideoParams,
): CreatomateRenderScript {
  const { clips, overlays, aspectRatio, transition: clipTransition = "none", music } = params;

  if (clips.length === 0) {
    throw new Error("buildCreatomateTimeline: clips array is empty");
  }

  const isVertical = aspectRatio === "9:16";
  const width = isVertical ? 1080 : 1920;
  const height = isVertical ? 1920 : 1080;

  // Branding: brand color tints the closing accent bar; logo (if provided)
  // becomes a corner watermark visible for the entire timeline.
  const primaryColor = overlays.primaryColor ?? "#ffffff";
  const logoUrl = overlays.logoUrl ?? null;

  // Build video clip elements
  const videoElements: CreatomateElement[] = [];
  let cursor = 0;
  const transitionDuration = clipTransition === "none" ? 0 : 0.5;

  clips.forEach((clip, i) => {
    const start = i === 0 ? 0 : cursor - transitionDuration;
    const length = clip.durationSeconds;

    // Hard cuts by default — no animations, no scale, no zoom. Creatomate
    // applies no implicit Ken-Burns to video elements that don't request it.
    const element: CreatomateElement = {
      type: "video",
      source: clip.url,
      track: 1,
      time: start,
      duration: length,
    };

    // Only attach a transition when the caller explicitly asks for one.
    // Default in Listing Elevate is hard cuts.
    if (i > 0 && clipTransition !== "none") {
      element.animations = [
        {
          type: clipTransition === "fade" ? "fade" : "slide",
          time: "start",
          duration: `${transitionDuration}`,
          easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
          fade: true,
        },
      ];
    }

    videoElements.push(element);
    cursor = start + length;
  });

  const totalDuration = cursor;

  // Opening overlay — address. Scales with total duration so the buyer
  // gets to read it: 25% of total, floored at 4s.
  const openingDuration = Math.max(
    OPENING_OVERLAY_MIN,
    totalDuration * OPENING_OVERLAY_RATIO,
  );

  const priceLine = `${overlays.price} | ${overlays.details}`;
  const agentLine = overlays.brokerage
    ? `${overlays.agent} | ${overlays.brokerage}`
    : overlays.agent;

  const titleFontSize = isVertical ? "6.5 vmin" : "4.5 vmin";
  const subtitleFontSize = isVertical ? "4 vmin" : "3 vmin";

  // Lower-third anchor: text sits in the bottom band of the frame
  // (around y=75–80%) for both opener and closer — broadcast graphic
  // style, not a centered title card.
  const lowerThirdPriceY = "73%";
  const lowerThirdAgentY = "80%";
  const lowerThirdAccentY = "67%";

  const openingTitle: CreatomateElement = {
    type: "text",
    text: overlays.address,
    track: 2,
    time: 0,
    duration: openingDuration,
    y: lowerThirdPriceY,
    width: "80%",
    x_anchor: "50%",
    y_anchor: "50%",
    font_family: "Inter",
    font_size: titleFontSize,
    font_weight: "600",
    color: "#ffffff",
    background_color: "rgba(0,0,0,0)",
    // Simple fade in/out only — no text-appear scale animation, no zoom.
    animations: [
      { type: "fade", time: "start", duration: "0.6", fade: true },
      { type: "fade", time: "end", duration: "0.5", fade: false },
    ],
  };

  // Closing overlays — price + agent stacked tight in the same lower-third
  // band as the opener, so the visual rhythm matches.
  const closingStart = Math.max(0, totalDuration - CLOSING_OVERLAY_DURATION);

  const closingPrice: CreatomateElement = {
    type: "text",
    text: priceLine,
    track: 2,
    time: closingStart,
    duration: CLOSING_OVERLAY_DURATION,
    y: lowerThirdPriceY,
    width: "80%",
    x_anchor: "50%",
    y_anchor: "50%",
    font_family: "Inter",
    font_size: titleFontSize,
    font_weight: "600",
    color: "#ffffff",
    animations: [
      { type: "fade", time: "start", duration: "0.6", fade: true },
      { type: "fade", time: "end", duration: "0.5", fade: false },
    ],
  };

  const closingAgent: CreatomateElement = {
    type: "text",
    text: agentLine,
    track: 2,
    time: closingStart,
    duration: CLOSING_OVERLAY_DURATION,
    y: lowerThirdAgentY,
    width: "80%",
    x_anchor: "50%",
    y_anchor: "50%",
    font_family: "Inter",
    font_size: subtitleFontSize,
    font_weight: "400",
    color: "rgba(255,255,255,0.85)",
    animations: [
      { type: "fade", time: "start", duration: "0.6", fade: true },
      { type: "fade", time: "end", duration: "0.5", fade: false },
    ],
  };

  // Semi-transparent dark gradient at the BOTTOM of the frame for text
  // readability — both opener and closer overlays sit in the lower third.
  const lowerThirdGradient = "linear-gradient(0deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0) 100%)";
  const openingGradient: CreatomateElement = {
    type: "composition",
    track: 3,
    time: 0,
    duration: openingDuration,
    // Gradient covers the bottom 40% of the frame.
    y: "80%",
    x_anchor: "50%",
    y_anchor: "50%",
    width: "100%",
    height: "40%",
    color_overlay: lowerThirdGradient,
    animations: [
      { type: "fade", time: "start", duration: "0.5", fade: true },
      { type: "fade", time: "end", duration: "0.5", fade: false },
    ],
  };

  const closingGradient: CreatomateElement = {
    type: "composition",
    track: 3,
    time: closingStart,
    duration: CLOSING_OVERLAY_DURATION,
    y: "80%",
    x_anchor: "50%",
    y_anchor: "50%",
    width: "100%",
    height: "40%",
    color_overlay: lowerThirdGradient,
    animations: [
      { type: "fade", time: "start", duration: "0.6", fade: true },
      { type: "fade", time: "end", duration: "0.5", fade: false },
    ],
  };

  // Brand-color accent line just above the closing price text — a thin
  // horizontal bar that subtly ties the video to the brokerage palette.
  // Sits at the top edge of the lower-third stack.
  const closingAccent: CreatomateElement = {
    type: "composition",
    track: 2,
    time: closingStart + 0.3,
    duration: CLOSING_OVERLAY_DURATION - 0.3,
    y: lowerThirdAccentY,
    x_anchor: "50%",
    y_anchor: "50%",
    width: "6%",
    height: "0.35%",
    background_color: primaryColor,
    animations: [
      { type: "fade", time: "start", duration: "0.5", fade: true },
      { type: "fade", time: "end", duration: "0.4", fade: false },
    ],
  };

  // Corner watermark logo — visible for the entire timeline at low opacity
  // so it doesn't compete with the main overlays. Only added when a logo
  // URL was provided.
  const logoElements: CreatomateElement[] = logoUrl
    ? [
        {
          type: "image",
          source: logoUrl,
          track: 4,
          time: 0,
          duration: totalDuration,
          // Top-right corner, ~8% of the frame width on 16:9 (12% on 9:16
          // so the logo doesn't get lost in the narrower frame).
          x: isVertical ? "85%" : "92%",
          y: "7%",
          x_anchor: "50%",
          y_anchor: "50%",
          width: isVertical ? "20%" : "12%",
          opacity: "85%",
        },
      ]
    : [];

  // Background music — single audio element trimmed to the timeline
  // duration, ducked to a low volume (~18%) so it sits under overlays
  // and any future voiceover track. Fades in/out for polish.
  const musicElements: CreatomateElement[] = music?.url
    ? [
        {
          type: "audio",
          source: music.url,
          track: 5,
          time: 0,
          duration: totalDuration,
          // Creatomate accepts numeric `volume` 0..1 or a percentage string.
          // We pass a percentage string for readability in the rendered
          // RenderScript JSON.
          volume: `${Math.round((music.volume ?? 0.18) * 100)}%`,
          animations: [
            { type: "fade", time: "start", duration: "1.0", fade: true },
            { type: "fade", time: "end", duration: "1.5", fade: false },
          ],
        },
      ]
    : [];

  return {
    output_format: "mp4",
    width,
    height,
    frame_rate: 30,
    // Explicit timeline duration — Creatomate /v2/renders defaults to 5s
    // when this is omitted, regardless of how long the elements run.
    duration: totalDuration,
    elements: [
      ...videoElements,
      openingGradient,
      openingTitle,
      closingGradient,
      closingAccent,
      closingPrice,
      closingAgent,
      ...logoElements,
      ...musicElements,
    ],
  };
}

// ---------------------------------------------------------------------------
// Provider Implementation
// ---------------------------------------------------------------------------

/** Options for assembleFromTemplate. */
export interface TemplateRenderOptions {
  /** Modification dict keyed by template element name (e.g. "St#/StName.text"). */
  modifications: Record<string, string | number | null>;
  /** Override output resolution. Creatomate default is the template's canvas
   *  scaled by render_scale. We pass explicit dimensions to force HD. */
  width?: number;
  height?: number;
  /** 0..1; 1 = full template canvas. Default 1 (production quality). The
   *  Creatomate template default of 0.375 produces a 480×270 thumbnail. */
  renderScale?: number;
}

export class CreatomateProvider implements IVideoAssemblyProvider {
  readonly name = "creatomate" as const;

  private readonly apiKey: string;
  // /v2/renders is the current API (per Creatomate docs 2026-05). The older
  // /v1/renders still works but returns a slightly different response shape
  // (array vs single object). We use v2 everywhere for consistency.
  private readonly baseUrl = "https://api.creatomate.com/v2";
  // /v1/templates is the template-metadata endpoint — Creatomate did not
  // bump that one to v2 yet; keep it on v1.
  private readonly templatesBaseUrl = "https://api.creatomate.com/v1";

  constructor() {
    const key = process.env.CREATOMATE_API_KEY;
    if (!key) {
      throw new Error("CREATOMATE_API_KEY is required");
    }
    this.apiKey = key;
  }

  /** Code-generated RenderScript path — used when no template_id is configured.
   *  Builds a timeline from clips + overlays via buildCreatomateTimeline(). */
  async assemble(params: AssembleVideoParams): Promise<AssemblyJob> {
    const renderScript = buildCreatomateTimeline(params);

    // /v2/renders expects the RenderScript fields spread at the TOP LEVEL —
    // NOT wrapped in a `source:` object (that was the v1 convention).
    // Wrapping causes Creatomate to silently fall back to a default 5-second
    // 480×270 draft regardless of what's inside.  We also force render_scale
    // explicitly so the account-default draft scale doesn't apply.
    const response = await fetch(`${this.baseUrl}/renders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...renderScript,
        render_scale: 1,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(
        `Creatomate render submit failed: ${response.status} ${err}`,
      );
    }

    const data = (await response.json()) as
      | CreatomateRenderResponse
      | CreatomateRenderResponse[];

    // v1 returned an array of render objects; v2 returns a single object.
    // Handle both for safety.
    const render = Array.isArray(data) ? data[0] : data;
    if (!render?.id) {
      throw new Error("Creatomate render submit returned no ID");
    }

    return {
      jobId: render.id,
      environment: "v1" as const,
    };
  }

  /**
   * Template-driven render. Pass a Creatomate template_id + a modifications
   * dict. Output dimensions + render_scale are forced to production-quality
   * defaults (1920×1080 @ scale 1.0) so the response isn't a thumbnail.
   */
  async assembleFromTemplate(
    templateId: string,
    opts: TemplateRenderOptions,
  ): Promise<AssemblyJob> {
    const body: Record<string, unknown> = {
      template_id: templateId,
      modifications: opts.modifications,
      render_scale: opts.renderScale ?? 1,
    };
    if (opts.width) body.width = opts.width;
    if (opts.height) body.height = opts.height;

    const response = await fetch(`${this.baseUrl}/renders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(
        `Creatomate template render submit failed: ${response.status} ${err}`,
      );
    }

    const data = (await response.json()) as
      | CreatomateRenderResponse
      | CreatomateRenderResponse[];
    const render = Array.isArray(data) ? data[0] : data;
    if (!render?.id) {
      throw new Error("Creatomate template render submit returned no ID");
    }

    return { jobId: render.id, environment: "v1" as const };
  }

  async checkStatus(job: AssemblyJob): Promise<AssemblyResult> {
    const response = await fetch(`${this.baseUrl}/renders/${job.jobId}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Creatomate status check failed: ${response.status}`);
    }

    const render = (await response.json()) as CreatomateRenderResponse;

    if (render.status === "succeeded") {
      return {
        status: "complete",
        videoUrl: render.url,
      };
    }

    if (render.status === "failed") {
      return {
        status: "failed",
        error: render.error_message ?? "Creatomate render failed",
      };
    }

    return { status: "processing" };
  }

  /**
   * Fetch a template's metadata + element list. Useful for discovering
   * which placeholder names a given template_id exposes. Templates live
   * on /v1 (Creatomate didn't migrate that endpoint to v2).
   */
  async getTemplate(templateId: string): Promise<{
    name: string;
    width: number;
    height: number;
    elements: Array<{ name: string; type: string; dynamic: string[] }>;
  }> {
    const response = await fetch(`${this.templatesBaseUrl}/templates/${templateId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!response.ok) {
      throw new Error(`Creatomate template fetch failed: ${response.status}`);
    }
    const data = (await response.json()) as {
      name?: string;
      source?: {
        width?: number;
        height?: number;
        elements?: Array<{ name?: string; type?: string; dynamic?: string[] }>;
      };
    };
    const src = data.source ?? {};
    return {
      name: data.name ?? "",
      width: src.width ?? 0,
      height: src.height ?? 0,
      elements: (src.elements ?? []).map((e) => ({
        name: e.name ?? "",
        type: e.type ?? "",
        dynamic: e.dynamic ?? [],
      })),
    };
  }
}

// ---------------------------------------------------------------------------
// Cost helpers
// ---------------------------------------------------------------------------

// Creatomate credit consumption: ~28 credits per minute of 1080p 30fps video.
// At Essential plan ($54/mo for 2,000 credits), that's ~$0.76 per output minute.
// We express cost in cents for consistency with the rest of the system.
const CREATOMATE_CENTS_PER_MINUTE = parseInt(
  process.env.CREATOMATE_CENTS_PER_MINUTE ?? "76",
  10,
);

/**
 * Compute Creatomate cost in cents for a rendered output of the given duration.
 * Rounds duration up to the nearest minute for simplicity.
 */
export function creatomateCostCents(outputDurationSeconds: number): number {
  const minutes = Math.ceil(outputDurationSeconds / 60);
  return minutes * CREATOMATE_CENTS_PER_MINUTE;
}
