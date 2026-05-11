import { describe, it, expect } from "vitest";
import { computeNextOrderStatus, type OrderEvent, type OrderStatus } from "./state.js";

describe("computeNextOrderStatus", () => {
  it("awaiting_onboarding + onboarding_completed → awaiting_delivery", () => {
    expect(computeNextOrderStatus("awaiting_onboarding", "onboarding_completed"))
      .toBe("awaiting_delivery");
  });

  it("awaiting_delivery + version_uploaded → delivered", () => {
    expect(computeNextOrderStatus("awaiting_delivery", "version_uploaded"))
      .toBe("delivered");
  });

  it("delivered + client_opened → in_review", () => {
    expect(computeNextOrderStatus("delivered", "client_opened"))
      .toBe("in_review");
  });

  it("in_review + revision_requested → revision_requested", () => {
    expect(computeNextOrderStatus("in_review", "revision_requested"))
      .toBe("revision_requested");
  });

  it("revision_requested + version_uploaded → delivered", () => {
    expect(computeNextOrderStatus("revision_requested", "version_uploaded"))
      .toBe("delivered");
  });

  it("in_review + approved → approved", () => {
    expect(computeNextOrderStatus("in_review", "approved")).toBe("approved");
  });

  it("approved + payment_intent_created → awaiting_payment", () => {
    expect(computeNextOrderStatus("approved", "payment_intent_created"))
      .toBe("awaiting_payment");
  });

  it("awaiting_payment + payment_succeeded → paid", () => {
    expect(computeNextOrderStatus("awaiting_payment", "payment_succeeded"))
      .toBe("paid");
  });

  it("paid is terminal — any event throws", () => {
    expect(() => computeNextOrderStatus("paid", "client_opened" as OrderEvent))
      .toThrow(/illegal transition/i);
  });

  it("delivered + client_opened repeated (already in_review) is idempotent — throws", () => {
    expect(() => computeNextOrderStatus("in_review", "client_opened" as OrderEvent))
      .toThrow(/illegal transition/i);
  });

  it("canceled is terminal", () => {
    expect(() => computeNextOrderStatus("canceled", "version_uploaded" as OrderEvent))
      .toThrow(/illegal transition/i);
  });

  it("any state + canceled event → canceled", () => {
    const states: OrderStatus[] = ["awaiting_delivery", "delivered", "in_review", "revision_requested", "approved"];
    for (const s of states) {
      expect(computeNextOrderStatus(s, "canceled")).toBe("canceled");
    }
  });
});
