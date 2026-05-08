import { describe, expect, it } from "vitest";
import { RUBRIC_VERSION, judgeVersionFor, validateJudgeOutput } from "./judge-rubric.js";

describe("judge-rubric — RUBRIC_VERSION", () => {
  it("is a non-empty version string", () => {
    expect(RUBRIC_VERSION).toBe("v1.1");
  });
});

describe("judge-rubric — judgeVersionFor", () => {
  it("returns bare RUBRIC_VERSION for gemini-2.5-flash (backward compat with 150 existing rows)", () => {
    expect(judgeVersionFor("gemini-2.5-flash")).toBe("v1.1");
  });

  it("returns v1.1-pro for gemini-2.5-pro", () => {
    expect(judgeVersionFor("gemini-2.5-pro")).toBe("v1.1-pro");
  });

  it("slug-suffixes any other model so future runs are separable", () => {
    expect(judgeVersionFor("gemini-3-flash-preview")).toBe("v1.1-gemini-3-flash-preview");
  });
});

describe("validateJudgeOutput — happy path", () => {
  const good = {
    motion_faithfulness: 4,
    geometry_coherence: 5,
    room_consistency: 5,
    hallucination_flags: [],
    confidence: 4,
    reasoning: "Camera dollies cleanly; room intact; minor motion damping.",
    overall: 4,
  };

  it("accepts a well-formed rubric output", () => {
    const r = validateJudgeOutput(good);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.motion_faithfulness).toBe(4);
      expect(r.result.hallucination_flags).toEqual([]);
    }
  });
});

describe("validateJudgeOutput — schema failures", () => {
  it("rejects non-object", () => {
    expect(validateJudgeOutput(null).ok).toBe(false);
    expect(validateJudgeOutput("string").ok).toBe(false);
  });

  it("rejects out-of-range axis", () => {
    const r = validateJudgeOutput({
      motion_faithfulness: 7,
      geometry_coherence: 5,
      room_consistency: 5,
      hallucination_flags: [],
      confidence: 3,
      reasoning: "x",
      overall: 5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/motion_faithfulness/);
  });

  it("rejects unknown hallucination flag", () => {
    const r = validateJudgeOutput({
      motion_faithfulness: 4,
      geometry_coherence: 4,
      room_consistency: 4,
      hallucination_flags: ["fabricated_flag_name"],
      confidence: 3,
      reasoning: "x",
      overall: 4,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/hallucination_flag/);
  });

  it("rejects empty reasoning", () => {
    const r = validateJudgeOutput({
      motion_faithfulness: 4,
      geometry_coherence: 4,
      room_consistency: 4,
      hallucination_flags: [],
      confidence: 3,
      reasoning: "",
      overall: 4,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/reasoning/);
  });
});

describe("validateJudgeOutput — cross-axis hard rules", () => {
  it("geometry_coherence ≤ 2 without matching flag fails", () => {
    const r = validateJudgeOutput({
      motion_faithfulness: 4,
      geometry_coherence: 2,
      room_consistency: 4,
      hallucination_flags: [],
      confidence: 3,
      reasoning: "broken walls",
      overall: 3,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/hallucinated_geometry|hallucinated_architecture/);
  });

  it("geometry_coherence ≤ 2 WITH hallucinated_geometry flag passes", () => {
    const r = validateJudgeOutput({
      motion_faithfulness: 4,
      geometry_coherence: 2,
      room_consistency: 4,
      hallucination_flags: ["hallucinated_geometry"],
      confidence: 3,
      reasoning: "walls warp",
      overall: 3,
    });
    expect(r.ok).toBe(true);
  });

  it("motion_faithfulness ≤ 2 without motion-defect flag fails", () => {
    const r = validateJudgeOutput({
      motion_faithfulness: 2,
      geometry_coherence: 4,
      room_consistency: 4,
      hallucination_flags: [],
      confidence: 3,
      reasoning: "wrong way",
      overall: 3,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/motion-defect/);
  });

  it("room_consistency ≤ 2 without camera_exited_room flag fails", () => {
    const r = validateJudgeOutput({
      motion_faithfulness: 4,
      geometry_coherence: 4,
      room_consistency: 1,
      hallucination_flags: [],
      confidence: 3,
      reasoning: "teleport",
      overall: 3,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/camera_exited_room/);
  });

  it("motion_faithfulness ≤ 2 WITH motion-defect flag passes", () => {
    const r = validateJudgeOutput({
      motion_faithfulness: 2,
      geometry_coherence: 4,
      room_consistency: 4,
      hallucination_flags: ["wrong_motion_direction"],
      confidence: 3,
      reasoning: "rotated opposite to prompt",
      overall: 3,
    });
    expect(r.ok).toBe(true);
  });

  it("room_consistency ≤ 2 WITH camera_exited_room flag passes", () => {
    const r = validateJudgeOutput({
      motion_faithfulness: 4,
      geometry_coherence: 4,
      room_consistency: 1,
      hallucination_flags: ["camera_exited_room"],
      confidence: 3,
      reasoning: "walked through door to hallway",
      overall: 3,
    });
    expect(r.ok).toBe(true);
  });

  it("v1.1 — motion_faithfulness ≤ 2 with motion_too_static flag passes", () => {
    const r = validateJudgeOutput({
      motion_faithfulness: 2,
      geometry_coherence: 4,
      room_consistency: 4,
      hallucination_flags: ["motion_too_static"],
      confidence: 3,
      reasoning: "clip is nearly motionless; reads as a still",
      overall: 3,
    });
    expect(r.ok).toBe(true);
  });

  it("v1.1 — motion_faithfulness ≤ 2 with overshoot_target flag passes", () => {
    const r = validateJudgeOutput({
      motion_faithfulness: 2,
      geometry_coherence: 4,
      room_consistency: 4,
      hallucination_flags: ["overshoot_target"],
      confidence: 3,
      reasoning: "camera drove past the screen enclosure instead of stopping at it",
      overall: 3,
    });
    expect(r.ok).toBe(true);
  });
});
