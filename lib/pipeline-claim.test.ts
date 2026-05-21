import { describe, it, expect } from "vitest";
import { tryClaimPipelineRun } from "./pipeline-claim.js";

// Build a fake Supabase client surface narrow enough to exercise the claim's
// query chain without spinning up a real Postgres. The runtime client returns
// a builder whose .select() resolves to { data, error }.
function makeFakeSupabase(returnedRows: Array<{ id: string }> | null, opts?: {
  capturedFilters?: Array<{ method: string; args: unknown[] }>;
  errorMessage?: string;
}) {
  const captured = opts?.capturedFilters;
  const builder: Record<string, unknown> = {};
  builder.update = (patch: unknown) => {
    captured?.push({ method: "update", args: [patch] });
    return builder;
  };
  builder.eq = (key: string, value: unknown) => {
    captured?.push({ method: "eq", args: [key, value] });
    return builder;
  };
  builder.in = (key: string, values: unknown[]) => {
    captured?.push({ method: "in", args: [key, values] });
    return builder;
  };
  builder.select = (cols: string) => {
    captured?.push({ method: "select", args: [cols] });
    return Promise.resolve(
      opts?.errorMessage
        ? { data: null, error: { message: opts.errorMessage } }
        : { data: returnedRows, error: null },
    );
  };
  return { from: (_t: string) => builder } as never;
}

describe("tryClaimPipelineRun — pipeline-run idempotency CAS", () => {
  it("returns true when the row was updated (queued → analyzing succeeded)", async () => {
    const claimed = await tryClaimPipelineRun(
      makeFakeSupabase([{ id: "prop-1" }]),
      "prop-1",
    );
    expect(claimed).toBe(true);
  });

  it("returns false when 0 rows updated (a parallel run already claimed it)", async () => {
    const claimed = await tryClaimPipelineRun(
      makeFakeSupabase([]),
      "prop-1",
    );
    expect(claimed).toBe(false);
  });

  it("returns false when the row set is null (PostgREST error path)", async () => {
    const claimed = await tryClaimPipelineRun(
      makeFakeSupabase(null, { errorMessage: "boom" }),
      "prop-1",
    );
    expect(claimed).toBe(false);
  });

  it("uses an atomic update that stamps both status='analyzing' and pipeline_started_at", async () => {
    const captured: Array<{ method: string; args: unknown[] }> = [];
    await tryClaimPipelineRun(
      makeFakeSupabase([{ id: "prop-1" }], { capturedFilters: captured }),
      "prop-1",
    );
    const update = captured.find((c) => c.method === "update");
    expect(update).toBeDefined();
    const patch = (update?.args[0] ?? {}) as Record<string, unknown>;
    expect(patch.status).toBe("analyzing");
    expect(typeof patch.pipeline_started_at).toBe("string");
  });

  it("only claims rows whose status is in the re-runnable set (not 'analyzing' or 'complete')", async () => {
    // The IN-filter is what enforces idempotency: a row already in
    // analyzing/scripting/generating/assembling/complete cannot be claimed,
    // so a second parallel runPipeline call returns false and exits.
    const captured: Array<{ method: string; args: unknown[] }> = [];
    await tryClaimPipelineRun(
      makeFakeSupabase([{ id: "prop-1" }], { capturedFilters: captured }),
      "prop-1",
    );
    const inFilter = captured.find((c) => c.method === "in");
    expect(inFilter).toBeDefined();
    const [column, allowed] = inFilter!.args as [string, string[]];
    expect(column).toBe("status");
    // The exact set is policy: at minimum 'queued' (initial state after rerun.ts)
    // must be claimable. 'failed' and 'needs_review' are also operator-rerunnable
    // terminal states.
    expect(allowed).toContain("queued");
    expect(allowed).not.toContain("analyzing");
    expect(allowed).not.toContain("complete");
  });

  it("scopes the update to the requested property id only", async () => {
    const captured: Array<{ method: string; args: unknown[] }> = [];
    await tryClaimPipelineRun(
      makeFakeSupabase([{ id: "prop-XYZ" }], { capturedFilters: captured }),
      "prop-XYZ",
    );
    const eqFilter = captured.find((c) => c.method === "eq");
    expect(eqFilter).toBeDefined();
    expect(eqFilter!.args).toEqual(["id", "prop-XYZ"]);
  });
});
