/**
 * prompt-lab.feedback-retrieval.test.ts
 *
 * Tests for retrieveRecentModelFeedback() in lib/prompt-lab.ts.
 *
 * Version isolation is a hard requirement: v1 feedback must NEVER appear
 * under v1.1 queries, and vice versa.
 *
 * 1. retrieveRecentModelFeedback('kling-v2-master', { pipelineVersion: 'v1' })
 *    returns v1 rows only.
 * 2. retrieveRecentModelFeedback(..., { pipelineVersion: 'v1.1' })
 *    returns v1.1 rows only.
 * 3. Returns at most `limit` rows.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase mock ─────────────────────────────────────────────────────────────
// retrieveRecentModelFeedback does a dynamic import of ./client.js, so we
// need to mock the module.

let mockRows: Array<{ comment: string; created_at: string; model_used: string; pipeline_version: string }> = [];
let capturedEqs: Array<{ column: string; value: unknown }> = [];
let capturedLimit: number | null = null;

vi.mock("./client.js", () => ({
  getSupabase: () => ({
    from: (_table: string) => {
      // Reset capture on each from() call
      capturedEqs = [];
      capturedLimit = null;

      const chain: Record<string, unknown> = {};

      chain.select = (_cols: string) => chain;

      chain.eq = (col: string, val: unknown) => {
        capturedEqs.push({ column: col, value: val });
        return chain;
      };

      chain.order = (_col: string, _opts: unknown) => chain;

      chain.limit = (n: number) => {
        capturedLimit = n;
        // Filter mockRows by the captured eq conditions to simulate DB
        const filtered = mockRows.filter((r) =>
          capturedEqs.every(({ column, value }) => (r as Record<string, unknown>)[column] === value)
        );
        // Respect limit
        const limited = n != null ? filtered.slice(0, n) : filtered;
        return Promise.resolve({
          data: limited.map(({ comment, created_at }) => ({ comment, created_at })),
          error: null,
        });
      };

      return chain;
    },
  }),
}));

// ── Import after mocks ────────────────────────────────────────────────────────
const { retrieveRecentModelFeedback } = await import("./prompt-lab.js");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const V1_ROWS = [
  { comment: "v1 note A", created_at: "2026-05-20T00:00:00Z", model_used: "kling-v2-master", pipeline_version: "v1" },
  { comment: "v1 note B", created_at: "2026-05-21T00:00:00Z", model_used: "kling-v2-master", pipeline_version: "v1" },
];

const V1_1_ROWS = [
  { comment: "v1.1 note A", created_at: "2026-05-22T00:00:00Z", model_used: "kling-v2-master", pipeline_version: "v1.1" },
  { comment: "v1.1 note B", created_at: "2026-05-23T00:00:00Z", model_used: "kling-v2-master", pipeline_version: "v1.1" },
  { comment: "v1.1 note C", created_at: "2026-05-24T00:00:00Z", model_used: "kling-v2-master", pipeline_version: "v1.1" },
];

beforeEach(() => {
  vi.clearAllMocks();
  // Default fixture: mixed rows for both versions
  mockRows = [...V1_ROWS, ...V1_1_ROWS];
  capturedEqs = [];
  capturedLimit = null;
});

// ─────────────────────────────────────────────────────────────────────────────

describe("retrieveRecentModelFeedback", () => {
  // Test 1
  it("returns only v1 rows when pipelineVersion='v1'", async () => {
    const result = await retrieveRecentModelFeedback("kling-v2-master", {
      pipelineVersion: "v1",
    });

    // All returned rows must be v1
    expect(result.length).toBeGreaterThan(0);
    // The mock filters by pipeline_version eq; only V1_ROWS should come back.
    // Verify no v1.1 comment leaks through.
    const comments = result.map((r) => r.comment);
    expect(comments.every((c) => c.startsWith("v1 note"))).toBe(true);
    expect(comments.some((c) => c.includes("v1.1"))).toBe(false);
  });

  // Test 2
  it("returns only v1.1 rows when pipelineVersion='v1.1'", async () => {
    const result = await retrieveRecentModelFeedback("kling-v2-master", {
      pipelineVersion: "v1.1",
    });

    expect(result.length).toBeGreaterThan(0);
    const comments = result.map((r) => r.comment);
    expect(comments.every((c) => c.includes("v1.1"))).toBe(true);
    expect(comments.some((c) => c === "v1 note A" || c === "v1 note B")).toBe(false);
  });

  // Test 3
  it("returns at most `limit` rows", async () => {
    // V1_1_ROWS has 3 entries; limit=2 should cap it.
    const result = await retrieveRecentModelFeedback("kling-v2-master", {
      pipelineVersion: "v1.1",
      limit: 2,
    });

    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("returns comment and created_at fields only", async () => {
    const result = await retrieveRecentModelFeedback("kling-v2-master", {
      pipelineVersion: "v1",
    });

    for (const row of result) {
      expect(typeof row.comment).toBe("string");
      expect(typeof row.created_at).toBe("string");
      // No other fields should be present (embedding, author, etc.)
      const keys = Object.keys(row);
      expect(keys).toEqual(expect.arrayContaining(["comment", "created_at"]));
      expect(keys).not.toContain("embedding");
      expect(keys).not.toContain("author");
    }
  });
});
