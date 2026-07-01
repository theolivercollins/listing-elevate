/**
 * order-status.ts
 *
 * Canonical order-status map for Listing Elevate.
 *
 * Maps every internal pipeline state string → user-facing label + color token.
 * This is the ONE place where status vocabulary is defined. Components must
 * consume this map rather than maintaining their own STATUS_MAP objects.
 *
 * INVARIANT: Every status in PropertyStatus and SceneStatus unions (src/lib/types.ts)
 * MUST have an explicit entry in ORDER_STATUS_MAP. Tests enforce this at build time
 * via ALL_PROPERTY_STATUSES and ALL_SCENE_STATUSES const tuples.
 *
 * NOTE: This map also contains legacy/special statuses (ingesting, pending_payment)
 * that are not in the current union but may appear in legacy data. These have fallback
 * mappings but new code should not emit them.
 *
 * User-facing vocabulary (per the role-split UX spec):
 *   Received        ← queued, pending
 *   Crafting scenes ← ingesting, analyzing, scripting
 *   Rendering       ← generating, retry_1, retry_2
 *   In review       ← qc, assembling, qc_pass
 *   Delivered       ← complete, delivered
 *   Needs attention ← needs_review, failed, qc_hard_reject, qc_soft_reject
 *   Archived        ← archived
 */

export interface OrderStatusEntry {
  /** Short user-facing label shown in chips and tables */
  label: string;
  /** CSS color token (var(--…) or hex) for text / dot */
  color: string;
  /** CSS background token for the chip background */
  bg: string;
}

/**
 * The canonical map from internal status string → display entry.
 * Every PropertyStatus and SceneStatus must appear here.
 */
export const ORDER_STATUS_MAP: Record<string, OrderStatusEntry> = {
  // ── Terminal success ──────────────────────────────────────────────
  complete:  { label: "Delivered",       color: "var(--good)", bg: "rgba(47,138,85,0.10)" },
  delivered: { label: "Delivered",       color: "var(--good)", bg: "rgba(47,138,85,0.10)" },
  qc_pass:   { label: "Delivered",       color: "var(--good)", bg: "rgba(47,138,85,0.10)" },

  // ── Awaiting payment (Stripe checkout started but not completed) ─
  pending_payment: { label: "Awaiting payment", color: "var(--warn)", bg: "rgba(182,128,44,0.10)" },

  // ── Waiting to start ─────────────────────────────────────────────
  queued:    { label: "Received",        color: "var(--muted)", bg: "rgba(11,11,16,0.05)" },
  pending:   { label: "Received",        color: "var(--muted)", bg: "rgba(11,11,16,0.05)" },

  // ── Crafting scenes (analysis pipeline) ──────────────────────────
  ingesting: { label: "Crafting scenes", color: "var(--accent)", bg: "var(--accent-soft)" },
  analyzing: { label: "Crafting scenes", color: "var(--accent)", bg: "var(--accent-soft)" },
  scripting: { label: "Crafting scenes", color: "var(--accent)", bg: "var(--accent-soft)" },

  // ── Rendering (video generation) ─────────────────────────────────
  generating: { label: "Rendering",      color: "var(--accent)", bg: "var(--accent-soft)" },
  retry_1:    { label: "Rendering",      color: "var(--accent)", bg: "var(--accent-soft)" },
  retry_2:    { label: "Rendering",      color: "var(--accent)", bg: "var(--accent-soft)" },

  // ── In review (QC + assembly) ─────────────────────────────────────
  qc:         { label: "In review",      color: "var(--accent)", bg: "var(--accent-soft)" },
  assembling: { label: "In review",      color: "var(--accent)", bg: "var(--accent-soft)" },

  // ── Needs attention (failures + soft reject + hard reject) ───────
  needs_review:   { label: "Needs attention", color: "var(--warn)", bg: "rgba(182,128,44,0.10)" },
  qc_soft_reject: { label: "Needs attention", color: "var(--warn)", bg: "rgba(182,128,44,0.10)" },
  qc_hard_reject: { label: "Needs attention", color: "var(--bad)",  bg: "rgba(196,74,74,0.10)" },
  failed:         { label: "Needs attention", color: "var(--bad)",  bg: "rgba(196,74,74,0.10)" },

  // ── Archived ─────────────────────────────────────────────────────
  archived: { label: "Archived",         color: "var(--muted-2)", bg: "rgba(11,11,16,0.04)" },
};

/**
 * Complete list of every status string this map covers.
 * Tests iterate this to assert no fallthrough to undefined.
 */
export const ALL_KNOWN_STATUSES: string[] = Object.keys(ORDER_STATUS_MAP);

/**
 * Safe accessor — always returns an entry, never undefined.
 * Unknown strings get the muted/neutral fallback so the UI never crashes.
 */
export function orderStatusEntry(status: string): OrderStatusEntry {
  return (
    ORDER_STATUS_MAP[status] ?? {
      label: status,
      color: "var(--muted)",
      bg: "rgba(11,11,16,0.05)",
    }
  );
}
