/**
 * multi-take.ts
 *
 * Orchestrates multi-take generation with per-clip geometric guardrail checks.
 * Generates up to maxAttempts clips; passes each through line-delta + flow-
 * turbulence; stops on first pass or returns ok=false after exhausting attempts.
 *
 * Pass criteria:
 *   lineVariance < 3°  AND  turbulence < 0.5
 */

import { AtlasProvider, ATLAS_MODELS, atlasClipCostCents } from "../../providers/atlas.js";
import { pollUntilComplete } from "../../providers/provider.interface.js";
import { recordCostEvent } from "../../db.js";
import { computeLineAngularVariance } from "./line-delta.js";
import { computeTurbulenceScore } from "./flow-turbulence.js";

// ── Thresholds ────────────────────────────────────────────────────────────────

export const LINE_VARIANCE_THRESHOLD = 3; // degrees
export const TURBULENCE_THRESHOLD = 0.5;  // 0..1

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MultiTakeAttempt {
  videoUrl: string;
  lineVariance: number;
  turbulence: number;
  passed: boolean;
}

export interface MultiTakeResult {
  ok: boolean;
  videoUrl?: string;
  reason?: string;
  attempts: MultiTakeAttempt[];
}

export interface MultiTakeOpts {
  /** Pair label ID — used in cost_events metadata for traceability. */
  pairLabelId: string;
  /** URL for the start-frame photo (Photo A). */
  photoAUrl: string;
  /** URL for the end-frame photo (Photo B). */
  photoBUrl: string;
  /**
   * Atlas model slug key (e.g. "kling-v2-1-pair").
   * Must be a key in ATLAS_MODELS.
   */
  atlasModelSlug: string;
  /**
   * Returns the prompt to use. Called per attempt so callers can vary
   * the prompt on retry (e.g. reduced-motion language).
   */
  generatePromptFn: () => string;
  /** Maximum number of generation + check cycles. Must be ≥ 1. Default = 2. */
  maxAttempts?: 2;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Mutate the prompt on retry to signal reduced motion magnitude.
 * We prefix a softer motion directive to reduce the likelihood of
 * warping or fast morphing on a second attempt.
 */
function retryPrompt(basePrompt: string): string {
  return `Minimal, subtle camera movement only. Gentle pan, no rapid motion. ${basePrompt}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a clip with geometric guardrail checks, retrying up to `maxAttempts`
 * times on failure. Each attempt:
 *   1. Calls Atlas with an alternate seed / reduced-motion prompt on retry.
 *   2. Checks lineVariance + turbulence.
 *   3. Records a cost_event.
 *
 * Returns ok=true with the first passing videoUrl, or ok=false with reason
 * after all attempts fail — the caller should route to the fall-through
 * single-image path.
 */
export async function tryWithGuardrail(opts: MultiTakeOpts): Promise<MultiTakeResult> {
  const {
    pairLabelId,
    photoAUrl,
    photoBUrl,
    atlasModelSlug,
    generatePromptFn,
    maxAttempts = 2,
  } = opts;

  const attempts: MultiTakeAttempt[] = [];

  const modelDescriptor = ATLAS_MODELS[atlasModelSlug];
  if (!modelDescriptor) {
    return {
      ok: false,
      reason: `Unknown atlasModelSlug: ${atlasModelSlug}`,
      attempts,
    };
  }

  const provider = new AtlasProvider(atlasModelSlug);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const isRetry = attempt > 0;

    // Vary the prompt on retries to reduce motion intensity
    const basePrompt = generatePromptFn();
    const prompt = isRetry ? retryPrompt(basePrompt) : basePrompt;

    // ── 1. Submit generation ─────────────────────────────────────────────────
    let jobId: string;
    try {
      const job = await provider.generateClip({
        sourceImage: Buffer.alloc(0), // Atlas uses URL, not buffer
        sourceImageUrl: photoAUrl,
        endImageUrl: photoBUrl,
        prompt,
        durationSeconds: 5,
        aspectRatio: "16:9",
        modelOverride: atlasModelSlug,
      });
      jobId = job.jobId;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Record zero-cost event for the failed submission attempt
      await recordCostEventSafe({
        pairLabelId,
        atlasModelSlug,
        attemptIndex: attempt,
        costCents: 0,
        status: "submit_failed",
        error: errMsg,
      });
      return {
        ok: false,
        reason: `Atlas submit failed on attempt ${attempt + 1}: ${errMsg}`,
        attempts,
      };
    }

    // ── 2. Poll until complete ────────────────────────────────────────────────
    let videoUrl: string;
    let actualCostCents: number;
    try {
      const result = await pollUntilComplete(provider, jobId);
      if (result.status !== "complete" || !result.videoUrl) {
        const errMsg = result.error ?? "generation failed";
        await recordCostEventSafe({
          pairLabelId,
          atlasModelSlug,
          attemptIndex: attempt,
          costCents: result.costCents ?? modelDescriptor.priceCentsPerClip,
          status: "generation_failed",
          error: errMsg,
        });
        return {
          ok: false,
          reason: `Atlas job failed on attempt ${attempt + 1}: ${errMsg}`,
          attempts,
        };
      }
      videoUrl = result.videoUrl;
      actualCostCents = result.costCents ?? atlasClipCostCents(atlasModelSlug);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await recordCostEventSafe({
        pairLabelId,
        atlasModelSlug,
        attemptIndex: attempt,
        costCents: modelDescriptor.priceCentsPerClip,
        status: "poll_failed",
        error: errMsg,
      });
      return {
        ok: false,
        reason: `Atlas poll failed on attempt ${attempt + 1}: ${errMsg}`,
        attempts,
      };
    }

    // ── 3. Guardrail checks ───────────────────────────────────────────────────
    const [lineVariance, turbulence] = await Promise.all([
      computeLineAngularVariance(videoUrl),
      computeTurbulenceScore(videoUrl),
    ]);

    const passed =
      lineVariance < LINE_VARIANCE_THRESHOLD &&
      turbulence < TURBULENCE_THRESHOLD;

    const attemptRecord: MultiTakeAttempt = {
      videoUrl,
      lineVariance,
      turbulence,
      passed,
    };
    attempts.push(attemptRecord);

    // ── 4. Record cost event ─────────────────────────────────────────────────
    await recordCostEventSafe({
      pairLabelId,
      atlasModelSlug,
      attemptIndex: attempt,
      costCents: actualCostCents,
      status: passed ? "passed" : "failed_guardrail",
      lineVariance,
      turbulence,
    });

    if (passed) {
      return { ok: true, videoUrl, attempts };
    }

    // If this is the last attempt, fall through to return ok=false
  }

  const last = attempts[attempts.length - 1];
  const reason = last
    ? `Guardrail failed after ${maxAttempts} attempt(s): lineVariance=${last.lineVariance.toFixed(2)}° turbulence=${last.turbulence.toFixed(3)}`
    : `All ${maxAttempts} attempt(s) failed`;

  return { ok: false, reason, attempts };
}

// ── Cost event helper ─────────────────────────────────────────────────────────

interface CostEventMeta {
  pairLabelId: string;
  atlasModelSlug: string;
  attemptIndex: number;
  costCents: number;
  status: string;
  error?: string;
  lineVariance?: number;
  turbulence?: number;
}

async function recordCostEventSafe(meta: CostEventMeta): Promise<void> {
  try {
    await recordCostEvent({
      propertyId: null, // pair renders are Lab/gen2 events, not tied to a pipeline property
      stage: "generation",
      provider: "atlas",
      costCents: meta.costCents,
      metadata: {
        pair_label_id: meta.pairLabelId,
        atlas_model_slug: meta.atlasModelSlug,
        attempt_index: meta.attemptIndex,
        guardrail_status: meta.status,
        ...(meta.lineVariance !== undefined && { line_variance_deg: meta.lineVariance }),
        ...(meta.turbulence !== undefined && { turbulence_score: meta.turbulence }),
        ...(meta.error && { error: meta.error }),
      },
    });
  } catch {
    // Cost recording is best-effort — never fail the render loop over it
  }
}
