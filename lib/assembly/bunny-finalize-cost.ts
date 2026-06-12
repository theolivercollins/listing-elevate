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
 *   - Emits ONE cost_events row with provider:'bunny' when the finalize step
 *     hosted the video on Bunny (finalizeUrl !== providerUrl AND outputBytes
 *     is not null).
 *   - Emits nothing (no row) when finalize fell back to the provider URL
 *     (kill switch, env guard, Bunny error) — those cases are no-ops here.
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
  /** The original URL returned by the render provider (Creatomate / Shotstack). */
  providerUrl: string;
  /** The URL returned by finalizeAssemblyRender (Bunny MP4 URL or fallback). */
  finalizeUrl: string;
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
  const { propertyId, aspectRatio, providerUrl, finalizeUrl, outputBytes, bitrateKbps } = params;

  // Bunny was NOT used — kill-switch, env guard, or any failure all return
  // providerUrl unchanged. Nothing to record.
  if (finalizeUrl === providerUrl || outputBytes === null) {
    return;
  }

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
