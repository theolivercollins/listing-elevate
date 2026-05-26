/**
 * Outcome-feedback state machine for V2.1 render outcomes.
 *
 * State diagram:
 *
 *   pending
 *     │ submit Atlas job
 *     ▼
 *   submitted
 *     │ Atlas accepted job (atlas_job_id set)
 *     ▼
 *   polling
 *     │ Atlas returns processing/pending/queued status
 *     │ (remains here until done or timeout)
 *     ▼
 *   rendered          ──── atlas failed ────► failed
 *     │ video_url set
 *     ▼
 *   judged            ──── judge error ──────► failed
 *     │ judge_score + judge_reasoning set
 *     ▼
 *   completed         (retrain hook called)
 *
 * Terminal states: completed, failed
 * Retry: failed outcomes are left as-is; caller enforces retry_count cap.
 *
 * Events:
 *   SUBMIT         pending → submitted
 *   POLL_START     submitted → polling
 *   RENDER_DONE    polling → rendered
 *   RENDER_FAIL    polling → failed
 *   TIMEOUT        submitted|polling → failed
 *   JUDGE_DONE     rendered → judged
 *   JUDGE_FAIL     rendered → failed
 *   RETRAIN_DONE   judged → completed
 */

import type { OutcomeStatus } from "../types.js";

export type OutcomeEvent =
  | "SUBMIT"
  | "POLL_START"
  | "RENDER_DONE"
  | "RENDER_FAIL"
  | "TIMEOUT"
  | "JUDGE_DONE"
  | "JUDGE_FAIL"
  | "RETRAIN_DONE";

const TRANSITIONS: Record<OutcomeStatus, Partial<Record<OutcomeEvent, OutcomeStatus>>> = {
  pending: {
    SUBMIT: "submitted",
  },
  submitted: {
    POLL_START: "polling",
    RENDER_DONE: "rendered",
    RENDER_FAIL: "failed",
    TIMEOUT: "failed",
  },
  polling: {
    RENDER_DONE: "rendered",
    RENDER_FAIL: "failed",
    TIMEOUT: "failed",
  },
  rendered: {
    JUDGE_DONE: "judged",
    JUDGE_FAIL: "failed",
  },
  judged: {
    RETRAIN_DONE: "completed",
  },
  completed: {},
  failed: {},
};

/**
 * Pure state transition function. Returns the next status given the current
 * status and an event. Throws if the transition is not valid for the current
 * state — callers should guard against invalid events.
 */
export function nextStatus(current: OutcomeStatus, event: OutcomeEvent): OutcomeStatus {
  const next = TRANSITIONS[current]?.[event];
  if (next === undefined) {
    throw new Error(
      `Invalid transition: state="${current}" event="${event}". ` +
        `Valid events for this state: [${Object.keys(TRANSITIONS[current] ?? {}).join(", ")}]`,
    );
  }
  return next;
}

/**
 * Returns true if the given status is a terminal state (no further
 * transitions possible).
 */
export function isTerminal(status: OutcomeStatus): boolean {
  return status === "completed" || status === "failed";
}

/**
 * Returns true if the given status is one where Atlas polling applies.
 */
export function isPollingState(status: OutcomeStatus): boolean {
  return status === "submitted" || status === "polling";
}
