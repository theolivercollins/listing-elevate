import { describe, it, expect } from 'vitest';
import { computeSceneWinners, computeSessionUsage, isRenderAffecting, needsConfirmFor, validateRefineActions } from '../refine-context';
import type { MlEventRow, SceneVariantRow } from '../../types/operator-studio';
import type { RefineContext } from '../refine-types';

// These pure helpers back BOTH refine-agent.ts and refine-execute.ts's
// validation, but neither of those test files exercises the REAL
// buildRefineContext aggregation (both inject a stub context) — this file
// covers the two derivation functions and a few validateRefineActions edge
// cases directly, independent of any LLM/DB mocking.

function variantRow(over: Partial<SceneVariantRow>): SceneVariantRow {
  return {
    id: 'v', delivery_run_id: 'run-1', scene_id: 'scene-1', variant: 'A', provider: 'atlas',
    provider_task_id: 't', clip_url: 'clip.mp4', cost_cents: 10, gemini_scores: null,
    winner: false, winner_source: null, degraded: false, error: null,
    created_at: '', updated_at: '', ...over,
  };
}

function mlEvent(over: Partial<MlEventRow>): MlEventRow {
  return { id: 'e', run_id: 'run-1', event_type: 'regenerate', payload: {}, created_at: '', ...over };
}

describe('computeSceneWinners', () => {
  it('maps each scene id to whichever variant has winner:true', () => {
    const variants = [
      variantRow({ scene_id: 's1', variant: 'A', winner: true }),
      variantRow({ scene_id: 's1', variant: 'B', winner: false }),
      variantRow({ scene_id: 's2', variant: 'A', winner: false }),
      variantRow({ scene_id: 's2', variant: 'B', winner: true }),
    ];
    const winners = computeSceneWinners(variants);
    expect(winners.get('s1')).toBe('A');
    expect(winners.get('s2')).toBe('B');
  });

  it('omits a scene entirely when neither variant has won yet', () => {
    const variants = [
      variantRow({ scene_id: 's3', variant: 'A', winner: false }),
      variantRow({ scene_id: 's3', variant: 'B', winner: false }),
    ];
    expect(computeSceneWinners(variants).has('s3')).toBe(false);
  });
});

describe('computeSessionUsage', () => {
  it('counts only telegram_refine-sourced events, bucketed by kind', () => {
    const events: MlEventRow[] = [
      mlEvent({ event_type: 'regenerate', payload: { source: 'telegram_refine' } }),
      mlEvent({ event_type: 'regenerate', payload: { source: 'telegram_refine' } }),
      // Operator-studio-originated regenerate — must NOT count against the Telegram cap.
      mlEvent({ event_type: 'regenerate', payload: {} }),
      mlEvent({ event_type: 'music_choice', payload: { source: 'telegram_refine', subtype: 'generate_music' } }),
      // set_music via telegram_refine — NOT a generate_music, must not count.
      mlEvent({ event_type: 'music_choice', payload: { source: 'telegram_refine' } }),
      mlEvent({ event_type: 'auto_advance', payload: { source: 'telegram_refine', action: 'batch_rerender' } }),
      // A different auto_advance payload shape (e.g. operator set_auto_run) must not count.
      mlEvent({ event_type: 'auto_advance', payload: { source: 'operator', action: 'set_auto_run' } }),
    ];
    expect(computeSessionUsage(events)).toEqual({
      regenerateClipCount: 2,
      generateMusicCount: 1,
      rerenderCount: 1,
    });
  });

  it('returns all zeros for an empty or unrelated event list', () => {
    expect(computeSessionUsage([])).toEqual({ regenerateClipCount: 0, generateMusicCount: 0, rerenderCount: 0 });
    expect(computeSessionUsage([mlEvent({ event_type: 'rating', payload: { overall: 5 } })])).toEqual({
      regenerateClipCount: 0, generateMusicCount: 0, rerenderCount: 0,
    });
  });

  it('FIX 1: counts a fallback or failed generate_music attempt exactly like a successful one — an uncounted expensive attempt must never bypass the cap', () => {
    const events: MlEventRow[] = [
      mlEvent({ event_type: 'music_choice', payload: { source: 'telegram_refine', subtype: 'generate_music', fallback: true } }),
      mlEvent({ event_type: 'music_choice', payload: { source: 'telegram_refine', subtype: 'generate_music', failed: true, error: 'boom' } }),
    ];
    expect(computeSessionUsage(events).generateMusicCount).toBe(2);
  });
});

describe('isRenderAffecting / needsConfirmFor', () => {
  it('classifies the render-affecting set correctly', () => {
    for (const kind of ['reorder', 'flip_winner', 'set_music', 'generate_music', 'generate_audio']) {
      expect(isRenderAffecting(kind)).toBe(true);
    }
    // regenerate_clip (P1-3) — only SUBMITS an async provider job; the clip
    // lands later via the poll cron, so it must never immediate-render a
    // still-stale winner. music_feedback (L5) — a free thumbs up/down must
    // never trigger a re-render.
    for (const kind of ['set_voice', 'set_script', 'generate_script', 'edit_details', 'resume', 'regenerate_all', 'regenerate_clip', 'music_feedback']) {
      expect(isRenderAffecting(kind)).toBe(false);
    }
  });

  it('regenerate_clip still needsConfirm (spends money/time) even though it is no longer render-affecting', () => {
    expect(needsConfirmFor([{ kind: 'regenerate_clip', sceneId: 's1' }])).toBe(true);
  });

  it('music_feedback alone no longer needsConfirm (free, instant, non-render-affecting)', () => {
    expect(needsConfirmFor([{ kind: 'music_feedback', track_id: 't1', verdict: 'up' }])).toBe(false);
  });

  it('needsConfirmFor is true for a money/time action even when it is not render-affecting (generate_script)', () => {
    expect(needsConfirmFor([{ kind: 'generate_script' }])).toBe(true);
  });

  it('needsConfirmFor is false when every action is cheap and instant', () => {
    expect(needsConfirmFor([{ kind: 'set_voice', voice_id: 'v1' }, { kind: 'edit_details', price: 1 }])).toBe(false);
  });

  it('needsConfirmFor is false for an empty action list', () => {
    expect(needsConfirmFor([])).toBe(false);
  });
});

describe('validateRefineActions — additional direct edge cases', () => {
  const ctx: RefineContext = {
    runId: 'run-1',
    propertyId: 'prop-1',
    stage: 'checkpoint_a',
    video_type: 'just_listed',
    duration_seconds: 30,
    scene_order: ['s1', 's2'],
    scenes: [
      { id: 's1', room_type: 'kitchen', winner: 'A' },
      { id: 's2', room_type: 'bathroom', winner: null },
    ],
    music_track_id: null,
    voiceover_voice_id: null,
    voiceover_script: null,
    listing_details: {},
    paused_reason: null,
    availableTracks: [{ id: 't1', name: 'Track', mood: 'upbeat', genre: 'acoustic' }],
    availableVoices: [{ id: 'v1', name: 'Brian', isClientVoice: false }],
    usage: { regenerateClipCount: 0, generateMusicCount: 0, rerenderCount: 0 },
  };

  it('accepts a fully-populated, in-bounds edit_details', () => {
    const { actions, dropped } = validateRefineActions([
      { kind: 'edit_details', price: 500000, beds: 3, baths: 2, sqft: 1800, description: 'Nice home.' },
    ], ctx);
    expect(dropped).toEqual([]);
    expect(actions).toEqual([{ kind: 'edit_details', price: 500000, beds: 3, baths: 2, sqft: 1800, description: 'Nice home.' }]);
  });

  it('rejects a negative price and a beds count over 50', () => {
    const { actions, dropped } = validateRefineActions([
      { kind: 'edit_details', price: -1 },
      { kind: 'edit_details', beds: 51 },
    ], ctx);
    expect(actions).toEqual([]);
    expect(dropped).toHaveLength(2);
    expect(dropped[0].reason).toMatch(/price out of bounds/);
    expect(dropped[1].reason).toMatch(/beds out of bounds/);
  });

  it('rejects an unsupported regenerate_clip model override', () => {
    const { actions, dropped } = validateRefineActions([
      { kind: 'regenerate_clip', sceneId: 's1', model: 'veo-3' },
    ], ctx);
    expect(actions).toEqual([]);
    expect(dropped[0].reason).toMatch(/unsupported model/);
  });

  it('drops a music_feedback with an invalid verdict and caps an over-length comment', () => {
    const { actions: badVerdict } = validateRefineActions([
      { kind: 'music_feedback', track_id: 't1', verdict: 'meh' },
    ], ctx);
    expect(badVerdict).toEqual([]);

    const { actions: capped } = validateRefineActions([
      { kind: 'music_feedback', track_id: 't1', verdict: 'up', comment: 'x'.repeat(600) },
    ], ctx);
    expect((capped[0] as { comment?: string }).comment).toHaveLength(500);
  });

  it('passes through resume and regenerate_all with no fields to validate', () => {
    const { actions, dropped } = validateRefineActions([{ kind: 'resume' }, { kind: 'regenerate_all' }], ctx);
    expect(actions).toEqual([{ kind: 'resume' }, { kind: 'regenerate_all' }]);
    expect(dropped).toEqual([]);
  });
});
