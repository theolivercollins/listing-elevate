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
        case 'scrape': {
          const { runScrapeStage } = await import('../../../../lib/delivery/scrape.js');
          await runScrapeStage(runId);
          const run = await getRun(runId);
          return res.status(200).json({ run });
        }
        case 'reorder': {
          const run = await getRun(runId);
          if (!run) return res.status(404).json({ error: 'not_found' });
          const after = (req.body?.scene_order ?? []) as string[];
          const before = (run.scene_order ?? []) as string[];
          if ([...after].sort().join(',') !== [...before].sort().join(',')) {
            return res.status(400).json({ error: 'scene_order must be a permutation of the current order' });
          }
          const { updateRun, recordMlEvent } = await import('../../../../lib/delivery/runs.js');
          const updated = await updateRun(runId, { scene_order: after });
          await recordMlEvent(runId, 'reorder', { before, after });
          return res.status(200).json({ run: updated });
        }
        case 'flip_winner': {
          const sceneId = String(req.body?.scene_id ?? '');
          if (!sceneId) return res.status(400).json({ error: 'scene_id required' });
          const { getVariantsForRun: gv, recordMlEvent: rme } = await import('../../../../lib/delivery/runs.js');
          const variants = (await gv(runId)).filter((v) => v.scene_id === sceneId);
          const a = variants.find((v) => v.variant === 'A');
          const b = variants.find((v) => v.variant === 'B');
          if (!a?.clip_url || !b?.clip_url) return res.status(400).json({ error: 'both variants need clips to flip' });
          const oldWinner = a.winner ? 'A' : 'B';
          const newWinner = oldWinner === 'A' ? 'B' : 'A';
          const db = (await import('../../../../lib/client.js')).getSupabase();
          await db.from('scene_variants').update({ winner: newWinner === 'A', winner_source: 'operator', updated_at: new Date().toISOString() }).eq('id', a.id);
          await db.from('scene_variants').update({ winner: newWinner === 'B', winner_source: 'operator', updated_at: new Date().toISOString() }).eq('id', b.id);
          await rme(runId, 'variant_override', { scene_id: sceneId, from: oldWinner, to: newWinner });
          return res.status(200).json({ ok: true });
        }
        case 'regenerate': {
          const sceneId = String(req.body?.scene_id ?? '');
          const variant = req.body?.variant === 'A' ? 'A' : 'B';
          if (!sceneId) return res.status(400).json({ error: 'scene_id required' });
          const { regenerateVariant } = await import('../../../../lib/delivery/variants.js');
          const { recordMlEvent } = await import('../../../../lib/delivery/runs.js');
          await regenerateVariant(runId, sceneId, variant);
          await recordMlEvent(runId, 'regenerate', { scene_id: sceneId, variant });
          return res.status(200).json({ ok: true });
        }
        case 'generate_script': {
          const run = await getRun(runId);
          if (!run) return res.status(404).json({ error: 'not_found' });
          const db = (await import('../../../../lib/client.js')).getSupabase();
          const { data: prop } = await db.from('properties').select('address').eq('id', run.property_id).maybeSingle();
          const { generateDeliveryScript } = await import('../../../../lib/delivery/voiceover-script.js');
          const { updateRun } = await import('../../../../lib/delivery/runs.js');
          const { script } = await generateDeliveryScript({
            runId,
            propertyId: run.property_id,
            address: String((prop as { address?: string } | null)?.address ?? ''),
            videoType: run.video_type,
            durationSec: run.duration_seconds ?? 30,
            details: run.listing_details ?? {},
          });
          const updated = await updateRun(runId, { voiceover_script: script } as never);
          return res.status(200).json({ run: updated });
        }
        case 'set_script': {
          const run = await getRun(runId);
          if (!run) return res.status(404).json({ error: 'not_found' });
          const script = String(req.body?.script ?? '').trim();
          if (!script) return res.status(400).json({ error: 'script required' });
          const { updateRun, recordMlEvent } = await import('../../../../lib/delivery/runs.js');
          const updated = await updateRun(runId, { voiceover_script: script } as never);
          if (run.voiceover_script && run.voiceover_script !== script) {
            await recordMlEvent(runId, 'script_edit', { before: run.voiceover_script, after: script });
          }
          return res.status(200).json({ run: updated });
        }
        // Later tasks add: 'set_voice'/'generate_audio' (T18),
        // 'set_music'/'generate_music' (T19), 'assemble' (T20), 'submit_ratings' (T21).
        default:
          return res.status(400).json({ error: `unknown action '${action}'` });
      }
    }

    if (req.method === 'PATCH') {
      const { validateListingDetails } = await import('../../../../lib/delivery/details.js');
      const run = await getRun(runId);
      if (!run) return res.status(404).json({ error: 'not_found' });
      const v = validateListingDetails(req.body ?? {});
      if (!v.ok) return res.status(400).json({ error: v.error });
      const { setListingDetails, recordMlEvent } = await import('../../../../lib/delivery/runs.js');
      const updated = await setListingDetails(runId, v.details);
      await recordMlEvent(runId, 'details_edit', { before: run.listing_details, after: v.details });
      return res.status(200).json({ run: updated });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/stage moved/i.test(msg)) return res.status(409).json({ error: msg });
    return res.status(/illegal transition|not a delivery stage|required|invalid|unknown/i.test(msg) ? 400 : 500).json({ error: msg });
  }
}
