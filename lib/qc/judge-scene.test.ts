/**
 * Tests for lib/qc/judge-scene.ts
 * TDD: written before the implementation file exists.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JudgeRubricResult } from "../prompts/judge-rubric.js";

// ============================================================================
// Helpers — build minimal valid JudgeRubricResult fixtures
// ============================================================================

function makeRubric(overrides: Partial<JudgeRubricResult>): JudgeRubricResult {
  return {
    motion_faithfulness: 4,
    geometry_coherence: 4,
    room_consistency: 4,
    hallucination_flags: [],
    confidence: 4,
    reasoning: "Clip looks clean.",
    overall: 4,
    ...overrides,
  };
}

// ============================================================================
// Unit tests: sceneVerdictFromRubric (pure function)
// ============================================================================

describe("sceneVerdictFromRubric", () => {
  // Lazy import so vitest module mocking can be set up before the tested
  // module is loaded. We import here via dynamic import in each test group.
  it("clean clip → qc_pass", async () => {
    const { sceneVerdictFromRubric } = await import("./judge-scene.js");
    const rubric = makeRubric({});
    const result = sceneVerdictFromRubric(rubric);
    expect(result.verdict).toBe("qc_pass");
    expect(result.shouldRerender).toBe(false);
  });

  it("hallucinated_geometry flag → qc_hard_reject + shouldRerender:true", async () => {
    const { sceneVerdictFromRubric } = await import("./judge-scene.js");
    const rubric = makeRubric({
      hallucination_flags: ["hallucinated_geometry"],
      geometry_coherence: 2,
      overall: 2,
    });
    const result = sceneVerdictFromRubric(rubric);
    expect(result.verdict).toBe("qc_hard_reject");
    expect(result.shouldRerender).toBe(true);
  });

  it("hallucinated_architecture flag → qc_hard_reject + shouldRerender:true", async () => {
    const { sceneVerdictFromRubric } = await import("./judge-scene.js");
    const rubric = makeRubric({
      hallucination_flags: ["hallucinated_architecture"],
      geometry_coherence: 2,
      overall: 3,
    });
    const result = sceneVerdictFromRubric(rubric);
    expect(result.verdict).toBe("qc_hard_reject");
    expect(result.shouldRerender).toBe(true);
  });

  it("camera_exited_room flag → qc_hard_reject + shouldRerender:true", async () => {
    const { sceneVerdictFromRubric } = await import("./judge-scene.js");
    const rubric = makeRubric({
      hallucination_flags: ["camera_exited_room"],
      room_consistency: 2,
      overall: 3,
    });
    const result = sceneVerdictFromRubric(rubric);
    expect(result.verdict).toBe("qc_hard_reject");
    expect(result.shouldRerender).toBe(true);
  });

  it("wrong_motion_direction flag → qc_hard_reject + shouldRerender:true", async () => {
    const { sceneVerdictFromRubric } = await import("./judge-scene.js");
    const rubric = makeRubric({
      hallucination_flags: ["wrong_motion_direction"],
      motion_faithfulness: 2,
      overall: 3,
    });
    const result = sceneVerdictFromRubric(rubric);
    expect(result.verdict).toBe("qc_hard_reject");
    expect(result.shouldRerender).toBe(true);
  });

  it("geometry_coherence <= 2 (no explicit flag in input) → qc_hard_reject", async () => {
    const { sceneVerdictFromRubric } = await import("./judge-scene.js");
    // geometry_coherence=2 without the flags — pure score check
    const rubric = makeRubric({
      geometry_coherence: 2,
      hallucination_flags: ["hallucinated_geometry"], // rubric validator requires this
      overall: 3,
    });
    const result = sceneVerdictFromRubric(rubric);
    expect(result.verdict).toBe("qc_hard_reject");
    expect(result.shouldRerender).toBe(true);
  });

  it("room_consistency <= 2 → qc_hard_reject", async () => {
    const { sceneVerdictFromRubric } = await import("./judge-scene.js");
    const rubric = makeRubric({
      room_consistency: 2,
      hallucination_flags: ["camera_exited_room"],
      overall: 3,
    });
    const result = sceneVerdictFromRubric(rubric);
    expect(result.verdict).toBe("qc_hard_reject");
    expect(result.shouldRerender).toBe(true);
  });

  it("low overall (<=2) but no fabrication flags → qc_soft_reject + shouldRerender:false", async () => {
    const { sceneVerdictFromRubric } = await import("./judge-scene.js");
    const rubric = makeRubric({
      motion_faithfulness: 2,
      geometry_coherence: 3,
      room_consistency: 3,
      hallucination_flags: ["too_slow"], // motion defect required by rubric at <=2
      overall: 2,
    });
    const result = sceneVerdictFromRubric(rubric);
    expect(result.verdict).toBe("qc_soft_reject");
    expect(result.shouldRerender).toBe(false);
  });

  it("returns a non-empty reason string for each verdict", async () => {
    const { sceneVerdictFromRubric } = await import("./judge-scene.js");
    const clean = sceneVerdictFromRubric(makeRubric({}));
    expect(typeof clean.reason).toBe("string");
    expect(clean.reason.length).toBeGreaterThan(0);

    const hard = sceneVerdictFromRubric(
      makeRubric({ hallucination_flags: ["camera_exited_room"], room_consistency: 2, overall: 2 }),
    );
    expect(typeof hard.reason).toBe("string");
    expect(hard.reason.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Integration tests: judgeProductionScene (mocked judgeLabIteration)
// ============================================================================

vi.mock("../providers/gemini-judge.js", () => {
  const { JudgeDisabledError: Err } = vi.importActual<typeof import("../providers/gemini-judge.js")>(
    "../providers/gemini-judge.js",
  );
  return {
    JudgeDisabledError: Err ?? class JudgeDisabledError extends Error {
      constructor() {
        super("judge disabled");
        this.name = "JudgeDisabledError";
      }
    },
    judgeLabIteration: vi.fn(),
  };
});

describe("judgeProductionScene", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clean rubric from judgeLabIteration → judgeRan:true, verdict:qc_pass", async () => {
    const gemini = await import("../providers/gemini-judge.js");
    const { judgeProductionScene } = await import("./judge-scene.js");

    const mockRubric: JudgeRubricResult & { judge_model: string; judge_version: string; latency_ms: number; cost_cents: number } = {
      motion_faithfulness: 5,
      geometry_coherence: 5,
      room_consistency: 5,
      hallucination_flags: [],
      confidence: 5,
      reasoning: "Perfect clip.",
      overall: 5,
      judge_model: "gemini-2.5-flash",
      judge_version: "v1.1",
      latency_ms: 1000,
      cost_cents: 3,
    };

    vi.mocked(gemini.judgeLabIteration).mockResolvedValueOnce(mockRubric);

    const result = await judgeProductionScene({
      clipUrl: "https://example.com/clip.mp4",
      sceneId: "scene-abc",
      directorPrompt: "Push in toward the kitchen island",
      cameraMovement: "push_in",
      roomType: "kitchen",
      sourcePhotoUrl: null,
    });

    expect(result.judgeRan).toBe(true);
    expect(result.verdict).toBe("qc_pass");
    expect(result.shouldRerender).toBe(false);
    expect(result.rubric).not.toBeNull();
    expect(vi.mocked(gemini.judgeLabIteration)).toHaveBeenCalledWith(
      expect.objectContaining({
        clipUrl: "https://example.com/clip.mp4",
        iterationId: "scene-abc",
        directorPrompt: "Push in toward the kitchen island",
        cameraMovement: "push_in",
        roomType: "kitchen",
      }),
    );
  });

  it("JudgeDisabledError → judgeRan:false, verdict:qc_pass, reason:judge_disabled", async () => {
    const gemini = await import("../providers/gemini-judge.js");
    const { judgeProductionScene } = await import("./judge-scene.js");

    vi.mocked(gemini.judgeLabIteration).mockRejectedValueOnce(
      new gemini.JudgeDisabledError(),
    );

    const result = await judgeProductionScene({
      clipUrl: "https://example.com/clip.mp4",
      sceneId: "scene-xyz",
      directorPrompt: "Pan right across living room",
      cameraMovement: "pan_right",
      roomType: "living_room",
      sourcePhotoUrl: undefined,
    });

    expect(result.judgeRan).toBe(false);
    expect(result.verdict).toBe("qc_pass");
    expect(result.shouldRerender).toBe(false);
    expect(result.reason).toBe("judge_disabled");
    expect(result.rubric).toBeNull();
  });

  it("generic network error → judgeRan:false, verdict:qc_pass, reason contains 'judge_error:'", async () => {
    const gemini = await import("../providers/gemini-judge.js");
    const { judgeProductionScene } = await import("./judge-scene.js");

    vi.mocked(gemini.judgeLabIteration).mockRejectedValueOnce(
      new Error("Network timeout"),
    );

    const result = await judgeProductionScene({
      clipUrl: "https://example.com/clip.mp4",
      sceneId: "scene-net",
      directorPrompt: "Orbit the dining table",
      cameraMovement: "orbit",
      roomType: "dining_room",
      sourcePhotoUrl: "https://example.com/photo.jpg",
    });

    expect(result.judgeRan).toBe(false);
    expect(result.verdict).toBe("qc_pass");
    expect(result.shouldRerender).toBe(false);
    expect(result.reason).toContain("judge_error:");
    expect(result.rubric).toBeNull();
  });
});
