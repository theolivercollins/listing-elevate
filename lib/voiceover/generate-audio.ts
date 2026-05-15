/**
 * ElevenLabs TTS generator.
 *
 * Uses the eleven_multilingual_v2 model (highest-quality stable, ~$0.60/1k chars).
 * The MP3 binary is uploaded to Supabase storage at:
 *   voiceovers/{propertyId|"preview"}/{Date.now()}.mp3
 *
 * Cost formula: ceil(chars / 1000 * 60) cents (60¢ per 1k chars for multilingual_v2).
 * Example: 150-word script ≈ 800 chars → ceil(0.8 * 60) = 48¢.
 */

import { getSupabase, recordCostEvent } from "../db.js";

const ELEVENLABS_API = "https://api.elevenlabs.io/v1/text-to-speech";
// Highest-quality stable model. eleven_v3 is alpha and not all
// pre-built voices support it yet — flip when GA.
const MODEL_ID = "eleven_multilingual_v2";

export interface GenerateAudioInput {
  script: string;
  voiceId: string;
  /** Pass property UUID for confirmed orders, or "preview" for the preview flow. */
  propertyId: string | null;
  /** Folder prefix in storage: "preview" for temp files, property UUID otherwise. */
  storageFolder?: string;
}

export interface GenerateAudioResult {
  audioUrl: string;
  /** Estimated duration derived from character count at 15 chars/sec average. */
  durationMs: number;
}

export async function generateVoiceoverAudio(
  input: GenerateAudioInput,
): Promise<GenerateAudioResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY env var is not set");

  const { script, voiceId, propertyId, storageFolder } = input;
  const folder = storageFolder ?? propertyId ?? "preview";

  // Call ElevenLabs TTS REST API.
  const res = await fetch(`${ELEVENLABS_API}/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: script,
      model_id: MODEL_ID,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${errText}`);
  }

  const audioBuffer = Buffer.from(await res.arrayBuffer());

  // Upload to Supabase storage.
  const supabase = getSupabase();
  const storagePath = `${folder}/${Date.now()}.mp3`;

  const { error: uploadErr } = await supabase.storage
    .from("voiceovers")
    .upload(storagePath, audioBuffer, {
      contentType: "audio/mpeg",
      upsert: true,
    });

  if (uploadErr) {
    throw new Error(`Supabase storage upload failed: ${uploadErr.message}`);
  }

  const { data: urlData } = supabase.storage
    .from("voiceovers")
    .getPublicUrl(storagePath);

  const audioUrl = urlData.publicUrl;

  // Compute cost: ceil(chars / 1000 * 30) cents.
  const chars = script.length;
  const costCents = Math.ceil((chars / 1000) * 60);
  // Rough duration estimate: ~15 chars/sec average narration pace.
  const durationMs = Math.round((chars / 15) * 1000);

  await recordCostEvent({
    propertyId,
    stage: "assembly",
    provider: "elevenlabs",
    unitsConsumed: chars,
    unitType: "characters",
    costCents,
    metadata: {
      model: MODEL_ID,
      voiceId,
      chars,
      storagePath,
    },
  }).catch((e) => console.error("[voiceover/audio] cost_event insert failed:", e));

  return { audioUrl, durationMs };
}
