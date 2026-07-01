/**
 * Shared per-run resolve lease — lib/delivery/resolve-lease.ts
 *
 * Primary overlap guard against double-spend on a single delivery_run. Two
 * concurrent actors (overlapping cron sweeps, a sweep racing an inline kick, or
 * two rapid operator "Resume generation" clicks) can otherwise both drive the
 * same run's expensive side-effects — paying ElevenLabs/Haiku/Creatomate twice,
 * or double-submitting scenes to the video provider (duplicate paid jobs).
 *
 * The lease serializes them via a compare-and-swap on delivery_runs.resolving_at:
 * exactly one caller claims the lease and proceeds; the other no-ops.
 *
 * This is now the SINGLE mutex for BOTH families of double-spend-risky work on a
 * run, not only the autopilot guard:
 *   1. Autopilot gate resolution — lib/delivery/auto-run.ts resolveGate()
 *      (photo_selection / checkpoint_a / details / voiceover / music / checkpoint_b).
 *   2. The generating-stage generation (re)fire — every site that re-runs
 *      continuePipelineAfterPhotoSelection for a run at stage='generating' goes
 *      through lib/delivery/resume-generation.ts::resumeGeneratingUnderLease,
 *      which wraps the compute in withResolveLease. That covers the operator
 *      "Resume generation" (rerun) + "Retry" actions, the stuck-reaper's
 *      zero-scene Path A re-fire, and the initial post-approval continue hop.
 * Because both families claim the SAME per-run lease, an autopilot sweep and a
 * generation re-fire can never overlap on one run either.
 *
 * Lives in its own module (not runs.ts) so it can be shared by all of the above
 * without a circular import, and so auto-run's existing tests keep exercising the
 * real CAS against their already-mocked getSupabase.
 */

import { getSupabase } from '../client.js';

/** Lease TTL — a crashed / Vercel-killed holder's stale lease is reclaimable
 *  after this window so a run is never permanently wedged. */
export const RESOLVE_LEASE_TTL_MS = 10 * 60 * 1000;

/** CAS-claim the per-run resolve lease. Returns true iff this caller won it.
 *  Mirrors: UPDATE delivery_runs SET resolving_at = now()
 *           WHERE id = :id AND (resolving_at IS NULL OR resolving_at < now() - interval '10 minutes')
 *                 AND paused_reason IS NULL.
 *
 *  The `paused_reason IS NULL` term folds the refine-lock check INTO the same
 *  atomic CAS as the lease claim, fully closing the residual double-submit race
 *  that auto-run.ts's isPausedFresh early-out only NARROWED: a Telegram refine
 *  executor CAS-sets delivery_runs.paused_reason='refining' to lock a run for a
 *  refine, so if that flip lands in the instant between isPausedFresh's fresh
 *  read and this claim, the resolver could still win the lease and double-spend.
 *  Making `paused_reason IS NULL` part of THIS row-level UPDATE means a run a
 *  refine executor just locked can never have its resolve-lease claimed — the
 *  DB, not a read-then-act pair, is the arbiter. Consistent with existing
 *  autopilot behavior: api/cron/auto-run-sweep.ts already only SELECTs
 *  paused_reason IS NULL runs, and the resume-generation path only fires on a
 *  stalled generating run (paused_reason NULL); folding it into the CAS just
 *  makes that invariant race-tight for every lease consumer. */
export async function claimResolveLease(runId: string): Promise<boolean> {
  const db = getSupabase();
  const staleBefore = new Date(Date.now() - RESOLVE_LEASE_TTL_MS).toISOString();
  const { data, error } = await db
    .from('delivery_runs')
    .update({ resolving_at: new Date().toISOString() })
    .eq('id', runId)
    .or(`resolving_at.is.null,resolving_at.lt.${staleBefore}`)
    .is('paused_reason', null)
    .select('id');
  if (error) throw new Error(`claimResolveLease: ${error.message}`);
  return Array.isArray(data) && data.length === 1;
}

/** Release the per-run resolve lease. Best-effort: a failure here must not mask
 *  the caller's own outcome (the TTL is the backstop). */
export async function releaseResolveLease(runId: string): Promise<void> {
  try {
    const db = getSupabase();
    const { error } = await db
      .from('delivery_runs')
      .update({ resolving_at: null })
      .eq('id', runId);
    if (error) console.error(`[resolve-lease] releaseResolveLease failed for ${runId}:`, error.message);
  } catch (e) {
    console.error(`[resolve-lease] releaseResolveLease threw for ${runId}:`, e);
  }
}

/** Outcome of running work under the lease. `ran:false` means the lease was
 *  held by a concurrent actor and `fn` was NOT invoked (no side-effects). */
export type LeaseOutcome<T> = { ran: true; result: T } | { ran: false };

/**
 * Run `fn` under the per-run resolve lease. If the lease is already held by a
 * concurrent actor, returns `{ ran: false }` WITHOUT invoking `fn` and WITHOUT
 * releasing (releasing a lease we never acquired would clear the holder's).
 * On acquisition, `fn` runs and the lease is ALWAYS released in a finally —
 * even if `fn` throws (the error then propagates to the caller).
 */
export async function withResolveLease<T>(
  runId: string,
  fn: () => Promise<T>,
): Promise<LeaseOutcome<T>> {
  if (!(await claimResolveLease(runId))) {
    return { ran: false };
  }
  try {
    return { ran: true, result: await fn() };
  } finally {
    await releaseResolveLease(runId);
  }
}
