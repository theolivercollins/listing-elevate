/**
 * Voiceover script generator using Claude Sonnet 4.6.
 *
 * Pricing (Sonnet 4.6): $3/M input tokens, $15/M output tokens.
 * A typical script generation is ~500 input + ~100 output tokens ≈ 0.03¢ total.
 * We still record the exact cost from the API response.
 */

import Anthropic from "@anthropic-ai/sdk";
import { computeClaudeCost } from "../utils/claude-cost.js";
import { recordCostEvent } from "../db.js";
import { WORD_BUDGET } from "./voices.js";
import { stripAudioTags } from "./audio-tags.js";

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You write welcoming real-estate listing-video voiceover scripts.
STRICT word budget: {wordBudget} words maximum. Count carefully — the spoken read at ~150 wpm must fit the duration.

Required structure:
1. OPEN by naming the property in a fresh construction — lead with a standout feature, the lifestyle, or the setting, e.g. "Waterfront mornings come standard at <street address>" or "Tucked on a quiet cul-de-sac, <street address> delivers …". Do NOT open with "Welcome to" or "Step inside".
2. MIDDLE — use "featuring", "boasting", or "with" to flow into 3–5 of the most distinctive features from the listing description (waterfront, pool, square footage, kitchen, view, etc.). Prefer flowing prose over staccato fragments.
3. CLOSE with one short, inviting line tied to the package (e.g. "Just listed" / "Just sold" / "Now pending").

Tone: warm, inviting, real-estate-classic. Connected sentences, not bullet points.
Output the script ONLY — no preamble, no quotes, no commentary, no stage directions.`;

// Appended only when audio tags are enabled (ElevenLabs v3 target).
const AUDIO_TAGS_INSTRUCTION = `

DELIVERY CUES (ElevenLabs v3 audio tags): sprinkle in 2–4 inline bracketed cues to make the read warm and human. Use ONLY these: [warmly], [calmly], [softly], [gently], [enthusiastically], [pause]. Place a [warmly] at the open and a [pause] before the closing line; otherwise use sparingly. Do NOT use any other bracketed tags. Tags do NOT count toward the word budget.`;

export interface GenerateScriptInput {
  description: string;
  durationSec: 15 | 30 | 60;
  address: string;
  packageLabel: string;
  propertyId: string | null;
  /**
   * Emit inline v3 audio tags ([warmly], [pause], …). Default true.
   * Set false when the TTS target is a non-v3 model that can't parse tags.
   */
  audioTags?: boolean;
}

export interface GenerateScriptResult {
  script: string;
  wordCount: number;
}

/**
 * Trim a script to at most `n` words, ending on a complete sentence.
 *
 * Slices to the word budget, then cuts at the LAST sentence boundary
 * (`.` / `!` / `?` followed by whitespace or end-of-slice — so decimals like
 * "$1.2" don't count) within the slice. If no boundary exists in the slice,
 * keeps the word slice and appends "." so the read at least ends cleanly
 * instead of chopping mid-sentence.
 */
export function trimToWordBudget(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  const sliced = words.slice(0, maxWords).join(" ");

  let lastBoundary = -1;
  const boundaryRe = /[.!?](?=\s|$)/g;
  for (let m = boundaryRe.exec(sliced); m; m = boundaryRe.exec(sliced)) {
    lastBoundary = m.index;
  }
  if (lastBoundary > 0) return sliced.slice(0, lastBoundary + 1);
  return `${sliced}.`;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export async function generateVoiceoverScript(
  input: GenerateScriptInput,
): Promise<GenerateScriptResult> {
  const { description, durationSec, address, packageLabel, propertyId } = input;
  const audioTags = input.audioTags ?? true;
  const wordBudget = WORD_BUDGET[durationSec] ?? 75;

  const systemPrompt =
    SYSTEM_PROMPT.replace("{wordBudget}", String(wordBudget)) +
    (audioTags ? AUDIO_TAGS_INSTRUCTION : "");

  const userMessage = `Property: ${address}
Package: ${packageLabel}
Duration: ${durationSec} seconds (≤${wordBudget} words)

Listing description:
${description}

Write a ${durationSec}-second voiceover script.`;

  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const rawText =
    response.content[0]?.type === "text" ? response.content[0].text.trim() : "";

  if (!rawText) throw new Error("Script generation returned empty text");

  // Enforce word budget as defense-in-depth — model occasionally runs long.
  // Count SPOKEN words (tags excluded) so audio tags don't eat the budget.
  // Only fall back to a hard trim when the spoken read actually overruns; the
  // trim drops tags (acceptable on the rare overflow) to guarantee duration fit.
  const spokenWordCount = countWords(stripAudioTags(rawText));
  const script =
    spokenWordCount > wordBudget
      ? trimToWordBudget(stripAudioTags(rawText), wordBudget)
      : rawText;
  const wordCount = countWords(stripAudioTags(script));

  // Compute and record cost.
  const costResult = computeClaudeCost(response.usage as never, MODEL);
  await recordCostEvent({
    propertyId,
    stage: "scripting",
    provider: "anthropic",
    unitsConsumed: costResult.totalTokens,
    unitType: "tokens",
    costCents: costResult.costCents,
    metadata: {
      model: MODEL,
      durationSec,
      wordBudget,
      wordCount,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  }).catch((e) => console.error("[voiceover/script] cost_event insert failed:", e));

  return { script, wordCount };
}
