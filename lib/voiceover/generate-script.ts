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

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You write cinematic real-estate listing-video voiceover scripts.
STRICT word budget: {wordBudget} words maximum. Count carefully.
No clichés like "Welcome to", "Step inside", "Nestled", or "Dream home".
Tone: confident, evocative. Second-person ("you") optional but encouraged.
Output the script ONLY — no preamble, no quotes, no commentary.`;

export interface GenerateScriptInput {
  description: string;
  durationSec: 15 | 30 | 60;
  address: string;
  packageLabel: string;
  propertyId: string | null;
}

export interface GenerateScriptResult {
  script: string;
  wordCount: number;
}

/**
 * Trim a script to at most `n` words.
 * Preserves sentence endings where possible by cutting at word boundaries.
 */
export function trimToWordBudget(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(" ");
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export async function generateVoiceoverScript(
  input: GenerateScriptInput,
): Promise<GenerateScriptResult> {
  const { description, durationSec, address, packageLabel, propertyId } = input;
  const wordBudget = WORD_BUDGET[durationSec] ?? 75;

  const systemPrompt = SYSTEM_PROMPT.replace("{wordBudget}", String(wordBudget));

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
  const script = trimToWordBudget(rawText, wordBudget);
  const wordCount = countWords(script);

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
