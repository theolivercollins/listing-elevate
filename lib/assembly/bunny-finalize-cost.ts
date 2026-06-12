/**
 * bunny-finalize-cost.ts
 *
 * Single-purpose helper: emit a cost_events row for the Bunny Stream hosting
 * call that happens inside finalizeAssemblyRender.
 *
 * Extracted here so the logic is independently testable without the full
 * pipeline module graph, and to keep it DRY across the two pipeline call sites
 * (horizontal + vertical).
 *
 * Why a separate file: pipeline.ts uses dynamic import() for finalize — the
 * cost helper is statically imported (it calls recordCostEvent from db.ts which
 * is already in the static import graph). Keeping it in lib/assembly/ keeps
 * the assembly surface cohesive.
 *
 * Contract:
 *   - Emits ONE cost_events row with provider:'bunny' whenever bunnyWasCalled
 *     is true AND outputBytes is not null. This covers both the happy path (url
 *     is the Bunny mp4Url) AND the HEAD-fallback path (url === providerUrl but
 *     Bunny was still called and charges were incurred).
 *   - Emits nothing (no row) when bunnyWasCalled is false (kill switch, env
 *     guard, download failure, Bunny unconfigured, or hostVideoOnBunny threw).
 *   - Always resolves — never rejects. Any recordCostEvent failure is caught
 *     and swallowed so a DB write failure never blocks delivery (zero-HITL).
 *   - costCents may legitimately be 0 for sub-1GB files. The row is still
 *     emitted (unitsConsumed:1) so every Bunny API call is traceable.
 */

import { recordCostEvent } from "../db.js";
import { bunnyStreamCostCents } from "../providers/bunny-stream.js";

export interface BunnyFinalizeCostParams {
  propertyId: string;
  aspectRatio: "16:9" | "9:16";
  /**
   * True when hostVideoOnBunny was actually called in finalizeAssemblyRender.
   * Copied directly from FinalizeResult.bunnyWasCalled. When true the caller
   * MUST emit a cost row regardless of whether url === providerUrl (i.e. HEAD
   * check failed after a successful upload still incurs real Bunny charges).
   */
  bunnyWasCalled: boolean;
  /** Raw byte count from finalizeAssemblyRender.outputBytes. Null on failure. */
  outputBytes: number | null;
  /** Computed bitrate from finalizeAssemblyRender.bitrateKbps. Null on failure. */
  bitrateKbps: number | null;
}

/**
 * Emit a cost_events row for a successful Bunny Stream hosting call.
 *
 * Call this immediately after finalizeAssemblyRender in pipeline.ts.
 * It is a no-op when finalize fell back (url equality check), so it is safe
 * to call unconditionally after every finalize invocation.
 */
export async function emitBunnyFinalizeCostEvent(
  params: BunnyFinalizeCostParams,
): Promise<void> {
  const { propertyId, aspectRatio, bunnyWasCalled, outputBytes, bitrateKbps } = params;

  // No-op if Bunny was never called (kill-switch, env guard, download failure,
  // unconfigured). Also no-op if outputBytes is null — bytes needed for cost calc.
  if (!bunnyWasCalled || outputBytes === null) { return; }

  const costCents = bunnyStreamCostCents(outputBytes);

  // Swallow errors: a cost-row insertion failure must NEVER block delivery.
  await recordCostEvent({
    propertyId,
    stage: "assembly",
    provider: "bunny",
    unitsConsumed: 1,
    unitType: "renders",
    costCents,
    metadata: {
      aspect_ratio: aspectRatio,
      output_bytes: outputBytes,
      bitrate_kbps: bitrateKbps,
      bunny_hosted: true,
      source: "assembly_finalize",
    },
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[assembly-finalize] bunny cost_event insert failed (non-fatal)", {
      msg,
      propertyId,
      aspectRatio,
      output_bytes: outputBytes,
      cost_cents: costCents,
    });
  });
}
