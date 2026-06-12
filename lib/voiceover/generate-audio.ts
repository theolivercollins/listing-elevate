/**
 * ElevenLabs TTS generator.
 *
 * Defaults to the eleven_v3 model (GA Feb 2026) — the most human/expressive
 * voice model, with support for inline audio tags (e.g. [warmly], [pause]).
 * Overridable via the ELEVENLABS_MODEL_ID env var so we can flip back to
 * eleven_multilingual_v2 without a deploy if a given voice 404s on v3 or if
 * v3 latency hurts the live preview UX.
 *
 * The MP3 binary is uploaded to Supabase storage at:
 *   voiceovers/{propertyId|"preview"}/{Date.now()}.mp3
 *
 * Cost formula: ceil(chars / 1000 * 60) cents (1 credit/char on v3 +
 * multilingual_v2; 60¢/1k chars is our accounting placeholder — reconcile
 * against the ElevenLabs invoice). Example: 150-word script ≈ 800 chars →
 * ceil(0.8 * 60) = 48¢.
 */

import { getSupabase, recordCostEvent } from "../db.js";
import { stripAudioTags } from "./audio-tags.js";
import { VOICES } from "./voices.js";

const ELEVENLABS_API = "https://api.elevenlabs.io/v1/text-to-speech";
// eleven_v3: most expressive/human, supports audio tags. Env-overridable.
const DEFAULT_MODEL_ID = "eleven_v3";
// Client/cloned voices are best served by eleven_multilingual_v2 (v3 distorts
// cloned voices). Env-overridable independently of stock model.
const CLIENT_VOICE_DEFAULT_MODEL_ID = "eleven_multilingual_v2";

// Must stay in sync with the output_format sent to ElevenLabs below
// (mp3_44100_128 = CBR MP3 @ 128 kbps), so byte length maps to duration.
const OUTPUT_FORMAT = "mp3_44100_128";
const OUTPUT_BITRATE_KBPS = 128;

/** Pre-built stock voice IDs from the VOICES catalog. */
const STOCK_VOICE_ID_SET = new Set(VOICES.map((v) => v.id));

/**
 * Duration of a CBR MP3 from its byte length: bytes * 8 bits / bitrate.
 * At kbps granularity that's exactly `bytes * 8 / kbps` milliseconds.
 * Accurate to within the ID3/frame-header overhead (negligible at our sizes).
 */
export function estimateMp3DurationMs(
  byteLength: number,
  bitrateKbps: number = OUTPUT_BITRATE_KBPS,
): number {
  if (byteLength <= 0 || bitrateKbps <= 0) return 0;
  return Math.round((byteLength * 8) / bitrateKbps);
}

/**
 * Resolve the ElevenLabs model to use for a given voice.
 *
 * - Stock voices (ids in the VOICES catalog) use `ELEVENLABS_MODEL_ID || eleven_v3`.
 * - Any other voice id is treated as a client/cloned voice and uses
 *   `ELEVENLABS_CLIENT_VOICE_MODEL_ID || eleven_multilingual_v2` — v3 distorts
 *   cloned voices, multilingual_v2 preserves them accurately.
 */
export function resolveModelId(voiceId: string): string {
  if (STOCK_VOICE_ID_SET.has(voiceId)) {
    return process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL_ID;
  }
  return process.env.ELEVENLABS_CLIENT_VOICE_MODEL_ID || CLIENT_VOICE_DEFAULT_MODEL_ID;
}

export interface GenerateAudioInput {
  script: string;
  voiceId: string;
  /** Pass property UUID for confirmed orders, or "preview" for the preview flow. */
  propertyId: string | null;
  /** Folder prefix in storage: "preview" for temp files, property UUID otherwise. */
  storageFolder?: string;
  /** When called from the delivery pipeline, tag the cost_event so it rolls up in the per-run breakdown. */
  deliveryRunId?: string | null;
}

export interface GenerateAudioResult {
  audioUrl: string;
  /** Measured duration derived from the MP3 byte length at the CBR bitrate. */
  durationMs: number;
}

export async function generateVoiceoverAudio(
  input: GenerateAudioInput,
): Promise<GenerateAudioResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY env var is not set");

  const { script, voiceId, propertyId, storageFolder, deliveryRunId } = input;
  const folder = storageFolder ?? propertyId ?? "preview";
  const modelId = resolveModelId(voiceId);
  const isV3 = modelId.startsWith("eleven_v3");

  // Audio tags (e.g. [warmly], [pause]) are a v3-only feature. On any
  // non-v3 model they'd be read literally or mishandled, so strip them.
  const text = isV3 ? script : stripAudioTags(script);

  // Call ElevenLabs TTS REST API.
  // v3 sits in the "Natural" stability zone (~0.5) with light style for a
  // warm, human read; use_speaker_boost sharpens voice similarity.
  const res = await fetch(`${ELEVENLABS_API}/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      output_format: OUTPUT_FORMAT,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        ...(isV3 ? { style: 0.3, use_speaker_boost: true } : {}),
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

  // Compute cost: ceil(chars / 1000 * 60) cents. Bill on the text actually
  // sent (tags stripped for non-v3) since that's what ElevenLabs charges for.
  const chars = text.length;
  const costCents = Math.ceil((chars / 1000) * 60);
  // Real duration measured from the MP3 buffer (CBR @ OUTPUT_BITRATE_KBPS).
  const durationMs = estimateMp3DurationMs(audioBuffer.byteLength);

  await recordCostEvent({
    propertyId,
    stage: "assembly",
    provider: "elevenlabs",
    unitsConsumed: chars,
    unitType: "characters",
    costCents,
    metadata: {
      model: modelId,
      voiceId,
      chars,
      storagePath,
      ...(deliveryRunId ? { delivery_run_id: deliveryRunId } : {}),
    },
  }).catch((e) => console.error("[voiceover/audio] cost_event insert failed:", e));

  return { audioUrl, durationMs };
}
