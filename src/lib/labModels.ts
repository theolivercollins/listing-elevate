// Kept in sync with lib/providers/atlas.ts::ATLAS_MODELS. Source of
// truth for the UI — model labels, per-clip cost, end-frame support.
// If a new model is registered server-side, add it here too.
//
// Pricing convention: priceCents / priceLabel represent the cost of
// one STANDARD 5-second clip. Atlas's public rates are per-second, so
// these values = perSecond × 5. If a 10-second clip is rendered, real
// cost is 2x the label.

// Resolution values across Lab SKUs. The `-SR` tiers are Seedance 2.0's
// super-resolution (FlashVSR) variants — they replaced the retired
// standalone "upscaled"/2K Atlas variant 2026-06. Mirrors
// lib/providers/atlas.ts::AtlasResolution.
export type LabResolution =
  | "480p"
  | "720p"
  | "720p-SR"
  | "1080p"
  | "1080p-SR"
  | "1440p-SR"
  | "4k";

export interface LabModelInfo {
  key: string;
  slug: string;
  label: string;
  shortLabel: string;
  priceCents: number;
  priceLabel: string;
  supportsEndFrame: boolean;
  /**
   * Ordered list of resolutions the model can produce. First entry is the
   * UI default. When absent or single-element, the resolution picker is
   * hidden — there's no meaningful choice to make.
   */
  supportedResolutions?: ReadonlyArray<LabResolution>;
  note?: string;
  hidden?: boolean;
}

// ─── v1 SKU catalog ──────────────────────────────────────────────────────────
//
// Client-safe mirror of lib/providers/atlas.ts::V1_ATLAS_SKUS. The server
// module reads process.env at import time and must never be bundled into the
// browser (it crashes vite dev with "process is not defined").
export const V1_ATLAS_SKUS = [
  "kling-v2-6-pro",
  "kling-v2-master",
] as const;
export type V1AtlasSku = (typeof V1_ATLAS_SKUS)[number];
export const V1_DEFAULT_SKU: V1AtlasSku = "kling-v2-6-pro";

// ─── v1.1 SKU catalog ────────────────────────────────────────────────────────
//
// SKUs valid for v1.1 Lab sessions (multi-model picker).
// Default is `seedance-pro-pushin`; the rest are modern Kling/Runway SKUs.
// Easy to extend — add a 1-line entry here and a matching LAB_MODELS row below.
export const V1_1_LAB_SKUS = [
  "seedance-pro-pushin",
  "kling-v3-pro",
  "kling-v2-6-pro",
  "kling-v2-master",
  "runway-gen4-native",
  // Lane B (2026-05-26): Veo 3.1 Preview — Premium 4K SKU via Gemini API.
  // Routes through VeoProvider (not Atlas). priceCents reflects 50¢/s × 5s
  // placeholder — verify against first invoice and update.
  "veo-3-1-preview",
  // Opt-in Seedance 2.0 pair mode (2026-06-10). Only meaningful on paired
  // scenes — never a default; paired scenes still default to kling-v3-pro.
  // Keep in sync with V1_1_LAB_SKUS in lib/providers/atlas.ts.
  "seedance-pair",
] as const;
export type V1_1LabSku = (typeof V1_1_LAB_SKUS)[number];
export const V1_1_DEFAULT_SKU: V1_1LabSku = "seedance-pro-pushin";

/** Returns true when `sku` is a valid v1.1 Lab SKU. */
export function isV1_1LabSku(sku: string): sku is V1_1LabSku {
  return (V1_1_LAB_SKUS as readonly string[]).includes(sku);
}

export const LAB_MODELS: LabModelInfo[] = [
  // ── v1.1-specific ────────────────────────────────────────────────────────
  {
    // Lane B (2026-05-26): Veo 3.1 Preview via Gemini API.
    // priceCents = 50¢/s × 5s = 250¢. PLACEHOLDER — verify against invoice.
    key: "veo-3-1-preview",
    slug: "veo-3.1-generate-preview",   // informational; VeoProvider doesn't use this
    label: "Veo 3.1 Preview (4K)",
    shortLabel: "Veo 3.1 4K",
    priceCents: 250,                     // ⚠️  placeholder: 50¢/s × 5s; update after invoice
    priceLabel: "$2.50",
    supportsEndFrame: false,             // Veo 3.1 supports last-frame but skip for MVP
    supportedResolutions: ["4k", "1080p", "720p"],  // Veo natively produces 4K
    note: "Google Veo 3.1 via Gemini API. Native 4K. ~5–10× more expensive than Kling — confirm pricing before high-volume use.",
  },
  {
    key: "seedance-pro-pushin",
    slug: "bytedance/seedance-2.0/image-to-video",
    label: "Seedance 2.0 (push-in, 1080p SR)",
    shortLabel: "Seedance 2.0",
    priceCents: 48,          // 9.6 ¢/s × 5s — matches atlas.ts (live Atlas catalog 2026-06-10)
    priceLabel: "$0.48",
    supportsEndFrame: false,
    supportedResolutions: ["1080p-SR", "1440p-SR", "1080p", "720p-SR", "720p", "480p"],  // -SR = FlashVSR super-res tiers (replaced retired 2K upscaled variant)
    note: "Bytedance Seedance 2.0 via Atlas, 1080p super-res default. Push-in only. FFmpeg speed-ramp polish applied on download.",
  },
  {
    // Opt-in pair mode (2026-06-10): Seedance 2.0 with `last_image`
    // start+end-frame interpolation. Uses the scene's own prompt (incl.
    // trajectory clause) — NO push-in preamble. Paired scenes still
    // DEFAULT to kling-v3-pro; this SKU is an explicit user choice only.
    key: "seedance-pair",
    slug: "bytedance/seedance-2.0/image-to-video",
    label: "Seedance 2.0 (start+end frame)",
    shortLabel: "Seedance Pair",
    priceCents: 48,          // 9.6 ¢/s × 5s — matches atlas.ts (live Atlas catalog 2026-06-10)
    priceLabel: "$0.48",
    supportsEndFrame: true,
    supportedResolutions: ["1080p-SR", "1440p-SR", "1080p", "720p-SR", "720p", "480p"],  // same enum as seedance-pro-pushin
    note: "Bytedance Seedance 2.0 pair mode via Atlas (last_image end frame). For paired scenes only — start+end-frame interpolation with the scene's own prompt.",
  },
  // ── v1 SKUs ──────────────────────────────────────────────────────────────
  {
    key: "kling-v2-native",
    slug: "kling-native-v2.0",  // informational; not used by Atlas
    label: "Kling 2.0 (native — pre-paid credits)",
    shortLabel: "v2 Native",
    priceCents: 0,
    priceLabel: "free (credits)",
    supportsEndFrame: false,  // native v2.0 image-to-video doesn't pair
    supportedResolutions: ["1080p"],  // fixed in-model
    note: "Uses your pre-paid Kling credits directly. Burn before Atlas bills. No end-frame support.",
  },
  {
    key: "kling-v3-pro",
    slug: "kwaivgi/kling-v3.0-pro/image-to-video",
    label: "Kling 3.0 Pro",
    shortLabel: "v3 Pro",
    priceCents: 48,
    priceLabel: "$0.48",
    supportsEndFrame: true,
    supportedResolutions: ["1080p"],  // Kling output res is fixed in-model
    note: "Newest. End-frame support. Known shake issue on single-image shots — stability prefix mitigation applied.",
  },
  {
    key: "kling-v3-std",
    slug: "kwaivgi/kling-v3.0-std/image-to-video",
    label: "Kling 3.0 Std",
    shortLabel: "v3 Std",
    priceCents: 36,
    priceLabel: "$0.36",
    supportsEndFrame: true,
    hidden: true,
    supportedResolutions: ["1080p"],  // Kling output res is fixed in-model
    note: "Like 3.0 Pro but lower quality. Hidden from picker — re-enable if ever needed.",
  },
  {
    key: "kling-v2-6-pro",
    slug: "kwaivgi/kling-v2.6-pro/image-to-video",
    label: "Kling 2.6 Pro",
    shortLabel: "v2.6 Pro",
    priceCents: 60,              // Corrected 2026-04-20: observed $0.60/clip, was $0.30
    priceLabel: "$0.60",
    supportsEndFrame: true,
    supportedResolutions: ["1080p"],  // Kling output res is fixed in-model
    note: "Smoothest motion for single-image shots. Current strong default for interiors.",
  },
  {
    key: "kling-v2-1-pair",
    slug: "kwaivgi/kling-v2.1-i2v-pro/start-end-frame",
    label: "Kling 2.1 Start-End-Frame",
    shortLabel: "v2.1 Pair",
    priceCents: 38,
    priceLabel: "$0.38",
    supportsEndFrame: true,
    supportedResolutions: ["1080p"],  // Kling output res is fixed in-model
    note: "Purpose-built for paired scenes (start + end photo). Can use long, detailed prompts effectively.",
  },
  {
    key: "kling-v2-master",
    slug: "kwaivgi/kling-v2.0-i2v-master",
    label: "Kling 2.0 Master",
    shortLabel: "v2 Master",
    priceCents: 111,
    priceLabel: "$1.11",
    supportsEndFrame: false,
    supportedResolutions: ["1080p"],  // Kling output res is fixed in-model
    note: "Premium quality; single-frame only (no end-frame support). Expensive — use for hero shots.",
  },
  {
    key: "kling-o3-pro",
    slug: "kwaivgi/kling-video-o3-pro/image-to-video",
    label: "Kling O3 Pro",
    shortLabel: "O3 Pro",
    priceCents: 48,
    priceLabel: "$0.48",
    supportsEndFrame: true,
    supportedResolutions: ["1080p"],  // Kling output res is fixed in-model
    note: "Minimal movement — tends to look static. Good for feature closeups, weak for dynamic shots.",
  },
];

export function getLabModel(key: string): LabModelInfo | undefined {
  return LAB_MODELS.find((m) => m.key === key);
}

/**
 * Returns the ordered list of `LabModelInfo` entries for the v1.1 multi-model
 * picker.  Order matches `V1_1_LAB_SKUS`.  Hidden models are intentionally
 * included (none of the v1.1 SKUs are hidden, but guard for future entries).
 */
export function getV1_1LabModels(): LabModelInfo[] {
  return V1_1_LAB_SKUS.map((sku) => getLabModel(sku)).filter(
    (m): m is LabModelInfo => m !== undefined,
  );
}

/**
 * Returns the ordered list of resolutions the given SKU supports. First entry
 * is the default for the UI picker. When the SKU is unknown or has no
 * `supportedResolutions` declared, falls back to `['1080p']` (safe default:
 * all Kling SKUs produce 1080p from the model side).
 *
 * The UI should hide the resolution picker when the returned array has length ≤ 1.
 */
export function getSupportedResolutions(sku: string): ReadonlyArray<LabResolution> {
  const model = getLabModel(sku);
  if (model?.supportedResolutions && model.supportedResolutions.length > 0) {
    return model.supportedResolutions;
  }
  return ["1080p"];
}
