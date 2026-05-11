import { describe, it, expect } from "vitest";
import { generateReviewToken } from "./deliverables.js";

describe("generateReviewToken", () => {
  it("produces a 64-char hex string", () => {
    const t = generateReviewToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces unique tokens", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateReviewToken()));
    expect(tokens.size).toBe(100);
  });
});
