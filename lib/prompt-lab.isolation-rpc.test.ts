import { describe, it, expect, vi, beforeEach } from "vitest";

// Lock in the contract: retrieveSimilarIterations / retrieveSimilarLosers
// pass p_pipeline_version to the Postgres RPC only when opts.pipelineVersion
// is supplied. Prevents regressions where a caller stops threading the
// option and v1/v1.1 leakage silently returns.

const mockRpc = vi.fn();
const mockSupabase = { rpc: mockRpc };

vi.mock("./client.js", () => ({
  getSupabase: () => mockSupabase,
}));

// Stub embedding helpers so importing prompt-lab doesn't pull pgvector.
vi.mock("./embeddings.js", async () => {
  const real = await vi.importActual<typeof import("./embeddings.js")>("./embeddings.js");
  return { ...real, toPgVector: (e: number[]) => `[${e.join(",")}]` };
});

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: [], error: null });
});

describe("retrieveSimilarIterations — pipeline_version threading", () => {
  it("does NOT pass p_pipeline_version when option is omitted", async () => {
    const { retrieveSimilarIterations } = await import("./prompt-lab.js");
    await retrieveSimilarIterations([0.1, 0.2], { minRating: 4, limit: 5 });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [rpcName, body] = mockRpc.mock.calls[0];
    expect(rpcName).toBe("match_rated_examples");
    expect(body).not.toHaveProperty("p_pipeline_version");
  });

  it("passes p_pipeline_version='v1.1' when supplied", async () => {
    const { retrieveSimilarIterations } = await import("./prompt-lab.js");
    await retrieveSimilarIterations([0.1, 0.2], {
      minRating: 4,
      limit: 5,
      pipelineVersion: "v1.1",
    });
    const [, body] = mockRpc.mock.calls[0];
    expect(body.p_pipeline_version).toBe("v1.1");
  });

  it("passes p_pipeline_version='v1' when supplied", async () => {
    const { retrieveSimilarIterations } = await import("./prompt-lab.js");
    await retrieveSimilarIterations([0.1, 0.2], {
      pipelineVersion: "v1",
    });
    const [, body] = mockRpc.mock.calls[0];
    expect(body.p_pipeline_version).toBe("v1");
  });
});

describe("retrieveSimilarLosers — pipeline_version threading", () => {
  it("does NOT pass p_pipeline_version when option is omitted", async () => {
    const { retrieveSimilarLosers } = await import("./prompt-lab.js");
    await retrieveSimilarLosers([0.1, 0.2], { maxRating: 2, limit: 3 });
    const [rpcName, body] = mockRpc.mock.calls[0];
    expect(rpcName).toBe("match_loser_examples");
    expect(body).not.toHaveProperty("p_pipeline_version");
  });

  it("passes p_pipeline_version='v1.1' when supplied", async () => {
    const { retrieveSimilarLosers } = await import("./prompt-lab.js");
    await retrieveSimilarLosers([0.1, 0.2], {
      maxRating: 2,
      pipelineVersion: "v1.1",
    });
    const [, body] = mockRpc.mock.calls[0];
    expect(body.p_pipeline_version).toBe("v1.1");
  });
});
