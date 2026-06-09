import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth.js';
import {
  getRun, getVariantsForRun, getEventsForRun,
  advanceRun, clearRunError,
} from '../../../../lib/delivery/runs.js';

export const maxDuration = 300; // scrape/regenerate/assemble actions run long

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const runId = String(req.query.runId);

  try {
    if (req.method === 'GET') {
      const run = await getRun(runId);
      if (!run) return res.status(404).json({ error: 'not_found' });
      const [variants, events] = await Promise.all([
        getVariantsForRun(runId),
        getEventsForRun(runId),
      ]);
      return res.status(200).json({ run, variants, events });
    }

    if (req.method === 'POST') {
      const action = String(req.body?.action ?? '');
      switch (action) {
        case 'advance': {
          const run = await advanceRun(runId, String(req.body?.to ?? ''));
          return res.status(200).json({ run });
        }
        case 'retry': {
          const run = await clearRunError(runId);
          return res.status(200).json({ run });
        }
        // Later tasks add: 'scrape' (T8), 'reorder' (T14), 'regenerate'/'flip_winner' (T15),
        // 'generate_script'/'set_script' (T17), 'set_voice'/'generate_audio' (T18),
        // 'set_music'/'generate_music' (T19), 'assemble' (T20), 'submit_ratings' (T21).
        default:
          return res.status(400).json({ error: `unknown action '${action}'` });
      }
    }

    // PATCH (listing details) lands in Task 9.
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(/illegal transition|not a delivery stage|required|invalid|unknown/i.test(msg) ? 400 : 500).json({ error: msg });
  }
}
