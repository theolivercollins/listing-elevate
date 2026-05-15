import Anthropic from "@anthropic-ai/sdk";
import { recordCostEvent } from "../db.js";
import { computeClaudeCost } from "../utils/claude-cost.js";
import type { Property, Scene } from "../types.js";

const VOICEOVER_MODEL = "claude-sonnet-4-6";

// ~155 words per minute — industry average for warm real-estate narration.
const WORDS_PER_MINUTE = 155;

const SYSTEM_PROMPT = `You are a warm, professional real-estate listing narrator.

Rules (non-negotiable):
- Never invent details not present in the property data provided.
- Speak in second person: begin with "Welcome home to..." or a natural variant.
- End with a soft call-to-action naming the agent, e.g. "Schedule a tour with [agent] today."
- Output plain text only — no SSML, no markdown, no scene labels, no parenthetical notes.
- Stay concise and conversational; every word must earn its place.
- Fit the word-count budget provided in the user message. Slightly under is better than over.`;

export async function generateVoiceoverScript(opts: {
  property: Property;
  scenes: Scene[];
  durationSeconds: 15 | 30 | 60;
}): Promise<{
  script: string;
  estimatedSpokenSeconds: number;
  usage: { inputTokens: number; outputTokens: number; costCents: number; model: string };
}> {
  const { property, scenes, durationSeconds } = opts;

  // Target word count (slightly under to leave breathing room).
  const targetWords = Math.floor((durationSeconds / 60) * WORDS_PER_MINUTE * 0.92);

  const sceneList = scenes
    .map((s, i) => `${i + 1}. ${s.camera_movement} on photo ${i + 1}`)
    .join("\n");

  const userPrompt = `Property details:
Address: ${property.address}
Price: $${property.price.toLocaleString("en-US")}
Bedrooms: ${property.bedrooms}
Bathrooms: ${property.bathrooms}
Listing Agent: ${property.listing_agent}
${property.brokerage ? `Brokerage: ${property.brokerage}` : ""}
${property.selected_package ? `Package: ${property.selected_package}` : ""}

Visual flow (${scenes.length} scenes):
${sceneList}

Duration budget: ${durationSeconds} seconds (~${targetWords} words at 155 wpm).
Write a ${targetWords}-word voiceover narration (±10 words is fine; do NOT exceed ${targetWords + 15} words).`;

  const client = new Anthropic();
  const response = await client.messages.create({
    model: VOICEOVER_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const script =
    response.content[0].type === "text" ? response.content[0].text.trim() : "";

  const usageCost = computeClaudeCost(response.usage as never, VOICEOVER_MODEL);
  const costCents = usageCost.costCents;

  await recordCostEvent({
    propertyId: property.id,
    stage: "voiceover",
    provider: "anthropic",
    unitsConsumed: (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0),
    unitType: "tokens",
    costCents,
    metadata: {
      scope: "voiceover_script",
      model: VOICEOVER_MODEL,
      duration_seconds: durationSeconds,
      target_words: targetWords,
      ...usageCost.breakdown,
    },
  });

  const wordCount = script.split(/\s+/).filter(Boolean).length;
  const estimatedSpokenSeconds = Math.round(wordCount / (WORDS_PER_MINUTE / 60));

  return {
    script,
    estimatedSpokenSeconds,
    usage: {
      inputTokens: response.usage.input_tokens ?? 0,
      outputTokens: response.usage.output_tokens ?? 0,
      costCents,
      model: VOICEOVER_MODEL,
    },
  };
}
