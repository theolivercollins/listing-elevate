/**
 * Voiceover script generator for the operator delivery pipeline.
 *
 * Uses Claude Sonnet 4.6 (same model as lib/voiceover/generate-script.ts) to
 * produce a TTS-ready script from delivery run metadata (listing details +
 * video type + duration).  Audio tags ([warmly] etc.) are included for
 * ElevenLabs v3 compatibility.
 *
 * Every successful call writes a cost_events row with:
 *   stage: 'scripting', provider: 'anthropic',
 *   metadata.delivery_run_id, metadata.subtype: 'delivery_voiceover_script'
 *   (or 'delivery_voiceover_shorten' for the duration-audit shorten pass)
 */

import Anthropic from '@anthropic-ai/sdk';
import { computeClaudeCost } from '../utils/claude-cost.js';
import { recordCostEvent } from '../db.js';
import { WORD_BUDGET } from '../voiceover/voices.js';
import { countWords, trimToWordBudget } from '../voiceover/generate-script.js';
import { stripAudioTags } from '../voiceover/audio-tags.js';
import type { ListingDetails, DeliveryVideoType } from '../types/operator-studio.js';

export const MODEL = 'claude-sonnet-4-6';

const VIDEO_TYPE_LABELS: Record<DeliveryVideoType, string> = {
  just_listed: 'Just Listed',
  just_pended: 'Just Pended',
  just_closed: 'Just Closed',
};

const SYSTEM_PROMPT = `You write welcoming real-estate listing-video voiceover scripts.
HARD word budget: {wordBudget} words maximum (spoken read ~150 wpm must fit the duration). This is a hard limit — the script MUST end with a complete sentence and never run past the budget; anything over gets cut off mid-read.
Structure: a fresh opener naming the property -> 3-5 distinctive features from the MLS description and facts -> one short closing line tied to the video type.
OPENER: do NOT open with "Welcome to" or "Step inside". Vary the opener — lead with a standout feature, the lifestyle, the setting, or the address in a fresher construction.
Tone: warm, inviting, real-estate-classic. Output the script ONLY.
DELIVERY CUES (ElevenLabs v3 audio tags): sprinkle 2-4 of ONLY these inline cues: [warmly], [calmly], [softly], [gently], [enthusiastically], [pause]. Tags do not count toward the word budget.`;

/**
 * Build the user-facing prompt from run metadata.
 * Pure function — no I/O, fully testable.
 */
export function buildScriptUserMessage(input: {
  address: string;
  videoType: DeliveryVideoType;
  durationSec: number;
  details: ListingDetails;
}): string {
  const { address, videoType, durationSec, details } = input;
  const facts: string[] = [];
  if (details.price) facts.push(`Price: $${details.price.toLocaleString('en-US')}`);
  if (details.beds) facts.push(`${details.beds} bedrooms`);
  if (details.baths) facts.push(`${details.baths} bathrooms`);
  if (details.sqft) facts.push(`${details.sqft.toLocaleString('en-US')} sqft`);

  return [
    `Property: ${address}`,
    `Video type: ${VIDEO_TYPE_LABELS[videoType]}`,
    `Duration: ${durationSec} seconds`,
    facts.length ? `Facts: ${facts.join(' · ')}` : '',
    details.mls_description
      ? `MLS description:\n${details.mls_description}`
      : 'No MLS description available — write from the facts.',
    `\nWrite a ${durationSec} seconds voiceover script.`,
  ]
    .filter(Boolean)
    .join('\n');
}

export interface GenerateDeliveryScriptResult {
  script: string;
  wordCount: number;
}

/**
 * Generate a voiceover script for a delivery run and record the Anthropic cost.
 *
 * @param input.runId        - delivery_runs.id — written to cost_events metadata
 * @param input.propertyId   - properties.id — written to cost_events.property_id
 * @param input.address      - street address for the script opening
 * @param input.videoType    - 'just_listed' | 'just_pended' | 'just_closed'
 * @param input.durationSec  - target video duration; controls word budget
 * @param input.details      - scraped / manual listing facts
 */
export async function generateDeliveryScript(input: {
  runId: string;
  propertyId: string;
  address: string;
  videoType: DeliveryVideoType;
  durationSec: number;
  details: ListingDetails;
}): Promise<GenerateDeliveryScriptResult> {
  const wordBudget = WORD_BUDGET[input.durationSec] ?? 75;
  const client = new Anthropic();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT.replace('{wordBudget}', String(wordBudget)),
    messages: [{ role: 'user', content: buildScriptUserMessage(input) }],
  });

  const rawText =
    response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
  if (!rawText) throw new Error('Delivery script generation returned empty text');

  // Enforce word budget — count spoken words (tags excluded) to avoid eating
  // the budget with delivery cues.  Trim only on real overflow.
  const spokenWordCount = countWords(stripAudioTags(rawText));
  const script =
    spokenWordCount > wordBudget
      ? trimToWordBudget(stripAudioTags(rawText), wordBudget)
      : rawText;

  // Cost tracking — never null/0 for a real API call.
  const cost = computeClaudeCost(response.usage as never, MODEL);
  await recordCostEvent({
    propertyId: input.propertyId,
    stage: 'scripting',
    provider: 'anthropic',
    unitsConsumed: cost.totalTokens,
    unitType: 'tokens',
    costCents: cost.costCents,
    metadata: {
      delivery_run_id: input.runId,
      subtype: 'delivery_voiceover_script',
      model: MODEL,
      duration_sec: input.durationSec,
      word_budget: wordBudget,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  }).catch((e) =>
    console.error('[delivery/voiceover-script] cost_event failed:', e),
  );

  return { script, wordCount: countWords(stripAudioTags(script)) };
}

/**
 * Build the user message for a shorten pass.
 * Pure function — no I/O, fully testable.
 */
export function buildShortenUserMessage(input: {
  script: string;
  actualSeconds: number;
  targetSeconds: number;
}): string {
  const { script, actualSeconds, targetSeconds } = input;
  return [
    `This voiceover runs ${actualSeconds.toFixed(1)}s but must fit in ${targetSeconds}s.`,
    'Shorten it naturally — keep complete sentences, keep the address and price if present, cut the least important features.',
    'Output the script only.',
    '',
    script,
  ].join('\n');
}

/**
 * Shorten an over-running delivery voiceover script naturally (complete
 * sentences, address/price preserved) and record the Anthropic cost.
 *
 * Same model + cost-tracking pattern as generateDeliveryScript;
 * cost_events metadata.subtype: 'delivery_voiceover_shorten'.
 */
export async function shortenDeliveryScript(input: {
  runId: string;
  propertyId: string;
  script: string;
  /** Measured audio duration of the current script, in seconds. */
  actualSeconds: number;
  /** Target video duration the audio must fit in, in seconds. */
  targetSeconds: number;
}): Promise<{ script: string }> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT.replace(
      '{wordBudget}',
      String(WORD_BUDGET[input.targetSeconds] ?? 75),
    ),
    messages: [{ role: 'user', content: buildShortenUserMessage(input) }],
  });

  const script =
    response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
  if (!script) throw new Error('Delivery script shortening returned empty text');

  // Cost tracking — never null/0 for a real API call.
  const cost = computeClaudeCost(response.usage as never, MODEL);
  await recordCostEvent({
    propertyId: input.propertyId,
    stage: 'scripting',
    provider: 'anthropic',
    unitsConsumed: cost.totalTokens,
    unitType: 'tokens',
    costCents: cost.costCents,
    metadata: {
      delivery_run_id: input.runId,
      subtype: 'delivery_voiceover_shorten',
      model: MODEL,
      target_seconds: input.targetSeconds,
      actual_seconds: input.actualSeconds,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  }).catch((e) =>
    console.error('[delivery/voiceover-script] cost_event failed:', e),
  );

  return { script };
}
