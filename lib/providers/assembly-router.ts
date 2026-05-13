/**
 * Assembly Provider Router
 *
 * Selects the video assembly provider for a property render. Priority:
 *   1. Creatomate (if CREATOMATE_API_KEY is set)
 *   2. Shotstack (if SHOTSTACK_API_KEY / SHOTSTACK_API_KEY_STAGE is set)
 *
 * Exports a shared poll helper so callers don't need to know which
 * provider was used.
 */

import {
  ShotstackProvider,
  shotstackCostCents,
  type IVideoAssemblyProvider,
  type AssemblyJob,
  type AssemblyResult,
} from "./shotstack.js";
import { CreatomateProvider, creatomateCostCents } from "./creatomate.js";

// Re-export for convenience
export type { IVideoAssemblyProvider, AssemblyJob, AssemblyResult };

export type AssemblyProviderName = "creatomate" | "shotstack";

/**
 * Construct the preferred assembly provider. Tries Creatomate first,
 * falls back to Shotstack, throws if neither is configured.
 */
export function selectAssemblyProvider(): IVideoAssemblyProvider {
  if (process.env.CREATOMATE_API_KEY) {
    return new CreatomateProvider();
  }

  const hasShotstack = Boolean(
    process.env.SHOTSTACK_API_KEY || process.env.SHOTSTACK_API_KEY_STAGE,
  );
  if (hasShotstack) {
    return new ShotstackProvider();
  }

  throw new Error(
    "No assembly provider configured. Set CREATOMATE_API_KEY (preferred) or SHOTSTACK_API_KEY.",
  );
}

/**
 * Compute the cost in cents for a render of the given duration on the
 * specified provider.
 */
export function assemblyProviderCostCents(
  providerName: AssemblyProviderName,
  outputDurationSeconds: number,
): number {
  if (providerName === "creatomate") {
    return creatomateCostCents(outputDurationSeconds);
  }
  return shotstackCostCents(outputDurationSeconds);
}

/**
 * Poll an assembly job until it completes or times out. Provider-agnostic.
 */
export async function pollAssemblyJob(
  provider: IVideoAssemblyProvider,
  job: AssemblyJob,
  timeoutMs = 240_000,
  intervalMs = 5_000,
): Promise<AssemblyResult> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await provider.checkStatus(job);
    if (result.status === "complete" || result.status === "failed") return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { status: "failed", error: "Assembly render timed out" };
}
