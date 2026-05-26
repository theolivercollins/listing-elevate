// Kept in sync with lib/providers/atlas.ts::ATLAS_MODELS. Source of
// truth for the UI — model labels, per-clip cost, end-frame support.
// If a new model is registered server-side, add it here too.
//
// Pricing convention: priceCents / priceLabel represent the cost of
// one STANDARD 5-second clip. Atlas's public rates are per-second, so
// these values = perSecond × 5. If a 10-second clip is rendered, real
// cost is 2x the label.

export interface LabModelInfo {
  key: string;
  slug: string;
  label: string;
  shortLabel: string;
  priceCents: number;
  priceLabel: string;
  supportsEndFrame: boolean;
  note?: string;
  hidden?: boolean;
}

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
    key: "seedance-pro-pushin",
    slug: "bytedance/seedance-2.0/image-to-video",
    label: "Seedance 2.0 (push-in)",
    shortLabel: "Seedance 2.0",
    priceCents: 70,          // 14 ¢/s × 5s — matches atlas.ts placeholder
    priceLabel: "$0.70",
    supportsEndFrame: false,
    note: "Bytedance Seedance 2.0 via Atlas. Push-in only. FFmpeg speed-ramp polish applied on download.",
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
