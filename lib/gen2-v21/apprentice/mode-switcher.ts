/**
 * Mode Switcher — recommends Director's Cut / Apprentice Review / Autopilot
 * based on label count and rolling agreement rate.
 *
 * This is a recommendation only — operator can always override via the UI.
 */

import type { LabMode } from "../types.js";

interface ModeSwitchInput {
  totalLabels: number;
  agreementRate20: number | null;
}

/**
 * Recommend the appropriate lab mode given current state.
 *
 * Rules (from spec):
 *   - totalLabels < 10                                      → directors_cut
 *   - 10 ≤ totalLabels < 50 OR agreementRate20 < 0.7       → directors_cut
 *   - agreementRate20 >= 0.7 AND agreementRate20 < 0.9     → apprentice_review
 *   - agreementRate20 >= 0.9                               → autopilot
 *
 * @param state  Current label count and rolling-20 agreement rate
 * @returns      Recommended LabMode
 */
export function recommendMode(state: ModeSwitchInput): LabMode {
  const { totalLabels, agreementRate20 } = state;

  // Phase 1: not enough labels to train apprentice
  if (totalLabels < 10) {
    return "directors_cut";
  }

  // Phase 2: building towards confidence threshold
  if (totalLabels < 50) {
    // In the 10-49 range, we need agreement rate to at least reach 0.7
    if (agreementRate20 === null || agreementRate20 < 0.7) {
      return "directors_cut";
    }
    if (agreementRate20 >= 0.9) {
      return "autopilot";
    }
    return "apprentice_review";
  }

  // Phase 3: enough labels — use agreement rate to decide
  if (agreementRate20 === null || agreementRate20 < 0.7) {
    return "directors_cut";
  }

  if (agreementRate20 >= 0.9) {
    return "autopilot";
  }

  // 0.7 <= agreementRate20 < 0.9
  return "apprentice_review";
}
