const SKU_KLING = "kling-v2-6-pro" as const;
const SKU_SEEDANCE = "seedance-pro-pushin" as const;

export type V1AbMode = typeof SKU_KLING | typeof SKU_SEEDANCE | "auto";

export function pickV1SKU(opts: { abMode?: V1AbMode } = {}): string {
  const mode = opts.abMode ?? "auto";
  if (mode === "auto" || mode === SKU_KLING) return SKU_KLING;
  if (mode === SKU_SEEDANCE) return SKU_SEEDANCE;
  // Exhaustive fallback — should never reach here with valid inputs
  return SKU_KLING;
}
