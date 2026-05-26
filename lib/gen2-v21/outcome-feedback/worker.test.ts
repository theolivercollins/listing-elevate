import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Atlas provider (fetch) — still used by pollAtlas for submitted/polling rows
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock guardrail
vi.mock("../guardrail/multi-take.js", () => ({
  tryWithGuardrail: vi.fn(),
}));

// Mock judge
vi.mock("./judge.js", () => ({
  judgeRenderedClip: vi.fn().mockResolvedValue({
    score: 0.88,
    reasoning: "Clean motion.",
    costCents: 5,
  }),
}));

// Mock retrain hook
vi.mock("./retrain-hook.js", () => ({
  triggerRetrainIfReady: vi.fn().mockResolvedValue({ retrained: false }),
}));

import { processOutstandingOutcomes } from "./worker.js";
import type { RenderOutcome } from "../types.js";
import { tryWithGuardrail } from "../guardrail/multi-take.js";

// Helper: builds a mock Supabase client with configurable table responses
function buildMockSupabase(config: {
  outcomes?: RenderOutcome[];
  rpcOutcomes?: RenderOutcome[] | null;
  labelRow?: { photo_a_id: string; photo_b_id: string } | null;
  photos?: Array<{ photo_id: string; file_url: string }>;
  atlasSubmitOk?: boolean;
}) {
  const tableData: Record<string, unknown[]> = {
    gen2_render_outcomes: config.outcomes ?? [],
    gen2_pair_labels: config.labelRow ? [config.labelRow] : [],
    photos: config.photos ?? [],
  };

  const tableUpdates: Record<string, unknown[]> = {};

  const makeBuilder = (tableName: string) => {
    const builder: Record<string, unknown> = {};
    let _data: unknown[] = [...(tableData[tableName] ?? [])];

    builder.select = vi.fn().mockReturnThis();
    builder.update = vi.fn().mockImplementation((vals: unknown) => {
      tableUpdates[tableName] = tableUpdates[tableName] ?? [];
      tableUpdates[tableName].push(vals);
      return builder;
    });
    builder.insert = vi.fn().mockReturnThis();
    builder.eq = vi.fn().mockReturnThis();
    builder.neq = vi.fn().mockReturnThis();
    builder.in = vi.fn().mockReturnThis();
    builder.not = vi.fn().mockReturnThis();
    builder.lte = vi.fn().mockReturnThis();
    builder.order = vi.fn().mockReturnThis();
    builder.limit = vi.fn().mockReturnThis();
    builder.then = vi.fn().mockImplementation((resolve: (res: unknown) => void) => {
      resolve({ data: _data, error: null });
    });

    return builder;
  };

  const supabase = {
    from: vi.fn().mockImplementation((tableName: string) => makeBuilder(tableName)),
    rpc: vi.fn().mockImplementation((fn: string) => {
      if (fn === "claim_v21_outcomes") {
        // If rpcOutcomes is null, simulate RPC unavailable
        if (config.rpcOutcomes === null) {
          return Promise.resolve({ data: null, error: new Error("RPC not found") });
        }
        return Promise.resolve({
          data: config.rpcOutcomes ?? config.outcomes ?? [],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    _updates: tableUpdates,
  };

  return supabase;
}

const BASE_OUTCOME: RenderOutcome = {
  outcome_id: "out-1",
  pair_label_id: "label-1",
  atlas_job_id: null,
  video_url: null,
  judge_score: null,
  judge_reasoning: null,
  status: "pending",
  cost_cents: 0,
  retry_count: 0,
  created_at: new Date().toISOString(),
  completed_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ATLASCLOUD_API_KEY = "test-atlas-key";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEN2_V21_ENABLED = "true";
});

describe("processOutstandingOutcomes", () => {
  it("returns { processed: 0, errors: 0 } when no outcomes", async () => {
    const supabase = buildMockSupabase({ outcomes: [], rpcOutcomes: [] });
    const result = await processOutstandingOutcomes(supabase);
    expect(result).toEqual({ processed: 0, errors: 0 });
  });

  it("pending → rendered when guardrail passes on first take", async () => {
    const mockGuardrail = vi.mocked(tryWithGuardrail);
    mockGuardrail.mockResolvedValueOnce({
      ok: true,
      videoUrl: "https://cdn.example.com/video.mp4",
      attempts: [
        { videoUrl: "https://cdn.example.com/video.mp4", lineVariance: 1.2, turbulence: 0.1, passed: true },
      ],
    });

    const supabase = buildMockSupabase({
      rpcOutcomes: [{ ...BASE_OUTCOME, status: "pending" }],
      labelRow: { photo_a_id: "photo-a", photo_b_id: "photo-b" },
      photos: [
        { photo_id: "photo-a", file_url: "https://cdn.example.com/a.jpg" },
        { photo_id: "photo-b", file_url: "https://cdn.example.com/b.jpg" },
      ],
    });

    const result = await processOutstandingOutcomes(supabase);
    expect(result.processed).toBe(1);
    expect(result.errors).toBe(0);
    // tryWithGuardrail was called with correct args
    expect(mockGuardrail).toHaveBeenCalledWith(
      expect.objectContaining({
        pairLabelId: "label-1",
        photoAUrl: "https://cdn.example.com/a.jpg",
        photoBUrl: "https://cdn.example.com/b.jpg",
        atlasModelSlug: "kling-o3-pro",
        maxAttempts: 2,
      }),
    );
    // Outcome updated to rendered with videoUrl
    const updates = supabase._updates["gen2_render_outcomes"] ?? [];
    const renderUpdate = updates.find((u: Record<string, unknown>) => u.status === "rendered");
    expect(renderUpdate).toBeDefined();
    expect((renderUpdate as Record<string, unknown>).video_url).toBe("https://cdn.example.com/video.mp4");
    // Attempts audit trail persisted in judge_reasoning
    const attemptsJson = (renderUpdate as Record<string, unknown>).judge_reasoning as string;
    const parsed = JSON.parse(attemptsJson);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].passed).toBe(true);
  });

  it("pending → failed with attempts audit trail when guardrail fails both takes", async () => {
    const mockGuardrail = vi.mocked(tryWithGuardrail);
    const failedAttempts = [
      { videoUrl: "https://cdn.example.com/v1.mp4", lineVariance: 4.5, turbulence: 0.6, passed: false },
      { videoUrl: "https://cdn.example.com/v2.mp4", lineVariance: 3.8, turbulence: 0.55, passed: false },
    ];
    mockGuardrail.mockResolvedValueOnce({
      ok: false,
      reason: "Guardrail failed after 2 attempt(s): lineVariance=3.80° turbulence=0.550",
      attempts: failedAttempts,
    });

    const supabase = buildMockSupabase({
      rpcOutcomes: [{ ...BASE_OUTCOME, status: "pending" }],
      labelRow: { photo_a_id: "photo-a", photo_b_id: "photo-b" },
      photos: [
        { photo_id: "photo-a", file_url: "https://cdn.example.com/a.jpg" },
        { photo_id: "photo-b", file_url: "https://cdn.example.com/b.jpg" },
      ],
    });

    const result = await processOutstandingOutcomes(supabase);
    expect(result.processed).toBe(1);
    expect(result.errors).toBe(0);
    // Outcome updated to failed
    const updates = supabase._updates["gen2_render_outcomes"] ?? [];
    const failUpdate = updates.find((u: Record<string, unknown>) => u.status === "failed");
    expect(failUpdate).toBeDefined();
    // Both attempts persisted in judge_reasoning
    const attemptsJson = (failUpdate as Record<string, unknown>).judge_reasoning as string;
    const parsed = JSON.parse(attemptsJson);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].passed).toBe(false);
    expect(parsed[1].passed).toBe(false);
  });

  it("GEN2_V21_ENABLED=false → no-op (returns 0/0 without touching DB)", async () => {
    process.env.GEN2_V21_ENABLED = "false";
    const mockGuardrail = vi.mocked(tryWithGuardrail);

    const supabase = buildMockSupabase({
      rpcOutcomes: [{ ...BASE_OUTCOME, status: "pending" }],
      labelRow: { photo_a_id: "photo-a", photo_b_id: "photo-b" },
      photos: [
        { photo_id: "photo-a", file_url: "https://cdn.example.com/a.jpg" },
        { photo_id: "photo-b", file_url: "https://cdn.example.com/b.jpg" },
      ],
    });

    const result = await processOutstandingOutcomes(supabase);
    expect(result).toEqual({ processed: 0, errors: 0 });
    expect(mockGuardrail).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("polls Atlas and marks rendered when complete", async () => {
    // Mock Atlas status check returning completed
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 200,
        data: {
          status: "succeeded",
          outputs: ["https://cdn.example.com/video.mp4"],
        },
      }),
    });

    const supabase = buildMockSupabase({
      rpcOutcomes: [
        {
          ...BASE_OUTCOME,
          status: "polling",
          atlas_job_id: "atlas-job-123",
        },
      ],
    });

    const result = await processOutstandingOutcomes(supabase);
    expect(result.processed).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("marks failed when retry_count reaches cap", async () => {
    const supabase = buildMockSupabase({
      rpcOutcomes: [{ ...BASE_OUTCOME, status: "pending", retry_count: 2 }],
      labelRow: null,
    });

    const result = await processOutstandingOutcomes(supabase);
    expect(result.processed).toBe(1);
    expect(result.errors).toBe(0);
    // update should have been called with status: 'failed'
    expect(supabase.from).toHaveBeenCalledWith("gen2_render_outcomes");
  });

  it("calls judgeRenderedClip for rendered outcomes", async () => {
    const { judgeRenderedClip } = await import("./judge.js");

    const supabase = buildMockSupabase({
      rpcOutcomes: [
        {
          ...BASE_OUTCOME,
          status: "rendered",
          video_url: "https://cdn.example.com/video.mp4",
        },
      ],
      labelRow: { photo_a_id: "photo-a", photo_b_id: "photo-b" },
      photos: [
        { photo_id: "photo-a", file_url: "https://cdn.example.com/a.jpg" },
        { photo_id: "photo-b", file_url: "https://cdn.example.com/b.jpg" },
      ],
    });

    const result = await processOutstandingOutcomes(supabase);
    expect(result.processed).toBe(1);
    expect(result.errors).toBe(0);
    expect(judgeRenderedClip).toHaveBeenCalledWith(
      "https://cdn.example.com/video.mp4",
      "https://cdn.example.com/a.jpg",
      "https://cdn.example.com/b.jpg",
    );
  });

  it("falls back to non-locking SELECT when RPC is unavailable", async () => {
    const supabase = buildMockSupabase({
      outcomes: [],
      rpcOutcomes: null, // RPC unavailable
    });

    const result = await processOutstandingOutcomes(supabase);
    expect(result.processed).toBe(0);
    expect(result.errors).toBe(0);
    // from() called as fallback
    expect(supabase.from).toHaveBeenCalledWith("gen2_render_outcomes");
  });

  it("counts errors when guardrail throws unexpectedly", async () => {
    const mockGuardrail = vi.mocked(tryWithGuardrail);
    mockGuardrail.mockRejectedValueOnce(new Error("Network error"));

    const supabase = buildMockSupabase({
      rpcOutcomes: [{ ...BASE_OUTCOME, status: "pending" }],
      labelRow: { photo_a_id: "photo-a", photo_b_id: "photo-b" },
      photos: [
        { photo_id: "photo-a", file_url: "https://cdn.example.com/a.jpg" },
        { photo_id: "photo-b", file_url: "https://cdn.example.com/b.jpg" },
      ],
    });

    const result = await processOutstandingOutcomes(supabase);
    expect(result.errors).toBe(1);
    expect(result.processed).toBe(0);
  });

  it("marks timeout for outcomes in polling state beyond 20 minutes", async () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 1000).toISOString();

    const supabase = buildMockSupabase({
      rpcOutcomes: [
        {
          ...BASE_OUTCOME,
          status: "polling",
          atlas_job_id: "atlas-job-123",
          created_at: oldDate,
        },
      ],
    });

    const result = await processOutstandingOutcomes(supabase);
    expect(result.processed).toBe(1);
    expect(result.errors).toBe(0);
    // Should have updated to failed due to timeout
    expect(supabase.from).toHaveBeenCalledWith("gen2_render_outcomes");
  });
});
