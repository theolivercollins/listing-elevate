/**
 * Unit tests for buildCorrectiveSuffix — the pure helper that turns judge
 * hallucination_flags into corrective render guidance appended to the prompt
 * on a QC re-render.
 */

import { describe, it, expect } from "vitest";
import { buildCorrectiveSuffix, passingThreshold } from "../poll-scenes.js";

describe("buildCorrectiveSuffix", () => {
  it("includes each provided flag verbatim", () => {
    const suffix = buildCorrectiveSuffix(["hallucinated_geometry", "camera_exited_room"]);
    expect(suffix).toContain("hallucinated_geometry");
    expect(suffix).toContain("camera_exited_room");
  });

  it("includes the keep-camera-inside-the-room / do-not-invent-geometry guidance", () => {
    const suffix = buildCorrectiveSuffix(["hallucinated_geometry"]);
    expect(suffix.toLowerCase()).toContain("keep the camera inside the room");
    expect(suffix.toLowerCase()).toContain("do not invent geometry");
  });

  it("handles an empty flag array (still emits the standing guidance, no defects list)", () => {
    const suffix = buildCorrectiveSuffix([]);
    expect(typeof suffix).toBe("string");
    expect(suffix.length).toBeGreaterThan(0);
    // Standing guidance is always present.
    expect(suffix.toLowerCase()).toContain("keep the camera inside the room");
    // No "Avoid these defects:" list when there are no flags.
    expect(suffix).not.toContain("Avoid these defects:");
  });

  it("emits an 'Avoid these defects:' list when flags are present", () => {
    const suffix = buildCorrectiveSuffix(["wrong_motion_direction"]);
    expect(suffix).toContain("Avoid these defects:");
    expect(suffix).toContain("wrong_motion_direction");
  });
});

describe("passingThreshold — scene-count-aware QC gate (ceil(n * 0.8))", () => {
  // 15s video: ~4 scenes. All 4 passing must be sufficient → threshold = 4.
  // Before fix the threshold was hardcoded to 6, so 4/4 passed < 6 → wrongly
  // forced needs_review.
  it("4-scene video: threshold is 4 (all 4 must pass)", () => {
    expect(passingThreshold(4)).toBe(4);
  });

  // finalStatus logic: needs_review only when needsReview > 0 AND passed < threshold.
  // 4-scene video with 4 passed and 0 needsReview → complete (not needs_review).
  it("4-scene video, 4 passed 0 needs_review → would be 'complete' (passed >= threshold)", () => {
    const total = 4;
    const passed = 4;
    const threshold = passingThreshold(total);
    expect(passed >= threshold).toBe(true);
  });

  // 5-scene video: ceil(5 * 0.8) = ceil(4) = 4. 3 passed < 4 → needs_review.
  it("5-scene video: threshold is 4", () => {
    expect(passingThreshold(5)).toBe(4);
  });

  it("5-scene video, 3 passed → would be 'needs_review' (passed < threshold)", () => {
    const total = 5;
    const passed = 3;
    const threshold = passingThreshold(total);
    expect(passed < threshold).toBe(true);
  });

  // Boundary checks for common video lengths.
  it("6-scene video: threshold is 5 (ceil(4.8) = 5)", () => {
    expect(passingThreshold(6)).toBe(5);
  });

  it("8-scene video (max clip-slot cap): threshold is 7 (ceil(6.4) = 7)", () => {
    expect(passingThreshold(8)).toBe(7);
  });

  it("1-scene video: threshold is 1", () => {
    expect(passingThreshold(1)).toBe(1);
  });
});
