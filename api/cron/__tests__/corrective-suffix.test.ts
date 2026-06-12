/**
 * Unit tests for buildCorrectiveSuffix — the pure helper that turns judge
 * hallucination_flags into corrective render guidance appended to the prompt
 * on a QC re-render.
 */

import { describe, it, expect } from "vitest";
import { buildCorrectiveSuffix } from "../poll-scenes.js";

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
