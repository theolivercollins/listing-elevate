import {
  getSupabase,
  getProperty,
  getScenesForProperty,
  getUserVoiceClone,
  recordCostEvent,
  log,
} from "../db.js";
import { ElevenLabsProvider } from "../providers/elevenlabs.js";
import { generateVoiceoverScript } from "./script.js";

/**
 * Run the voiceover stage for a property.
 *
 * Returns { audioUrl, voiceIdUsed } on success, null if voiceover is disabled
 * or any step fails (voiceover is optional — assembly proceeds without it).
 */
export async function runVoiceover(
  propertyId: string,
): Promise<{ audioUrl: string; voiceIdUsed: string } | null> {
  try {
    // 1. Load property.
    const property = await getProperty(propertyId);

    // 2. No-op if voiceover is not requested.
    if (property.add_voiceover !== true) {
      return null;
    }

    // 3. Load scenes.
    const scenes = await getScenesForProperty(propertyId);

    // 4. Decide which voice to use.
    let voiceId = ElevenLabsProvider.DEFAULT_VOICE_ID;

    if (property.add_voice_clone === true && property.submitted_by) {
      const clone = await getUserVoiceClone(property.submitted_by).catch(() => null);
      if (clone?.status === "ready" && clone.voice_id) {
        voiceId = clone.voice_id;
        await log(propertyId, "assembly", "info", `Voiceover: using cloned voice ${voiceId}`);
      } else {
        console.warn(
          `[voiceover] add_voice_clone=true for property ${propertyId} but clone is not ready (status=${clone?.status ?? "null"}); falling back to default voice`,
        );
        await log(
          propertyId,
          "assembly",
          "warn",
          `Voiceover: voice clone not ready (status=${clone?.status ?? "null"}); using default voice`,
        );
      }
    }

    // 5. Generate the voiceover script via Claude.
    const rawDuration = property.selected_duration ?? 60;
    const durationSeconds: 15 | 30 | 60 =
      rawDuration === 15 ? 15 : rawDuration === 30 ? 30 : 60;

    await log(propertyId, "assembly", "info", `Voiceover: generating script (${durationSeconds}s)`);

    const { script, estimatedSpokenSeconds } = await generateVoiceoverScript({
      property,
      scenes,
      durationSeconds,
    });

    // 6. Generate audio via ElevenLabs TTS.
    await log(propertyId, "assembly", "info", `Voiceover: calling ElevenLabs TTS (voice=${voiceId})`);

    const provider = new ElevenLabsProvider();
    const { audioBuffer, chars, costCents, modelId } = await provider.textToSpeech({
      voiceId,
      text: script,
    });

    // 7. Upload mp3 to Supabase Storage.
    const storagePath = `${property.submitted_by ?? "unknown"}/${propertyId}.mp3`;
    const supabase = getSupabase();

    const { error: uploadError } = await supabase.storage
      .from("voiceovers")
      .upload(storagePath, audioBuffer, {
        contentType: "audio/mpeg",
        upsert: true,
      });
    if (uploadError) throw uploadError;

    const { data: signedData, error: signedError } = await supabase.storage
      .from("voiceovers")
      .createSignedUrl(storagePath, 60 * 60 * 24 * 365); // 1 year
    if (signedError || !signedData?.signedUrl) {
      throw signedError ?? new Error("Failed to create signed URL for voiceover");
    }
    const audioUrl = signedData.signedUrl;

    // 8. Update the property row with voiceover metadata.
    const { error: updateError } = await supabase
      .from("properties")
      .update({
        voiceover_script: script,
        voiceover_audio_url: audioUrl,
        voiceover_voice_id_used: voiceId,
        voiceover_chars: chars,
        voiceover_duration_seconds: estimatedSpokenSeconds,
        updated_at: new Date().toISOString(),
      })
      .eq("id", propertyId);
    if (updateError) throw updateError;

    // 9. Record TTS cost event.
    await recordCostEvent({
      propertyId,
      stage: "voiceover",
      provider: "elevenlabs",
      unitsConsumed: chars,
      unitType: null,
      costCents,
      metadata: {
        voice_id: voiceId,
        model_id: modelId,
        scope: "voiceover_tts",
      },
    });

    await log(
      propertyId,
      "assembly",
      "info",
      `Voiceover complete: ${chars} chars, ~${estimatedSpokenSeconds}s spoken, $${(costCents / 100).toFixed(4)} TTS cost`,
      { audioUrl, voiceId, chars, estimatedSpokenSeconds },
    );

    return { audioUrl, voiceIdUsed: voiceId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[voiceover] runVoiceover failed for ${propertyId}: ${msg}`);
    try {
      await log(propertyId, "assembly", "warn", `Voiceover failed (non-fatal): ${msg}`);
    } catch {
      // swallow secondary log error
    }
    // Voiceover is optional — don't throw.
    return null;
  }
}
