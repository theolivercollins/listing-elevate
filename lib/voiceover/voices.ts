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
  gender: "male" | "female";
  description: string;
  /** Preview MP3 URL hosted by ElevenLabs — present for pre-built voices. */
  sampleUrl?: string;
}

export const VOICES: Voice[] = [
  { id: "UgBBYS2sOqTuMpoF3BR0", name: "Mark",  gender: "male", description: "Natural, conversational" },
  { id: "dtSEyYGNJqjrtBArPCVZ", name: "Titan", gender: "male", description: "Deep, commanding narrator" },
];

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
