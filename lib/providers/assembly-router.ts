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

import type {
  IVideoAssemblyProvider,
  AssemblyJob,
  AssemblyResult,
} from "./shotstack.js";

// Re-export for convenience
export type { IVideoAssemblyProvider, AssemblyJob, AssemblyResult };

export type AssemblyProviderName = "creatomate" | "shotstack";

/**
 * Construct the preferred assembly provider. Tries Creatomate first,
 * falls back to Shotstack, throws if neither is configured.
 */
export function selectAssemblyProvider(): IVideoAssemblyProvider {
  // Dynamic imports avoided — both modules tree-shake fine and are
  // only ~10KB each. Eager import keeps the call stack sync-friendly.
  if (process.env.CREATOMATE_API_KEY) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CreatomateProvider } = require("./creatomate.js") as typeof import("./creatomate.js");
    return new CreatomateProvider();
  }

  const hasShotstack = Boolean(
    process.env.SHOTSTACK_API_KEY || process.env.SHOTSTACK_API_KEY_STAGE,
  );
  if (hasShotstack) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ShotstackProvider } = require("./shotstack.js") as typeof import("./shotstack.js");
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { creatomateCostCents } = require("./creatomate.js") as typeof import("./creatomate.js");
    return creatomateCostCents(outputDurationSeconds);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { shotstackCostCents } = require("./shotstack.js") as typeof import("./shotstack.js");
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
