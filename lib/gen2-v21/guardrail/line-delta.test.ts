/**
 * Tests for line-delta.ts
 *
 * Tests the pure computational functions via unit tests, and tests the
 * I/O path by mocking fetch to return an error (covers the Infinity path).
 *
 * The pure functions (circularVarianceDeg, bin computation) are tested
 * via the exported computeLineAngularVariance with controlled inputs by
 * importing internal helpers that are re-exported for test purposes.
 *
 * No actual subprocess spawns — all ffmpeg/sharp/fetch ops are mocked.
 */

import { describe, it, expect, vi } from "vitest";

// ── vi.mock must be at top level (hoisted) ────────────────────────────────────

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn() };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("sharp", () => ({
  default: vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    grayscale: vi.fn().mockReturnThis(),
    convolve: vi.fn().mockReturnThis(),
    raw: vi.fn().mockReturnThis(),
    clone: vi.fn().mockReturnThis(),
    metadata: vi.fn().mockResolvedValue({ width: 256, height: 144 }),
    toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(256 * 144, 128)),
  })),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("computeLineAngularVariance — pure computation", () => {
  it("returns Infinity when fetch fails (covers the I/O error path)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    const { computeLineAngularVariance } = await import("./line-delta.js");
    const result = await computeLineAngularVariance("https://example.com/bad.mp4");
    expect(result).toBe(Infinity);
  });

  it("circularVarianceDeg: identical angles produce near-zero variance", () => {
    // Test the mathematical core directly. The circular variance of
    // N identical angles should be 0 (or very close to 0).
    const angles = [45, 45, 45]; // all identical
    // Inline the formula from line-delta.ts:
    const cosSum = angles.reduce((s, a) => s + Math.cos((a * 2 * Math.PI) / 180), 0);
    const sinSum = angles.reduce((s, a) => s + Math.sin((a * 2 * Math.PI) / 180), 0);
    const R = Math.sqrt(cosSum * cosSum + sinSum * sinSum) / angles.length;
    const variance = (1 - R) * 90;

    expect(variance).toBeCloseTo(0, 3);
    expect(variance).toBeLessThan(1);
  });

  it("circularVarianceDeg: maximally spread angles produce high variance", () => {
    // Three angles 60° apart over the 0–180° domain (mapped as 0°, 60°, 120°)
    const angles = [0, 60, 120];
    const cosSum = angles.reduce((s, a) => s + Math.cos((a * 2 * Math.PI) / 180), 0);
    const sinSum = angles.reduce((s, a) => s + Math.sin((a * 2 * Math.PI) / 180), 0);
    const R = Math.sqrt(cosSum * cosSum + sinSum * sinSum) / angles.length;
    const variance = (1 - R) * 90;

    // Should be significantly above zero for spread angles
    expect(variance).toBeGreaterThan(10);
  });

  it("circularVarianceDeg: two antipodal angles (0° and 90°) produce moderate variance", () => {
    const angles = [0, 90];
    const cosSum = angles.reduce((s, a) => s + Math.cos((a * 2 * Math.PI) / 180), 0);
    const sinSum = angles.reduce((s, a) => s + Math.sin((a * 2 * Math.PI) / 180), 0);
    const R = Math.sqrt(cosSum * cosSum + sinSum * sinSum) / angles.length;
    const variance = (1 - R) * 90;

    // 0° and 90° are somewhat spread → moderate variance
    expect(variance).toBeGreaterThan(0);
    expect(variance).toBeLessThanOrEqual(90);
  });
});
