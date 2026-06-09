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
        case 'set_voice': {
          const voiceId = String(req.body?.voice_id ?? '');
          if (!voiceId) return res.status(400).json({ error: 'voice_id required' });
          const { updateRun: uRun2, recordMlEvent: rme2 } = await import('../../../../lib/delivery/runs.js');
          const updated = await uRun2(runId, { voiceover_voice_id: voiceId } as never);
          await rme2(runId, 'voice_choice', { voice_id: voiceId, is_client_voice: Boolean(req.body?.is_client_voice) });
          return res.status(200).json({ run: updated });
        }
        case 'generate_audio': {
          const run = await getRun(runId);
          if (!run) return res.status(404).json({ error: 'not_found' });
          if (!run.voiceover_script) return res.status(400).json({ error: 'generate the script first' });
          if (!run.voiceover_voice_id) return res.status(400).json({ error: 'pick a voice first' });
          const { generateVoiceoverAudio } = await import('../../../../lib/voiceover/generate-audio.js');
          const { updateRun: uRun3, setRunError: sre3 } = await import('../../../../lib/delivery/runs.js');
          try {
            let audioUrl: string;
            try {
              ({ audioUrl } = await generateVoiceoverAudio({
                script: run.voiceover_script, voiceId: run.voiceover_voice_id,
                propertyId: run.property_id, storageFolder: run.property_id,
              }));
            } catch {
              ({ audioUrl } = await generateVoiceoverAudio({
                script: run.voiceover_script, voiceId: run.voiceover_voice_id,
                propertyId: run.property_id, storageFolder: run.property_id,
              }));
            }
            const updated = await uRun3(runId, { voiceover_audio_url: audioUrl } as never);
            return res.status(200).json({ run: updated });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await sre3(runId, `Voiceover audio failed twice: ${msg} — you can skip (assembly proceeds without VO).`);
            return res.status(502).json({ error: msg });
          }
        }
        case 'set_music': {
          const trackId = String(req.body?.music_track_id ?? '');
          if (!trackId) return res.status(400).json({ error: 'music_track_id required' });
          const { updateRun: uRun4, recordMlEvent: rme4 } = await import('../../../../lib/delivery/runs.js');
          const updated = await uRun4(runId, { music_track_id: trackId } as never);
          await rme4(runId, 'music_choice', { music_track_id: trackId, source: String(req.body?.source ?? 'library') });
          return res.status(200).json({ run: updated });
        }
        case 'generate_music': {
          const run = await getRun(runId);
          if (!run) return res.status(404).json({ error: 'not_found' });
          const { moodForPackage } = await import('../../../../lib/assembly/music.js');
          const { composeMusic, MOOD_PROMPTS } = await import('../../../../lib/providers/elevenlabs-music.js');
          const mood = moodForPackage(run.video_type);
          const lengthMs = Math.max((run.duration_seconds ?? 30) * 1000, 15_000) + 5_000;
          const db = (await import('../../../../lib/client.js')).getSupabase();
          try {
            const { audio } = await composeMusic(MOOD_PROMPTS[mood], lengthMs, { propertyId: run.property_id });
            const path = `delivery/${run.id}/${Date.now()}.mp3`;
            const { error: upErr } = await db.storage.from('music').upload(path, audio, { contentType: 'audio/mpeg', upsert: true });
            if (upErr) throw new Error(upErr.message);
            const { data: urlData } = db.storage.from('music').getPublicUrl(path);
            const { data: track, error: insErr } = await db.from('music_tracks').insert({
              name: `Generated · ${mood} · ${new Date().toISOString().slice(0, 10)}`,
              file_url: urlData.publicUrl, mood_tag: mood, source: 'elevenlabs_music',
              prompt: MOOD_PROMPTS[mood], active: true,
            }).select('id, name, file_url, mood_tag, source').single();
            if (insErr) throw new Error(insErr.message);
            return res.status(201).json({ track });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const { setRunError: sre5 } = await import('../../../../lib/delivery/runs.js');
            await sre5(runId, `Music generation failed: ${msg} — pick a library track or skip.`);
            return res.status(502).json({ error: msg });
          }
        }
        case 'assemble': {
          const run = await getRun(runId);
          if (!run) return res.status(404).json({ error: 'not_found' });
          // music -> assembling advance happens here so the music Next button
          // fires a single request; a retry on an 'assembling' run skips it.
          if (run.stage === 'music') {
            await (await import('../../../../lib/delivery/runs.js')).advanceRun(runId, 'assembling');
          }
          const { runAssembleStage } = await import('../../../../lib/delivery/assemble.js');
          await runAssembleStage(runId);
          const updated = await getRun(runId);
          return res.status(200).json({ run: updated });
        }
        case 'submit_ratings': {
          const run = await getRun(runId);
          if (!run) return res.status(404).json({ error: 'not_found' });
          const ratings: Record<string, number> = {};
          for (const k of ['overall', 'music', 'voiceover', 'script'] as const) {
            const v = Number(req.body?.[k]);
            if (!Number.isInteger(v) || v < 1 || v > 5) return res.status(400).json({ error: `${k} must be an integer 1-5` });
            ratings[k] = v;
          }
          const { recordMlEvent, advanceRun } = await import('../../../../lib/delivery/runs.js');
          await recordMlEvent(runId, 'rating', ratings);
          const comment = String(req.body?.comment ?? '').trim();
          if (comment) {
            let tags: unknown = [];
            try {
              const { parseFeedbackComment } = await import('../../../../lib/delivery/parse-feedback.js');
              tags = (await parseFeedbackComment(comment, { runId, propertyId: run.property_id })).tags;
            } catch (err) {
              console.error('[delivery] feedback parse failed (storing raw only):', err);
            }
            await recordMlEvent(runId, 'comment', { raw: comment, tags });
          }
          const updated = await advanceRun(runId, 'delivered');
          return res.status(200).json({ run: updated });
        }
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
