/**
 * ElevenLabs v3 audio tags.
 *
 * v3 interprets inline bracketed directives — e.g. "[warmly] Welcome to..." —
 * as delivery cues. For real-estate narration we use a small, tasteful set of
 * warm/calm tags only; dramatic or character tags ([pirate voice], [shouts])
 * would sound wrong in a property video.
 *
 * Non-v3 models (eleven_multilingual_v2, flash, turbo) do NOT support tags and
 * would otherwise read them literally, so `stripAudioTags` removes any bracketed
 * directive before sending to those models.
 */

/** The only audio tags we instruct the script writer to use. */
export const REAL_ESTATE_AUDIO_TAGS = [
  "[warmly]",
  "[calmly]",
  "[softly]",
  "[gently]",
  "[enthusiastically]",
  "[pause]",
] as const;

/**
 * Remove any inline `[...]` audio tag from a script and tidy the whitespace
 * left behind. Conservative: only matches short bracketed tokens (≤30 chars,
 * no line breaks) so it never eats real bracketed prose.
 */
export function stripAudioTags(text: string): string {
  return text
    .replace(/\[[^\]\n]{1,30}\]/g, "")
    // collapse the double-spaces / leading spaces a removed tag leaves behind
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,!?;:])/g, "$1")
    .replace(/^[ \t]+/gm, "")
    .trim();
}
