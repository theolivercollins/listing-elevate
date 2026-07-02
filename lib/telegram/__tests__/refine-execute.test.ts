import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeRefinement } from '../refine-execute';
import type { ExecuteDeps, RefineAction, RefineContext } from '../refine-types';
import type { SceneVariantRow } from '../../types/operator-studio';

function makeCtx(overrides: Partial<RefineContext> = {}): RefineContext {
  return {
    runId: 'run-1',
    propertyId: 'prop-1',
    stage: 'music',
    video_type: 'just_listed',
    duration_seconds: 30,
    scene_order: ['scene-1', 'scene-2'],
    scenes: [
      { id: 'scene-1', room_type: 'kitchen', winner: 'A' },
      { id: 'scene-2', room_type: 'master_bedroom', winner: 'B' },
    ],
    music_track_id: 'track-1',
    voiceover_voice_id: 'voice-1',
    voiceover_script: 'Welcome home.',
    listing_details: { price: 500000, beds: 3, baths: 2, sqft: 1800, mls_description: 'Nice.' },
    paused_reason: null,
    availableTracks: [
      { id: 'track-1', name: 'Track 1', mood: 'upbeat', genre: 'acoustic' },
      { id: 'track-2', name: 'Track 2', mood: 'upbeat', genre: 'orchestral' },
    ],
    availableVoices: [
      { id: 'voice-1', name: 'Brian', isClientVoice: false },
      { id: 'voice-2', name: 'Mark', isClientVoice: false },
    ],
    usage: { regenerateClipCount: 0, generateMusicCount: 0, rerenderCount: 0 },
    ...overrides,
  };
}

function variantRow(over: Partial<SceneVariantRow>): SceneVariantRow {
  return {
    id: 'v', delivery_run_id: 'run-1', scene_id: 'scene-1', variant: 'A', provider: 'atlas',
    provider_task_id: 't', clip_url: 'clip.mp4', cost_cents: 10, gemini_scores: null,
    winner: false, winner_source: null, degraded: false, error: null,
    created_at: '', updated_at: '', ...over,
  };
}

function makeDeps(ctx: RefineContext, dbVariants: SceneVariantRow[] = []) {
  const dbUpdateCalls: Array<{ table: string; patch: Record<string, unknown> }> = [];

  const getSupabase = vi.fn().mockReturnValue({
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => {
        dbUpdateCalls.push({ table, patch });
        return { eq: () => Promise.resolve({ error: null }) };
      },
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { address: '123 Main St' }, error: null }),
        }),
      }),
    }),
  });

  const deps = {
    getVariantsForRun: vi.fn().mockResolvedValue(dbVariants),
    updateRun: vi.fn().mockResolvedValue({}),
    advanceRun: vi.fn().mockResolvedValue({}),
    revertRun: vi.fn().mockResolvedValue({}),
    recordMlEvent: vi.fn().mockResolvedValue(undefined),
    setListingDetails: vi.fn().mockResolvedValue({}),
    validateListingDetails: vi.fn().mockImplementation((input: Record<string, unknown>) => ({ ok: true, details: input })),
    regenerateVariant: vi.fn().mockResolvedValue(undefined),
    generateDeliveryScript: vi.fn().mockResolvedValue({ script: 'New script.', wordCount: 3 }),
    runDeliveryAudio: vi.fn().mockResolvedValue({ ok: true, run: {} }),
    runAssembleStage: vi.fn().mockResolvedValue(undefined),
    generateMusicVariantsForRun: vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      body: {
        tracks: [
          { id: 'gen-1', name: 'Gen 1', file_url: 'x', mood_tag: 'upbeat', source: 'elevenlabs_music', genre: 'acoustic' },
          { id: 'gen-2', name: 'Gen 2', file_url: 'y', mood_tag: 'upbeat', source: 'elevenlabs_music', genre: 'orchestral' },
        ],
        failures: 0,
      },
    }),
    recordMusicTrackFeedback: vi.fn().mockResolvedValue({ ok: true }),
    getSupabase,
    buildRefineContext: vi.fn().mockResolvedValue(ctx),
  } satisfies Required<ExecuteDeps>;

  return { deps, dbUpdateCalls };
}

describe('executeRefinement — per-action dispatch calls the right injected dep', () => {
  it('set_music calls updateRun + recordMlEvent with the chosen track', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps(ctx);
    const actions: RefineAction[] = [{ kind: 'set_music', music_track_id: 'track-2' }];
    const result = await executeRefinement('run-1', actions, deps);
    expect(deps.updateRun).toHaveBeenCalledWith('run-1', { music_track_id: 'track-2' });
    expect(deps.recordMlEvent).toHaveBeenCalledWith('run-1', 'music_choice', expect.objectContaining({ music_track_id: 'track-2', source: 'telegram_refine' }));
    expect(result.steps).toEqual([{ action: 'set_music', ok: true }]);
  });

  it('generate_music calls generateMusicVariantsForRun and auto-selects the first track', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps(ctx);
    await executeRefinement('run-1', [{ kind: 'generate_music' }], deps);
    expect(deps.generateMusicVariantsForRun).toHaveBeenCalledWith('run-1');
    expect(deps.updateRun).toHaveBeenCalledWith('run-1', { music_track_id: 'gen-1' });
    expect(deps.recordMlEvent).toHaveBeenCalledWith('run-1', 'music_choice', expect.objectContaining({
      music_track_id: 'gen-1', source: 'telegram_refine', subtype: 'generate_music', alternative_track_ids: ['gen-2'],
    }));
  });

  it('generate_music does NOT double-apply a track when the underlying call already fell back to a library pick', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps(ctx);
    deps.generateMusicVariantsForRun.mockResolvedValue({
      ok: true, status: 200,
      body: { tracks: [{ id: 'lib-1', name: 'Lib', file_url: 'z', mood_tag: 'upbeat', source: 'library', genre: null }], failures: 4, fallback: true, warning: 'all failed' },
    });
    await executeRefinement('run-1', [{ kind: 'generate_music' }], deps);
    expect(deps.updateRun).not.toHaveBeenCalled();
  });

  // ── FIX 1 — cap must count a fallback/failed generate_music attempt ────────
  // computeSessionUsage (refine-context.ts) only counts ml_events tagged
  // event_type='music_choice' + payload.subtype==='generate_music' +
  // payload.source==='telegram_refine'. Every attempt burns real provider
  // spend (4 parallel composeMusic() calls) regardless of outcome, so every
  // attempt must record ONE such event or REFINE_CAPS.generateMusic can
  // never trip on a repeatedly-failing/falling-back call.

  it('FIX 1: a fallback-to-library outcome still records a qualifying telegram_refine usage event (not just the internal library_fallback one)', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps(ctx);
    deps.generateMusicVariantsForRun.mockResolvedValue({
      ok: true, status: 200,
      body: { tracks: [{ id: 'lib-1', name: 'Lib', file_url: 'z', mood_tag: 'upbeat', source: 'library', genre: null }], failures: 4, fallback: true, warning: 'all failed' },
    });
    await executeRefinement('run-1', [{ kind: 'generate_music' }], deps);
    expect(deps.recordMlEvent).toHaveBeenCalledWith('run-1', 'music_choice', expect.objectContaining({
      source: 'telegram_refine', subtype: 'generate_music', fallback: true, music_track_id: 'lib-1',
    }));
  });

  it('FIX 1: an outright failure (ok:false) still records a qualifying usage event before surfacing the failed step', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps(ctx);
    deps.generateMusicVariantsForRun.mockResolvedValue({ ok: false, status: 502, error: 'All 4 music generations failed' });

    const result = await executeRefinement('run-1', [{ kind: 'generate_music' }], deps);

    expect(deps.recordMlEvent).toHaveBeenCalledWith('run-1', 'music_choice', expect.objectContaining({
      source: 'telegram_refine', subtype: 'generate_music', failed: true, error: 'All 4 music generations failed',
    }));
    expect(result.steps).toContainEqual(expect.objectContaining({ action: 'generate_music', ok: false }));
    expect(deps.updateRun).not.toHaveBeenCalled();
  });

  it('FIX 1: a thrown exception from generateMusicVariantsForRun itself still records a qualifying usage event, then rethrows as a failed step', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps(ctx);
    deps.generateMusicVariantsForRun.mockRejectedValue(new Error('network blip'));

    const result = await executeRefinement('run-1', [{ kind: 'generate_music' }], deps);

    expect(deps.recordMlEvent).toHaveBeenCalledWith('run-1', 'music_choice', expect.objectContaining({
      source: 'telegram_refine', subtype: 'generate_music', failed: true, error: 'network blip',
    }));
    expect(result.steps).toContainEqual(expect.objectContaining({ action: 'generate_music', ok: false, error: 'network blip' }));
  });

  it('music_feedback calls recordMusicTrackFeedback with the exact args', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps(ctx);
    await executeRefinement('run-1', [{ kind: 'music_feedback', track_id: 'track-1', verdict: 'down', comment: 'too loud' }], deps);
    expect(deps.recordMusicTrackFeedback).toHaveBeenCalledWith('run-1', 'track-1', 'down', 'too loud');
  });

  it('reorder calls updateRun with the new scene_order + recordMlEvent with before/after', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps(ctx);
    await executeRefinement('run-1', [{ kind: 'reorder', scene_order: ['scene-2', 'scene-1'] }], deps);
    expect(deps.updateRun).toHaveBeenCalledWith('run-1', { scene_order: ['scene-2', 'scene-1'] });
    expect(deps.recordMlEvent).toHaveBeenCalledWith('run-1', 'reorder', { before: ['scene-1', 'scene-2'], after: ['scene-2', 'scene-1'], source: 'telegram_refine' });
  });

  it('regenerate_clip always targets variant B and forwards an explicit model override', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps(ctx);
    await executeRefinement('run-1', [{ kind: 'regenerate_clip', sceneId: 'scene-1', model: 'seedance-pair' }], deps);
    expect(deps.regenerateVariant).toHaveBeenCalledWith('run-1', 'scene-1', 'B', { modelOverride: 'seedance-pair' });
    expect(deps.recordMlEvent).toHaveBeenCalledWith('run-1', 'regenerate', expect.objectContaining({ scene_id: 'scene-1', variant: 'B', model: 'seedance-pair' }));
  });

  it('flip_winner reads getVariantsForRun and flips the winner + winner_source on both rows', async () => {
    const ctx = makeCtx();
    const variants = [
      variantRow({ id: 'va', scene_id: 'scene-1', variant: 'A', winner: true, clip_url: 'a.mp4' }),
      variantRow({ id: 'vb', scene_id: 'scene-1', variant: 'B', winner: false, clip_url: 'b.mp4' }),
    ];
    const { deps, dbUpdateCalls } = makeDeps(ctx, variants);
    await executeRefinement('run-1', [{ kind: 'flip_winner', sceneId: 'scene-1' }], deps);
    expect(deps.getVariantsForRun).toHaveBeenCalledWith('run-1');
    expect(dbUpdateCalls).toEqual([
      { table: 'scene_variants', patch: expect.objectContaining({ winner: false, winner_source: 'operator' }) },
      { table: 'scene_variants', patch: expect.objectContaining({ winner: true, winner_source: 'operator' }) },
    ]);
    expect(deps.recordMlEvent).toHaveBeenCalledWith('run-1', 'variant_override', expect.objectContaining({ scene_id: 'scene-1', from: 'A', to: 'B' }));
  });

  it('set_voice calls updateRun + recordMlEvent', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps(ctx);
    await executeRefinement('run-1', [{ kind: 'set_voice', voice_id: 'voice-2' }], deps);
    expect(deps.updateRun).toHaveBeenCalledWith('run-1', { voiceover_voice_id: 'voice-2' });
    expect(deps.recordMlEvent).toHaveBeenCalledWith('run-1', 'voice_choice', expect.objectContaining({ voice_id: 'voice-2' }));
  });

  it('generate_script calls generateDeliveryScript with the note forwarded as guidanceNote, then persists it', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps(ctx);
    await executeRefinement('run-1', [{ kind: 'generate_script', note: 'make it punchier' }], deps);
    expect(deps.generateDeliveryScript).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1', propertyId: 'prop-1', videoType: 'just_listed', durationSec: 30, guidanceNote: 'make it punchier',
    }));
    expect(deps.updateRun).toHaveBeenCalledWith('run-1', { voiceover_script: 'New script.' });
  });

  it('set_script persists exact text', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps(ctx);
    await executeRefinement('run-1', [{ kind: 'set_script', text: 'Exact words.' }], deps);
    expect(deps.updateRun).toHaveBeenCalledWith('run-1', { voiceover_script: 'Exact words.' });
  });

  it('generate_audio calls runDeliveryAudio', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps(ctx);
    await executeRefinement('run-1', [{ kind: 'generate_audio' }], deps);
    expect(deps.runDeliveryAudio).toHaveBeenCalledWith('run-1');
  });

  it('edit_details merges the partial input over the existing listing_details before validating + persisting', async () => {
    const ctx = makeCtx({ listing_details: { price: 400000, beds: 3, baths: 2, sqft: 1500, mls_description: 'old' } });
    const { deps } = makeDeps(ctx);
    await executeRefinement('run-1', [{ kind: 'edit_details', price: 450000 }], deps);
    expect(deps.validateListingDetails).toHaveBeenCalledWith({ price: 450000, beds: 3, baths: 2, sqft: 1500, mls_description: 'old' });
    expect(deps.setListingDetails).toHaveBeenCalledWith('run-1', { price: 450000, beds: 3, baths: 2, sqft: 1500, mls_description: 'old' });
  });

  it('resume clears paused_reason and records auto_resume', async () => {
    const ctx = makeCtx({ paused_reason: 'awaiting price' });
    const { deps } = makeDeps(ctx);
    const result = await executeRefinement('run-1', [{ kind: 'resume' }], deps);
    expect(deps.updateRun).toHaveBeenCalledWith('run-1', { paused_reason: null });
    expect(deps.recordMlEvent).toHaveBeenCalledWith('run-1', 'auto_resume', { source: 'telegram_refine' });
    expect(result.rerendering).toBe(false);
  });

  it('regenerate_all reverts the run and skips everything else in the same batch, with no render attempted', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps(ctx);
    const result = await executeRefinement('run-1', [
      { kind: 'regenerate_all' },
      { kind: 'set_voice', voice_id: 'voice-2' },
    ], deps);
    expect(deps.revertRun).toHaveBeenCalledWith('run-1', 'generating');
    expect(deps.updateRun).not.toHaveBeenCalled(); // set_voice never applied
    expect(result.rerendering).toBe(false);
    expect(result.steps).toContainEqual({ action: 'regenerate_all', ok: true });
    expect(result.steps).toContainEqual(expect.objectContaining({ action: 'set_voice', ok: false, error: expect.stringContaining('skipped') }));
  });
});

describe('executeRefinement — validate-all-first aborts before any mutation', () => {
  it('a render-affecting action that fails re-validation aborts the WHOLE batch before mutating anything', async () => {
    const ctx = makeCtx(); // scene ids: scene-1, scene-2 only
    const { deps } = makeDeps(ctx);
    const actions: RefineAction[] = [
      { kind: 'set_voice', voice_id: 'voice-2' }, // individually valid, non-render-affecting
      { kind: 'flip_winner', sceneId: 'scene-does-not-exist' }, // invalid AND render-affecting
    ];
    const result = await executeRefinement('run-1', actions, deps);

    expect(deps.updateRun).not.toHaveBeenCalled();
    expect(deps.recordMlEvent).not.toHaveBeenCalled();
    expect(deps.runAssembleStage).not.toHaveBeenCalled();
    expect(result.rerendering).toBe(false);
    expect(result.summary).toMatch(/Nothing applied/);
  });

  it('an invalid action that is NOT render-affecting does not abort the batch — it is skipped and reported', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps(ctx);
    const actions: RefineAction[] = [
      { kind: 'set_voice', voice_id: 'voice-does-not-exist' }, // invalid, but not render-affecting
      { kind: 'set_music', music_track_id: 'track-2' }, // valid
    ];
    const result = await executeRefinement('run-1', actions, deps);
    expect(deps.updateRun).toHaveBeenCalledWith('run-1', { music_track_id: 'track-2' });
    expect(result.steps).toContainEqual(expect.objectContaining({ action: 'set_voice', ok: false }));
    expect(result.steps).toContainEqual({ action: 'set_music', ok: true });
  });
});

describe('executeRefinement — batching + one re-render', () => {
  it('multiple render-affecting actions in one batch trigger exactly ONE runAssembleStage call', async () => {
    const ctx = makeCtx({ stage: 'music' });
    const variants = [
      variantRow({ id: 'va', scene_id: 'scene-1', variant: 'A', winner: true, clip_url: 'a.mp4' }),
      variantRow({ id: 'vb', scene_id: 'scene-1', variant: 'B', winner: false, clip_url: 'b.mp4' }),
    ];
    const { deps } = makeDeps(ctx, variants);
    const actions: RefineAction[] = [
      { kind: 'set_music', music_track_id: 'track-2' },
      { kind: 'reorder', scene_order: ['scene-2', 'scene-1'] },
      { kind: 'flip_winner', sceneId: 'scene-1' },
    ];
    const result = await executeRefinement('run-1', actions, deps);

    expect(deps.runAssembleStage).toHaveBeenCalledTimes(1);
    expect(deps.advanceRun).toHaveBeenCalledWith('run-1', 'assembling'); // from 'music'
    expect(result.rerendering).toBe(true);
    expect(result.summary).toMatch(/re-rendered/);
    // The batch marker ml_event fires exactly once too.
    expect(deps.recordMlEvent).toHaveBeenCalledWith('run-1', 'auto_advance', expect.objectContaining({ source: 'telegram_refine', action: 'batch_rerender' }));
  });

  it('drives voiceover -> music -> assembling with two advanceRun hops before rendering', async () => {
    const ctx = makeCtx({ stage: 'voiceover' });
    const { deps } = makeDeps(ctx);
    await executeRefinement('run-1', [{ kind: 'set_music', music_track_id: 'track-2' }], deps);
    expect(deps.advanceRun).toHaveBeenNthCalledWith(1, 'run-1', 'music');
    expect(deps.advanceRun).toHaveBeenNthCalledWith(2, 'run-1', 'assembling');
    expect(deps.runAssembleStage).toHaveBeenCalledTimes(1);
  });

  it('reverts checkpoint_b -> assembling before rendering', async () => {
    const ctx = makeCtx({ stage: 'checkpoint_b' });
    const { deps } = makeDeps(ctx);
    await executeRefinement('run-1', [{ kind: 'set_music', music_track_id: 'track-2' }], deps);
    expect(deps.revertRun).toHaveBeenCalledWith('run-1', 'assembling');
    expect(deps.runAssembleStage).toHaveBeenCalledTimes(1);
  });

  it('a render-affecting action at a too-early stage (checkpoint_a) saves the change but does not attempt a render', async () => {
    const ctx = makeCtx({ stage: 'checkpoint_a' });
    const variants = [
      variantRow({ id: 'va', scene_id: 'scene-1', variant: 'A', winner: true, clip_url: 'a.mp4' }),
      variantRow({ id: 'vb', scene_id: 'scene-1', variant: 'B', winner: false, clip_url: 'b.mp4' }),
    ];
    const { deps } = makeDeps(ctx, variants);
    const result = await executeRefinement('run-1', [{ kind: 'flip_winner', sceneId: 'scene-1' }], deps);
    expect(result.steps).toEqual([{ action: 'flip_winner', ok: true }]); // the mutation itself succeeded
    expect(deps.runAssembleStage).not.toHaveBeenCalled();
    expect(result.rerendering).toBe(false);
    expect(result.summary).toMatch(/too early to render/);
  });

  it('non-render-affecting actions alone never trigger a render', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps(ctx);
    const result = await executeRefinement('run-1', [
      { kind: 'set_voice', voice_id: 'voice-2' },
      { kind: 'edit_details', price: 510000 },
    ], deps);
    expect(deps.runAssembleStage).not.toHaveBeenCalled();
    expect(result.rerendering).toBe(false);
  });
});

describe('executeRefinement — per-session caps enforced', () => {
  it('regenerate_clip is skipped once the session cap is reached, no throw', async () => {
    const ctx = makeCtx({ usage: { regenerateClipCount: 10, generateMusicCount: 0, rerenderCount: 0 } });
    const { deps } = makeDeps(ctx);
    const result = await executeRefinement('run-1', [{ kind: 'regenerate_clip', sceneId: 'scene-1' }], deps);
    expect(deps.regenerateVariant).not.toHaveBeenCalled();
    expect(result.steps).toEqual([{ action: 'regenerate_clip', ok: false, error: expect.stringContaining('session cap reached') }]);
    expect(result.rerendering).toBe(false);
  });

  it('generate_music is skipped once the session cap is reached, no throw', async () => {
    const ctx = makeCtx({ usage: { regenerateClipCount: 0, generateMusicCount: 3, rerenderCount: 0 } });
    const { deps } = makeDeps(ctx);
    const result = await executeRefinement('run-1', [{ kind: 'generate_music' }], deps);
    expect(deps.generateMusicVariantsForRun).not.toHaveBeenCalled();
    expect(result.steps).toEqual([{ action: 'generate_music', ok: false, error: expect.stringContaining('session cap reached') }]);
  });

  it('the re-render itself is skipped once the rerender cap is reached, even though mutations still apply', async () => {
    const ctx = makeCtx({ stage: 'music', usage: { regenerateClipCount: 0, generateMusicCount: 0, rerenderCount: 10 } });
    const { deps } = makeDeps(ctx);
    const result = await executeRefinement('run-1', [{ kind: 'set_music', music_track_id: 'track-2' }], deps);
    expect(deps.updateRun).toHaveBeenCalledWith('run-1', { music_track_id: 'track-2' });
    expect(deps.runAssembleStage).not.toHaveBeenCalled();
    expect(result.rerendering).toBe(false);
    expect(result.summary).toMatch(/re-render skipped — session cap reached/);
  });

  it('a within-batch second regenerate_clip is capped after the first consumes the last slot', async () => {
    const ctx = makeCtx({ usage: { regenerateClipCount: 9, generateMusicCount: 0, rerenderCount: 0 } });
    const { deps } = makeDeps(ctx);
    const result = await executeRefinement('run-1', [
      { kind: 'regenerate_clip', sceneId: 'scene-1' },
      { kind: 'regenerate_clip', sceneId: 'scene-2' },
    ], deps);
    expect(deps.regenerateVariant).toHaveBeenCalledTimes(1);
    expect(deps.regenerateVariant).toHaveBeenCalledWith('run-1', 'scene-1', 'B', undefined);
    expect(result.steps.find((s) => s.error?.includes('session cap'))).toBeTruthy();
  });
});

describe('executeRefinement — cost-recording deps are invoked (production owns the actual cost_events writes)', () => {
  it('generate_music, generate_script, and generate_audio all delegate to the cost-owning lib/delivery functions', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps(ctx);
    await executeRefinement('run-1', [
      { kind: 'generate_music' },
      { kind: 'generate_script' },
      { kind: 'generate_audio' },
    ], deps);
    expect(deps.generateMusicVariantsForRun).toHaveBeenCalledTimes(1);
    expect(deps.generateDeliveryScript).toHaveBeenCalledTimes(1);
    expect(deps.runDeliveryAudio).toHaveBeenCalledTimes(1);
  });
});

describe('executeRefinement — partial-failure path skips the render', () => {
  it('one render-affecting action failing blocks the render even though another render-affecting action succeeded', async () => {
    const ctx = makeCtx({ stage: 'music' });
    const { deps } = makeDeps(ctx);
    // generate_audio (still render-affecting post-P1-3, unlike regenerate_clip)
    // fails via an unexpected throw from the underlying delivery call.
    deps.runDeliveryAudio.mockRejectedValueOnce(new Error('provider down'));

    const result = await executeRefinement('run-1', [
      { kind: 'set_music', music_track_id: 'track-2' }, // succeeds
      { kind: 'generate_audio' }, // fails
    ], deps);

    expect(deps.updateRun).toHaveBeenCalledWith('run-1', { music_track_id: 'track-2' }); // mutation still applied
    expect(deps.runAssembleStage).not.toHaveBeenCalled(); // but no render
    expect(result.rerendering).toBe(false);
    expect(result.summary).toMatch(/re-render skipped/);
    expect(result.steps).toContainEqual({ action: 'set_music', ok: true });
    expect(result.steps).toContainEqual(expect.objectContaining({ action: 'generate_audio', ok: false, error: 'provider down' }));
  });

  it('P1-3: a failing regenerate_clip no longer blocks a render triggered by a different, successful render-affecting action (regenerate_clip is no longer render-affecting)', async () => {
    const ctx = makeCtx({ stage: 'music' });
    const { deps } = makeDeps(ctx);
    deps.regenerateVariant.mockRejectedValueOnce(new Error('provider down'));

    const result = await executeRefinement('run-1', [
      { kind: 'set_music', music_track_id: 'track-2' }, // render-affecting, succeeds
      { kind: 'regenerate_clip', sceneId: 'scene-1' }, // fails, but no longer render-affecting
    ], deps);

    expect(deps.runAssembleStage).toHaveBeenCalledTimes(1);
    expect(result.rerendering).toBe(true);
    expect(result.steps).toContainEqual(expect.objectContaining({ action: 'regenerate_clip', ok: false, error: 'provider down' }));
  });

  it('a failing non-render-affecting action does not block a render triggered by a different, successful action', async () => {
    const ctx = makeCtx({ stage: 'music' });
    const { deps } = makeDeps(ctx);
    // edit_details is NOT render-affecting (no price/beds/baths placeholder in
    // the current Creatomate templates) — its failure must never gate the
    // render decision, unlike a render-affecting action's failure.
    deps.setListingDetails.mockRejectedValueOnce(new Error('db write failed'));

    const result = await executeRefinement('run-1', [
      { kind: 'set_music', music_track_id: 'track-2' }, // render-affecting, succeeds
      { kind: 'edit_details', price: 999 }, // fails, but is not render-affecting
    ], deps);

    expect(deps.runAssembleStage).toHaveBeenCalledTimes(1);
    expect(result.rerendering).toBe(true);
    expect(result.steps).toContainEqual(expect.objectContaining({ action: 'edit_details', ok: false, error: 'db write failed' }));
  });
});

describe('executeRefinement — deterministic ordering + resume runs last', () => {
  it('applies edit_details before music before voice/script before reorder before flip_winner before regenerate_clip before generate_audio, regardless of input order', async () => {
    const ctx = makeCtx({ stage: 'music' });
    const variants = [
      variantRow({ id: 'va', scene_id: 'scene-1', variant: 'A', winner: true, clip_url: 'a.mp4' }),
      variantRow({ id: 'vb', scene_id: 'scene-1', variant: 'B', winner: false, clip_url: 'b.mp4' }),
    ];
    const { deps } = makeDeps(ctx, variants);
    const callOrder: string[] = [];
    deps.setListingDetails.mockImplementation(async () => { callOrder.push('edit_details'); return {}; });
    deps.updateRun.mockImplementation(async (_id: string, patch: Record<string, unknown>) => {
      if ('music_track_id' in patch) callOrder.push('set_music');
      if ('scene_order' in patch) callOrder.push('reorder');
      return {};
    });
    deps.getVariantsForRun.mockImplementation(async () => { callOrder.push('flip_winner'); return variants; });
    deps.regenerateVariant.mockImplementation(async () => { callOrder.push('regenerate_clip'); });
    deps.runDeliveryAudio.mockImplementation(async () => { callOrder.push('generate_audio'); return { ok: true, run: {} }; });

    // Deliberately out of order in the input.
    await executeRefinement('run-1', [
      { kind: 'generate_audio' },
      { kind: 'regenerate_clip', sceneId: 'scene-1' },
      { kind: 'flip_winner', sceneId: 'scene-1' },
      { kind: 'reorder', scene_order: ['scene-2', 'scene-1'] },
      { kind: 'set_music', music_track_id: 'track-2' },
      { kind: 'edit_details', price: 1 },
    ], deps);

    expect(callOrder).toEqual(['edit_details', 'set_music', 'reorder', 'flip_winner', 'regenerate_clip', 'generate_audio']);
  });

  it('resume is applied after the render decision, never before', async () => {
    const ctx = makeCtx({ stage: 'music', paused_reason: 'awaiting music pick' });
    const { deps } = makeDeps(ctx);
    const callOrder: string[] = [];
    deps.runAssembleStage.mockImplementation(async () => { callOrder.push('render'); });
    deps.updateRun.mockImplementation(async (_id: string, patch: Record<string, unknown>) => {
      if ('paused_reason' in patch) callOrder.push('resume');
      return {};
    });

    await executeRefinement('run-1', [
      { kind: 'resume' },
      { kind: 'set_music', music_track_id: 'track-2' },
    ], deps);

    expect(callOrder).toEqual(['render', 'resume']);
  });
});

describe('executeRefinement — C3: flip_winner must not swallow a DB error', () => {
  it('throws (reported as a failed step) when the FIRST scene_variants update returns an error, and never records the ml_event', async () => {
    const ctx = makeCtx();
    const variants = [
      variantRow({ id: 'va', scene_id: 'scene-1', variant: 'A', winner: true, clip_url: 'a.mp4' }),
      variantRow({ id: 'vb', scene_id: 'scene-1', variant: 'B', winner: false, clip_url: 'b.mp4' }),
    ];
    const { deps } = makeDeps(ctx, variants);
    let call = 0;
    deps.getSupabase = vi.fn().mockReturnValue({
      from: () => ({
        update: () => ({
          eq: () => {
            call++;
            return Promise.resolve(call === 1 ? { error: { message: 'db down' } } : { error: null });
          },
        }),
      }),
    });

    const result = await executeRefinement('run-1', [{ kind: 'flip_winner', sceneId: 'scene-1' }], deps);

    expect(result.steps).toEqual([
      { action: 'flip_winner', ok: false, error: expect.stringContaining('db down') },
    ]);
    expect(deps.recordMlEvent).not.toHaveBeenCalled();
  });

  it('throws when the SECOND scene_variants update returns an error, after the first already landed', async () => {
    const ctx = makeCtx();
    const variants = [
      variantRow({ id: 'va', scene_id: 'scene-1', variant: 'A', winner: true, clip_url: 'a.mp4' }),
      variantRow({ id: 'vb', scene_id: 'scene-1', variant: 'B', winner: false, clip_url: 'b.mp4' }),
    ];
    const { deps } = makeDeps(ctx, variants);
    let call = 0;
    deps.getSupabase = vi.fn().mockReturnValue({
      from: () => ({
        update: () => ({
          eq: () => {
            call++;
            return Promise.resolve(call === 2 ? { error: { message: 'second write failed' } } : { error: null });
          },
        }),
      }),
    });

    const result = await executeRefinement('run-1', [{ kind: 'flip_winner', sceneId: 'scene-1' }], deps);

    expect(result.steps).toEqual([
      { action: 'flip_winner', ok: false, error: expect.stringContaining('second write failed') },
    ]);
    // Only the failed action's own event is skipped — the ml_event that
    // marks the flip as done must never fire when either write failed.
    expect(deps.recordMlEvent).not.toHaveBeenCalledWith('run-1', 'variant_override', expect.anything());
  });
});

describe('executeRefinement — P1-3: regenerate_clip no longer immediate-renders', () => {
  it('a regenerate_clip-only batch at a renderable stage never calls runAssembleStage', async () => {
    const ctx = makeCtx({ stage: 'music' });
    const { deps } = makeDeps(ctx);

    const result = await executeRefinement('run-1', [{ kind: 'regenerate_clip', sceneId: 'scene-1' }], deps);

    expect(deps.regenerateVariant).toHaveBeenCalledWith('run-1', 'scene-1', 'B', undefined);
    expect(deps.runAssembleStage).not.toHaveBeenCalled();
    expect(deps.advanceRun).not.toHaveBeenCalled();
    expect(deps.revertRun).not.toHaveBeenCalled();
    expect(result.rerendering).toBe(false);
  });

  it('regenerate_clip mixed with a genuinely render-affecting action still renders (for the OTHER action, not the clip)', async () => {
    const ctx = makeCtx({ stage: 'music' });
    const { deps } = makeDeps(ctx);

    const result = await executeRefinement('run-1', [
      { kind: 'regenerate_clip', sceneId: 'scene-1' },
      { kind: 'set_music', music_track_id: 'track-2' },
    ], deps);

    expect(deps.runAssembleStage).toHaveBeenCalledTimes(1);
    expect(result.rerendering).toBe(true);
  });
});

describe('executeRefinement — Cap-on-submit: batch_rerender ml_event records at SUBMIT time, not after completion', () => {
  it('BUG 1 (b): a genuine isAssemblyTimeout still counts the cap event and keeps rerendering:true (job was submitted, sweep will finish it)', async () => {
    const ctx = makeCtx({ stage: 'music' });
    const { deps } = makeDeps(ctx);
    deps.runAssembleStage.mockRejectedValue(Object.assign(new Error('[ASSEMBLY_TIMEOUT] Horizontal render timed out'), { isAssemblyTimeout: true }));

    const result = await executeRefinement('run-1', [{ kind: 'set_music', music_track_id: 'track-2' }], deps);

    // The cap-counting event fired BEFORE the render call threw — a real
    // provider timeout must still count against REFINE_CAPS.rerender so a
    // retry loop can't dodge the cap while still burning real spend.
    expect(deps.recordMlEvent).toHaveBeenCalledWith('run-1', 'auto_advance', expect.objectContaining({ action: 'batch_rerender' }));
    // The job token is persisted (see lib/pipeline.ts) before this timeout
    // fires — the auto-run sweep finishes polling it, so this is still an
    // honest "rerendering" outcome, unlike a genuine submission failure below.
    expect(result.rerendering).toBe(true);
    // L3 — the raw provider error text must never reach the user-facing summary.
    expect(result.summary).not.toContain('ASSEMBLY_TIMEOUT');
  });

  it('BUG 1 (c): a non-timeout throw from the render submission reports rerendering:false with an honest summary', async () => {
    const ctx = makeCtx({ stage: 'music' });
    const { deps } = makeDeps(ctx);
    deps.runAssembleStage.mockRejectedValue(new Error('could not reach provider'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await executeRefinement('run-1', [{ kind: 'set_music', music_track_id: 'track-2' }], deps);

    // Never lie that a re-render is in flight when the submission itself failed.
    expect(result.rerendering).toBe(false);
    expect(result.summary).not.toContain('could not reach provider');
    expect(result.summary).toMatch(/re-render did not start/);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('the recordMlEvent call happens before runAssembleStage (submit-time, not completion-time)', async () => {
    const ctx = makeCtx({ stage: 'music' });
    const { deps } = makeDeps(ctx);
    const callOrder: string[] = [];
    deps.recordMlEvent.mockImplementation(async (_id: string, type: string, payload: Record<string, unknown>) => {
      if (type === 'auto_advance' && payload.action === 'batch_rerender') callOrder.push('record');
    });
    deps.runAssembleStage.mockImplementation(async () => { callOrder.push('render'); });

    await executeRefinement('run-1', [{ kind: 'set_music', music_track_id: 'track-2' }], deps);

    expect(callOrder).toEqual(['record', 'render']);
  });
});

describe('executeRefinement — BUG 2: mutable working context threads mutations across the same batch', () => {
  it('edit_details then generate_script: the script generation receives the NEW price, not the pre-batch snapshot', async () => {
    const ctx = makeCtx({ listing_details: { price: 400000, beds: 3, baths: 2, sqft: 1500, mls_description: 'old' } });
    const { deps } = makeDeps(ctx);

    await executeRefinement('run-1', [
      { kind: 'edit_details', price: 500000 },
      { kind: 'generate_script' },
    ], deps);

    expect(deps.generateDeliveryScript).toHaveBeenCalledWith(
      expect.objectContaining({ details: expect.objectContaining({ price: 500000 }) }),
    );
  });

  it('two edit_details actions in one batch compose (second merges over the first) rather than clobbering back to the pre-batch snapshot', async () => {
    const ctx = makeCtx({ listing_details: { price: 400000, beds: 3, baths: 2, sqft: 1500, mls_description: 'old' } });
    const { deps } = makeDeps(ctx);

    await executeRefinement('run-1', [
      { kind: 'edit_details', price: 500000 },
      { kind: 'edit_details', beds: 4 },
    ], deps);

    // The SECOND edit_details didn't specify price, so it must merge over the
    // FIRST edit_details' new price (500000), not the stale pre-batch price
    // (400000) — this is the "two edit_details clobber each other" bug.
    expect(deps.setListingDetails).toHaveBeenLastCalledWith('run-1', expect.objectContaining({ price: 500000, beds: 4 }));
  });

  it('reorder then a second reorder: the second sees the first as "before", not the pre-batch order', async () => {
    const ctx = makeCtx({ scene_order: ['scene-1', 'scene-2'] });
    const { deps } = makeDeps(ctx);

    await executeRefinement('run-1', [
      { kind: 'reorder', scene_order: ['scene-2', 'scene-1'] },
      { kind: 'reorder', scene_order: ['scene-1', 'scene-2'] },
    ], deps);

    expect(deps.recordMlEvent).toHaveBeenNthCalledWith(1, 'run-1', 'reorder', {
      before: ['scene-1', 'scene-2'], after: ['scene-2', 'scene-1'], source: 'telegram_refine',
    });
    expect(deps.recordMlEvent).toHaveBeenNthCalledWith(2, 'run-1', 'reorder', {
      before: ['scene-2', 'scene-1'], after: ['scene-1', 'scene-2'], source: 'telegram_refine',
    });
  });

  it('generate_audio needs no working-ctx patch: it re-reads the run fresh from the DB via runDeliveryAudio(runId)', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps(ctx);

    await executeRefinement('run-1', [
      { kind: 'set_script', text: 'Brand new narration.' },
      { kind: 'generate_audio' },
    ], deps);

    // generate_audio takes ONLY runId — it never receives ctx at all, since
    // lib/delivery/audio.ts's runDeliveryAudio re-reads voiceover_script/
    // voiceover_voice_id fresh from the DB (already-updated by set_script's
    // own updateRun write above).
    expect(deps.runDeliveryAudio).toHaveBeenCalledWith('run-1');
  });
});

describe('executeRefinement — graceful regenerate_all', () => {
  it('replies "nothing to redo" (not "could not start over") when revertRun reports an illegal (already-past-target) transition', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps(ctx);
    deps.revertRun.mockRejectedValue(new Error("revertRun: illegal transition intake -> generating (must be strictly backward)"));

    const result = await executeRefinement('run-1', [{ kind: 'regenerate_all' }], deps);

    expect(result.summary).toMatch(/nothing to redo/i);
    expect(result.summary).not.toMatch(/could not start over/i);
  });

  it('still gives a friendly (sanitized) message for a genuinely unexpected revertRun failure', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps(ctx);
    deps.revertRun.mockRejectedValue(new Error('connection reset by peer'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await executeRefinement('run-1', [{ kind: 'regenerate_all' }], deps);

    expect(result.summary).not.toContain('connection reset by peer');
    expect(result.summary).toMatch(/could not start over/i);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
