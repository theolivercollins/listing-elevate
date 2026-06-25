/**
 * Shared delivery voiceover-audio runner — lib/delivery/audio.ts
 *
 * Single source of truth for the "synthesize the run's voiceover audio" step,
 * INCLUDING the duration-audit / auto-shorten loop, the per-call retry, and the
 * setRunError failure surface. Extracted from the operator route's generate_audio
 * handler so BOTH the human path (api/admin/studio/delivery/[runId].ts) and the
 * autopilot path (resolveVoiceover in auto-run.ts) get identical quality behavior
 * — autopilot must never ship audio that overruns the target duration.
 *
 * Reads the run fresh and requires voiceover_script + voiceover_voice_id to be
 * persisted first. Records its own cost_events (via generateVoiceoverAudio +
 * shortenDeliveryScript). Persists the script ACTUALLY spoken + the audio URL.
 */

import { getRun, updateRun, setRunError, recordMlEvent } from './runs.js';

export type DeliveryAudioResult =
  | { ok: true; run: unknown; duration_warning?: string }
  | { ok: false; status: number; error: string };

/**
 * Synthesize (and, if it overruns, auto-shorten) the voiceover audio for a run.
 * Returns a structured result; the caller decides how to surface it (HTTP status
 * for the route, pause-for-human for autopilot). On a hard failure the run's
 * error is set (skip-able: assembly can proceed without VO).
 */
export async function runDeliveryAudio(runId: string): Promise<DeliveryAudioResult> {
  const run = await getRun(runId);
  if (!run) return { ok: false, status: 404, error: 'not_found' };
  if (!run.voiceover_script) return { ok: false, status: 400, error: 'generate the script first' };
  if (!run.voiceover_voice_id) return { ok: false, status: 400, error: 'pick a voice first' };

  const { generateVoiceoverAudio } = await import('../voiceover/generate-audio.js');

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

    // Duration audit: the audio must fit the video. If it overruns the target by
    // >1s, ask Claude to shorten naturally and re-render — at most 2 attempts,
    // then proceed with a warning.
    const targetSec = run.duration_seconds ?? 30;
    const toleranceMs = 1000;
    let shortenUnavailable = false;
    if (durationMs > targetSec * 1000 + toleranceMs) {
      const { shortenDeliveryScript } = await import('./voiceover-script.js');
      const { countWords } = await import('../voiceover/generate-script.js');
      const { stripAudioTags } = await import('../voiceover/audio-tags.js');
      for (let attempt = 0; attempt < 2 && durationMs > targetSec * 1000 + toleranceMs; attempt++) {
        const fromWords = countWords(stripAudioTags(script));
        // A shorten or re-render failure must NOT discard the good audio we
        // already paid for: keep the last good {script, audio} pair (always
        // consistent — script is only swapped once its audio exists) and fall
        // through to persist it with a warning.
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
        await recordMlEvent(runId, 'script_edit', {
          source: 'auto_shorten',
          from_words: fromWords,
          to_words: countWords(stripAudioTags(script)),
          target_seconds: targetSec,
        });
      }
    }

    // Persist the script actually spoken so the UI matches the audio.
    const updated = await updateRun(runId, { voiceover_script: script, voiceover_audio_url: audioUrl } as never);
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
    await setRunError(runId, `Voiceover audio failed twice: ${msg} — you can skip (assembly proceeds without VO).`);
    return { ok: false, status: 502, error: msg };
  }
}
