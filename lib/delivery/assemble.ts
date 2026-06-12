import { getSupabase } from '../client.js';
import { getRun, getVariantsForRun, advanceRun, setRunError } from './runs.js';

/**
 * Pure: reorder by an explicit id list. Ids present in `order` sort by their
 * index; ids missing from `order` (e.g. a scene added after the operator's
 * checkpoint-A draft was saved) fall to the end. Ties — multiple missing ids,
 * or any equal-position pair — break DETERMINISTICALLY by `scene_number` when
 * present, then by `id`, so assembly never depends on Array.prototype.sort
 * stability or the caller's input order.
 */
export function applySceneOrder<T extends { id: string; scene_number?: number }>(
  scenes: T[],
  order: string[] | null,
): T[] {
  if (!order || order.length === 0) return scenes;
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...scenes].sort((a, b) => {
    const pa = pos.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const pb = pos.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    const sa = a.scene_number ?? Number.MAX_SAFE_INTEGER;
    const sb = b.scene_number ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Stage side effect for 'assembling': write the run's choices onto the rows
 * the existing assembly path reads, then reuse rerunAssembly() verbatim.
 *  - winner B clips -> scenes.clip_url (swap-clip precedent)
 *  - run.music_track_id -> properties.music_track_id (selectMusicTrackForProperty picks it up)
 *  - run.voiceover_audio_url -> properties.voiceover_url (+ script/voice) so
 *    ensureVoiceover's "already exists" branch reuses it
 *  - listing details -> properties.price/bedrooms/bathrooms (overlay + script
 *    inputs). Note: the current Creatomate templates have NO price/beds/baths
 *    text placeholders (see lib/assembly/template-modifications.ts) and no
 *    sqft anywhere — sqft reaches the customer via the voiceover script only.
 * Then advances assembling -> checkpoint_b (rerunAssembly is synchronous —
 * it polls the Creatomate render to completion inside the call).
 */
export async function runAssembleStage(runId: string): Promise<void> {
  const supabase = getSupabase();
  const run = await getRun(runId);
  if (!run) throw new Error(`runAssembleStage: run not found: ${runId}`);
  if (run.stage !== 'assembling') {
    throw new Error(`runAssembleStage: run is in '${run.stage}', expected 'assembling'`);
  }

  try {
    // 1. Winner clips: where B won, point the scene at the B clip.
    const variants = await getVariantsForRun(runId);
    for (const v of variants.filter((x) => x.winner && x.variant === 'B' && x.clip_url)) {
      const { error } = await supabase
        .from('scenes')
        .update({ clip_url: v.clip_url, status: 'qc_pass' })
        .eq('id', v.scene_id);
      if (error) throw new Error(`winner clip write failed for scene ${v.scene_id}: ${error.message}`);
    }

    // 2. Property-level choices.
    const d = run.listing_details ?? {};
    const { error: propErr } = await supabase
      .from('properties')
      .update({
        music_track_id: run.music_track_id ?? null,
        ...(run.voiceover_audio_url
          ? {
              voiceover_url: run.voiceover_audio_url,
              voiceover_script: run.voiceover_script,
              voiceover_voice_id: run.voiceover_voice_id,
              add_voiceover: true,
            }
          : {}),
        ...(d.price != null ? { price: d.price } : {}),
        ...(d.beds != null ? { bedrooms: d.beds } : {}),
        ...(d.baths != null ? { bathrooms: d.baths } : {}),
      })
      .eq('id', run.property_id);
    if (propErr) throw new Error(`property write-back failed: ${propErr.message}`);

    // 3. Existing assembly path (records its own creatomate cost_events,
    //    metadata.reason = 'manual_rerun').
    const { rerunAssembly } = await import('../pipeline.js');
    await rerunAssembly(run.property_id);

    await advanceRun(runId, 'checkpoint_b');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setRunError(runId, `Assembly failed: ${msg}`);
    throw err;
  }
}
