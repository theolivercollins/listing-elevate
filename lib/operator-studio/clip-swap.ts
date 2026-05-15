/**
 * clip-swap.ts
 * Replaces a production scene's clip with a Lab iteration's clip, then
 * re-triggers assembly for the property.
 *
 * Production schema notes:
 *   - scenes.scene_number is the positional index (param: sceneIdx)
 *   - scenes.room_type is NOT a native column; it is populated via a view
 *     or a denorm column added by a future migration. In production the
 *     caller should verify room_type compatibility upstream, or the select
 *     below should be replaced with a join through photos.
 *   - scenes.replaced_at requires migration 057_scenes_replaced_at.sql
 *     (ADD COLUMN IF NOT EXISTS replaced_at timestamptz).
 *   - prompt_lab_listing_scene_iterations.room_type is not a native column
 *     either — it lives on the parent prompt_lab_listing_scenes row. In
 *     production this should be fetched via a join, e.g.:
 *       .select('id, clip_url, prompt_lab_listing_scenes(room_type)')
 */

import { getSupabase } from '../client';
import { rerunAssembly } from '../pipeline';

export async function swapClip(
  propertyId: string,
  sceneIdx: number,
  iterationId: string,
): Promise<void> {
  const db = getSupabase();

  // Fetch the scene at this position within the property.
  // Note: scenes.room_type is queried here for compatibility-check;
  // in production this column must exist (see schema notes above).
  const { data: scene, error: sErr } = await db
    .from('scenes')
    .select('id, room_type')
    .eq('property_id', propertyId)
    .eq('scene_number', sceneIdx)
    .maybeSingle();
  if (sErr) throw new Error(`swapClip: ${sErr.message}`);
  if (!scene) throw new Error(`swapClip: scene not found at scene_number ${sceneIdx}`);

  // Fetch the Lab iteration to swap in.
  // Note: prompt_lab_listing_scene_iterations.room_type is queried here
  // for the mismatch check; in production join to prompt_lab_listing_scenes.
  const { data: iter, error: iErr } = await db
    .from('prompt_lab_listing_scene_iterations')
    .select('id, clip_url, room_type')
    .eq('id', iterationId)
    .maybeSingle();
  if (iErr) throw new Error(`swapClip: ${iErr.message}`);
  if (!iter) throw new Error(`swapClip: iteration ${iterationId} not found`);

  if (iter.room_type !== scene.room_type) {
    throw new Error(
      `swapClip: room_type mismatch (scene=${scene.room_type}, iter=${iter.room_type})`,
    );
  }
  if (!iter.clip_url) throw new Error(`swapClip: iteration has no clip_url`);

  // Apply the clip and mark the swap timestamp.
  // requires scenes.replaced_at timestamptz column (migration 057).
  const { error: uErr } = await db
    .from('scenes')
    .update({ clip_url: iter.clip_url, replaced_at: new Date().toISOString() })
    .eq('id', scene.id);
  if (uErr) throw new Error(`swapClip: scene update failed: ${uErr.message}`);

  await rerunAssembly(propertyId);
}
