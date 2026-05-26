import { describe, it, expect } from "vitest";
import { nextStatus, isTerminal, isPollingState } from "./state-machine.js";
import type { OutcomeStatus } from "../types.js";

describe("nextStatus — valid transitions", () => {
  it("pending + SUBMIT → submitted", () => {
    expect(nextStatus("pending", "SUBMIT")).toBe("submitted");
  });

  it("submitted + POLL_START → polling", () => {
    expect(nextStatus("submitted", "POLL_START")).toBe("polling");
  });

  it("submitted + RENDER_DONE → rendered", () => {
    expect(nextStatus("submitted", "RENDER_DONE")).toBe("rendered");
  });

  it("polling + RENDER_DONE → rendered", () => {
    expect(nextStatus("polling", "RENDER_DONE")).toBe("rendered");
  });

  it("polling + RENDER_FAIL → failed", () => {
    expect(nextStatus("polling", "RENDER_FAIL")).toBe("failed");
  });

  it("submitted + TIMEOUT → failed", () => {
    expect(nextStatus("submitted", "TIMEOUT")).toBe("failed");
  });

  it("polling + TIMEOUT → failed", () => {
    expect(nextStatus("polling", "TIMEOUT")).toBe("failed");
  });

  it("rendered + JUDGE_DONE → judged", () => {
    expect(nextStatus("rendered", "JUDGE_DONE")).toBe("judged");
  });

  it("rendered + JUDGE_FAIL → failed", () => {
    expect(nextStatus("rendered", "JUDGE_FAIL")).toBe("failed");
  });

  it("judged + RETRAIN_DONE → completed", () => {
    expect(nextStatus("judged", "RETRAIN_DONE")).toBe("completed");
  });
});

describe("nextStatus — invalid transitions throw", () => {
  it("completed + SUBMIT → throws", () => {
    expect(() => nextStatus("completed", "SUBMIT")).toThrow("Invalid transition");
  });

  it("failed + JUDGE_DONE → throws", () => {
    expect(() => nextStatus("failed", "JUDGE_DONE")).toThrow("Invalid transition");
  });

  it("pending + RENDER_DONE → throws (can't render without submitting)", () => {
    expect(() => nextStatus("pending", "RENDER_DONE")).toThrow("Invalid transition");
  });
});

describe("isTerminal", () => {
  const terminal: OutcomeStatus[] = ["completed", "failed"];
  const nonTerminal: OutcomeStatus[] = ["pending", "submitted", "polling", "rendered", "judged"];

  it.each(terminal)("%s is terminal", (status) => {
    expect(isTerminal(status)).toBe(true);
  });

  it.each(nonTerminal)("%s is not terminal", (status) => {
    expect(isTerminal(status)).toBe(false);
  });
});

describe("isPollingState", () => {
  it("submitted is a polling state", () => {
    expect(isPollingState("submitted")).toBe(true);
  });

  it("polling is a polling state", () => {
    expect(isPollingState("polling")).toBe(true);
  });

  it("rendered is not a polling state", () => {
    expect(isPollingState("rendered")).toBe(false);
  });

  it("pending is not a polling state", () => {
    expect(isPollingState("pending")).toBe(false);
  });
});
