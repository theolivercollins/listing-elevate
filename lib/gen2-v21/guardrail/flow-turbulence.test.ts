/**
 * Tests for flow-turbulence.ts
 *
 * All ffmpeg/sharp/fetch calls are mocked — no actual subprocess spawns.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

const mockSharpInstance = {
  resize: vi.fn(),
  grayscale: vi.fn(),
  raw: vi.fn(),
  toBuffer: vi.fn(),
};
Object.values(mockSharpInstance).forEach((fn) => {
  (fn as ReturnType<typeof vi.fn>).mockReturnValue(mockSharpInstance);
});

vi.mock("sharp", () => ({
  default: vi.fn(() => mockSharpInstance),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Produce 8 identical raw frame buffers (128×72 grayscale). */
function uniformFrames(value = 128): Buffer[] {
  return Array.from({ length: 8 }, () => Buffer.alloc(128 * 72, value));
}

/** Produce 8 frames where consecutive pairs differ only in one 8×8 region. */
function localizedChangeFrames(): Buffer[] {
  const frames: Buffer[] = [];
  for (let i = 0; i < 8; i++) {
    const buf = Buffer.alloc(128 * 72, 100);
    if (i % 2 === 1) {
      // Set a single cell (top-left 16×9) to a very different value
      for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 16; x++) {
          buf[y * 128 + x] = 200;
        }
      }
    }
    frames.push(buf);
  }
  return frames;
}

/** Produce 8 frames with uniform random-like motion across all cells. */
function uniformMotionFrames(): Buffer[] {
  const frames: Buffer[] = [];
  for (let i = 0; i < 8; i++) {
    const buf = Buffer.alloc(128 * 72);
    // Alternate between two values on every frame to create global diff
    buf.fill(i % 2 === 0 ? 80 : 120);
    frames.push(buf);
  }
  return frames;
}

function mockSpawnForDuration(durationStr: string) {
  return (cmd: string) => {
    if (cmd === "ffprobe") {
      return {
        stdout: { on: (_: string, cb: (d: Buffer) => void) => { cb(Buffer.from(`${durationStr}\n`)); } },
        stderr: { on: vi.fn() },
        on: (_: string, cb: (code: number) => void) => { cb(0); },
      };
    }
    return {
      stdout: { on: vi.fn() },
      stderr: { on: (_: string, cb: (d: Buffer) => void) => { cb(Buffer.from("")); } },
      on: (_: string, cb: (code: number) => void) => { cb(0); },
    };
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("computeTurbulenceScore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(mockSharpInstance).forEach((fn) => {
      (fn as ReturnType<typeof vi.fn>).mockReturnValue(mockSharpInstance);
    });
  });

  it("returns 1 when fetch fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    const { computeTurbulenceScore } = await import("./flow-turbulence.js");
    const result = await computeTurbulenceScore("https://example.com/bad.mp4");
    expect(result).toBe(1);
  });

  it("returns a score in [0, 1] range for a static clip (uniform frames)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
    });

    const { spawn } = await import("node:child_process");
    (spawn as ReturnType<typeof vi.fn>).mockImplementation(mockSpawnForDuration("5.0"));

    const frames = uniformFrames(128);
    let callCount = 0;
    mockSharpInstance.toBuffer.mockImplementation(() =>
      Promise.resolve(frames[callCount++ % frames.length]),
    );

    const { computeTurbulenceScore } = await import("./flow-turbulence.js");
    const result = await computeTurbulenceScore("https://example.com/static.mp4");

    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it("returns a lower score for uniform-motion clip vs localized-change clip", async () => {
    const fetch_ok = {
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
    };

    const { spawn } = await import("node:child_process");
    const { computeTurbulenceScore } = await import("./flow-turbulence.js");

    // --- Run 1: localized changes (should score higher turbulence) ---
    globalThis.fetch = vi.fn().mockResolvedValue(fetch_ok);
    (spawn as ReturnType<typeof vi.fn>).mockImplementation(mockSpawnForDuration("4.0"));

    const localizedFrames = localizedChangeFrames();
    let lIdx = 0;
    mockSharpInstance.toBuffer.mockImplementation(() =>
      Promise.resolve(localizedFrames[lIdx++ % localizedFrames.length]),
    );
    vi.clearAllMocks();
    Object.values(mockSharpInstance).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReturnValue(mockSharpInstance));

    globalThis.fetch = vi.fn().mockResolvedValue(fetch_ok);
    (spawn as ReturnType<typeof vi.fn>).mockImplementation(mockSpawnForDuration("4.0"));
    lIdx = 0;
    mockSharpInstance.toBuffer.mockImplementation(() =>
      Promise.resolve(localizedFrames[lIdx++ % localizedFrames.length]),
    );
    const localScore = await computeTurbulenceScore("https://example.com/local.mp4");

    // --- Run 2: uniform motion across all cells (entropy = high → low turbulence) ---
    vi.clearAllMocks();
    Object.values(mockSharpInstance).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReturnValue(mockSharpInstance));

    globalThis.fetch = vi.fn().mockResolvedValue(fetch_ok);
    (spawn as ReturnType<typeof vi.fn>).mockImplementation(mockSpawnForDuration("4.0"));

    const uniformFrames2 = uniformMotionFrames();
    let uIdx = 0;
    mockSharpInstance.toBuffer.mockImplementation(() =>
      Promise.resolve(uniformFrames2[uIdx++ % uniformFrames2.length]),
    );
    const uniformScore = await computeTurbulenceScore("https://example.com/uniform.mp4");

    // Both should be in range
    expect(localScore).toBeGreaterThanOrEqual(0);
    expect(localScore).toBeLessThanOrEqual(1);
    expect(uniformScore).toBeGreaterThanOrEqual(0);
    expect(uniformScore).toBeLessThanOrEqual(1);

    // Localized change should produce higher turbulence than global uniform motion
    // (localized concentration score > uniform distribution score)
    expect(localScore).toBeGreaterThanOrEqual(uniformScore);
  });
});
