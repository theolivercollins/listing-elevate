import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: mockCreate }; },
}));
vi.mock('../db.js', () => ({ recordCostEvent: vi.fn().mockResolvedValue(undefined) }));

import { parseFeedbackComment, validateFeedbackTags, FEEDBACK_CATEGORIES } from './parse-feedback';

const usage = { input_tokens: 100, output_tokens: 50 };

beforeEach(() => mockCreate.mockReset());

describe('validateFeedbackTags', () => {
  it('keeps only allowed categories and sentiment values', () => {
    expect(validateFeedbackTags([
      { category: 'pacing', sentiment: 'negative', note: 'rushed' },
      { category: 'invented_thing', sentiment: 'negative', note: 'x' },
      { category: 'music_fit', sentiment: 'sideways', note: 'x' },
    ])).toEqual([{ category: 'pacing', sentiment: 'negative', note: 'rushed' }]);
  });
  it('non-array input -> empty', () => {
    expect(validateFeedbackTags('garbage')).toEqual([]);
  });
});

describe('parseFeedbackComment', () => {
  it('parses model JSON into validated tags, records cost, no parse_error field', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"tags":[{"category":"voice_tone","sentiment":"positive","note":"warm read"}]}' }],
      usage,
    });
    const out = await parseFeedbackComment('loved the warm voice', { runId: 'r1', propertyId: 'p1' });
    expect(out.tags).toEqual([{ category: 'voice_tone', sentiment: 'positive', note: 'warm read' }]);
    expect(out.parse_error).toBeUndefined();
  });
  it('model returning junk -> empty tags, parse_error:true, no throw', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'not json' }], usage });
    const out = await parseFeedbackComment('hmm', { runId: 'r1', propertyId: 'p1' });
    expect(out.tags).toEqual([]);
    expect(out.parse_error).toBe(true);
    expect(typeof out.error_message).toBe('string');
  });

  it('clean parse with zero tags -> no parse_error field', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: '{"tags":[]}' }], usage });
    const out = await parseFeedbackComment('ok', { runId: 'r1', propertyId: 'p1' });
    expect(out.tags).toEqual([]);
    expect(out.parse_error).toBeUndefined();
  });
});

it('exposes the locked category list', () => {
  expect(FEEDBACK_CATEGORIES).toEqual(['pacing', 'voice_tone', 'clip_quality', 'music_fit', 'script_style', 'other']);
});
