/**
 * V2.1 outcome-feedback module public API.
 */

export { processOutstandingOutcomes } from "./worker.js";
export { triggerRetrainIfReady } from "./retrain-hook.js";
export { judgeRenderedClip } from "./judge.js";
export { nextStatus, isTerminal, isPollingState } from "./state-machine.js";
export type { OutcomeEvent } from "./state-machine.js";
