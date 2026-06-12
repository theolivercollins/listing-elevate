/**
 * Tests for emitBunnyFinalizeCostEvent — the helper that emits a cost_events
 * row with provider:'bunny' after each finalizeAssemblyRender call in
 * pipeline.ts (task T3-pipeline-bunny-cost).
 *
 * Success criteria verified here:
 *   1. A cost_events row with provider:'bunny' is emitted when bunnyWasCalled=true
 *      AND outputBytes != null (covers both happy path and HEAD-fallback path).
 *   2. costCents=0 rows ARE emitted (unitsConsumed:1) — Oliver: "even $0 calls".
 *   3. No row is emitted when bunnyWasCalled=false (kill switch / env guard /
 *      download failure / unconfigured / hostVideoOnBunny threw).
 *   4. No row is emitted when outputBytes is null (download failed).
 *   5. recordCostEvent errors are swallowed — cost-row failure never blocks.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { emitBunnyFinalizeCostEvent } from "./assembly/bunny-finalize-cost.js";

// ── Mock db.js ───────────────────────────────────────────────────────────────
vi.mock("./db.js", () => ({
  recordCostEvent: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock bunny-stream.js ─────────────────────────────────────────────────────
vi.mock("./providers/bunny-stream.js", () => ({
  bunnyStreamCostCents: vi.fn((bytes: number) => Math.round(bytes / 1_073_741_824)),
  isBunnyConfigured: vi.fn().mockReturnValue(true),
  hostVideoOnBunny: vi.fn(),
  bunnyMp4Url: vi.fn(),
  bunnyHlsUrl: vi.fn(),
}));

import { recordCostEvent } from "./db.js";
import { bunnyStreamCostCents } from "./providers/bunny-stream.js";

const recordCostEventMock = vi.mocked(recordCostEvent);
const bunnyStreamCostCentsMock = vi.mocked(bunnyStreamCostCents);

// ---------------------------------------------------------------------------
const PROPERTY_ID = "prop-xyz";
const OUTPUT_BYTES = 50_000_000; // 50 MB

describe("emitBunnyFinalizeCostEvent", () => {
  beforeEach(() => {
    recordCostEventMock.mockReset().mockResolvedValue(undefined);
    bunnyStreamCostCentsMock.mockReset().mockImplementation(
      (bytes: number) => Math.round(bytes / 1_073_741_824),
    );
  });

  it("emits a bunny cost_events row when bunnyWasCalled=true and outputBytes is set (happy path)", async () => {
    await emitBunnyFinalizeCostEvent({
      propertyId: PROPERTY_ID,
      aspectRatio: "16:9",
      bunnyWasCalled: true,
      outputBytes: OUTPUT_BYTES,
      bitrateKbps: 10_000,
    });

    expect(recordCostEventMock).toHaveBeenCalledTimes(1);
    const call = recordCostEventMock.mock.calls[0][0];
    expect(call.propertyId).toBe(PROPERTY_ID);
    expect(call.stage).toBe("assembly");
    expect(call.provider).toBe("bunny");
    expect(call.unitsConsumed).toBe(1);
    expect(call.unitType).toBe("renders");
    expect(call.metadata).toMatchObject({
      aspect_ratio: "16:9",
      output_bytes: OUTPUT_BYTES,
      bitrate_kbps: 10_000,
      bunny_hosted: true,
      source: "assembly_finalize",
    });
  });

  it("emits a bunny cost_events row when bunnyWasCalled=true even if url fell back to providerUrl (HEAD-check fallback)", async () => {
    // HEAD failure: Bunny was called (charges incurred) but url is still providerUrl.
    await emitBunnyFinalizeCostEvent({
      propertyId: PROPERTY_ID,
      aspectRatio: "16:9",
      bunnyWasCalled: true,
      outputBytes: OUTPUT_BYTES,
      bitrateKbps: 10_000,
    });

    expect(recordCostEventMock).toHaveBeenCalledTimes(1);
    const call = recordCostEventMock.mock.calls[0][0];
    expect(call.provider).toBe("bunny");
    expect(call.unitsConsumed).toBe(1);
  });

  it("emits costCents=0 when file is sub-1GB (no silent skip — even $0 calls must appear)", async () => {
    bunnyStreamCostCentsMock.mockReturnValue(0);

    await emitBunnyFinalizeCostEvent({
      propertyId: PROPERTY_ID,
      aspectRatio: "9:16",
      bunnyWasCalled: true,
      outputBytes: 1_000_000,
      bitrateKbps: 500,
    });

    expect(recordCostEventMock).toHaveBeenCalledTimes(1);
    const call = recordCostEventMock.mock.calls[0][0];
    expect(call.costCents).toBe(0);
    expect(call.unitsConsumed).toBe(1); // row still emitted even at $0
    expect(call.metadata).toMatchObject({ aspect_ratio: "9:16" });
  });

  it("does NOT emit a cost row when bunnyWasCalled=false (kill switch / env guard / unconfigured)", async () => {
    await emitBunnyFinalizeCostEvent({
      propertyId: PROPERTY_ID,
      aspectRatio: "16:9",
      bunnyWasCalled: false,
      outputBytes: OUTPUT_BYTES,
      bitrateKbps: 10_000,
    });

    expect(recordCostEventMock).not.toHaveBeenCalled();
  });

  it("does NOT emit a cost row when outputBytes is null (download failed)", async () => {
    await emitBunnyFinalizeCostEvent({
      propertyId: PROPERTY_ID,
      aspectRatio: "16:9",
      bunnyWasCalled: true,
      outputBytes: null,
      bitrateKbps: null,
    });

    expect(recordCostEventMock).not.toHaveBeenCalled();
  });

  it("swallows recordCostEvent errors — cost-row failure must never block delivery", async () => {
    recordCostEventMock.mockRejectedValueOnce(new Error("DB write failure"));

    await expect(
      emitBunnyFinalizeCostEvent({
        propertyId: PROPERTY_ID,
        aspectRatio: "16:9",
        bunnyWasCalled: true,
        outputBytes: OUTPUT_BYTES,
        bitrateKbps: 10_000,
      }),
    ).resolves.toBeUndefined();
  });
});
