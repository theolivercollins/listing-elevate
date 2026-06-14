/**
 * Stuck-state reaper for the Listing Elevate video pipeline.
 *
 * Zero-human-in-the-loop is a hard product requirement: any row that can sit
 * in a transient status forever is a defect. These reapers are called at the
 * top of each polling cron so stuck rows self-heal before the cron's main work
 * runs.
 *
 * Pattern mirrors lib/blog-engine/market-update/run.ts's pattern of
 * table-scoped helpers that return counts + ids, catch internally, and never
 * throw into the caller.
 *
 * Schema facts (verified against supabase/migrations/):
 *   - prompt_lab_listing_scene_iterations:
 *       status CHECK IN ('queued','submitting','rendering','rendered','rated','failed')
 *       render_error TEXT (nullable)
 *       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *       (no render_submitted_at column — only prompt_lab_iterations (old lab) has that)
 *   - scenes (CREATE TABLE predates supabase/migrations/; columns verified
 *     against the LIVE schema 2026-06-14):
 *       status: 'pending'|'generating'|'qc_pass'|'qc_soft_reject'|'qc_hard_reject'
 *              |'retry_1'|'retry_2'|'failed'|'needs_review' (from lib/types.ts SceneStatus)
 *       submitted_at TIMESTAMPTZ — the ONLY ageable timestamp on this table
 *       (there is NO created_at / updated_at column). Therefore never-submitted
 *       'pending' scenes (provider_task_id AND submitted_at both NULL) cannot be
 *       aged at the scene level; that stall surfaces as a property stuck in
 *       'generating' and is the job of a property-level reaper (follow-up). Here
 *       we reap only submitted-but-stuck 'generating' scenes.
 *   - prompt_lab_listings:
 *       status CHECK IN ('draft','analyzing','directing','ready_to_render','rendering','complete','failed')
 *       notes TEXT (nullable — used for error annotation)
 *       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *       (no updated_at column)
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ── Threshold constants (exported so callers can document and tests can use) ──

/** Minutes a scene iteration may stay in 'rendering' before being reaped. */
export const RENDER_STUCK_MINUTES = 30;

/** Minutes a scene may stay in 'generating' (submitted, no clip) before being reaped. */
export const GENERATE_STUCK_MINUTES = 30;

/**
 * Minutes a scene may stay in 'pending' with no provider_task_id before being
 * reaped. RESERVED for the property-level reaper follow-up — `scenes` has no
 * timestamp that is non-NULL for never-submitted rows, so the pending stall is
 * caught at the property level, not here. Kept exported for that follow-up.
 */
export const SUBMIT_STUCK_MINUTES = 20;

/** Minutes a listing may stay in 'analyzing' or 'directing' before being reaped. */
export const ANALYZE_STUCK_MINUTES = 15;

// ── Return type ──

export interface ReapResult {
  reaped: number;
  ids: string[];
}

// ── Internal helper ──

function cutoffIso(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * 60 * 1000).toISOString();
}

/**
 * Reap prompt_lab_listing_scene_iterations rows stuck in 'rendering'.
 *
 * A row stuck here means the provider task was submitted but the poll cron
 * never collected the result — the real-world example is bc699120-…, stuck
 * since 2026-04-21, which caused per-minute error-spam in poll-listing-iterations.
 *
 * Uses created_at as the age proxy (the table has no render_submitted_at;
 * in practice a row enters 'rendering' within milliseconds of creation so
 * created_at is a safe — if slightly conservative — lower bound).
 *
 * @param db   Supabase client (service-role).
 * @param now  Reference timestamp; pass explicitly so tests are deterministic.
 */
export async function reapStuckLabIterations(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<ReapResult> {
  try {
    const cutoff = cutoffIso(now, RENDER_STUCK_MINUTES);

    // Select candidates: 'rendering', no clip yet, old enough.
    const { data: candidates, error: selErr } = await db
      .from("prompt_lab_listing_scene_iterations")
      .select("id")
      .eq("status", "rendering")
      .is("clip_url", null)
      .lt("created_at", cutoff);

    if (selErr) {
      console.error("[stuck-reaper] reapStuckLabIterations select failed:", selErr.message);
      return { reaped: 0, ids: [] };
    }

    const rows = candidates ?? [];
    if (rows.length === 0) return { reaped: 0, ids: [] };

    const ids = rows.map((r: { id: string }) => r.id);

    const { error: updErr } = await db
      .from("prompt_lab_listing_scene_iterations")
      .update({
        status: "failed",
        render_error: "timed out — render never completed (reaped)",
      })
      .in("id", ids);

    if (updErr) {
      console.error("[stuck-reaper] reapStuckLabIterations update failed:", updErr.message);
      return { reaped: 0, ids: [] };
    }

    console.warn(
      `[stuck-reaper] reaped ${ids.length} prompt_lab_listing_scene_iterations rows: ${ids.join(", ")}`,
    );
    return { reaped: ids.length, ids };
  } catch (err) {
    console.error("[stuck-reaper] reapStuckLabIterations unexpected error:", err);
    return { reaped: 0, ids: [] };
  }
}

/**
 * Reap scenes stuck in 'generating' — the provider task was submitted
 * (submitted_at set) but the completed clip was never collected. Age is
 * measured from submitted_at (the only ageable column on `scenes`); threshold
 * GENERATE_STUCK_MINUTES (30). Recovers to 'needs_review' — a status the
 * operator/studio can act on without code intervention.
 *
 * NOT handled here: never-submitted 'pending' scenes (provider_task_id +
 * submitted_at both NULL) have no ageable timestamp on `scenes`, so that stall
 * is caught at the property level (property stuck 'generating') by a
 * property-level reaper (follow-up) — never at the scene level.
 *
 * @param db   Supabase client (service-role).
 * @param now  Reference timestamp; pass explicitly so tests are deterministic.
 */
export async function reapStuckScenes(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<ReapResult> {
  try {
    const generateCutoff = cutoffIso(now, GENERATE_STUCK_MINUTES);

    const { data: candidates, error: selErr } = await db
      .from("scenes")
      .select("id")
      .eq("status", "generating")
      .is("clip_url", null)
      .not("provider_task_id", "is", null)
      .lt("submitted_at", generateCutoff);

    if (selErr) {
      console.error("[stuck-reaper] reapStuckScenes select failed:", selErr.message);
      return { reaped: 0, ids: [] };
    }

    const rows = candidates ?? [];
    if (rows.length === 0) return { reaped: 0, ids: [] };

    const ids = rows.map((r: { id: string }) => r.id);

    const { error: updErr } = await db
      .from("scenes")
      .update({ status: "needs_review" })
      .in("id", ids);

    if (updErr) {
      console.error("[stuck-reaper] reapStuckScenes update failed:", updErr.message);
      return { reaped: 0, ids: [] };
    }

    console.warn(
      `[stuck-reaper] reaped ${ids.length} scenes rows (generating→needs_review): ${ids.join(", ")}`,
    );
    return { reaped: ids.length, ids };
  } catch (err) {
    console.error("[stuck-reaper] reapStuckScenes unexpected error:", err);
    return { reaped: 0, ids: [] };
  }
}

/**
 * Reap prompt_lab_listings rows stuck in 'analyzing' or 'directing'.
 *
 * The lifecycle cron (poll-listing-lifecycle) picks these up and runs the
 * Claude vision + director calls. If the function timed out or crashed the
 * row sits in a transient status forever. Reaped rows flip to 'failed' with
 * an explanatory note so the operator can re-trigger.
 *
 * Age measured from created_at (the table has no updated_at column).
 *
 * @param db   Supabase client (service-role).
 * @param now  Reference timestamp; pass explicitly so tests are deterministic.
 */
export async function reapStuckLabListings(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<ReapResult> {
  try {
    const cutoff = cutoffIso(now, ANALYZE_STUCK_MINUTES);

    const { data: candidates, error: selErr } = await db
      .from("prompt_lab_listings")
      .select("id")
      .in("status", ["analyzing", "directing"])
      .eq("archived", false)
      .lt("created_at", cutoff);

    if (selErr) {
      console.error("[stuck-reaper] reapStuckLabListings select failed:", selErr.message);
      return { reaped: 0, ids: [] };
    }

    const rows = candidates ?? [];
    if (rows.length === 0) return { reaped: 0, ids: [] };

    const ids = rows.map((r: { id: string }) => r.id);

    const { error: updErr } = await db
      .from("prompt_lab_listings")
      .update({
        status: "failed",
        notes: "timed out — analysis or direction never completed (reaped)",
      })
      .in("id", ids);

    if (updErr) {
      console.error("[stuck-reaper] reapStuckLabListings update failed:", updErr.message);
      return { reaped: 0, ids: [] };
    }

    console.warn(
      `[stuck-reaper] reaped ${ids.length} prompt_lab_listings rows: ${ids.join(", ")}`,
    );
    return { reaped: ids.length, ids };
  } catch (err) {
    console.error("[stuck-reaper] reapStuckLabListings unexpected error:", err);
    return { reaped: 0, ids: [] };
  }
}
