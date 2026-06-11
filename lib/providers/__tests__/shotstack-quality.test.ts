/**
 * shotstack-quality.test.ts
 *
 * Asserts that every Shotstack render payload builder emits the maximum
 * quality tier, an explicit 30fps, and 1080p resolution.
 *
 * Root cause: Shotstack's default quality is "medium" and default fps is 25.
 * Both silently degrade the final assembled video vs. the source clips, which
 * are 30fps AI-generated video (Kling/Runway/Veo). Without explicit
 * quality:"high" + fps:30, every assembly ships at medium quality and gets
 * frame-rate-converted from 30fps source to 25fps output — a visible
 * sharpness and motion-smoothness regression on the final render.
 *
 * These tests follow TDD: written BEFORE the fix and expected to fail until
 * quality and fps are added to ShotstackRenderPayload.output.
 */

import { describe, it, expect } from "vitest";
import {
  buildShotstackConcatTimeline,
  buildShotstackTimeline,
  buildShotstackJustListedTimeline,
} from "../shotstack.js";

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const CLIP_URLS = [
  "https://cdn.example.com/a.mp4",
  "https://cdn.example.com/b.mp4",
  "https://cdn.example.com/c.mp4",
];

const ASSEMBLY_PARAMS = {
  clips: CLIP_URLS.map((url) => ({ url, durationSeconds: 5 })),
  overlays: {
    address: "5019 San Massimo Drive",
    price: "$1,850,000",
    details: "4 BD | 3.5 BA",
    agent: "Oliver Helgemo",
    brokerage: "Luxury Realty",
  },
  aspectRatio: "16:9" as const,
};

const JUST_LISTED_PARAMS = {
  clips: CLIP_URLS.map((url) => ({ url, durationSeconds: 5 })),
  overlays: {
    street: "5019 San Massimo Drive",
    cityState: "Las Vegas, NV",
    category: "Just Listed",
    agent: "Oliver Helgemo",
    brokerage: "Luxury Realty",
  },
  aspectRatio: "16:9" as const,
};

// ---------------------------------------------------------------------------
// buildShotstackConcatTimeline — Prompt Lab "Create Video" path
// ---------------------------------------------------------------------------

describe("buildShotstackConcatTimeline output quality", () => {
  it("emits quality: 'high' for maximum render quality", () => {
    const payload = buildShotstackConcatTimeline(CLIP_URLS);
    expect((payload.output as Record<string, unknown>).quality).toBe("high");
  });

  it("emits fps: 30 to match AI-generated source clips", () => {
    const payload = buildShotstackConcatTimeline(CLIP_URLS);
    expect((payload.output as Record<string, unknown>).fps).toBe(30);
  });

  it("still emits resolution: '1080' (not downgraded)", () => {
    const payload = buildShotstackConcatTimeline(CLIP_URLS);
    expect(payload.output.resolution).toBe("1080");
  });

  it("carries quality and fps through for 9:16 vertical output too", () => {
    const payload = buildShotstackConcatTimeline(CLIP_URLS, "9:16");
    expect((payload.output as Record<string, unknown>).quality).toBe("high");
    expect((payload.output as Record<string, unknown>).fps).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// buildShotstackTimeline — main overlay assembly path
// ---------------------------------------------------------------------------

describe("buildShotstackTimeline output quality", () => {
  it("emits quality: 'high'", () => {
    const payload = buildShotstackTimeline(ASSEMBLY_PARAMS);
    expect((payload.output as Record<string, unknown>).quality).toBe("high");
  });

  it("emits fps: 30", () => {
    const payload = buildShotstackTimeline(ASSEMBLY_PARAMS);
    expect((payload.output as Record<string, unknown>).fps).toBe(30);
  });

  it("still emits resolution: '1080'", () => {
    const payload = buildShotstackTimeline(ASSEMBLY_PARAMS);
    expect(payload.output.resolution).toBe("1080");
  });
});

// ---------------------------------------------------------------------------
// buildShotstackJustListedTimeline — Just Listed layout
// ---------------------------------------------------------------------------

describe("buildShotstackJustListedTimeline output quality", () => {
  it("emits quality: 'high'", () => {
    const payload = buildShotstackJustListedTimeline(JUST_LISTED_PARAMS);
    expect((payload.output as Record<string, unknown>).quality).toBe("high");
  });

  it("emits fps: 30", () => {
    const payload = buildShotstackJustListedTimeline(JUST_LISTED_PARAMS);
    expect((payload.output as Record<string, unknown>).fps).toBe(30);
  });

  it("still emits resolution: '1080'", () => {
    const payload = buildShotstackJustListedTimeline(JUST_LISTED_PARAMS);
    expect(payload.output.resolution).toBe("1080");
  });
});
