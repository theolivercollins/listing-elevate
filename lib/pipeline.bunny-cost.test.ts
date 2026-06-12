/**
 * Tests for emitBunnyFinalizeCostEvent — the helper that emits a cost_events
 * row with provider:'bunny' after each finalizeAssemblyRender call in
 * pipeline.ts (task T3-pipeline-bunny-cost).
 *
 * Success criteria verified here:
 *   1. A cost_events row with provider:'bunny' is emitted when finalize hosted
 *      on Bunny (finalizeUrl !== providerUrl AND outputBytes != null).
 *   2. costCents=0 rows ARE emitted (unitsConsumed:1) — Oliver: "even $0 calls".
 *   3. No row is emitted when finalize fell back (url === providerUrl).
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
const PROVIDER_URL = "https://creatomate.com/renders/abc.mp4";
const BUNNY_URL = "https://vz-cdn.b-cdn.net/guid-abc/play_720p.mp4";
const PROPERTY_ID = "prop-xyz";
const OUTPUT_BYTES = 50_000_000; // 50 MB

describe("emitBunnyFinalizeCostEvent", () => {
  beforeEach(() => {
    recordCostEventMock.mockReset().mockResolvedValue(undefined);
    bunnyStreamCostCentsMock.mockReset().mockImplementation(
      (bytes: number) => Math.round(bytes / 1_073_741_824),
    );
  });

  it("emits a bunny cost_events row when finalize hosted on Bunny (url !== providerUrl)", async () => {
    await emitBunnyFinalizeCostEvent({
      propertyId: PROPERTY_ID,
      aspectRatio: "16:9",
      providerUrl: PROVIDER_URL,
      finalizeUrl: BUNNY_URL,
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

  it("emits costCents=0 when file is sub-1GB (no silent skip — even $0 calls must appear)", async () => {
    bunnyStreamCostCentsMock.mockReturnValue(0);

    await emitBunnyFinalizeCostEvent({
      propertyId: PROPERTY_ID,
      aspectRatio: "9:16",
      providerUrl: PROVIDER_URL,
      finalizeUrl: BUNNY_URL,
      outputBytes: 1_000_000,
      bitrateKbps: 500,
    });

    expect(recordCostEventMock).toHaveBeenCalledTimes(1);
    const call = recordCostEventMock.mock.calls[0][0];
    expect(call.costCents).toBe(0);
    expect(call.unitsConsumed).toBe(1); // row still emitted even at $0
    expect(call.metadata).toMatchObject({ aspect_ratio: "9:16" });
  });

  it("does NOT emit a cost row when finalize fell back (url === providerUrl)", async () => {
    await emitBunnyFinalizeCostEvent({
      propertyId: PROPERTY_ID,
      aspectRatio: "16:9",
      providerUrl: PROVIDER_URL,
      finalizeUrl: PROVIDER_URL, // same URL = fallback
      outputBytes: OUTPUT_BYTES,
      bitrateKbps: 10_000,
    });

    expect(recordCostEventMock).not.toHaveBeenCalled();
  });

  it("does NOT emit a cost row when outputBytes is null (download failed)", async () => {
    await emitBunnyFinalizeCostEvent({
      propertyId: PROPERTY_ID,
      aspectRatio: "16:9",
      providerUrl: PROVIDER_URL,
      finalizeUrl: BUNNY_URL,
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
        providerUrl: PROVIDER_URL,
        finalizeUrl: BUNNY_URL,
        outputBytes: OUTPUT_BYTES,
        bitrateKbps: 10_000,
      }),
    ).resolves.toBeUndefined();
  });
});
