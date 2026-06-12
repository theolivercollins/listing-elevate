/**
 * Operator delivery — draft scene order via the walkthrough policy.
 *
 * Two entry points:
 *   - draftOrderFromWinners: pure helper (scene rows -> ordered ID array)
 *   - draftOrderForRun: DB wrapper (loads winner variants + room types, then calls the pure fn)
 *
 * The DB wrapper is imported by lib/delivery/judge.ts once judging completes
 * (Task 11 dynamic-imports `./order.js` with exactly the draftOrderForRun
 * signature). Winner filter: v.winner && v.clip_url — degraded winners always
 * have clip_url; failed pairs have no winner, so the returned order may be
 * shorter than the scene count (expected; checkpoint A UI handles it).
 */

import { getSupabase } from '../client.js';
import { orderScenesForAssembly } from '../assembly/scene-ordering.js';
import { getRun, getVariantsForRun } from './runs.js';
import type { RoomType } from '../types.js';

/** Pure: winner scenes -> ordered scene-id array via the walkthrough policy. */
export function draftOrderFromWinners(
  scenes: Array<{ id: string; scene_number: number; room_type: RoomType | null }>,
): string[] {
  return orderScenesForAssembly(scenes).map((s) => s.id as string);
}

/** DB wrapper: load the run's winner scenes (room types via photos) and order them. */
export async function draftOrderForRun(runId: string): Promise<string[]> {
  const supabase = getSupabase();
  const run = await getRun(runId);
  if (!run) throw new Error(`draftOrderForRun: run not found: ${runId}`);
  const variants = await getVariantsForRun(runId);
  const winnerSceneIds = Array.from(
    new Set(variants.filter((v) => v.winner && v.clip_url).map((v) => v.scene_id)),
  );
  if (winnerSceneIds.length === 0) return [];

  const { data: scenes } = await supabase
    .from('scenes')
    .select('id, scene_number, photo_id')
    .in('id', winnerSceneIds);
  const photoIds = Array.from(new Set((scenes ?? []).map((s) => s.photo_id)));
  const { data: photos } = await supabase
    .from('photos')
    .select('id, room_type')
    .in('id', photoIds);
  const roomByPhoto = new Map<string, RoomType | null>(
    (photos ?? []).map((p) => [p.id as string, (p.room_type as RoomType | null) ?? null]),
  );
  return draftOrderFromWinners(
    (scenes ?? []).map((s) => ({
      id: s.id as string,
      scene_number: s.scene_number as number,
      room_type: roomByPhoto.get(s.photo_id as string) ?? null,
    })),
  );
}
