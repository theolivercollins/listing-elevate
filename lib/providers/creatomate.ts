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

const OPENING_OVERLAY_DURATION = 2.5;
const CLOSING_OVERLAY_DURATION = 4.0;

/**
 * Build a Creatomate RenderScript from the same params the Shotstack
 * builder uses. Produces a more polished result with animated overlays,
 * modern font, and smooth transitions.
 */
export function buildCreatomateTimeline(
  params: AssembleVideoParams,
): CreatomateRenderScript {
  const { clips, overlays, aspectRatio, transition: clipTransition = "fade" } = params;

  if (clips.length === 0) {
    throw new Error("buildCreatomateTimeline: clips array is empty");
  }

  const isVertical = aspectRatio === "9:16";
  const width = isVertical ? 1080 : 1920;
  const height = isVertical ? 1920 : 1080;

  // Build video clip elements
  const videoElements: CreatomateElement[] = [];
  let cursor = 0;
  const transitionDuration = clipTransition === "none" ? 0 : 0.5;

  clips.forEach((clip, i) => {
    const start = i === 0 ? 0 : cursor - transitionDuration;
    const length = clip.durationSeconds;

    const element: CreatomateElement = {
      type: "video",
      source: clip.url,
      track: 1,
      time: start,
      duration: length,
    };

    // Add transition animations on clips 2+
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

  // Opening overlay — address
  const priceLine = `${overlays.price} | ${overlays.details}`;
  const agentLine = overlays.brokerage
    ? `${overlays.agent} | ${overlays.brokerage}`
    : overlays.agent;

  const titleFontSize = isVertical ? "6.5 vmin" : "4.5 vmin";
  const subtitleFontSize = isVertical ? "4 vmin" : "3 vmin";

  const openingTitle: CreatomateElement = {
    type: "text",
    text: overlays.address,
    track: 2,
    time: 0,
    duration: OPENING_OVERLAY_DURATION,
    y: "75%",
    width: "80%",
    x_anchor: "50%",
    y_anchor: "50%",
    font_family: "Inter",
    font_size: titleFontSize,
    font_weight: "600",
    color: "#ffffff",
    // Text shadow for readability over video
    background_color: "rgba(0,0,0,0)",
    animations: [
      {
        type: "text-appear",
        time: "start",
        duration: "0.8",
        easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
      },
      {
        type: "fade",
        time: "end",
        duration: "0.6",
        easing: "linear",
        fade: false,
      },
    ],
  };

  // Closing overlays — price + agent
  const closingStart = Math.max(0, totalDuration - CLOSING_OVERLAY_DURATION);

  const closingPrice: CreatomateElement = {
    type: "text",
    text: priceLine,
    track: 2,
    time: closingStart,
    duration: CLOSING_OVERLAY_DURATION,
    y: "45%",
    width: "80%",
    x_anchor: "50%",
    y_anchor: "50%",
    font_family: "Inter",
    font_size: titleFontSize,
    font_weight: "600",
    color: "#ffffff",
    animations: [
      {
        type: "fade",
        time: "start",
        duration: "0.8",
        easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
        fade: true,
      },
      {
        type: "fade",
        time: "end",
        duration: "0.6",
        easing: "linear",
        fade: false,
      },
    ],
  };

  const closingAgent: CreatomateElement = {
    type: "text",
    text: agentLine,
    track: 2,
    time: closingStart,
    duration: CLOSING_OVERLAY_DURATION,
    y: "55%",
    width: "80%",
    x_anchor: "50%",
    y_anchor: "50%",
    font_family: "Inter",
    font_size: subtitleFontSize,
    font_weight: "400",
    color: "rgba(255,255,255,0.85)",
    animations: [
      {
        type: "fade",
        time: "start",
        duration: "0.8",
        easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
        fade: true,
      },
      {
        type: "fade",
        time: "end",
        duration: "0.6",
        easing: "linear",
        fade: false,
      },
    ],
  };

  // Semi-transparent dark gradient for text readability at opening/closing
  const openingGradient: CreatomateElement = {
    type: "composition",
    track: 3,
    time: 0,
    duration: OPENING_OVERLAY_DURATION,
    color_overlay: "linear-gradient(0deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 60%)",
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
    color_overlay: "linear-gradient(0deg, rgba(0,0,0,0) 20%, rgba(0,0,0,0.55) 100%)",
    animations: [
      { type: "fade", time: "start", duration: "0.8", fade: true },
      { type: "fade", time: "end", duration: "0.5", fade: false },
    ],
  };

  return {
    output_format: "mp4",
    width,
    height,
    frame_rate: 30,
    elements: [
      ...videoElements,
      openingGradient,
      openingTitle,
      closingGradient,
      closingPrice,
      closingAgent,
    ],
  };
}

// ---------------------------------------------------------------------------
// Provider Implementation
// ---------------------------------------------------------------------------

export class CreatomateProvider implements IVideoAssemblyProvider {
  readonly name = "creatomate" as const;

  private readonly apiKey: string;
  private readonly baseUrl = "https://api.creatomate.com/v1";

  constructor() {
    const key = process.env.CREATOMATE_API_KEY;
    if (!key) {
      throw new Error("CREATOMATE_API_KEY is required");
    }
    this.apiKey = key;
  }

  async assemble(params: AssembleVideoParams): Promise<AssemblyJob> {
    const renderScript = buildCreatomateTimeline(params);

    const response = await fetch(`${this.baseUrl}/renders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source: renderScript }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(
        `Creatomate render submit failed: ${response.status} ${err}`,
      );
    }

    const data = (await response.json()) as CreatomateRenderResponse[];

    // Creatomate returns an array of render objects (one per output)
    const render = Array.isArray(data) ? data[0] : data;
    if (!render?.id) {
      throw new Error("Creatomate render submit returned no ID");
    }

    return {
      jobId: render.id,
      environment: "v1" as const,
    };
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
        // Creatomate doesn't return duration in the render response,
        // but the video is the timeline duration we specified.
      };
    }

    if (render.status === "failed") {
      return {
        status: "failed",
        error: render.error_message ?? "Creatomate render failed",
      };
    }

    // Still rendering
    return { status: "processing" };
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
