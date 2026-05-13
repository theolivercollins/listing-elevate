/**
 * Music track selection for assembled videos.
 *
 * Resolution priority:
 *  1. Explicit `properties.music_track_id` — operator picked, honor it.
 *  2. Mood derived from `properties.selected_package` — auto-pick from
 *     the active library:
 *       just_listed  -> upbeat
 *       just_pended  -> cinematic
 *       just_closed  -> celebratory
 *       life_cycle   -> warm  (covers all three phases of the campaign)
 *  3. Fallback: any active 'neutral' track.
 *  4. If the library has no active rows at all -> null (no music element).
 *
 * Return shape includes only what the timeline builder needs. Callers
 * should pass the URL into the Creatomate audio element (track index 5
 * by convention) at low volume.
 */

import { getSupabase } from "../db.js";

export type MoodTag = "upbeat" | "warm" | "celebratory" | "cinematic" | "neutral";

export interface MusicTrack {
  id: string;
  name: string;
  fileUrl: string;
  moodTag: MoodTag;
}

const PACKAGE_TO_MOOD: Record<string, MoodTag> = {
  just_listed: "upbeat",
  just_pended: "cinematic",
  just_closed: "celebratory",
  life_cycle: "warm",
};

/** Pure mapping helper — exposed for testing. */
export function moodForPackage(pkg: string | null | undefined): MoodTag {
  if (pkg && PACKAGE_TO_MOOD[pkg]) return PACKAGE_TO_MOOD[pkg];
  return "neutral";
}

/**
 * Resolve which track to play under a property's assembled video.
 * Returns null when the library is empty or nothing matches — caller
 * should skip the audio element in that case.
 */
export async function selectMusicTrackForProperty(
  propertyId: string,
): Promise<MusicTrack | null> {
  const supabase = getSupabase();

  // 1. Operator-pinned track wins.
  const { data: prop } = await supabase
    .from("properties")
    .select("music_track_id, selected_package")
    .eq("id", propertyId)
    .maybeSingle();

  if (prop?.music_track_id) {
    const { data: pinned } = await supabase
      .from("music_tracks")
      .select("id, name, file_url, mood_tag")
      .eq("id", prop.music_track_id)
      .eq("active", true)
      .maybeSingle();
    if (pinned) {
      return {
        id: pinned.id as string,
        name: pinned.name as string,
        fileUrl: pinned.file_url as string,
        moodTag: pinned.mood_tag as MoodTag,
      };
    }
    // Pinned track was deactivated — fall through to auto-pick.
  }

  const mood = moodForPackage(prop?.selected_package as string | null | undefined);

  // 2. Auto-pick by mood.
  const { data: matchByMood } = await supabase
    .from("music_tracks")
    .select("id, name, file_url, mood_tag")
    .eq("mood_tag", mood)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (matchByMood) {
    return {
      id: matchByMood.id as string,
      name: matchByMood.name as string,
      fileUrl: matchByMood.file_url as string,
      moodTag: matchByMood.mood_tag as MoodTag,
    };
  }

  // 3. Fall back to neutral.
  const { data: neutral } = await supabase
    .from("music_tracks")
    .select("id, name, file_url, mood_tag")
    .eq("mood_tag", "neutral")
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (neutral) {
    return {
      id: neutral.id as string,
      name: neutral.name as string,
      fileUrl: neutral.file_url as string,
      moodTag: neutral.mood_tag as MoodTag,
    };
  }

  // 4. Library empty — no music.
  return null;
}
