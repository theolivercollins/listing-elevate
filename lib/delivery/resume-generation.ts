/**
 * Shared "resume generation under the lease" helper — lib/delivery/resume-generation.ts
 *
 * There are FOUR sites that (re)fire the post-checkpoint generation compute
 * (continuePipelineAfterPhotoSelection) for a delivery_run sitting at
 * stage='generating':
 *   (a) the operator "Resume generation" action  — api/admin/studio/delivery/[runId].ts `rerun`
 *   (b) the operator "Retry" action (0-scene arm) — api/admin/studio/delivery/[runId].ts `retry`
 *   (c) the stuck-reaper's zero-scene Path A        — lib/pipeline/stuck-reaper.ts
 *   (d) the initial post-approval continue hop      — api/pipeline/continue/[runId].ts
 *
 * runScripting has a 0-scene guard, but TWO of these firing concurrently can
 * BOTH pass that guard before either inserts scenes → duplicate scenes →
 * duplicate paid provider jobs. This helper funnels all four through the SAME
 * per-run mutex (delivery_runs.resolving_at CAS, via withResolveLease) so exactly
 * one generation (re)fire per run runs at a time. The other caller gets
 * `{ ran: false }` and decides its own site-appropriate no-op:
 *   - rerun / retry → friendly 409 { error: 'resume_already_in_progress' }
 *   - reaper        → skip this tick cleanly (retries next minute)
 *   - continue-hop  → no-op 200 (the in-flight resume owns the lifecycle)
 *
 * The lease is released in a finally inside withResolveLease even if the compute
 * throws (the error then propagates to the caller). On a FRESH run the lease is
 * null → claim succeeds → generation runs exactly as before (no behavior change
 * to the happy path).
 */
import { withResolveLease, type LeaseOutcome } from './resolve-lease.js';

/**
 * Run continuePipelineAfterPhotoSelection for `propertyId` under the per-run
 * resolve lease keyed by `runId`. Returns the lease outcome:
 *   - { ran: true }  — this caller won the lease and the compute ran (or threw).
 *   - { ran: false } — the lease was held by a concurrent (re)fire; nothing ran.
 *
 * `extraContext` is merged into the pipeline log context AFTER the two defaults
 * (order_mode:'operator', delivery_run_id:runId) so a caller can add fields such
 * as `rerun_stage:'generating'` without re-specifying the defaults.
 *
 * pipeline.js is dynamically imported so this module stays cheap to import from
 * the API routes / cron reaper and so tests can mock the heavy pipeline compute.
 */
export async function resumeGeneratingUnderLease(
  runId: string,
  propertyId: string,
  extraContext: Record<string, unknown> = {},
): Promise<LeaseOutcome<void>> {
  const { continuePipelineAfterPhotoSelection } = await import('../pipeline.js');
  return withResolveLease(runId, () =>
    continuePipelineAfterPhotoSelection(propertyId, {
      order_mode: 'operator',
      delivery_run_id: runId,
      ...extraContext,
    }),
  );
}
