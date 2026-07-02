/**
 * ElevenLabs pre-built voice catalog for AI voiceover.
 *
 * Voice IDs sourced from the ElevenLabs public pre-built catalog (verified 2026-05).
 * If a voice returns 404, swap voice_id here — swapping in one place updates all call sites.
 *
 * Pricing reference: eleven_turbo_v2_5 ~$0.30/1k chars (~3¢ per 100 chars).
 */

export interface Voice {
  /** ElevenLabs voice_id as returned by GET /v1/voices */
  id: string;
  name: string;
  /** "custom" = a client's own cloned/custom ElevenLabs voice (not in the catalog). */
  gender: "male" | "female" | "custom";
  description: string;
  /** Preview MP3 URL hosted by ElevenLabs — present for pre-built voices. */
  sampleUrl?: string;
}

export const VOICES: Voice[] = [
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian",   gender: "male",   description: "Deep, resonant, comforting narrator" },
  { id: "UgBBYS2sOqTuMpoF3BR0", name: "Mark",    gender: "male",   description: "Natural, conversational" },
  { id: "dtSEyYGNJqjrtBArPCVZ", name: "Jack",    gender: "male",   description: "Deep, commanding narrator" },
  { id: "F7hCTbeEDbm7osolS21j", name: "Amanda",  gender: "female", description: "Warm, polished, informative" },
  { id: "kdmDKE6EkgrWrrykO9Qt", name: "Jessica", gender: "female", description: "Young, conversational, natural" },
];

/**
 * Default narrator for the pipeline auto-trigger when the order didn't pick a
 * voice (and the fallback target when the LLM's tone pick doesn't match a
 * catalog name). Brian — deep, resonant, comforting — is the house default
 * male narrator for real estate. Override via ELEVENLABS_DEFAULT_VOICE_ID.
 *
 * Voice ID verified live 2026-06-30 against GET /v1/voices
 * (xi-api-key) — ElevenLabs premade voice "Brian - Deep, Resonant and
 * Comforting", category "premade", labels.gender "male".
 */
export function defaultVoiceId(): string {
  const env = process.env.ELEVENLABS_DEFAULT_VOICE_ID;
  if (env && isValidVoiceId(env)) return env;
  return "nPczCjzI2devNBz1zQrb"; // Brian
}

/** Valid voice IDs — used for fast validation without iterating. */
const VOICE_ID_SET = new Set(VOICES.map((v) => v.id));

export function getVoice(id: string): Voice | undefined {
  return VOICES.find((v) => v.id === id);
}

export function isValidVoiceId(id: string): boolean {
  return VOICE_ID_SET.has(id);
}

/** Word budgets keyed by duration in seconds (~150 wpm narration). */
export const WORD_BUDGET: Record<number, number> = {
  15: 37,
  30: 75,
  60: 150,
};
