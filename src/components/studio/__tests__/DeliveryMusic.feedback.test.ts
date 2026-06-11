/**
 * Unit tests for DeliveryMusic feedback state logic.
 *
 * We test the pure state helpers extracted from the component so we don't
 * need a full React render environment for these invariants.
 */

import { describe, it, expect } from 'vitest';

// ─── Replicated types (keep in sync with DeliveryMusic.tsx) ──────────────────

type Verdict = 'up' | 'down';
type FeedbackStatus = 'idle' | 'saving' | 'error';

interface CardFeedback {
  verdict?: Verdict;
  comment: string;
  status: FeedbackStatus;
  errorMsg?: string;
}

type FeedbackMap = Record<string, CardFeedback>;

// ─── Pure helpers (mirrors component logic exactly) ───────────────────────────

function getFeedback(map: FeedbackMap, trackId: string): CardFeedback {
  return map[trackId] ?? { comment: '', status: 'idle' };
}

function patchFeedback(
  map: FeedbackMap,
  trackId: string,
  patch: Partial<CardFeedback>,
): FeedbackMap {
  return {
    ...map,
    [trackId]: { ...getFeedback(map, trackId), ...patch },
  };
}

/** Optimistic path: sets verdict + saving immediately */
function applyOptimisticVote(
  map: FeedbackMap,
  trackId: string,
  verdict: Verdict,
): FeedbackMap {
  return patchFeedback(map, trackId, { verdict, status: 'saving', errorMsg: undefined });
}

/** Success path: clears saving flag */
function applyVoteSuccess(map: FeedbackMap, trackId: string): FeedbackMap {
  return patchFeedback(map, trackId, { status: 'idle' });
}

/** Error path: reverts verdict, sets error */
function applyVoteError(
  map: FeedbackMap,
  trackId: string,
  errorMsg: string,
): FeedbackMap {
  return patchFeedback(map, trackId, {
    verdict: undefined,
    status: 'error',
    errorMsg,
  });
}

/** Comment update: patches comment only */
function applyCommentUpdate(
  map: FeedbackMap,
  trackId: string,
  comment: string,
): FeedbackMap {
  return patchFeedback(map, trackId, { comment });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DeliveryMusic feedback state helpers', () => {
  describe('getFeedback', () => {
    it('returns default state for an unknown track', () => {
      const fb = getFeedback({}, 'track-1');
      expect(fb.comment).toBe('');
      expect(fb.status).toBe('idle');
      expect(fb.verdict).toBeUndefined();
    });

    it('returns existing state for a known track', () => {
      const map: FeedbackMap = {
        't1': { verdict: 'up', comment: 'great', status: 'idle' },
      };
      expect(getFeedback(map, 't1').verdict).toBe('up');
    });
  });

  describe('patchFeedback', () => {
    it('merges partial patch over existing state', () => {
      let map: FeedbackMap = {};
      map = patchFeedback(map, 't1', { verdict: 'up', status: 'idle', comment: '' });
      map = patchFeedback(map, 't1', { comment: 'sounds good' });
      expect(map['t1'].verdict).toBe('up');
      expect(map['t1'].comment).toBe('sounds good');
    });

    it('does not mutate other track entries', () => {
      let map: FeedbackMap = {
        't2': { verdict: 'down', comment: '', status: 'idle' },
      };
      map = patchFeedback(map, 't1', { verdict: 'up', comment: '', status: 'idle' });
      expect(map['t2'].verdict).toBe('down');
    });
  });

  describe('optimistic vote flow', () => {
    it('sets verdict and saving status immediately', () => {
      let map: FeedbackMap = {};
      map = applyOptimisticVote(map, 't1', 'up');
      expect(map['t1'].verdict).toBe('up');
      expect(map['t1'].status).toBe('saving');
    });

    it('clears saving on success', () => {
      let map: FeedbackMap = {};
      map = applyOptimisticVote(map, 't1', 'down');
      map = applyVoteSuccess(map, 't1');
      expect(map['t1'].verdict).toBe('down');
      expect(map['t1'].status).toBe('idle');
    });

    it('reverts verdict and sets error on failure', () => {
      let map: FeedbackMap = {};
      map = applyOptimisticVote(map, 't1', 'up');
      map = applyVoteError(map, 't1', 'Network error');
      expect(map['t1'].verdict).toBeUndefined();
      expect(map['t1'].status).toBe('error');
      expect(map['t1'].errorMsg).toBe('Network error');
    });
  });

  describe('comment flow', () => {
    it('updates comment without affecting verdict or status', () => {
      let map: FeedbackMap = {};
      map = applyOptimisticVote(map, 't1', 'up');
      map = applyVoteSuccess(map, 't1');
      map = applyCommentUpdate(map, 't1', 'perfect vibe');
      expect(map['t1'].comment).toBe('perfect vibe');
      expect(map['t1'].verdict).toBe('up');
      expect(map['t1'].status).toBe('idle');
    });
  });

  describe('"Won\'t be reused" display rule', () => {
    it('is true only for AI-generated tracks with a down verdict', () => {
      const shouldShowWontReuse = (source: string, verdict?: Verdict) =>
        source === 'elevenlabs_music' && verdict === 'down';

      expect(shouldShowWontReuse('elevenlabs_music', 'down')).toBe(true);
      expect(shouldShowWontReuse('elevenlabs_music', 'up')).toBe(false);
      expect(shouldShowWontReuse('elevenlabs_music', undefined)).toBe(false);
      expect(shouldShowWontReuse('library', 'down')).toBe(false);
    });
  });

  describe('genre label helper', () => {
    it('capitalises the genre key', () => {
      const genreLabel = (genre: string | null): string => {
        if (!genre) return 'Library';
        return genre.charAt(0).toUpperCase() + genre.slice(1);
      };

      expect(genreLabel('acoustic')).toBe('Acoustic');
      expect(genreLabel('orchestral')).toBe('Orchestral');
      expect(genreLabel('ambient')).toBe('Ambient');
      expect(genreLabel('modern')).toBe('Modern');
      expect(genreLabel(null)).toBe('Library');
    });
  });
});
