// Single source of truth for how a Rating Ledger row's SKU is derived from
// (model_used, provider). Every ledger-shaped API + UI MUST go through this
// helper so the "provider aggregator name leaks as SKU" bug (Apr 2026:
// legacy_lab rows surfaced "atlas" instead of the captured Kling SKU) stays
// fixed for every new surface.
//
// Contract:
//   - If the row has model_used (P1+ writes, sku_source='captured_at_render'
//     or 'recovered'), return it verbatim. has_model_used=true.
//   - If model_used is missing, fall back to a KNOWN-native SKU per provider.
//     Atlas is an aggregator, not a model — there is no native Atlas SKU, so
//     atlas + null returns null rather than leaking "atlas" as a SKU string.
//   - If we cannot derive a SKU, return null. The UI decides how to render it.

export interface LedgerSkuInput {
  modelUsed: string | null | undefined;
  provider: string | null | undefined;
}

export interface LedgerSkuResult {
  sku: string | null;
  has_model_used: boolean;
}

const PROVIDER_NATIVE_SKU: Record<string, string> = {
  kling: "kling-v2-native",
  runway: "runway-gen-4-turbo",
};

export function formatRowSku(input: LedgerSkuInput): LedgerSkuResult {
  const modelUsed = typeof input.modelUsed === "string" && input.modelUsed.length > 0 ? input.modelUsed : null;
  if (modelUsed) return { sku: modelUsed, has_model_used: true };
  const provider = input.provider ?? null;
  if (provider && PROVIDER_NATIVE_SKU[provider]) {
    return { sku: PROVIDER_NATIVE_SKU[provider], has_model_used: false };
  }
  return { sku: null, has_model_used: false };
}
