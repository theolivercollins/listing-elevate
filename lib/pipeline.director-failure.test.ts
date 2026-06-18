/**
 * Test for the director no-parseable-script failure surfacing in runScripting,
 * exercised via the exported continuePipelineAfterPhotoSelection (runScripting
 * itself is module-private).
 *
 * Invariant under test (hardening task, change #3 + #4):
 *   When the director (DIRECTOR_MODEL) returns text with NO JSON brace-block
 *   AND a delivery_run id is threaded through, runScripting must:
 *     - record a cost_event for the (token-consuming) director call, and
 *     - call setRunError(runId, <actionable msg>), and
 *     - THROW (so api/pipeline/continue's catch surfaces the failure)
 *   instead of the old silent updatePropertyStatus('failed') + return.
 *
 * Mock strategy: importOriginal on ./db.js so the many real exports survive and
 * only the handful runScripting touches are stubbed (a known gate-catch in this
 * repo — partial module mocks must preserve real exports). The Anthropic SDK is
 * fully mocked to return brace-less text. runPropertyStyleGuide (which runs
 * before runScripting inside continuePipelineAfterPhotoSelection) is short-
 * circuited by returning a property that already HAS a style_guide.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Anthropic SDK: messages.create returns brace-less text + usage ──
const mockMessagesCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create: (...a: unknown[]) => mockMessagesCreate(...a) };
  }
  return { default: MockAnthropic };
});

// ── ./delivery/runs.js: capture setRunError ──
const mockSetRunError = vi.fn();
vi.mock("./delivery/runs.js", () => ({
  setRunError: (...a: unknown[]) => mockSetRunError(...a),
}));

// ── ./prompts/resolve.js: avoid DB; return the compile-time prompt ──
vi.mock("./prompts/resolve.js", () => ({
  resolveProductionPrompt: vi.fn().mockResolvedValue({
    source: "compile_time",
    body: "DIRECTOR SYSTEM",
    version: 0,
  }),
}));

// ── ./prompts/per-photo-retrieval.js: avoid DB-backed retrieval ──
vi.mock("./prompts/per-photo-retrieval.js", () => ({
  fetchPerPhotoRetrievalBundle: vi.fn().mockResolvedValue({
    recipes: [],
    exemplars: [],
    losers: [],
  }),
  renderPerPhotoBlock: vi.fn().mockReturnValue(""),
}));

// ── ./db.js: importOriginal so all real exports survive; stub the few used ──
const mockRecordCostEvent = vi.fn();
const mockUpdatePropertyStatus = vi.fn();
const mockGetScenesForProperty = vi.fn();
const mockGetSelectedPhotos = vi.fn();
const mockGetProperty = vi.fn();
const mockLog = vi.fn();
const mockGetSupabase = vi.fn();

vi.mock("./db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db.js")>();
  return {
    ...actual,
    recordCostEvent: (...a: unknown[]) => mockRecordCostEvent(...a),
    updatePropertyStatus: (...a: unknown[]) => mockUpdatePropertyStatus(...a),
    getScenesForProperty: (...a: unknown[]) => mockGetScenesForProperty(...a),
    getSelectedPhotos: (...a: unknown[]) => mockGetSelectedPhotos(...a),
    getProperty: (...a: unknown[]) => mockGetProperty(...a),
    log: (...a: unknown[]) => mockLog(...a),
    getSupabase: (...a: unknown[]) => mockGetSupabase(...a),
  };
});

import { continuePipelineAfterPhotoSelection } from "./pipeline.js";

const PROP_ID = "prop-director-fail-001";
const RUN_ID = "run-director-fail-001";

function chainResolvingMaybeSingle(data: unknown) {
  // Permissive chainable for getSupabase().from(t).select().eq().neq()
  // .order().limit().maybeSingle()/.single() — every filter returns the same
  // chain; terminals resolve with { data }. Covers both the selected_duration
  // lookup in runScripting and the delivery_run gate in runGenerationSubmit.
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "order", "limit", "is", "not", "in"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
  chain.single = vi.fn().mockResolvedValue({ data, error: null });
  return { from: vi.fn().mockReturnValue(chain) };
}

beforeEach(() => {
  vi.clearAllMocks();

  // Style-guide pass short-circuits: property already HAS a style_guide.
  mockGetProperty.mockResolvedValue({
    id: PROP_ID,
    style_guide: "already-built",
    pipeline_mode: "v1",
  });
  // No existing scenes → runScripting proceeds to the director call.
  mockGetScenesForProperty.mockResolvedValue([]);
  // At least one selected photo so runScripting does not early-return.
  mockGetSelectedPhotos.mockResolvedValue([
    {
      id: "photo-1",
      file_name: "front.jpg",
      file_url: "https://example.test/front.jpg",
      room_type: "exterior",
      aesthetic_score: 8,
      depth_rating: "high",
      key_features: [],
      analysis_json: {},
    },
  ]);
  // selected_duration lookup inside runScripting.
  mockGetSupabase.mockReturnValue(
    chainResolvingMaybeSingle({ selected_duration: 30 }),
  );
  mockLog.mockResolvedValue(undefined);
  mockUpdatePropertyStatus.mockResolvedValue(undefined);
  mockRecordCostEvent.mockResolvedValue(undefined);
  mockSetRunError.mockResolvedValue(undefined);
});

describe("runScripting director no-parseable-script failure (via continuePipelineAfterPhotoSelection)", () => {
  it("records cost, calls setRunError, and THROWS when deliveryRunId is present", async () => {
    // Director returns prose with NO JSON brace-block.
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: "text", text: "I'm sorry, I cannot produce a shot plan." }],
      usage: { input_tokens: 1200, output_tokens: 80 },
    });

    await expect(
      continuePipelineAfterPhotoSelection(PROP_ID, {
        order_mode: "operator",
        delivery_run_id: RUN_ID,
      }),
    ).rejects.toThrow(/no parseable script/i);

    // Cost recorded for the token-consuming director call even on failure.
    expect(mockRecordCostEvent).toHaveBeenCalledTimes(1);
    const costArg = mockRecordCostEvent.mock.calls[0]?.[0] as {
      provider: string;
      stage: string;
      metadata: Record<string, unknown>;
    };
    expect(costArg.provider).toBe("anthropic");
    expect(costArg.stage).toBe("scripting");
    expect(costArg.metadata.parse_failed).toBe(true);

    // Visible, actionable error attached to the delivery_run.
    expect(mockSetRunError).toHaveBeenCalledTimes(1);
    expect(mockSetRunError).toHaveBeenCalledWith(
      RUN_ID,
      expect.stringMatching(/director script generation failed/i),
    );
  });

  it("does NOT throw or setRunError when no deliveryRunId (autonomous/customer path keeps silent-fail)", async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: "text", text: "No JSON here at all." }],
      usage: { input_tokens: 500, output_tokens: 40 },
    });

    // No delivery_run_id in the context → legacy behavior: property marked
    // failed, plain return, NO throw, NO setRunError.
    await expect(
      continuePipelineAfterPhotoSelection(PROP_ID, { order_mode: "customer" }),
    ).resolves.toBeUndefined();

    expect(mockSetRunError).not.toHaveBeenCalled();
    expect(mockUpdatePropertyStatus).toHaveBeenCalledWith(PROP_ID, "failed");
    // Cost still recorded on the failure path.
    expect(mockRecordCostEvent).toHaveBeenCalledTimes(1);
  });
});
