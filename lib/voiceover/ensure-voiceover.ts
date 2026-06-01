/**
 * Pipeline voiceover auto-trigger.
 *
 * The order form sets `properties.add_voiceover = true` when the customer buys
 * the AI-voiceover add-on, but historically nothing in the render pipeline acted
 * on that flag — narration was only ever produced if the customer manually
 * clicked "Generate" in the form (which writes `voiceover_url`). So a paid
 * add-on silently produced a silent video.
 *
 * `ensureVoiceover` closes that gap: called from the assembly step, it generates
 * the script + MP3 and persists `voiceover_url` when the add-on is on and no
 * audio exists yet. Idempotent and best-effort — a failure logs and returns the
 * existing (possibly null) URL rather than failing the whole render.
 */

import { getSupabase } from "../db.js";
import type { Property } from "../types.js";
import { generateVoiceoverScript } from "./generate-script.js";
import { generateVoiceoverAudio } from "./generate-audio.js";
import { defaultVoiceId, isValidVoiceId } from "./voices.js";
import { scrapeCompassDescription } from "./scrape-compass.js";

type VoiceoverProperty = Pick<
  Property,
  | "id"
  | "address"
  | "price"
  | "bedrooms"
  | "bathrooms"
  | "brokerage"
  | "selected_package"
  | "selected_duration"
  | "add_voiceover"
  | "voiceover_url"
  | "voiceover_voice_id"
  | "voiceover_compass_url"
  | "custom_request_text"
>;

const VALID_DURATIONS = new Set([15, 30, 60]);

function resolveDuration(d: number | null | undefined): 15 | 30 | 60 {
  return d != null && VALID_DURATIONS.has(d) ? (d as 15 | 30 | 60) : 30;
}

function formatPackageLabel(pkg: string | null | undefined): string {
  if (!pkg) return "Just Listed";
  return pkg
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Build a listing description from the structured property fields when no
 * Compass URL is available to scrape. Good enough for the script writer to
 * produce a warm narration grounded in the real listing facts.
 */
export function synthesizeDescription(p: VoiceoverProperty): string {
  const parts: string[] = [];
  parts.push(`${p.address}.`);
  const beds = p.bedrooms ? `${p.bedrooms} bedroom` + (p.bedrooms === 1 ? "" : "s") : null;
  const baths = p.bathrooms ? `${p.bathrooms} bathroom` + (p.bathrooms === 1 ? "" : "s") : null;
  const bedBath = [beds, baths].filter(Boolean).join(", ");
  if (bedBath) parts.push(`A home featuring ${bedBath}.`);
  if (p.price && p.price > 0) parts.push(`Offered at $${p.price.toLocaleString()}.`);
  if (p.brokerage) parts.push(`Presented by ${p.brokerage}.`);
  if (p.custom_request_text) parts.push(p.custom_request_text);
  return parts.join(" ");
}

export interface EnsureVoiceoverResult {
  voiceoverUrl: string | null;
  generated: boolean;
}

/**
 * Ensure a voiceover MP3 exists for a property when the add-on is enabled.
 * No-op (returns the existing URL) when the add-on is off or audio already
 * exists. Persists `voiceover_url` + `voiceover_script` on success.
 */
export async function ensureVoiceover(
  property: VoiceoverProperty,
  logFn?: (level: "info" | "warn", msg: string) => Promise<void> | void,
): Promise<EnsureVoiceoverResult> {
  const log = async (level: "info" | "warn", msg: string) => {
    try {
      await logFn?.(level, msg);
    } catch {
      /* logging is best-effort */
    }
  };

  if (!property.add_voiceover) {
    return { voiceoverUrl: property.voiceover_url ?? null, generated: false };
  }
  if (property.voiceover_url) {
    // Preview flow already produced narration — reuse it.
    return { voiceoverUrl: property.voiceover_url, generated: false };
  }

  const durationSec = resolveDuration(property.selected_duration);
  const voiceId =
    property.voiceover_voice_id && isValidVoiceId(property.voiceover_voice_id)
      ? property.voiceover_voice_id
      : defaultVoiceId();

  try {
    // Resolve a description: scrape Compass if a URL was provided, else
    // synthesize from the property's structured fields.
    let description: string;
    if (property.voiceover_compass_url) {
      try {
        const scraped = await scrapeCompassDescription(property.voiceover_compass_url, null);
        description = scraped.description?.trim() || synthesizeDescription(property);
      } catch {
        await log("warn", "Compass scrape failed for voiceover — using synthesized description");
        description = synthesizeDescription(property);
      }
    } else {
      description = synthesizeDescription(property);
    }

    const { script } = await generateVoiceoverScript({
      description,
      durationSec,
      address: property.address,
      packageLabel: formatPackageLabel(property.selected_package),
      propertyId: property.id,
    });

    const { audioUrl } = await generateVoiceoverAudio({
      script,
      voiceId,
      propertyId: property.id,
      storageFolder: property.id,
    });

    const { error } = await getSupabase()
      .from("properties")
      .update({ voiceover_url: audioUrl, voiceover_script: script, voiceover_voice_id: voiceId })
      .eq("id", property.id);
    if (error) {
      await log("warn", `Voiceover generated but DB persist failed: ${error.message}`);
    }

    await log("info", `Voiceover generated (${voiceId}, ${durationSec}s)`);
    return { voiceoverUrl: audioUrl, generated: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await log("warn", `Voiceover generation failed (${msg}) — proceeding without narration`);
    return { voiceoverUrl: null, generated: false };
  }
}
