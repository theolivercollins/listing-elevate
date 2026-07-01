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
 * Core of the generate_audio action — thin delegate to the shared delivery audio
 * runner (lib/delivery/audio.ts), which owns the duration-audit / auto-shorten
 * loop, the per-call retry, and the setRunError failure surface. The same runner
 * backs the autopilot voiceover gate (resolveVoiceover) so both paths produce
 * duration-audited audio. Returns the response shape; caller does res.json().
 */
async function runGenerateAudio(runId: string): Promise<
  | { ok: true; run: unknown; duration_warning?: string }
  | { ok: false; status: number; error: string }
> {
  const { runDeliveryAudio } = await import('../../../../lib/delivery/audio.js');
  return runDeliveryAudio(runId);
}

/**
 * Core of the generate_music action — extracted to lib/delivery/music-gen.ts
 * (generateMusicVariantsForRun) so both this route AND the Telegram refine
 * executor (lib/telegram/refine-execute.ts) call the exact same 4-genre
 * parallel generation logic. Kept as a dynamic import here (matching this
 * file's existing lazy-loading convention for occasional/heavy deps) —
 * behavior is unchanged, this is a pure move.
 */
async function runGenerateMusic(runId: string): Promise<
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; error: string }
> {
  const { generateMusicVariantsForRun } = await import('../../../../lib/delivery/music-gen.js');
  return generateMusicVariantsForRun(runId);
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
          const run = await getRun(runId);
          if (!run) return res.status(404).json({ error: 'not_found' });

          // Only the 'generating'-stage zero-scene stall needs a real re-fire;
          // other stages keep the existing clear-error behavior.
          if (run.stage === 'generating') {
            const db = (await import('../../../../lib/client.js')).getSupabase();
            const { data: scenes, error: sceneErr } = await db.from('scenes').select('id').eq('property_id', run.property_id);
            // P1 #1: a Supabase query error must NEVER be treated as "zero scenes" —
            // that would re-fire continuePipeline on a run that may already have scenes,
            // duplicating them and doubling provider cost.
            if (sceneErr) return res.status(500).json({ error: sceneErr.message });
            const sceneCount = (scenes ?? []).length;
            if (sceneCount === 0) {
              // Serialize with every other generating-stage (re)fire (rerun /
              // stuck-reaper / continue hop) under the SHARED per-run resolve
              // lease so two callers can never both pass runScripting's 0-scene
              // guard and double-submit scenes = duplicate paid provider jobs.
              // If the lease is already held, mirror the rerun contract: 409.
              // On throw, setRunError so the failure stays visible in the UI.
              let leaseOutcome: { ran: boolean };
              try {
                const { resumeGeneratingUnderLease } = await import('../../../../lib/delivery/resume-generation.js');
                leaseOutcome = await resumeGeneratingUnderLease(runId, run.property_id);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                await setRunError(runId, `Generation resume failed: ${msg}`);
                return res.status(500).json({ status: 'failed', runId, error: msg });
              }
              if (!leaseOutcome.ran) {
                // Another resume is already in flight — don't double-fire.
                return res.status(409).json({
                  error: 'resume_already_in_progress',
                  message: 'A resume is already in progress — give it a moment, then refresh.',
                });
              }
              const refreshed = await getRun(runId);
              return res.status(200).json({ run: refreshed });
            }
            // generating stage but scenes already exist → don't duplicate;
            // fall through to clear-error.
          }

          const cleared = await clearRunError(runId);
          return res.status(200).json({ run: cleared });
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
          // applyPhotoSelectionForRun's RPC has already advanced the run to
          // stage='generating'. The post-approval compute (style guide +
          // director scripting + N provider submits) is heavy and previously
          // ran SYNCHRONOUSLY inside this 300s approve-POST — three failure
          // shapes (Vercel kill on overrun, no-JSON director output, all
          // providers permanent-fail) left the run pinned at 'generating'
          // with error=NULL and no autonomous recovery.
          //
          // DECOUPLE: respond 202 to the operator immediately and hand the
          // compute off to a SEPARATE serverless function
          // (/api/pipeline/continue/[runId]) which gets its OWN fresh 300s
          // maxDuration and, on any thrown error, calls setRunError so the
          // failure is visible. We do NOT await it — this mirrors the
          // browser's fire-and-forget call to /api/pipeline/[propertyId] in
          // StudioNew.tsx. A bare un-awaited promise in THIS function would be
          // killed on response-return; a real HTTP hop to a fresh function is
          // not. The generating-stage stuck-reaper is the safety net if the
          // hop itself fails to land.
          const advanced = await getRun(runId);
          const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'https';
          const host =
            (req.headers['x-forwarded-host'] as string | undefined)
            ?? (req.headers.host as string | undefined)
            ?? process.env.VERCEL_URL;
          if (host) {
            const continueUrl = `${proto}://${host}/api/pipeline/continue/${encodeURIComponent(runId)}`;
            // Fire-and-forget: don't await. The continue endpoint owns the
            // compute lifecycle (including setRunError on failure). We swallow
            // network errors here — the reaper recovers a hop that never lands.
            void fetch(continueUrl, { method: 'POST' }).catch((e) => {
              console.warn(`[delivery] continue hop to ${continueUrl} failed to dispatch; reaper will recover`, e);
            });
          } else {
            // No resolvable host (e.g. a non-Vercel execution context). Fall
            // back to surfacing an actionable error rather than silently
            // stalling at 'generating'. The operator can Rerun.
            await setRunError(runId, 'Photo selection approved, but the generation continue hop could not be dispatched (no host) — use Rerun');
          }
          return res.status(202).json({ run: advanced, selected_photo_ids: result.selected_photo_ids });
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

          // Core logic (upsert + conditional deactivation) lives in
          // lib/delivery/music-gen.ts — shared with the Telegram refine
          // executor. This route keeps only its own HTTP input validation.
          const { recordMusicTrackFeedback } = await import('../../../../lib/delivery/music-gen.js');
          const result = await recordMusicTrackFeedback(runId, trackId, verdict, comment);
          if (result.ok === false) return res.status(result.status).json({ error: result.error });
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
              // Concurrency guard: two rapid "Resume generation" clicks (or a
              // click racing the autopilot sweep / stuck-reaper / continue hop)
              // must NOT both run continuePipeline and double-submit scenes =
              // duplicate paid provider jobs. ALL four generating-stage (re)fire
              // sites funnel through resumeGeneratingUnderLease, which serializes
              // them on the per-run resolve lease (delivery_runs.resolving_at CAS).
              // If the lease is already held, no-op with a friendly 409.
              let leaseOutcome: { ran: boolean };
              try {
                const { resumeGeneratingUnderLease } = await import('../../../../lib/delivery/resume-generation.js');
                leaseOutcome = await resumeGeneratingUnderLease(runId, rerunRun.property_id, {
                  rerun_stage: 'generating',
                });
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                await setRunError(runId, `Generation resume failed: ${msg}`);
                return res.status(502).json({ error: 'generation_resume_failed', message: msg });
              }
              if (!leaseOutcome.ran) {
                // Another resume is already in flight — don't double-fire.
                return res.status(409).json({
                  error: 'resume_already_in_progress',
                  message: 'A resume is already in progress — give it a moment, then refresh.',
                });
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

        case 'set_auto_run': {
          // Kill-switch / arm: flip auto_run on or off for this run.
          // body: { enabled: boolean }
          const enabled = req.body?.enabled;
          if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean' });
          const { updateRun: uRun9, recordMlEvent: rme9 } = await import('../../../../lib/delivery/runs.js');
          const updated9 = await uRun9(runId, { auto_run: enabled } as never);
          await rme9(runId, 'auto_advance', { source: 'operator', action: 'set_auto_run', enabled });
          // Best-effort gate kick: when arming, resolve immediately if the run
          // already sits at a gate stage rather than waiting for the next cron sweep.
          let gateOutcome9: unknown;
          if (enabled) {
            try {
              const { resolveGate } = await import('../../../../lib/delivery/auto-run.js');
              const freshRun9 = await getRun(runId);
              if (freshRun9) gateOutcome9 = await resolveGate(freshRun9);
            } catch (e) {
              console.warn('[delivery] set_auto_run: resolveGate best-effort failed', e);
            }
          }
          const body9: { run: unknown; gate_outcome?: unknown } = { run: updated9 };
          if (gateOutcome9 !== undefined) body9.gate_outcome = gateOutcome9;
          return res.status(200).json(body9);
        }

        case 'resume_autopilot': {
          // Clear the pause state set by pauseForHuman, re-arm autopilot, and
          // immediately kick the gate resolver so the run continues without delay.
          const { updateRun: uRun10, recordMlEvent: rme10 } = await import('../../../../lib/delivery/runs.js');
          const updated10 = await uRun10(runId, { paused_reason: null, auto_paused_at: null, auto_run: true } as never);
          await rme10(runId, 'auto_resume', { source: 'operator' });
          let gateOutcome10: unknown;
          try {
            const { resolveGate } = await import('../../../../lib/delivery/auto-run.js');
            gateOutcome10 = await resolveGate(updated10);
          } catch (e) {
            console.warn('[delivery] resume_autopilot: resolveGate best-effort failed', e);
          }
          return res.status(200).json({ run: updated10, gate_outcome: gateOutcome10 });
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
