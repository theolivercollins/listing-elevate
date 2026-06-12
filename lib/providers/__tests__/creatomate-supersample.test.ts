/**
 * creatomate-supersample.test.ts
 *
 * Success-criteria tests for the ASSEMBLY_SUPERSAMPLE env-var path
 * (Gate A — 2026-06-11 assembly-quality-drop-diagnosis).
 *
 * Verified behaviors:
 *   1. creatomateCostCents returns 2.25× at default factor 1.5 (2880×1620)
 *      vs the 1920×1080 baseline rate.
 *   2. buildCreatomateConcatScript emits 2880×1620 for 16:9 (factor 1.5),
 *      1080×1920 for 9:16 (baseline — vertical not supersampled).
 *   3. buildCreatomateTimeline emits the same scaled even dimensions.
 *   4. ASSEMBLY_SUPERSAMPLE=1 rolls back to 1920×1080 (env-flip rollback).
 *   5. Clamp [1, 2] holds — factor 0.5 → 1.0, factor 3.0 → 2.0.
 *   6. Output dimensions are always even (macroblock alignment).
 *   7. assembleSuperSampleFactor() is the single source of truth for the factor.
 *
 * Rollback check: set ASSEMBLY_SUPERSAMPLE=1 in env and assert baseline dims.
 */

import { afterEach, describe, it, expect } from "vitest";
import {
  assembleSuperSampleFactor,
  buildCreatomateConcatScript,
  buildCreatomateTimeline,
  creatomateCostCents,
} from "../creatomate.js";
import type { AssembleVideoParams } from "../shotstack.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function setEnv(val: string | undefined): void {
  if (val === undefined) {
    delete process.env.ASSEMBLY_SUPERSAMPLE;
  } else {
    process.env.ASSEMBLY_SUPERSAMPLE = val;
  }
}

const CLIPS = [
  "https://cdn.example.com/a.mp4",
  "https://cdn.example.com/b.mp4",
];

function baseTimelineParams(extra: Partial<AssembleVideoParams> = {}): AssembleVideoParams {
  return {
    clips: [
      { url: "https://cdn/a.mp4", durationSeconds: 5 },
      { url: "https://cdn/b.mp4", durationSeconds: 5 },
    ],
    overlays: {
      address: "123 Oak Ave",
      price: "$500,000",
      details: "3 BD | 2 BA",
      agent: "Jane Doe",
      brokerage: "Acme Realty",
    },
    aspectRatio: "16:9",
    ...extra,
  };
}

// ── assembleSuperSampleFactor ──────────────────────────────────────────────

describe("assembleSuperSampleFactor", () => {
  afterEach(() => setEnv(undefined));

  it("returns 1.5 when ASSEMBLY_SUPERSAMPLE is unset (default)", () => {
    setEnv(undefined);
    expect(assembleSuperSampleFactor()).toBe(1.5);
  });

  it("parses a valid float from the env var", () => {
    setEnv("2.0");
    expect(assembleSuperSampleFactor()).toBe(2.0);
  });

  it("clamps below 1 up to 1 (rollback guard)", () => {
    setEnv("0.5");
    expect(assembleSuperSampleFactor()).toBe(1.0);
  });

  it("clamps above 2 down to 2", () => {
    setEnv("3.0");
    expect(assembleSuperSampleFactor()).toBe(2.0);
  });

  it("returns 1 when ASSEMBLY_SUPERSAMPLE=1 (env-flip rollback)", () => {
    setEnv("1");
    expect(assembleSuperSampleFactor()).toBe(1.0);
  });
});

// ── creatomateCostCents at factor 1.5 (2.25× pixel area) ──────────────────

describe("creatomateCostCents — supersample cost multiplier", () => {
  afterEach(() => setEnv(undefined));

  it("costs 2.25× more for 16:9 vs 9:16 at the same duration (factor 1.5)", () => {
    setEnv(undefined); // default 1.5
    const horizontal = creatomateCostCents(60, "16:9");
    const vertical = creatomateCostCents(60, "9:16");
    // Pixel-area ratio = 1.5² = 2.25; allow ±0.1 for rounding.
    expect(horizontal / vertical).toBeCloseTo(2.25, 1);
  });

  it("16:9 at 60 s with factor 1.5 costs ceil(1) min × 76¢ × 2.25 = 171¢", () => {
    setEnv(undefined);
    expect(creatomateCostCents(60, "16:9")).toBe(171);
  });

  it("9:16 at 60 s costs baseline 76¢ (no supersample on vertical)", () => {
    setEnv(undefined);
    expect(creatomateCostCents(60, "9:16")).toBe(76);
  });

  it("returns baseline cost when factor=1 (rollback env flip)", () => {
    setEnv("1");
    expect(creatomateCostCents(60, "16:9")).toBe(76);
  });

  it("cost is always an integer (rounds to whole cents)", () => {
    setEnv(undefined);
    const result = creatomateCostCents(45, "16:9");
    expect(Number.isInteger(result)).toBe(true);
  });
});

// ── buildCreatomateConcatScript — scaled even dimensions ──────────────────

describe("buildCreatomateConcatScript — supersample dimensions", () => {
  afterEach(() => setEnv(undefined));

  it("emits 2880×1620 for 16:9 at default factor 1.5", () => {
    setEnv(undefined);
    const s = buildCreatomateConcatScript(CLIPS);
    expect(s.width).toBe(2880);  // 1920 × 1.5 = 2880
    expect(s.height).toBe(1620); // 1080 × 1.5 = 1620
  });

  it("emits 1080×1920 for 9:16 (vertical is NOT supersampled)", () => {
    setEnv(undefined);
    const s = buildCreatomateConcatScript(CLIPS, "9:16");
    expect(s.width).toBe(1080);
    expect(s.height).toBe(1920);
  });

  it("rolls back to 1920×1080 when ASSEMBLY_SUPERSAMPLE=1", () => {
    setEnv("1");
    const s = buildCreatomateConcatScript(CLIPS);
    expect(s.width).toBe(1920);
    expect(s.height).toBe(1080);
  });

  it("emits even dimensions when factor is non-integer (e.g. 1.3 → even nearest)", () => {
    setEnv("1.3");
    const s = buildCreatomateConcatScript(CLIPS);
    expect(s.width % 2).toBe(0);
    expect(s.height % 2).toBe(0);
  });

  it("respects upper clamp: factor=2 → 3840×2160", () => {
    setEnv("2");
    const s = buildCreatomateConcatScript(CLIPS);
    expect(s.width).toBe(3840);
    expect(s.height).toBe(2160);
  });
});

// ── buildCreatomateTimeline — scaled even dimensions ──────────────────────

describe("buildCreatomateTimeline — supersample dimensions", () => {
  afterEach(() => setEnv(undefined));

  it("emits 2880×1620 for 16:9 at default factor 1.5", () => {
    setEnv(undefined);
    const s = buildCreatomateTimeline(baseTimelineParams());
    expect(s.width).toBe(2880);
    expect(s.height).toBe(1620);
  });

  it("emits 1080×1920 for 9:16 (vertical is NOT supersampled)", () => {
    setEnv(undefined);
    const s = buildCreatomateTimeline(baseTimelineParams({ aspectRatio: "9:16" }));
    expect(s.width).toBe(1080);
    expect(s.height).toBe(1920);
  });

  it("rolls back to 1920×1080 when ASSEMBLY_SUPERSAMPLE=1", () => {
    setEnv("1");
    const s = buildCreatomateTimeline(baseTimelineParams());
    expect(s.width).toBe(1920);
    expect(s.height).toBe(1080);
  });

  it("always emits even dimensions", () => {
    setEnv("1.7");
    const s = buildCreatomateTimeline(baseTimelineParams());
    expect(s.width % 2).toBe(0);
    expect(s.height % 2).toBe(0);
  });
});
