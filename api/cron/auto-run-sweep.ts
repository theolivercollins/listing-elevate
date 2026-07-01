/**
 * Autopilot sweep cron — api/cron/auto-run-sweep.ts
 *
 * Runs every minute on main. For every delivery run with auto_run=true that
 * is sitting at a gate stage (or the 'assembling' stage) and is not paused,
 * calls the appropriate resolver to let the autopilot decision engine take
 * action (advance, pause-for-human, or noop).
 *
 * Gate stages: resolveGate() handles checkpoint_a → checkpoint_b.
 * Assembling stage: resolveAssembling() resumes stalled renders without re-spend.
 *
 * Reclaim pass (runs FIRST, every tick): reclaimStrandedRefiningLocks()
 * (lib/delivery/auto-run.ts) clears any run wedged at paused_reason='refining'
 * for more than 10 minutes — the lock a Telegram conversational-refine
 * executor (lib/telegram/refine-conversation.ts) holds for the duration of a
 * refine plus its fire-and-forget render. If that executor's Vercel instance
 * is frozen/killed mid-render, nothing else ever clears the lock (the normal
 * pass below filters paused_reason IS NULL, so a locked run would otherwise be
 * invisible to it forever, with no dependency on a new inbound Telegram
 * message to trigger the executor's own reclaim). Runs before the main SELECT
 * below so a freshly-reclaimed run is picked up in this SAME tick.
 *
 * Auth: CRON_SECRET is HARD-REQUIRED here (not best-effort). This route drives
 * autonomous provider spend, so an unauthenticated/misconfigured request must be
 * rejected — never run open. Vercel auto-sends `Authorization: Bearer <CRON_SECRET>`.
 *
 * Budget: maxDuration=280s to accommodate a single 240-s poll plus overhead.
 * Assembling runs are given the remaining budget (fnBudgetMs - elapsed) so the
 * poll timeout fits within the Vercel function window.
 *
 * Write guard: resolveGate()/resolveAssembling()/reclaimStrandedRefiningLocks()
 * all gate via canWrite() (prod or LE_ALLOW_NONPROD_WRITES=true), so this
 * handler can run on all envs for observability — non-prod runs return all
 * noops, never mutate.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../lib/client.js';
import {
  resolveGate,
  resolveAssembling,
  reclaimStrandedRefiningLocks,
  GATE_STAGES,
} from '../../lib/delivery/auto-run.js';
import type { DeliveryRunRow } from '../../lib/types/operator-studio.js';

// Raised from 120 → 280 to accommodate a single 240-s render poll (e.g. 30-s
// horizontal render) plus setup/finalize overhead. Stays under the Vercel Pro
// 300-s limit with 20 s of margin. Both-orientation runs use remaining-budget
// per poll so the total never exceeds this cap.
export const maxDuration = 280;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CRON_SECRET guard — HARD-REQUIRED because this cron drives autonomous spend.
  // Missing secret OR mismatched bearer → 401. Never run open.
  if (
    !process.env.CRON_SECRET ||
    req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return res.status(401).json({ ok: false });
  }

  const fnStartMs = Date.now();
  // Usable budget: maxDuration minus 20 s safety margin.
  // Assembling runs are given (fnBudgetMs - elapsed) so polls stay inside the window.
  const fnBudgetMs = maxDuration * 1000 - 20_000;

  let processed = 0;
  let advanced = 0;
  let paused = 0;
  let noop = 0;
  let leaseError = 0;
  let reclaimed = 0;

  try {
    // Reclaim pass — BEFORE the main resolution pass below, so a run whose
    // stranded 'refining' lock we just cleared is visible to THIS tick's
    // SELECT (no extra tick of latency). Never throws (fail-open internally),
    // but wrapped defensively anyway: this reaper must never outrank or block
    // the main resolution pass that follows.
    try {
      const reclaimResult = await reclaimStrandedRefiningLocks();
      reclaimed = reclaimResult.reclaimed;
    } catch (err) {
      console.error('[auto-run-sweep] reclaimStrandedRefiningLocks failed:', err);
    }

    const supabase = getSupabase();

    // Single query for both gate stages AND assembling runs so we need only one
    // DB round-trip. Results are split client-side for routing.
    const allStages = [...(GATE_STAGES as unknown as string[]), 'assembling'];

    const { data: runs, error } = await supabase
      .from('delivery_runs')
      .select('*')
      .eq('auto_run', true)
      .is('paused_reason', null)
      .in('stage', allStages);

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    const allRuns = (runs ?? []) as DeliveryRunRow[];
    const gateRuns = allRuns.filter(r => (GATE_STAGES as unknown as string[]).includes(r.stage));
    const assemblingRuns = allRuns.filter(r => r.stage === 'assembling');

    // Process gate runs first — they're fast (no long polls).
    for (const run of gateRuns) {
      processed++;
      try {
        const outcome = await resolveGate(run);
        if (outcome.action === 'advanced') advanced++;
        else if (outcome.action === 'paused') paused++;
        else noop++;
      } catch (err) {
        // One run failure must never abort the sweep — log and count as noop.
        // 42703 = undefined_column: signals migration 091 (resolving_at) not applied.
        // Surface the count so operators can diagnose deploy-before-migration scenarios.
        console.error(`[auto-run-sweep] resolveGate failed for run ${run.id}:`, err);
        if (String(err).includes('42703')) leaseError++;
        noop++;
      }
    }

    // Process assembling runs with remaining function budget.
    // Each run gets (fnBudgetMs - elapsed) as its render poll timeout so the
    // Vercel function never exceeds maxDuration.
    for (const run of assemblingRuns) {
      const remainingBudget = fnBudgetMs - (Date.now() - fnStartMs);
      if (remainingBudget < 5_000) {
        // Not enough budget remaining — skip this run; it stays at assembling for
        // the next cron tick (job IDs are persisted so no re-spend occurs).
        noop++;
        processed++;
        continue;
      }
      processed++;
      try {
        const outcome = await resolveAssembling(run, remainingBudget);
        if (outcome.action === 'advanced') advanced++;
        else if (outcome.action === 'paused') paused++;
        else noop++;
      } catch (err) {
        console.error(`[auto-run-sweep] resolveAssembling failed for run ${run.id}:`, err);
        if (String(err).includes('42703')) leaseError++;
        noop++;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ ok: false, error: msg });
  }

  return res.status(200).json({ ok: true, processed, advanced, paused, noop, leaseError, reclaimed });
}
