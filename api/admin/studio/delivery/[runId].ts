import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth.js';
import {
  getRun, getVariantsForRun, getEventsForRun, getPairedSceneIds,
  advanceRun, clearRunError, revertRun, setRunError,
} from '../../../../lib/delivery/runs.js';
import { prevStage, isDeliveryStage, type DeliveryStage } from '../../../../lib/delivery/state.js';

export const maxDuration = 300; // scrape/regenerate/assemble actions run long

// ─── Factored stage helpers (called by both the existing action cases and 'rerun') ───

/**
 * Core of the generate_audio action — extracted so 'rerun' can call it without
 * duplicating the duration-audit and auto-shorten loop.
 * Returns the response shape; caller is responsible for res.json().
 */
async function runGenerateAudio(runId: string): Promise<
  | { ok: true; run: unknown; duration_warning?: string }
  | { ok: false; status: number; error: string }
> {
  const run = await getRun(runId);
  if (!run) return { ok: false, status: 404, error: 'not_found' };
  if (!run.voiceover_script) return { ok: false, status: 400, error: 'generate the script first' };
  if (!run.voiceover_voice_id) return { ok: false, status: 400, error: 'pick a voice first' };

  const { generateVoiceoverAudio } = await import('../../../../lib/voiceover/generate-audio.js');
  const { updateRun: uRun3, setRunError: sre3, recordMlEvent: rme3 } = await import('../../../../lib/delivery/runs.js');

  try {
    const voiceId = run.voiceover_voice_id;
    const genAudio = async (script: string) => {
      const input = {
        script, voiceId,
        propertyId: run.property_id, storageFolder: run.property_id,
        deliveryRunId: runId,
      };
      try {
        return await generateVoiceoverAudio(input);
      } catch {
        return await generateVoiceoverAudio(input);
      }
    };

    let script = run.voiceover_script;
    let { audioUrl, durationMs } = await genAudio(script);

    // Duration audit: the audio must fit the video. If it overruns the
    // target by >1s, ask Claude to shorten naturally and re-render —
    // at most 2 attempts, then proceed with a warning.
    const targetSec = run.duration_seconds ?? 30;
    const toleranceMs = 1000;
    let shortenUnavailable = false;
    if (durationMs > targetSec * 1000 + toleranceMs) {
      const { shortenDeliveryScript } = await import('../../../../lib/delivery/voiceover-script.js');
      const { countWords } = await import('../../../../lib/voiceover/generate-script.js');
      const { stripAudioTags } = await import('../../../../lib/voiceover/audio-tags.js');
      for (let attempt = 0; attempt < 2 && durationMs > targetSec * 1000 + toleranceMs; attempt++) {
        const fromWords = countWords(stripAudioTags(script));
        // A shorten or re-render failure must NOT discard the good audio
        // we already paid for: keep the last good {script, audio} pair
        // (always consistent — script is only swapped once its audio
        // exists) and fall through to persist it with a warning.
        try {
          const { script: shortened } = await shortenDeliveryScript({
            runId, propertyId: run.property_id, script,
            actualSeconds: durationMs / 1000, targetSeconds: targetSec,
          });
          ({ audioUrl, durationMs } = await genAudio(shortened));
          script = shortened;
        } catch (shortenErr) {
          console.error('[delivery] auto-shorten failed, keeping last good audio:', shortenErr);
          shortenUnavailable = true;
          break;
        }
        await rme3(runId, 'script_edit', {
          source: 'auto_shorten',
          from_words: fromWords,
          to_words: countWords(stripAudioTags(script)),
          target_seconds: targetSec,
        });
      }
    }

    // Persist the script actually spoken so the UI matches the audio.
    const updated = await uRun3(runId, { voiceover_script: script, voiceover_audio_url: audioUrl } as never);
    if (durationMs > targetSec * 1000 + toleranceMs) {
      return {
        ok: true,
        run: updated,
        duration_warning: `audio ${(durationMs / 1000).toFixed(1)}s > ${targetSec}s target${shortenUnavailable ? ' (auto-shorten unavailable)' : ''}`,
      };
    }
    return { ok: true, run: updated };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sre3(runId, `Voiceover audio failed twice: ${msg} — you can skip (assembly proceeds without VO).`);
    return { ok: false, status: 502, error: msg };
  }
}

/**
 * Core of the generate_music action — extracted so 'rerun' can call it without
 * duplicating the 4-genre parallel generation logic.
 * Returns a structured result that the caller converts to a response.
 */
async function runGenerateMusic(runId: string): Promise<
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; error: string }
> {
  const run = await getRun(runId);
  if (!run) return { ok: false, status: 404, error: 'not_found' };

  const { moodForPackage, pickRandom } = await import('../../../../lib/assembly/music.js');
  const {
    composeMusic, MOOD_PROMPTS, GENRE_VARIANTS, buildFeedbackBlock, buildGenrePrompt,
  } = await import('../../../../lib/providers/elevenlabs-music.js');
  const mood = moodForPackage(run.video_type);
  const lengthMs = Math.max((run.duration_seconds ?? 30) * 1000, 15_000) + 5_000;
  const db = (await import('../../../../lib/client.js')).getSupabase();

  // Fetch the latest 5 feedback rows for this mood to build the feedback block.
  const { data: feedbackRows } = await db
    .from('music_track_feedback')
    .select('verdict, genre, comment, created_at')
    .eq('mood', mood)
    .order('created_at', { ascending: false })
    .limit(5);
  const feedbackBlock = buildFeedbackBlock(
    (feedbackRows ?? []) as Array<{ verdict: 'up' | 'down'; genre: string | null; comment: string | null; created_at: string }>,
  );

  // Fire 4 composeMusic calls in parallel — one per genre variant.
  type TrackOption = { id: string; name: string; file_url: string; mood_tag: string; source: string; genre: string | null };
  type SettledResult = { status: 'fulfilled'; value: TrackOption } | { status: 'rejected'; reason: unknown };

  const today = new Date().toISOString().slice(0, 10);
  const results = await Promise.allSettled(
    GENRE_VARIANTS.map(async (variant) => {
      const fullPrompt = buildGenrePrompt(MOOD_PROMPTS[mood], variant.promptFragment, feedbackBlock);
      const { audio } = await composeMusic(fullPrompt, lengthMs, { propertyId: run.property_id, deliveryRunId: runId });
      const path = `delivery/${run.id}/${Date.now()}-${variant.key}.mp3`;
      const { error: upErr } = await db.storage.from('music').upload(path, audio, { contentType: 'audio/mpeg', upsert: true });
      if (upErr) throw new Error(upErr.message);
      const { data: urlData } = db.storage.from('music').getPublicUrl(path);
      const { data: track, error: insErr } = await db.from('music_tracks').insert({
        name: `Generated · ${mood} · ${variant.key} · ${today}`,
        file_url: urlData.publicUrl,
        mood_tag: mood,
        source: 'elevenlabs_music',
        genre: variant.key,
        prompt: fullPrompt,
        active: true,
      }).select('id, name, file_url, mood_tag, source, genre').single();
      if (insErr) throw new Error(insErr.message);
      return track as TrackOption;
    }),
  ) as SettledResult[];

  const successTracks = results
    .filter((r): r is { status: 'fulfilled'; value: TrackOption } => r.status === 'fulfilled')
    .map((r) => r.value);
  const failures = results.filter((r) => r.status === 'rejected').length;

  if (successTracks.length > 0) {
    const warning = failures > 0 ? `${failures} of 4 generations failed` : undefined;
    const body: { tracks: TrackOption[]; failures: number; warning?: string } = {
      tracks: successTracks, failures,
    };
    if (warning) body.warning = warning;
    return { ok: true, status: 201, body };
  }

  // All 4 failed — fall back to library.
  const firstError = results.find((r) => r.status === 'rejected');
  const msg = firstError?.status === 'rejected'
    ? (firstError.reason instanceof Error ? firstError.reason.message : String(firstError.reason))
    : 'All 4 music generations failed';

  type LibraryTrackRow = { id: string; name: string; file_url: string; mood_tag: string; source: string };
  const { data: moodPool } = await db.from('music_tracks').select('id, name, file_url, mood_tag, source').eq('mood_tag', mood).eq('active', true).neq('source', 'elevenlabs_music');
  const { data: neutralPool } = await db.from('music_tracks').select('id, name, file_url, mood_tag, source').eq('mood_tag', 'neutral').eq('active', true).neq('source', 'elevenlabs_music');
  const { data: anyPool } = await db.from('music_tracks').select('id, name, file_url, mood_tag, source').eq('active', true).neq('source', 'elevenlabs_music');

  const fallbackRow = pickRandom(moodPool ?? []) ?? pickRandom(neutralPool ?? []) ?? pickRandom(anyPool ?? []);
  if (!fallbackRow) {
    const { setRunError: sre5 } = await import('../../../../lib/delivery/runs.js');
    await sre5(runId, `Music generation failed: ${msg} — pick a library track or skip.`);
    return { ok: false, status: 502, error: msg };
  }

  const { updateRun: uRun5, recordMlEvent: rme5 } = await import('../../../../lib/delivery/runs.js');
  await uRun5(runId, { music_track_id: (fallbackRow as LibraryTrackRow).id } as never);
  await rme5(runId, 'music_choice', {
    music_track_id: (fallbackRow as LibraryTrackRow).id,
    source: 'library_fallback',
    generation_error: msg,
  });
  const fallbackTrack: TrackOption = { ...(fallbackRow as LibraryTrackRow), genre: null };
  return { ok: true, status: 200, body: { tracks: [fallbackTrack], failures: 4, fallback: true, warning: msg } };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const runId = String(req.query.runId);

  try {
    if (req.method === 'GET') {
      const run = await getRun(runId);
      if (!run) return res.status(404).json({ error: 'not_found' });
      const [variants, events, pairedSceneIds] = await Promise.all([
        getVariantsForRun(runId),
        getEventsForRun(runId),
        // Paired scenes (end_photo_id set) unlock the Checkpoint A regenerate
        // model picker (kling-v3-pro default / seedance-pair opt-in).
        getPairedSceneIds(run.property_id),
      ]);
      let photoSelection: unknown = null;
      if (run.stage === 'photo_selection') {
        const { getPhotoSelectionForRun } = await import('../../../../lib/delivery/photo-selection.js');
        photoSelection = await getPhotoSelectionForRun(runId);
      }
      return res.status(200).json({ run, variants, events, paired_scene_ids: pairedSceneIds, photo_selection: photoSelection });
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
        case 'approve_photo_selection': {
          const run = await getRun(runId);
          if (!run) return res.status(404).json({ error: 'not_found' });
          if (run.stage !== 'photo_selection') {
            return res.status(400).json({ error: `approve_photo_selection requires stage photo_selection, got ${run.stage}` });
          }
          const photoOrder = Array.isArray(req.body?.photo_order)
            ? (req.body.photo_order as unknown[]).map(String)
            : [];
          const rejected = Array.isArray(req.body?.rejected)
            ? (req.body.rejected as Array<{ photo_id?: unknown; category?: unknown; reason?: unknown }>).map((r) => ({
                photo_id: String(r.photo_id ?? ''),
                category: r.category == null ? null : String(r.category),
                reason: r.reason == null ? null : String(r.reason),
              })).filter((r) => r.photo_id)
            : [];
          const accepted = Array.isArray(req.body?.accepted)
            ? (req.body.accepted as Array<{ photo_id?: unknown; category?: unknown; note?: unknown }>).map((a) => ({
                photo_id: String(a.photo_id ?? ''),
                category: a.category == null ? null : String(a.category),
                note: a.note == null ? null : String(a.note),
              })).filter((a) => a.photo_id)
            : [];
          const { applyPhotoSelectionForRun, normalizePhotoFeedbackCategory } = await import('../../../../lib/delivery/photo-selection.js');
          const result = await applyPhotoSelectionForRun(runId, {
            photo_order: photoOrder,
            accepted: accepted.map((a) => ({
              photo_id: a.photo_id,
              category: normalizePhotoFeedbackCategory(a.category),
              note: a.note,
            })),
            rejected: rejected.map((r) => ({
              photo_id: r.photo_id,
              category: normalizePhotoFeedbackCategory(r.category),
              reason: r.reason,
            })),
          });
          const advanced = await getRun(runId);
          const { continuePipelineAfterPhotoSelection } = await import('../../../../lib/pipeline.js');
          try {
            await continuePipelineAfterPhotoSelection(run.property_id, { order_mode: 'operator', delivery_run_id: runId });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await setRunError(runId, `Photo selection approved, but generation resume failed: ${msg}`);
            const failedRun = await getRun(runId);
            return res.status(200).json({
              run: failedRun ?? advanced,
              selected_photo_ids: result.selected_photo_ids,
              resume_error: 'generation_resume_failed',
              message: msg,
            });
          }
          return res.status(200).json({ run: advanced, selected_photo_ids: result.selected_photo_ids });
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

          // Optional explicit model choice (paired scenes only). Allowlist:
          // kling-v3-pro (the DQ.3 default) and seedance-pair (opt-in
          // Seedance 2.0 start+end-frame mode). Anything else → 400.
          const modelRaw = req.body?.model;
          let model: 'kling-v3-pro' | 'seedance-pair' | undefined;
          if (modelRaw != null && modelRaw !== '') {
            if (modelRaw !== 'kling-v3-pro' && modelRaw !== 'seedance-pair') {
              return res.status(400).json({
                error: `model '${String(modelRaw)}' is not allowed for regenerate — valid: kling-v3-pro, seedance-pair`,
              });
            }
            model = modelRaw;
            if (model === 'seedance-pair') {
              // Pair mode needs an end frame: only paired scenes qualify.
              const db = (await import('../../../../lib/client.js')).getSupabase();
              const { data: sceneRow } = await db
                .from('scenes').select('end_photo_id').eq('id', sceneId).maybeSingle();
              if (!(sceneRow as { end_photo_id?: string | null } | null)?.end_photo_id) {
                return res.status(400).json({
                  error: 'seedance-pair requires a paired scene (start + end photo) — this scene has no end_photo_id',
                });
              }
            }
          }

          const { regenerateVariant } = await import('../../../../lib/delivery/variants.js');
          const { recordMlEvent } = await import('../../../../lib/delivery/runs.js');
          if (model) {
            await regenerateVariant(runId, sceneId, variant, { modelOverride: model });
          } else {
            await regenerateVariant(runId, sceneId, variant);
          }
          // ml_event records the operator's model choice (absent = router default).
          await recordMlEvent(runId, 'regenerate', { scene_id: sceneId, variant, ...(model ? { model } : {}) });
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
          const audioResult = await runGenerateAudio(runId);
          if (audioResult.ok === false) {
            return res.status(audioResult.status).json({ error: audioResult.error });
          }
          const audioBody: { run: unknown; duration_warning?: string } = { run: audioResult.run };
          if (audioResult.duration_warning) audioBody.duration_warning = audioResult.duration_warning;
          return res.status(200).json(audioBody);
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
          const musicResult = await runGenerateMusic(runId);
          if (musicResult.ok === false) {
            return res.status(musicResult.status).json({ error: musicResult.error });
          }
          return res.status(musicResult.status).json(musicResult.body);
        }
        case 'music_feedback': {
          const trackId = String(req.body?.track_id ?? '');
          if (!trackId) return res.status(400).json({ error: 'track_id required' });
          const verdict = req.body?.verdict;
          if (verdict !== 'up' && verdict !== 'down') {
            return res.status(400).json({ error: "verdict must be 'up' or 'down'" });
          }
          const comment = req.body?.comment ? String(req.body.comment).trim() : null;

          const db = (await import('../../../../lib/client.js')).getSupabase();

          // Fetch the track to denormalize mood/genre/prompt.
          const { data: trackRow } = await db
            .from('music_tracks')
            .select('id, mood_tag, genre, prompt, source, active')
            .eq('id', trackId)
            .maybeSingle();
          const track = trackRow as { id: string; mood_tag: string | null; genre: string | null; prompt: string | null; source: string; active: boolean } | null;

          // Upsert: conflict on (run_id, track_id) → update verdict/comment.
          // A failed write must surface as an error — returning ok would let the
          // UI show a verdict that was never stored (and never reaches prompts).
          const { error: feedbackErr } = await db.from('music_track_feedback').upsert(
            {
              track_id: trackId,
              run_id: runId,
              mood: track?.mood_tag ?? null,
              genre: track?.genre ?? null,
              prompt: track?.prompt ?? null,
              verdict,
              comment,
            },
            { onConflict: 'run_id,track_id' },
          );
          if (feedbackErr) {
            console.error('[delivery] music_track_feedback upsert failed:', feedbackErr);
            return res.status(500).json({ error: `feedback save failed: ${feedbackErr.message}` });
          }

          const { recordMlEvent: rme6 } = await import('../../../../lib/delivery/runs.js');
          await rme6(runId, 'music_feedback', {
            track_id: trackId,
            verdict,
            has_comment: Boolean(comment),
          });

          // On 'down' + source='elevenlabs_music': deactivate the track.
          // Library tracks are never auto-deactivated (curated pool must stay intact).
          if (verdict === 'down' && track?.source === 'elevenlabs_music') {
            // Supabase returns errors rather than throwing — check the result
            // (a try/catch here would never fire). Non-fatal by design.
            const { error: deactivateErr } = await db.from('music_tracks')
              .update({ active: false })
              .eq('id', trackId)
              .eq('source', 'elevenlabs_music');
            if (deactivateErr) {
              console.error('[delivery] music_track deactivation failed (non-fatal):', deactivateErr);
            }
          }

          return res.status(200).json({ ok: true });
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
            const { parseFeedbackComment } = await import('../../../../lib/delivery/parse-feedback.js');
            let parseResult: Awaited<ReturnType<typeof parseFeedbackComment>>;
            try {
              parseResult = await parseFeedbackComment(comment, { runId, propertyId: run.property_id });
            } catch (err) {
              console.error('[delivery] feedback parse failed (storing raw only):', err);
              parseResult = { tags: [], parse_error: true, error_message: err instanceof Error ? err.message : String(err) };
            }
            const commentPayload: Record<string, unknown> = { raw: comment, tags: parseResult.tags };
            if (parseResult.parse_error) {
              commentPayload.parse_error = true;
              if (parseResult.error_message) commentPayload.error_message = parseResult.error_message;
            }
            await recordMlEvent(runId, 'comment', commentPayload);
          }
          const updated = await advanceRun(runId, 'delivered');
          return res.status(200).json({ run: updated });
        }
        case 'back': {
          // Move the run to an earlier stage. Optional `to` in the body lets the
          // caller target a specific stage; without it we go one step back.
          const currentRun = await getRun(runId);
          if (!currentRun) return res.status(404).json({ error: 'not_found' });
          const currentStage = currentRun.stage as DeliveryStage;

          let targetStage: DeliveryStage;
          const rawTo = req.body?.to;
          if (rawTo != null && rawTo !== '') {
            const toStr = String(rawTo);
            if (!isDeliveryStage(toStr)) {
              return res.status(400).json({ error: `'${toStr}' is not a delivery stage` });
            }
            targetStage = toStr;
          } else {
            const prev = prevStage(currentStage);
            if (prev === null) {
              return res.status(400).json({ error: 'already at the first step' });
            }
            targetStage = prev;
          }

          if (currentStage === 'photo_selection' && targetStage === 'scraping') {
            return res.status(400).json({ error: 'photo selection cannot go back to scraping; rerun the intake/scrape flow from the order if needed' });
          }
          if (targetStage === 'photo_selection' && currentStage !== 'photo_selection') {
            return res.status(400).json({ error: 'photo selection is locked after generation starts; create a new run to change source photos' });
          }

          const revertedRun = await revertRun(runId, targetStage);
          return res.status(200).json({ run: revertedRun });
        }

        case 'rerun': {
          // Re-execute the machine side-effect for the current stage.
          const rerunRun = await getRun(runId);
          if (!rerunRun) return res.status(404).json({ error: 'not_found' });
          const rerunStage = rerunRun.stage as DeliveryStage;

          switch (rerunStage) {
            case 'scraping': {
              const { runScrapeStage } = await import('../../../../lib/delivery/scrape.js');
              await runScrapeStage(runId);
              const updated = await getRun(runId);
              return res.status(200).json({ run: updated });
            }
            case 'generating': {
              const { continuePipelineAfterPhotoSelection } = await import('../../../../lib/pipeline.js');
              try {
                await continuePipelineAfterPhotoSelection(rerunRun.property_id, {
                  order_mode: 'operator',
                  delivery_run_id: runId,
                  rerun_stage: 'generating',
                });
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                await setRunError(runId, `Generation resume failed: ${msg}`);
                return res.status(502).json({ error: 'generation_resume_failed', message: msg });
              }
              const updated = await getRun(runId);
              return res.status(200).json({ run: updated });
            }
            case 'judging': {
              const { runJudgePass } = await import('../../../../lib/delivery/judge.js');
              await runJudgePass(runId);
              const updated = await getRun(runId);
              return res.status(200).json({ run: updated });
            }
            case 'checkpoint_a': {
              // checkpoint_a is the human gate AFTER judging. runJudgePass only
              // acts while the run is in generating/judging (it early-returns at
              // checkpoint_a), so step the pointer back to 'judging' first; the
              // pass re-judges and re-advances to checkpoint_a. Operator winner
              // picks are preserved inside runJudgePass (winner_source='operator').
              const { revertRun } = await import('../../../../lib/delivery/runs.js');
              await revertRun(runId, 'judging');
              const { runJudgePass } = await import('../../../../lib/delivery/judge.js');
              await runJudgePass(runId);
              const updated = await getRun(runId);
              return res.status(200).json({ run: updated });
            }
            case 'voiceover': {
              const audioResult = await runGenerateAudio(runId);
              if (audioResult.ok === false) {
                return res.status(audioResult.status).json({ error: audioResult.error });
              }
              const audioBody: { run: unknown; duration_warning?: string } = { run: audioResult.run };
              if (audioResult.duration_warning) audioBody.duration_warning = audioResult.duration_warning;
              return res.status(200).json(audioBody);
            }
            case 'music': {
              const musicResult = await runGenerateMusic(runId);
              if (musicResult.ok === false) {
                return res.status(musicResult.status).json({ error: musicResult.error });
              }
              return res.status(musicResult.status).json(musicResult.body);
            }
            case 'assembling': {
              const { runAssembleStage } = await import('../../../../lib/delivery/assemble.js');
              await runAssembleStage(runId);
              const updated = await getRun(runId);
              return res.status(200).json({ run: updated });
            }
            case 'checkpoint_b': {
              // checkpoint_b is the human gate AFTER assembly. runAssembleStage
              // hard-guards stage==='assembling' (throws otherwise), so step the
              // pointer back to 'assembling' first; the assemble re-renders and
              // re-advances to checkpoint_b.
              const { revertRun } = await import('../../../../lib/delivery/runs.js');
              await revertRun(runId, 'assembling');
              const { runAssembleStage } = await import('../../../../lib/delivery/assemble.js');
              await runAssembleStage(runId);
              const updated = await getRun(runId);
              return res.status(200).json({ run: updated });
            }
            case 'intake':
            case 'photo_selection':
            case 'details':
            case 'delivered': {
              return res.status(400).json({ error: 'nothing to re-run at this stage' });
            }
            default: {
              // Exhaustiveness assertion — all DeliveryStage values are handled above.
              // This branch is unreachable at runtime; the cast silences the TS error
              // without using `any` while preserving the compile-time completeness check.
              const exhausted = rerunStage as never;
              return res.status(400).json({ error: `unhandled stage: ${String(exhausted)}` });
            }
          }
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
