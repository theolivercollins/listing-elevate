/**
 * lib/delivery/music-gen.ts
 *
 * Reusable core of the delivery pipeline's AI music generation + feedback
 * loop. Extracted verbatim from api/admin/studio/delivery/[runId].ts (the
 * 'generate_music' and 'music_feedback' action bodies) so the Telegram
 * refine executor (lib/telegram/refine-execute.ts) calls the EXACT same
 * logic the human Operator Studio route uses — no parallel implementation,
 * no behavior drift. The route now imports these two functions instead of
 * carrying its own copies; this is a pure move, not a behavior change.
 *
 * generateMusicVariantsForRun: fires 4 composeMusic() calls in parallel (one
 * per GENRE_VARIANTS entry), stores each as a music_tracks row, and falls
 * back to a random active library track if all 4 fail. Every composeMusic()
 * call already records its own cost_event (lib/providers/elevenlabs-music.ts)
 * — this file does not double-record cost.
 *
 * recordMusicTrackFeedback: upserts a music_track_feedback row and, on a
 * 'down' verdict against an AI-generated track, deactivates it so future
 * generations/picks stop offering it. Library tracks are never
 * auto-deactivated (curated pool stays intact).
 */

import { getSupabase } from '../client.js';
import { getRun, updateRun, recordMlEvent, setRunError } from './runs.js';
import { moodForPackage, pickRandom } from '../assembly/music.js';
import {
  composeMusic, GENRE_VARIANTS, buildFeedbackBlock, buildGenrePrompt, MOOD_PROMPTS,
} from '../providers/elevenlabs-music.js';

export interface MusicTrackOption {
  id: string;
  name: string;
  file_url: string;
  mood_tag: string;
  source: string;
  genre: string | null;
}

export interface GenerateMusicBody {
  tracks: MusicTrackOption[];
  failures: number;
  fallback?: boolean;
  warning?: string;
}

export type GenerateMusicResult =
  | { ok: true; status: 200 | 201; body: GenerateMusicBody }
  | { ok: false; status: number; error: string };

interface LibraryTrackRow {
  id: string;
  name: string;
  file_url: string;
  mood_tag: string;
  source: string;
}

/**
 * Generate 4 AI genre variants (acoustic/orchestral/ambient/modern) of the
 * run's mood music and store them as music_tracks rows. Falls back to a
 * random active library track (and applies it directly to the run) if every
 * generation fails.
 */
export async function generateMusicVariantsForRun(runId: string): Promise<GenerateMusicResult> {
  const run = await getRun(runId);
  if (!run) return { ok: false, status: 404, error: 'not_found' };

  const mood = moodForPackage(run.video_type);
  const lengthMs = Math.max((run.duration_seconds ?? 30) * 1000, 15_000) + 5_000;
  const db = getSupabase();

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
  type SettledResult = { status: 'fulfilled'; value: MusicTrackOption } | { status: 'rejected'; reason: unknown };

  const today = new Date().toISOString().slice(0, 10);
  const results = (await Promise.allSettled(
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
      return track as MusicTrackOption;
    }),
  )) as SettledResult[];

  const successTracks = results
    .filter((r): r is { status: 'fulfilled'; value: MusicTrackOption } => r.status === 'fulfilled')
    .map((r) => r.value);
  const failures = results.filter((r) => r.status === 'rejected').length;

  if (successTracks.length > 0) {
    const warning = failures > 0 ? `${failures} of 4 generations failed` : undefined;
    const body: GenerateMusicBody = { tracks: successTracks, failures };
    if (warning) body.warning = warning;
    return { ok: true, status: 201, body };
  }

  // All 4 failed — fall back to library.
  const firstError = results.find((r) => r.status === 'rejected');
  const msg = firstError?.status === 'rejected'
    ? (firstError.reason instanceof Error ? firstError.reason.message : String(firstError.reason))
    : 'All 4 music generations failed';

  const { data: moodPool } = await db.from('music_tracks').select('id, name, file_url, mood_tag, source').eq('mood_tag', mood).eq('active', true).neq('source', 'elevenlabs_music');
  const { data: neutralPool } = await db.from('music_tracks').select('id, name, file_url, mood_tag, source').eq('mood_tag', 'neutral').eq('active', true).neq('source', 'elevenlabs_music');
  const { data: anyPool } = await db.from('music_tracks').select('id, name, file_url, mood_tag, source').eq('active', true).neq('source', 'elevenlabs_music');

  const fallbackRow = pickRandom(moodPool ?? []) ?? pickRandom(neutralPool ?? []) ?? pickRandom(anyPool ?? []);
  if (!fallbackRow) {
    await setRunError(runId, `Music generation failed: ${msg} — pick a library track or skip.`);
    return { ok: false, status: 502, error: msg };
  }

  await updateRun(runId, { music_track_id: (fallbackRow as LibraryTrackRow).id } as never);
  await recordMlEvent(runId, 'music_choice', {
    music_track_id: (fallbackRow as LibraryTrackRow).id,
    source: 'library_fallback',
    generation_error: msg,
  });
  const fallbackTrack: MusicTrackOption = { ...(fallbackRow as LibraryTrackRow), genre: null };
  return { ok: true, status: 200, body: { tracks: [fallbackTrack], failures: 4, fallback: true, warning: msg } };
}

export type MusicFeedbackResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Record operator/telegram feedback on a music track: upsert
 * music_track_feedback, then (verdict='down' AND source='elevenlabs_music'
 * only) deactivate the track so it stops being offered again. Library
 * tracks are never auto-deactivated — only the curated AI-generated pool is
 * pruned this way.
 *
 * Callers own their OWN input validation (trackId non-empty, verdict is
 * 'up'|'down') — this function assumes already-validated arguments, matching
 * how the route calls it after its own 400 checks.
 */
export async function recordMusicTrackFeedback(
  runId: string,
  trackId: string,
  verdict: 'up' | 'down',
  comment: string | null,
): Promise<MusicFeedbackResult> {
  const db = getSupabase();

  // Fetch the track to denormalize mood/genre/prompt.
  const { data: trackRow } = await db
    .from('music_tracks')
    .select('id, mood_tag, genre, prompt, source, active')
    .eq('id', trackId)
    .maybeSingle();
  const track = trackRow as { id: string; mood_tag: string | null; genre: string | null; prompt: string | null; source: string; active: boolean } | null;

  // Upsert: conflict on (run_id, track_id) → update verdict/comment.
  // A failed write must surface as an error — returning ok would let the
  // caller believe a verdict was stored when it never reaches prompts.
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
    console.error('[music-gen] music_track_feedback upsert failed:', feedbackErr);
    return { ok: false, status: 500, error: `feedback save failed: ${feedbackErr.message}` };
  }

  await recordMlEvent(runId, 'music_feedback', {
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
      console.error('[music-gen] music_track deactivation failed (non-fatal):', deactivateErr);
    }
  }

  return { ok: true };
}
