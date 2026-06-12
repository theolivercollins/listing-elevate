// Stuck-run reaper for the Market Update workflow.
//
// Background: analyzeRun() inserts a market_update_runs row at status
// "extracting" BEFORE invoking Claude.  If the Vercel function times out or
// crashes mid-extraction the row is stranded at "extracting" with no chance of
// self-recovery.  This happened in production (run bd011913, 2026-06-12) and
// had to be manually deleted.
//
// Strategy: LAZY reaping.  When the runs-list GET fires, call reapStuckRuns()
// before returning data.  Any run in a TRANSIENT_STATUS older than its
// threshold is atomically flipped to "failed" with a descriptive failure_note.
// No cron needed; the fix is pure app logic.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Transient statuses → maximum permitted age in minutes before reaping. */
export const TRANSIENT_THRESHOLDS: Record<string, number> = {
  extracting: 15, // Claude extraction should finish in ≪ 2 min on a healthy run
} as const;

const TRANSIENT_STATUSES = Object.keys(TRANSIENT_THRESHOLDS);

/**
 * Reap any stuck runs in TRANSIENT_STATUSES older than their threshold.
 *
 * The function is idempotent: once a row is flipped to "failed" (a terminal
 * status), subsequent calls skip it via the `.in("status", TRANSIENT_STATUSES)`
 * filter.
 *
 * @returns the number of runs that were reaped.
 */
export async function reapStuckRuns(
  supabase: SupabaseClient,
  siteId: string,
): Promise<number> {
  // Build the earliest updated_at timestamp for each threshold.
  // Because thresholds differ per status we do one SELECT per status (small —
  // there is currently only one transient status; the loop is future-proof).
  let totalReaped = 0;

  for (const status of TRANSIENT_STATUSES) {
    const thresholdMinutes = TRANSIENT_THRESHOLDS[status];
    const cutoff = new Date(
      Date.now() - thresholdMinutes * 60 * 1000,
    ).toISOString();

    // SELECT rows that are: correct site, this transient status, updated before cutoff.
    const { data: stale, error: selErr } = await supabase
      .from("market_update_runs")
      .select("id")
      .eq("site_id", siteId)
      .eq("status", status)
      .lte("updated_at", cutoff);

    if (selErr || !stale || stale.length === 0) continue;

    const ids = (stale as Array<{ id: string }>).map((r) => r.id);

    const errorNote =
      `timed out — ${status} phase never completed (threshold: ${thresholdMinutes} min). ` +
      `Re-upload the PDFs to create a fresh run.`;

    await supabase
      .from("market_update_runs")
      .update({
        status: "failed",
        error: errorNote,
        updated_at: new Date().toISOString(),
      })
      .in("id", ids);

    totalReaped += ids.length;
  }

  return totalReaped;
}
