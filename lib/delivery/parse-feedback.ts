import Anthropic from '@anthropic-ai/sdk';
import { computeClaudeCost } from '../utils/claude-cost.js';
import { recordCostEvent } from '../db.js';

const MODEL = 'claude-haiku-4-5-20251001'; // matches prompt-lab chat endpoints

export const FEEDBACK_CATEGORIES = ['pacing', 'voice_tone', 'clip_quality', 'music_fit', 'script_style', 'other'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
const SENTIMENTS = ['positive', 'negative', 'neutral'] as const;

export interface FeedbackTag {
  category: FeedbackCategory;
  sentiment: (typeof SENTIMENTS)[number];
  note: string;
}

/** Drop anything outside the locked category/sentiment vocab. Never throws. */
export function validateFeedbackTags(input: unknown): FeedbackTag[] {
  if (!Array.isArray(input)) return [];
  return input.filter((t): t is FeedbackTag =>
    t != null && typeof t === 'object'
    && (FEEDBACK_CATEGORIES as readonly string[]).includes((t as FeedbackTag).category)
    && (SENTIMENTS as readonly string[]).includes((t as FeedbackTag).sentiment)
    && typeof (t as FeedbackTag).note === 'string',
  );
}

const SYSTEM_PROMPT = `You convert an operator's freeform feedback about a real-estate listing video into structured tags.
Return ONLY JSON: {"tags":[{"category":"<one of: pacing, voice_tone, clip_quality, music_fit, script_style, other>","sentiment":"positive|negative|neutral","note":"<short paraphrase>"}]}
One tag per distinct point. Empty comment -> {"tags":[]}.`;

export async function parseFeedbackComment(
  comment: string,
  ctx: { runId: string; propertyId: string },
): Promise<{ tags: FeedbackTag[] }> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: comment }],
  });
  const raw = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';

  const cost = computeClaudeCost(response.usage as never, MODEL);
  await recordCostEvent({
    propertyId: ctx.propertyId, stage: 'analysis', provider: 'anthropic',
    unitsConsumed: cost.totalTokens, unitType: 'tokens', costCents: cost.costCents,
    metadata: {
      delivery_run_id: ctx.runId, subtype: 'feedback_parse', model: MODEL,
      input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens,
    },
  }).catch((e) => console.error('[delivery/parse-feedback] cost_event failed:', e));

  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    const parsed = JSON.parse(cleaned) as { tags?: unknown };
    return { tags: validateFeedbackTags(parsed.tags) };
  } catch {
    return { tags: [] }; // raw comment is stored regardless (Task 21)
  }
}
