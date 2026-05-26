/**
 * Tests for mode-switcher recommendations.
 */

import { describe, it, expect } from "vitest";
import { recommendMode } from "./mode-switcher.js";

describe("recommendMode — all threshold transitions", () => {
  it("returns directors_cut when totalLabels < 10", () => {
    expect(recommendMode({ totalLabels: 0, agreementRate20: null })).toBe("directors_cut");
    expect(recommendMode({ totalLabels: 5, agreementRate20: 0.95 })).toBe("directors_cut");
    expect(recommendMode({ totalLabels: 9, agreementRate20: 1.0 })).toBe("directors_cut");
  });

  it("returns directors_cut when 10-49 labels and agreement < 0.7", () => {
    expect(recommendMode({ totalLabels: 10, agreementRate20: 0.5 })).toBe("directors_cut");
    expect(recommendMode({ totalLabels: 30, agreementRate20: 0.69 })).toBe("directors_cut");
    expect(recommendMode({ totalLabels: 49, agreementRate20: null })).toBe("directors_cut");
  });

  it("returns apprentice_review when 10-49 labels and 0.7 <= agreement < 0.9", () => {
    expect(recommendMode({ totalLabels: 10, agreementRate20: 0.7 })).toBe("apprentice_review");
    expect(recommendMode({ totalLabels: 25, agreementRate20: 0.75 })).toBe("apprentice_review");
    expect(recommendMode({ totalLabels: 49, agreementRate20: 0.89 })).toBe("apprentice_review");
  });

  it("returns autopilot when agreement >= 0.9 (even in 10-49 range)", () => {
    expect(recommendMode({ totalLabels: 20, agreementRate20: 0.9 })).toBe("autopilot");
    expect(recommendMode({ totalLabels: 45, agreementRate20: 0.95 })).toBe("autopilot");
  });

  it("returns directors_cut when 50+ labels but agreement < 0.7", () => {
    expect(recommendMode({ totalLabels: 50, agreementRate20: 0.6 })).toBe("directors_cut");
    expect(recommendMode({ totalLabels: 100, agreementRate20: null })).toBe("directors_cut");
  });

  it("returns apprentice_review when 50+ labels and 0.7 <= agreement < 0.9", () => {
    expect(recommendMode({ totalLabels: 50, agreementRate20: 0.7 })).toBe("apprentice_review");
    expect(recommendMode({ totalLabels: 200, agreementRate20: 0.85 })).toBe("apprentice_review");
  });

  it("returns autopilot when 50+ labels and agreement >= 0.9", () => {
    expect(recommendMode({ totalLabels: 50, agreementRate20: 0.9 })).toBe("autopilot");
    expect(recommendMode({ totalLabels: 500, agreementRate20: 1.0 })).toBe("autopilot");
  });
});
