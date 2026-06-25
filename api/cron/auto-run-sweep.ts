/**
 * Autopilot sweep cron — api/cron/auto-run-sweep.ts
 *
 * Runs every minute on main. For every delivery run with auto_run=true that
 * is sitting at a gate stage and is not paused, calls resolveGate() to let the
 * autopilot decision engine take action (advance, pause-for-human, or noop).
 *
 * Auth: same CRON_SECRET pattern as all other crons in this repo. Vercel
 * auto-sends `Authorization: Bearer <CRON_SECRET>` when the env var is set.
 *
 * Write guard: resolveGate() itself gates via canWrite() (prod or
 * LE_ALLOW_NONPROD_WRITES=true), so this handler can run on all envs for
 * observability — non-prod runs return all noops, never mutate.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../lib/client.js';
import { resolveGate } from '../../lib/delivery/auto-run.js';
import type { DeliveryRunRow } from '../../lib/types/operator-studio.js';

export const maxDuration = 120;

/** Gate stages that the autopilot can act on (mirrors GATE_STAGES in auto-run.ts). */
const GATE_STAGES = [
  'checkpoint_a',
  'details',
  'voiceover',
  'music',
  'checkpoint_b',
] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CRON_SECRET guard — mirrors every other cron in this repo.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false });
  }

  let processed = 0;
  let advanced = 0;
  let paused = 0;
  let noop = 0;

  try {
    const supabase = getSupabase();

    const { data: runs, error } = await supabase
      .from('delivery_runs')
      .select('*')
      .eq('auto_run', true)
      .is('paused_reason', null)
      .in('stage', GATE_STAGES as unknown as string[]);

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    for (const run of (runs ?? []) as DeliveryRunRow[]) {
      processed++;
      try {
        const outcome = await resolveGate(run);
        if (outcome.action === 'advanced') advanced++;
        else if (outcome.action === 'paused') paused++;
        else noop++;
      } catch (err) {
        // One run failure must never abort the sweep — log and count as noop.
        console.error(`[auto-run-sweep] resolveGate failed for run ${run.id}:`, err);
        noop++;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ ok: false, error: msg });
  }

  return res.status(200).json({ ok: true, processed, advanced, paused, noop });
}
