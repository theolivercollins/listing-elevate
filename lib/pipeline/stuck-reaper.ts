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
 *   - delivery_runs:
 *       stage TEXT (intake→scraping→generating→judging→checkpoint_a→details→
 *                   voiceover→music→assembling→checkpoint_b→delivered)
 *       error TEXT (nullable)
 *       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   - properties:
 *       status TEXT
 *       updated_at TIMESTAMPTZ NOT NULL — used as age proxy for the 'generating'
 *       property reaper (lib/db.ts updatePropertyStatus always bumps it).
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

/**
 * Minutes a delivery_run may sit in 'intake' or 'scraping' with no updated_at
 * progress before being eligible for a re-fire. Re-firing updates updated_at,
 * so the same run will not be eligible again for another DELIVERY_STUCK_MINUTES.
 * This is the rate-limit — each re-fire costs nothing (it's a scrape call) but
 * repeated hammering is still undesirable.
 */
export const DELIVERY_STUCK_MINUTES = 15;

/**
 * Age ceiling for delivery_run auto-recovery. Runs older than this (measured
 * from created_at) are presumed permanently stuck and are annotated with an
 * exhausted error message instead of being re-fired.
 */
export const DELIVERY_MAX_AGE_MINUTES = 60;

/**
 * Minutes a property may sit in 'generating' with ≥1 never-submitted scene
 * (provider_task_id IS NULL) before being eligible for scene re-submission.
 * Re-submission updates the property's updated_at (via updatePropertyStatus),
 * so the same property will not be eligible again for another
 * GENERATING_STUCK_MINUTES — this is the rate-limit.
 */
export const GENERATING_STUCK_MINUTES = 20;

/**
 * Age ceiling for generating-property auto-recovery. Properties older than
 * this with still-unsubmitted scenes are surfaced to the operator as
 * 'needs_review' instead of being re-submitted.
 */
export const GENERATING_MAX_AGE_MINUTES = 60;

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

/**
 * Reap delivery_runs stuck in 'intake' or 'scraping'.
 *
 * A run lands in 'intake' the moment StudioNew creates it. It should advance
 * to 'scraping' → 'generating' within seconds via runScrapeStage. If the
 * fetch crashed or timed out the row sits in 'intake'/'scraping' indefinitely
 * until an operator manually clicks Rerun.
 *
 * Recovery strategy:
 *   - run.updated_at < now - DELIVERY_STUCK_MINUTES AND
 *     run.created_at >= now - DELIVERY_MAX_AGE_MINUTES → re-fire runScrapeStage.
 *     Re-firing updates updated_at, preventing another re-fire for another
 *     DELIVERY_STUCK_MINUTES (this is the rate-limit — no provider call is made
 *     by scraping itself, but repeated Redfin scrapes are undesirable).
 *   - run.created_at < now - DELIVERY_MAX_AGE_MINUTES → EXHAUSTED: set an
 *     explanatory error message; do NOT change stage so operator Rerun/Back
 *     controls continue to work. Do NOT re-fire.
 *
 * runScrapeStage is safe to call on both 'intake' and 'scraping' runs:
 *   - If stage == 'intake', it advances to 'scraping' first.
 *   - If stage == 'scraping', it skips the advance and runs the scrape.
 *   - It ALWAYS tries to advance to 'generating' after the scrape, so calling
 *     it on a stuck run is idempotent and recovers both stages in one shot.
 *
 * The existing reapers (reapStuckLabIterations, reapStuckScenes,
 * reapStuckLabListings) do NOT use a non-prod write guard — they reap in every
 * environment. This reaper matches that pattern. If re-firing is ever
 * undesirable in non-prod, add a VERCEL_ENV guard here.
 *
 * @param db   Supabase client (service-role).
 * @param now  Reference timestamp; pass explicitly so tests are deterministic.
 */
export async function reapStuckDeliveryRuns(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<ReapResult> {
  try {
    const stuckCutoff = cutoffIso(now, DELIVERY_STUCK_MINUTES);
    const exhaustedCutoff = cutoffIso(now, DELIVERY_MAX_AGE_MINUTES);

    // Find runs stuck in 'intake' or 'scraping' for at least DELIVERY_STUCK_MINUTES.
    const { data: candidates, error: selErr } = await db
      .from("delivery_runs")
      .select("id, stage, created_at")
      .in("stage", ["intake", "scraping"])
      .lt("updated_at", stuckCutoff);

    if (selErr) {
      console.error("[stuck-reaper] reapStuckDeliveryRuns select failed:", selErr.message);
      return { reaped: 0, ids: [] };
    }

    const rows = (candidates ?? []) as Array<{ id: string; stage: string; created_at: string }>;
    if (rows.length === 0) return { reaped: 0, ids: [] };

    // Dynamic import so tests can mock resubmit/runScrapeStage independently.
    // runScrapeStage uses the global getSupabase() singleton internally; the `db`
    // param here is only for the select and exhausted-error writes.
    const { runScrapeStage } = await import("../delivery/scrape.js");

    let reaped = 0;
    const ids: string[] = [];

    for (const row of rows) {
      try {
        const isExhausted = row.created_at < exhaustedCutoff;

        if (isExhausted) {
          // Mark exhausted — update error without changing stage so UI controls work.
          const { error: updErr } = await db
            .from("delivery_runs")
            .update({
              error: `stuck in ${row.stage} >60m — auto-recovery exhausted (reaped); use Rerun`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);

          if (updErr) {
            console.error(
              `[stuck-reaper] reapStuckDeliveryRuns exhausted-update failed for ${row.id}:`,
              updErr.message,
            );
            continue;
          }
          console.warn(
            `[stuck-reaper] delivery_run ${row.id} exhausted in '${row.stage}' >60m — annotated; use Rerun`,
          );
        } else {
          // Re-fire the scrape stage. runScrapeStage updates updated_at via
          // advanceRun/setRunError, so this run won't be eligible again for
          // DELIVERY_STUCK_MINUTES — that is the re-fire rate-limit.
          await runScrapeStage(row.id);
          console.warn(
            `[stuck-reaper] re-fired runScrapeStage for delivery_run ${row.id} (was stuck in '${row.stage}')`,
          );
        }

        reaped++;
        ids.push(row.id);
      } catch (rowErr) {
        console.warn(
          `[stuck-reaper] reapStuckDeliveryRuns failed for run ${row.id}:`,
          rowErr instanceof Error ? rowErr.message : String(rowErr),
        );
      }
    }

    return { reaped, ids };
  } catch (err) {
    console.error("[stuck-reaper] reapStuckDeliveryRuns unexpected error:", err);
    return { reaped: 0, ids: [] };
  }
}

/**
 * Reap properties stuck in 'generating' that have ≥1 never-submitted scene.
 *
 * A "never-submitted" scene has provider_task_id IS NULL AND clip_url IS NULL
 * AND status = 'pending' AND replaced_at IS NULL. These arise when
 * runGenerationSubmit fails to dispatch a scene (provider error, timeout, etc.).
 * poll-scenes correctly refuses to finalize until all pending scenes settle, so
 * the property stalls with no autonomous recovery.
 *
 * The `scenes` table has NO created_at / updated_at column (only submitted_at,
 * which is NULL for never-submitted scenes). Age is therefore measured on the
 * property's updated_at (lib/db.ts updatePropertyStatus always bumps it).
 *
 * Recovery strategy:
 *   - property.updated_at < now - GENERATING_STUCK_MINUTES AND
 *     property.updated_at >= now - GENERATING_MAX_AGE_MINUTES → re-submit each
 *     never-submitted scene via resubmitScene (lib/pipeline.ts). resubmitScene
 *     stamps submitted_at + provider_task_id and returns {ok, error} — it never
 *     throws. On success, the property is touched via updatePropertyStatus to
 *     bump updated_at so this run won't re-fire for another GENERATING_STUCK_MINUTES.
 *     If resubmitScene fails (provider exhausted), the scene is left at
 *     needs_review by resubmitScene itself; we still bump the timestamp to avoid
 *     a tight retry loop.
 *   - property.updated_at < now - GENERATING_MAX_AGE_MINUTES → GIVE-UP: set
 *     property status to 'needs_review' with a note so the operator can act.
 *     Do NOT re-submit.
 *
 * Design note: resubmitScene uses the global getSupabase() singleton, not the
 * injected `db` param. The `db` param here is only for the property/scene
 * selects and the give-up status write. Tests mock resubmitScene via the
 * module mock system.
 *
 * @param db   Supabase client (service-role).
 * @param now  Reference timestamp; pass explicitly so tests are deterministic.
 */
export async function reapStuckGeneratingProperties(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<ReapResult> {
  try {
    const stuckCutoff = cutoffIso(now, GENERATING_STUCK_MINUTES);
    const exhaustedCutoff = cutoffIso(now, GENERATING_MAX_AGE_MINUTES);

    // Find properties stuck in 'generating' for at least GENERATING_STUCK_MINUTES.
    const { data: candidates, error: propSelErr } = await db
      .from("properties")
      .select("id, updated_at")
      .eq("status", "generating")
      .lt("updated_at", stuckCutoff);

    if (propSelErr) {
      console.error("[stuck-reaper] reapStuckGeneratingProperties property select failed:", propSelErr.message);
      return { reaped: 0, ids: [] };
    }

    const props = (candidates ?? []) as Array<{ id: string; updated_at: string }>;
    if (props.length === 0) return { reaped: 0, ids: [] };

    // Dynamic import so tests can mock resubmitScene independently.
    const { resubmitScene } = await import("../pipeline.js");

    let reaped = 0;
    const ids: string[] = [];

    for (const prop of props) {
      try {
        // Find never-submitted pending scenes for this property.
        const { data: neverSubmitted, error: sceneSelErr } = await db
          .from("scenes")
          .select("id")
          .eq("property_id", prop.id)
          .eq("status", "pending")
          .is("provider_task_id", null)
          .is("clip_url", null)
          .is("replaced_at", null);

        if (sceneSelErr) {
          console.warn(
            `[stuck-reaper] reapStuckGeneratingProperties scene select failed for property ${prop.id}:`,
            sceneSelErr.message,
          );
          continue;
        }

        const unsubmitted = (neverSubmitted ?? []) as Array<{ id: string }>;
        if (unsubmitted.length === 0) continue; // no never-submitted scenes — another reaper covers it

        const isExhausted = prop.updated_at < exhaustedCutoff;

        if (isExhausted) {
          // Give-up: surface to operator as needs_review. updatePropertyStatus
          // bumps updated_at so a subsequent cron tick won't re-process this.
          const { error: updErr } = await db
            .from("properties")
            .update({
              status: "needs_review",
              updated_at: new Date().toISOString(),
            })
            .eq("id", prop.id);

          if (updErr) {
            console.error(
              `[stuck-reaper] reapStuckGeneratingProperties give-up update failed for property ${prop.id}:`,
              updErr.message,
            );
            continue;
          }
          console.warn(
            `[stuck-reaper] property ${prop.id} exhausted in 'generating' >60m with ${unsubmitted.length} unsubmitted scene(s) — set needs_review`,
          );
        } else {
          // Re-submit each never-submitted scene. resubmitScene is safe:
          //   - Returns {ok:false, error} on failure (never throws).
          //   - On failure it leaves the scene at needs_review itself.
          //   - On success it stamps provider_task_id + submitted_at.
          // We bump the property's updated_at afterward to rate-limit re-fires.
          let anySubmitted = false;
          for (const scene of unsubmitted) {
            const result = await resubmitScene(scene.id);
            if (result.ok) {
              anySubmitted = true;
              console.warn(
                `[stuck-reaper] re-submitted scene ${scene.id} for property ${prop.id} (provider=${result.provider})`,
              );
            } else {
              console.warn(
                `[stuck-reaper] resubmitScene failed for scene ${scene.id} (property ${prop.id}): ${result.error ?? "unknown"}`,
              );
            }
          }

          // Bump property updated_at to rate-limit future re-fires regardless
          // of submit outcome (even all-failed), to avoid a tight retry storm.
          const { error: touchErr } = await db
            .from("properties")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", prop.id);

          if (touchErr) {
            console.warn(
              `[stuck-reaper] reapStuckGeneratingProperties timestamp bump failed for property ${prop.id}:`,
              touchErr.message,
            );
          }

          if (anySubmitted) {
            console.warn(
              `[stuck-reaper] property ${prop.id}: re-submitted ${unsubmitted.length} scene(s) that were never dispatched`,
            );
          }
        }

        reaped++;
        ids.push(prop.id);
      } catch (propErr) {
        console.warn(
          `[stuck-reaper] reapStuckGeneratingProperties failed for property ${prop.id}:`,
          propErr instanceof Error ? propErr.message : String(propErr),
        );
      }
    }

    return { reaped, ids };
  } catch (err) {
    console.error("[stuck-reaper] reapStuckGeneratingProperties unexpected error:", err);
    return { reaped: 0, ids: [] };
  }
}
