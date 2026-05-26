/**
 * Tests for multi-take.ts
 *
 * Mocks AtlasProvider, recordCostEvent, computeLineAngularVariance,
 * and computeTurbulenceScore.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGenerateClip = vi.fn();
const mockCheckStatus = vi.fn();
const mockDownloadClip = vi.fn();

vi.mock("../../providers/atlas.js", () => ({
  AtlasProvider: vi.fn().mockImplementation(() => ({
    generateClip: mockGenerateClip,
    checkStatus: mockCheckStatus,
    downloadClip: mockDownloadClip,
    name: "atlas",
  })),
  ATLAS_MODELS: {
    "kling-v2-1-pair": {
      slug: "kwaivgi/kling-v2.1-i2v-pro/start-end-frame",
      endFrameField: "end_image",
      allowedDurations: [5, 10],
      priceCentsPerSecond: 8,
      priceCentsPerClip: 38,
    },
  },
  atlasClipCostCents: vi.fn().mockReturnValue(38),
}));

vi.mock("../../providers/provider.interface.js", () => ({
  pollUntilComplete: vi.fn(),
}));

const mockRecordCostEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("../../db.js", () => ({
  recordCostEvent: mockRecordCostEvent,
}));

const mockComputeLineAngularVariance = vi.fn();
const mockComputeTurbulenceScore = vi.fn();

vi.mock("./line-delta.js", () => ({
  computeLineAngularVariance: mockComputeLineAngularVariance,
}));

vi.mock("./flow-turbulence.js", () => ({
  computeTurbulenceScore: mockComputeTurbulenceScore,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_OPTS = {
  pairLabelId: "label-001",
  photoAUrl: "https://cdn.example.com/photo-a.jpg",
  photoBUrl: "https://cdn.example.com/photo-b.jpg",
  atlasModelSlug: "kling-v2-1-pair",
  generatePromptFn: () => "Smooth walkthrough from living room to kitchen",
  maxAttempts: 2 as const,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("tryWithGuardrail", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockRecordCostEvent.mockResolvedValue(undefined);
  });

  it("passes on first attempt when metrics are within threshold", async () => {
    const { pollUntilComplete } = await import("../../providers/provider.interface.js");

    mockGenerateClip.mockResolvedValue({ jobId: "job-123", estimatedSeconds: 90 });
    (pollUntilComplete as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "complete",
      videoUrl: "https://cdn.example.com/output.mp4",
      costCents: 38,
    });

    // Below thresholds: variance < 3, turbulence < 0.5
    mockComputeLineAngularVariance.mockResolvedValue(1.5);
    mockComputeTurbulenceScore.mockResolvedValue(0.2);

    const { tryWithGuardrail } = await import("./multi-take.js");
    const result = await tryWithGuardrail(BASE_OPTS);

    expect(result.ok).toBe(true);
    expect(result.videoUrl).toBe("https://cdn.example.com/output.mp4");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].passed).toBe(true);
    expect(result.attempts[0].lineVariance).toBe(1.5);
    expect(result.attempts[0].turbulence).toBe(0.2);
  });

  it("fails both attempts and returns ok=false with reason", async () => {
    const { pollUntilComplete } = await import("../../providers/provider.interface.js");

    mockGenerateClip.mockResolvedValue({ jobId: "job-456", estimatedSeconds: 90 });
    (pollUntilComplete as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "complete",
      videoUrl: "https://cdn.example.com/output-bad.mp4",
      costCents: 38,
    });

    // Both above thresholds
    mockComputeLineAngularVariance.mockResolvedValue(10);
    mockComputeTurbulenceScore.mockResolvedValue(0.8);

    const { tryWithGuardrail } = await import("./multi-take.js");
    const result = await tryWithGuardrail(BASE_OPTS);

    expect(result.ok).toBe(false);
    expect(result.videoUrl).toBeUndefined();
    expect(result.reason).toMatch(/guardrail failed/i);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts.every((a) => !a.passed)).toBe(true);
  });

  it("retries with an alternate seed (reduced-motion prefix) on second attempt", async () => {
    const { pollUntilComplete } = await import("../../providers/provider.interface.js");

    const capturedPrompts: string[] = [];
    mockGenerateClip.mockImplementation(async (params: { prompt: string }) => {
      capturedPrompts.push(params.prompt);
      return { jobId: "job-retry", estimatedSeconds: 90 };
    });

    (pollUntilComplete as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ status: "complete", videoUrl: "https://cdn.example.com/bad1.mp4", costCents: 38 })
      .mockResolvedValueOnce({ status: "complete", videoUrl: "https://cdn.example.com/ok2.mp4", costCents: 38 });

    // First attempt fails guardrail, second passes
    mockComputeLineAngularVariance
      .mockResolvedValueOnce(8) // fails
      .mockResolvedValueOnce(1); // passes
    mockComputeTurbulenceScore
      .mockResolvedValueOnce(0.7) // fails
      .mockResolvedValueOnce(0.3); // passes

    const { tryWithGuardrail } = await import("./multi-take.js");
    const result = await tryWithGuardrail(BASE_OPTS);

    expect(result.ok).toBe(true);
    expect(result.attempts).toHaveLength(2);

    // First attempt: base prompt
    expect(capturedPrompts[0]).toBe("Smooth walkthrough from living room to kitchen");
    // Second attempt: reduced-motion prefix injected
    expect(capturedPrompts[1]).toMatch(/minimal.*subtle.*camera/i);
    expect(capturedPrompts[1]).toContain("Smooth walkthrough from living room to kitchen");
  });

  it("records a cost_event for each generation attempt", async () => {
    const { pollUntilComplete } = await import("../../providers/provider.interface.js");

    mockGenerateClip.mockResolvedValue({ jobId: "job-costs", estimatedSeconds: 90 });
    (pollUntilComplete as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "complete",
      videoUrl: "https://cdn.example.com/output-costs.mp4",
      costCents: 38,
    });

    // Both attempts fail guardrail
    mockComputeLineAngularVariance.mockResolvedValue(20);
    mockComputeTurbulenceScore.mockResolvedValue(0.9);

    const { tryWithGuardrail } = await import("./multi-take.js");
    await tryWithGuardrail(BASE_OPTS);

    // recordCostEvent should be called once per attempt (2 total)
    expect(mockRecordCostEvent).toHaveBeenCalledTimes(2);

    // Each call should contain the pair_label_id in metadata
    for (const call of mockRecordCostEvent.mock.calls) {
      const event = call[0];
      expect(event.metadata?.pair_label_id).toBe("label-001");
      expect(event.provider).toBe("atlas");
      expect(event.stage).toBe("generation");
      expect(typeof event.costCents).toBe("number");
    }
  });

  it("returns ok=false with reason when atlasModelSlug is not registered", async () => {
    const { tryWithGuardrail } = await import("./multi-take.js");
    const result = await tryWithGuardrail({
      ...BASE_OPTS,
      atlasModelSlug: "nonexistent-model",
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/unknown atlasmodelslug/i);
    expect(result.attempts).toHaveLength(0);
  });

  it("returns ok=false immediately on Atlas submit failure", async () => {
    mockGenerateClip.mockRejectedValue(new Error("Atlas API unreachable"));

    const { tryWithGuardrail } = await import("./multi-take.js");
    const result = await tryWithGuardrail(BASE_OPTS);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/atlas submit failed/i);
    expect(result.attempts).toHaveLength(0);
  });
});
