// TDD tests for gateVerticalHeadroom helper
// DA.1 fix: drone_push_in and top_down headroom must be FALSE unless the
// source photo is already shot from above (aerial | elevated | overhead).

import { describe, it, expect } from "vitest";
import { gateVerticalHeadroom } from "./gemini-analyzer.js";
import type { MotionHeadroom, ExtendedPhotoAnalysis } from "./gemini-analyzer.js";

// ─── Helpers ────────────────────────────────────────────────────────────

function makeAnalysis(
  camera_height: string,
  headroom: Partial<MotionHeadroom>,
  rationale?: Partial<Record<string, string>>,
): ExtendedPhotoAnalysis {
  return {
    room_type: "exterior_front" as never,
    quality_score: 8,
    aesthetic_score: 7,
    depth_rating: "medium" as never,
    key_features: [],
    composition: "test",
    suggested_discard: false,
    discard_reason: null,
    video_viable: true,
    suggested_motion: null,
    motion_rationale: null,
    camera_height: camera_height as never,
    camera_tilt: "level" as never,
    frame_coverage: "wide_establishing" as never,
    motion_headroom: {
      push_in: false,
      pull_out: false,
      orbit: false,
      parallax: false,
      drone_push_in: false,
      top_down: false,
      ...headroom,
    },
    motion_headroom_rationale: {
      push_in: "ok",
      pull_out: "ok",
      orbit: "ok",
      parallax: "ok",
      drone_push_in: "open sky allows aerial approach",
      top_down: "can rise to overhead",
      ...rationale,
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("gateVerticalHeadroom", () => {
  it("eye_level: forces drone_push_in and top_down to false, leaves push_in untouched", () => {
    const input = makeAnalysis("eye_level", {
      drone_push_in: true,
      top_down: true,
      push_in: true,
    });

    const result = gateVerticalHeadroom(input);

    expect(result.motion_headroom.drone_push_in).toBe(false);
    expect(result.motion_headroom.top_down).toBe(false);
    expect(result.motion_headroom.push_in).toBe(true); // untouched
  });

  it("eye_level: appends gate note to rationale for the two gated keys", () => {
    const input = makeAnalysis("eye_level", {
      drone_push_in: true,
      top_down: true,
    });

    const result = gateVerticalHeadroom(input);

    expect(result.motion_headroom_rationale.drone_push_in).toMatch(/gated/);
    expect(result.motion_headroom_rationale.drone_push_in).toMatch(/eye_level/);
    expect(result.motion_headroom_rationale.top_down).toMatch(/gated/);
    expect(result.motion_headroom_rationale.top_down).toMatch(/eye_level/);
  });

  it("aerial: leaves drone_push_in and top_down true (no change)", () => {
    const input = makeAnalysis("aerial", {
      drone_push_in: true,
      top_down: true,
    });

    const result = gateVerticalHeadroom(input);

    expect(result.motion_headroom.drone_push_in).toBe(true);
    expect(result.motion_headroom.top_down).toBe(true);
  });

  it("elevated: leaves drone_push_in and top_down true (no change)", () => {
    const input = makeAnalysis("elevated", {
      drone_push_in: true,
      top_down: true,
    });

    const result = gateVerticalHeadroom(input);

    expect(result.motion_headroom.drone_push_in).toBe(true);
    expect(result.motion_headroom.top_down).toBe(true);
  });

  it("overhead: leaves drone_push_in and top_down true (no change)", () => {
    const input = makeAnalysis("overhead", {
      drone_push_in: true,
      top_down: true,
    });

    const result = gateVerticalHeadroom(input);

    expect(result.motion_headroom.drone_push_in).toBe(true);
    expect(result.motion_headroom.top_down).toBe(true);
  });

  it("low: forces drone_push_in and top_down to false", () => {
    const input = makeAnalysis("low", {
      drone_push_in: true,
      top_down: true,
    });

    const result = gateVerticalHeadroom(input);

    expect(result.motion_headroom.drone_push_in).toBe(false);
    expect(result.motion_headroom.top_down).toBe(false);
  });

  it("does NOT mutate the input object", () => {
    const input = makeAnalysis("eye_level", {
      drone_push_in: true,
      top_down: true,
    });
    const originalDronePushIn = input.motion_headroom.drone_push_in;
    const originalTopDown = input.motion_headroom.top_down;

    gateVerticalHeadroom(input);

    expect(input.motion_headroom.drone_push_in).toBe(originalDronePushIn);
    expect(input.motion_headroom.top_down).toBe(originalTopDown);
  });

  it("does NOT mutate the nested motion_headroom object", () => {
    const headroom = {
      push_in: true,
      pull_out: true,
      orbit: true,
      parallax: true,
      drone_push_in: true,
      top_down: true,
    };
    const input = makeAnalysis("eye_level", headroom);
    const originalHeadroomRef = input.motion_headroom;

    gateVerticalHeadroom(input);

    // The original headroom object should be unchanged
    expect(originalHeadroomRef.drone_push_in).toBe(true);
    expect(originalHeadroomRef.top_down).toBe(true);
  });

  it("returns unchanged analysis when motion_headroom is null", () => {
    const input = makeAnalysis("eye_level", {});
    const inputWithNullHeadroom = { ...input, motion_headroom: null as never };

    const result = gateVerticalHeadroom(inputWithNullHeadroom);

    expect(result).toBe(inputWithNullHeadroom);
  });

  it("only adds rationale note when flag was previously true (drone_push_in already false)", () => {
    const originalRationale = "camera too low for drone approach";
    const input = makeAnalysis(
      "eye_level",
      { drone_push_in: false },
      { drone_push_in: originalRationale },
    );

    const result = gateVerticalHeadroom(input);

    // Should NOT append gating note since it was already false
    expect(result.motion_headroom_rationale.drone_push_in).toBe(originalRationale);
  });

  it("leaves pull_out, orbit, parallax flags untouched even for eye_level", () => {
    const input = makeAnalysis("eye_level", {
      push_in: true,
      pull_out: true,
      orbit: true,
      parallax: true,
      drone_push_in: true,
      top_down: true,
    });

    const result = gateVerticalHeadroom(input);

    expect(result.motion_headroom.pull_out).toBe(true);
    expect(result.motion_headroom.orbit).toBe(true);
    expect(result.motion_headroom.parallax).toBe(true);
  });
});
