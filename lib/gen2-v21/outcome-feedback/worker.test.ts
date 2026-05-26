import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Atlas provider (fetch)
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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
});

describe("processOutstandingOutcomes", () => {
  it("returns { processed: 0, errors: 0 } when no outcomes", async () => {
    const supabase = buildMockSupabase({ outcomes: [], rpcOutcomes: [] });
    const result = await processOutstandingOutcomes(supabase);
    expect(result).toEqual({ processed: 0, errors: 0 });
  });

  it("submits pending outcome to Atlas", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: 200, data: { id: "atlas-job-123" } }),
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
    // Atlas endpoint was called
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("atlascloud.ai"),
      expect.objectContaining({ method: "POST" }),
    );
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

  it("counts errors when Atlas submit fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

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
