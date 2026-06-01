/**
 * Generate the ElevenLabs Music pool (C-pooled music strategy).
 *
 * For each mood, generates N instrumental tracks via the Eleven Music API,
 * uploads them to the public `music` storage bucket, inserts `music_tracks`
 * rows (source='elevenlabs_music'), and deactivates the SoundHelix placeholder
 * rows so the pipeline picks real tracks.
 *
 * This SPENDS real ElevenLabs credits (~$0.50/min × tracks). Dry-run by default;
 * pass --run to actually generate. One-time operational tool — run with
 * ELEVENLABS_API_KEY + Supabase service-role env set.
 *
 *   pnpm exec tsx scripts/generate-music-pool.ts            # dry run (no spend)
 *   pnpm exec tsx scripts/generate-music-pool.ts --run      # generate 5/mood
 *   pnpm exec tsx scripts/generate-music-pool.ts --run --per-mood 3 --length 40
 */

import { getSupabase } from "../lib/db.js";
import { composeMusic, MOOD_PROMPTS } from "../lib/providers/elevenlabs-music.js";
import type { MoodTag } from "../lib/assembly/music.js";

const MOODS: MoodTag[] = ["upbeat", "warm", "celebratory", "cinematic", "neutral"];
const BUCKET = "music";

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return Number(process.argv[i + 1]);
  return fallback;
}

async function ensureBucket() {
  const supabase = getSupabase();
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.some((b) => b.id === BUCKET)) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
    if (error && !/already exists/i.test(error.message)) throw error;
    console.log(`Created public bucket '${BUCKET}'`);
  }
}

async function main() {
  const run = process.argv.includes("--run");
  const perMood = arg("per-mood", 5);
  const lengthSec = arg("length", 40);
  const lengthMs = lengthSec * 1000;

  console.log(
    `${run ? "GENERATING" : "DRY RUN"} — ${perMood} tracks/mood × ${MOODS.length} moods = ${perMood * MOODS.length} tracks @ ${lengthSec}s`,
  );
  console.log(`Estimated spend: ~$${((perMood * MOODS.length * lengthSec) / 60 * 0.5).toFixed(2)}`);

  if (!run) {
    for (const mood of MOODS) {
      console.log(`\n[${mood}] prompt: ${MOOD_PROMPTS[mood].slice(0, 80)}…`);
    }
    console.log("\nDry run complete. Re-run with --run to generate + upload.");
    return;
  }

  const supabase = getSupabase();
  await ensureBucket();

  let inserted = 0;
  for (const mood of MOODS) {
    for (let i = 1; i <= perMood; i++) {
      const prompt = MOOD_PROMPTS[mood];
      process.stdout.write(`[${mood}] track ${i}/${perMood} … `);
      const { audio } = await composeMusic(prompt, lengthMs, { propertyId: null });
      const path = `${mood}/${Date.now()}-${i}.mp3`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, audio, { contentType: "audio/mpeg", upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const { error: insErr } = await supabase.from("music_tracks").insert({
        name: `${mood.charAt(0).toUpperCase() + mood.slice(1)} ${i}`,
        file_url: urlData.publicUrl,
        mood_tag: mood,
        duration_seconds: lengthSec,
        license: "ElevenLabs Music — commercial use (paid plan)",
        attribution: "AI-generated (ElevenLabs Music)",
        source: "elevenlabs_music",
        prompt,
        active: true,
      });
      if (insErr) throw insErr;
      inserted++;
      console.log("ok");
    }
  }

  // Deactivate the SoundHelix placeholder rows now that real tracks exist.
  const { error: deErr } = await supabase
    .from("music_tracks")
    .update({ active: false })
    .eq("source", "placeholder");
  if (deErr) console.warn("Failed to deactivate placeholders:", deErr.message);

  console.log(`\nDone. Inserted ${inserted} tracks; deactivated placeholders.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
