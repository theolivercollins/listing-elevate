/**
 * lib/billing/pricing.ts — Single source of truth for Listing Elevate pricing.
 *
 * These values mirror src/pages/Upload.tsx lines 142-166. Any price change
 * must be made here first; the Upload.tsx display prices are derived from
 * this module (or kept in sync manually with a comment pointing here).
 *
 * All values are in US dollars unless the name ends in _CENTS.
 */

// ── Package base prices ────────────────────────────────────────────────────

/**
 * Duration options and their prices for standard (non-life_cycle) packages.
 * Key is the duration string from the form (e.g. "15s").
 */
export const DURATION_PRICES: Record<string, { standard: number; life_cycle: number }> = {
  "15s": { standard: 75, life_cycle: 90 },
  "30s": { standard: 125, life_cycle: 140 },
  "60s": { standard: 175, life_cycle: 190 },
};

// ── Orientation add-on ─────────────────────────────────────────────────────

/**
 * Extra charge for the 'both' orientation (9:16 + 16:9).
 * 'vertical' and 'horizontal' are $0 extra.
 * Life cycle package never charges an orientation extra.
 */
export const ORIENTATION_BOTH_EXTRA = 10;

// ── Add-on prices ──────────────────────────────────────────────────────────

/** Per-video voiceover add-on (standard TTS or cloned voice synthesis). */
export const VOICEOVER_PER_VIDEO = 10;

/** Custom request add-on (bespoke branding / special instruction). */
export const CUSTOM_REQUEST_PRICE = 15;

// ── Voice clone ─────────────────────────────────────────────────────────────

/**
 * One-time voice clone setup fee. This is charged SEPARATELY by the admin
 * team after recording the customer's sample — it is NOT included in the
 * per-order Checkout session. It is listed here so any future automated
 * billing of this fee uses the same constant.
 */
export const VOICE_CLONE_SETUP = 125;

/**
 * Per-video voiceover charge when using a cloned voice.
 * The cloned voice still requires ElevenLabs TTS synthesis on every render,
 * so the per-video rate is the same as the standard voiceover.
 */
export const VOICE_CLONE_PER_VIDEO = VOICEOVER_PER_VIDEO;

// ── Derived helpers ─────────────────────────────────────────────────────────

/**
 * Compute the base price (in dollars) for a given duration + package.
 * Returns 0 if either value is null/unknown.
 */
export function getBasePrice(
  selectedDuration: string | null,
  selectedPackage: string | null,
): number {
  if (!selectedDuration) return 0;
  const row = DURATION_PRICES[selectedDuration];
  if (!row) return 0;
  return selectedPackage === "life_cycle" ? row.life_cycle : row.standard;
}

/**
 * Compute the orientation extra in dollars.
 * Life cycle package never charges this extra.
 */
export function getOrientationExtra(
  selectedOrientation: string | null,
  selectedPackage: string | null,
): number {
  if (selectedPackage === "life_cycle") return 0;
  if (selectedOrientation === "both") return ORIENTATION_BOTH_EXTRA;
  return 0;
}
