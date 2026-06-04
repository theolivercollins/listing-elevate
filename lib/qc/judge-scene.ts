/**
 * Production scene-judge wrapper.
 *
 * Two exports:
 *   - sceneVerdictFromRubric — pure function mapping JudgeRubricResult → verdict
 *   - judgeProductionScene  — async orchestrator (fetch photo bytes + judge call)
 *
 * Contract: judgeProductionScene NEVER throws. A judge outage or disabled state
 * must not block delivery — callers get verdict:"qc_pass" / judgeRan:false and
 * carry on.
 */

import type { JudgeRubricResult } from "../prompts/judge-rubric.js";
import { JudgeDisabledError, judgeLabIteration } from "../providers/gemini-judge.js";

// ============================================================================
// Types
// ============================================================================

export type SceneVerdict = "qc_pass" | "qc_soft_reject" | "qc_hard_reject";

export interface VerdictResult {
  verdict: SceneVerdict;
  shouldRerender: boolean;
  reason: string;
}

export interface JudgeSceneResult extends VerdictResult {
  rubric: JudgeRubricResult | null;
  judgeRan: boolean;
}

export interface JudgeProductionSceneInput {
  clipUrl: string;
  sceneId: string;
  directorPrompt: string;
  cameraMovement: string;
  roomType: string;
  sourcePhotoUrl?: string | null;
}

// ============================================================================
// Hard-reject fabrication flags (spec §2 step 1)
// ============================================================================

const FABRICATION_FLAGS = new Set([
  "hallucinated_geometry",
  "hallucinated_architecture",
  "camera_exited_room",
  "wrong_motion_direction",
]);

// ============================================================================
// sceneVerdictFromRubric — pure function
// ============================================================================

/**
 * Derive a SceneVerdict from a completed JudgeRubricResult.
 *
 * Hard-reject (shouldRerender:true) when fabrication is present:
 *   - hallucination_flags contains any fabrication flag, OR
 *   - geometry_coherence <= 2, OR
 *   - room_consistency <= 2
 *
 * Soft-reject (shouldRerender:false) when overall <= 2 but no fabrication.
 *
 * Otherwise qc_pass.
 */
export function sceneVerdictFromRubric(r: JudgeRubricResult): VerdictResult {
  // Check fabrication flags first.
  const fabricationFlag = r.hallucination_flags.find((f) => FABRICATION_FLAGS.has(f));
  if (fabricationFlag) {
    return {
      verdict: "qc_hard_reject",
      shouldRerender: true,
      reason: `fabrication_flag:${fabricationFlag}`,
    };
  }

  // Check low geometry_coherence score.
  if (r.geometry_coherence <= 2) {
    return {
      verdict: "qc_hard_reject",
      shouldRerender: true,
      reason: `geometry_coherence:${r.geometry_coherence}`,
    };
  }

  // Check low room_consistency score.
  if (r.room_consistency <= 2) {
    return {
      verdict: "qc_hard_reject",
      shouldRerender: true,
      reason: `room_consistency:${r.room_consistency}`,
    };
  }

  // Check overall for soft-reject.
  if (r.overall <= 2) {
    return {
      verdict: "qc_soft_reject",
      shouldRerender: false,
      reason: `overall:${r.overall}`,
    };
  }

  return {
    verdict: "qc_pass",
    shouldRerender: false,
    reason: "pass",
  };
}

// ============================================================================
// judgeProductionScene — async orchestrator
// ============================================================================

/**
 * Judge a production scene clip. Never throws — all errors degrade to
 * qc_pass / judgeRan:false so the pipeline is not blocked.
 */
export async function judgeProductionScene(
  input: JudgeProductionSceneInput,
): Promise<JudgeSceneResult> {
  // Fetch source photo bytes non-fatally.
  let photoBytes: Buffer | undefined;
  try {
    if (input.sourcePhotoUrl) {
      const r = await fetch(input.sourcePhotoUrl);
      if (r.ok) photoBytes = Buffer.from(await r.arrayBuffer());
    }
  } catch { /* non-fatal */ }

  try {
    const result = await judgeLabIteration({
      clipUrl: input.clipUrl,
      photoBytes,
      directorPrompt: input.directorPrompt,
      cameraMovement: input.cameraMovement,
      roomType: input.roomType,
      iterationId: input.sceneId,
    });

    const v = sceneVerdictFromRubric(result);
    return { ...v, rubric: result, judgeRan: true };
  } catch (err) {
    if (err instanceof JudgeDisabledError) {
      return {
        verdict: "qc_pass",
        shouldRerender: false,
        reason: "judge_disabled",
        rubric: null,
        judgeRan: false,
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      verdict: "qc_pass",
      shouldRerender: false,
      reason: `judge_error: ${msg}`,
      rubric: null,
      judgeRan: false,
    };
  }
}
