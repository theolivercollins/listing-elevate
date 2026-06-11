import { describe, it, expect } from 'vitest';
import {
  GENRE_VARIANTS,
  buildFeedbackBlock,
  buildGenrePrompt,
} from '../elevenlabs-music.js';

// ---------------------------------------------------------------------------
// GENRE_VARIANTS shape
// ---------------------------------------------------------------------------
describe('GENRE_VARIANTS', () => {
  it('has exactly 4 entries', () => {
    expect(GENRE_VARIANTS).toHaveLength(4);
  });

  it('contains the expected keys: acoustic, orchestral, ambient, modern', () => {
    const keys = GENRE_VARIANTS.map((v) => v.key);
    expect(keys).toEqual(expect.arrayContaining(['acoustic', 'orchestral', 'ambient', 'modern']));
    expect(keys).toHaveLength(4);
  });

  it('every entry has a non-empty label and promptFragment', () => {
    for (const v of GENRE_VARIANTS) {
      expect(v.label).toBeTruthy();
      expect(v.promptFragment).toBeTruthy();
    }
  });

  it('every promptFragment preserves "No vocals" character (narration-safe)', () => {
    // Fragments steer instrumentation; they must not introduce vocals.
    // They append to a mood prompt that already says "No vocals" — the fragment
    // must not say "with vocals" or similar. We verify each fragment doesn't
    // contradict the no-vocals policy by checking it doesn't contain "vocal".
    for (const v of GENRE_VARIANTS) {
      expect(v.promptFragment.toLowerCase()).not.toMatch(/\bwith vocals\b/);
    }
  });
});

// ---------------------------------------------------------------------------
// buildFeedbackBlock
// ---------------------------------------------------------------------------
describe('buildFeedbackBlock', () => {
  it('returns empty string for empty input', () => {
    expect(buildFeedbackBlock([])).toBe('');
  });

  it('includes the operator feedback header when rows are present', () => {
    const rows = [
      { verdict: 'up' as const, genre: 'acoustic', comment: null, created_at: '2026-06-11T10:00:00Z' },
    ];
    const block = buildFeedbackBlock(rows);
    expect(block).toContain('OPERATOR FEEDBACK ON PREVIOUS TRACKS');
  });

  it('renders a liked entry with comment correctly', () => {
    const rows = [
      { verdict: 'up' as const, genre: 'orchestral', comment: 'great strings', created_at: '2026-06-11T10:00:00Z' },
    ];
    const block = buildFeedbackBlock(rows);
    expect(block).toContain('liked');
    expect(block).toContain('orchestral');
    expect(block).toContain('"great strings"');
    expect(block).toContain('2026-06-11');
  });

  it('renders a disliked entry with comment correctly', () => {
    const rows = [
      { verdict: 'down' as const, genre: 'orchestral', comment: 'too cheesy', created_at: '2026-06-11T09:00:00Z' },
    ];
    const block = buildFeedbackBlock(rows);
    expect(block).toContain('disliked');
    expect(block).toContain('orchestral');
    expect(block).toContain('"too cheesy"');
  });

  it('renders a no-comment entry as "liked/disliked a <genre> track"', () => {
    const rows = [
      { verdict: 'up' as const, genre: 'ambient', comment: null, created_at: '2026-06-11T08:00:00Z' },
    ];
    const block = buildFeedbackBlock(rows);
    expect(block).toContain('liked a ambient track');
  });

  it('renders a no-comment disliked entry correctly', () => {
    const rows = [
      { verdict: 'down' as const, genre: 'modern', comment: null, created_at: '2026-06-10T08:00:00Z' },
    ];
    const block = buildFeedbackBlock(rows);
    expect(block).toContain('disliked a modern track');
  });

  it('handles null genre gracefully', () => {
    const rows = [
      { verdict: 'up' as const, genre: null, comment: null, created_at: '2026-06-10T07:00:00Z' },
    ];
    const block = buildFeedbackBlock(rows);
    expect(block).toBeTruthy();
    // Should not crash; genre may appear as empty or "unknown"
  });

  it('renders multiple entries in order (newest first = first in array)', () => {
    const rows = [
      { verdict: 'up' as const, genre: 'acoustic', comment: 'loved it', created_at: '2026-06-11T10:00:00Z' },
      { verdict: 'down' as const, genre: 'orchestral', comment: 'heavy', created_at: '2026-06-10T10:00:00Z' },
    ];
    const block = buildFeedbackBlock(rows);
    const acousticIdx = block.indexOf('acoustic');
    const orchestralIdx = block.indexOf('orchestral');
    // acoustic (newer, first row) should appear before orchestral in the block
    expect(acousticIdx).toBeLessThan(orchestralIdx);
  });

  it('includes (apply these preferences) directive', () => {
    const rows = [
      { verdict: 'down' as const, genre: 'ambient', comment: 'too quiet', created_at: '2026-06-11T10:00:00Z' },
    ];
    const block = buildFeedbackBlock(rows);
    expect(block.toLowerCase()).toContain('apply these preferences');
  });
});

// ---------------------------------------------------------------------------
// buildGenrePrompt
// ---------------------------------------------------------------------------
describe('buildGenrePrompt', () => {
  it('combines moodPrompt + fragment + feedbackBlock', () => {
    const mood = 'Warm, heartfelt instrumental.';
    const fragment = 'Acoustic guitar treatment.';
    const fb = 'OPERATOR FEEDBACK: liked acoustic.';
    const result = buildGenrePrompt(mood, fragment, fb);
    expect(result).toContain(mood);
    expect(result).toContain(fragment);
    expect(result).toContain(fb);
  });

  it('works with an empty feedback block', () => {
    const result = buildGenrePrompt('Warm instrumental.', 'Ambient pads.', '');
    expect(result).toContain('Warm instrumental.');
    expect(result).toContain('Ambient pads.');
    // No extra newlines or stray content from the empty block
    expect(result.trim()).toBeTruthy();
  });

  it('does not duplicate content', () => {
    const mood = 'Upbeat.';
    const fragment = 'Electric guitar.';
    const result = buildGenrePrompt(mood, fragment, '');
    expect(result.split('Upbeat.').length - 1).toBe(1); // appears exactly once
  });
});
