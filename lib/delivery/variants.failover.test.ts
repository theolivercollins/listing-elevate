/**
 * variants.failover.test.ts
 *
 * Tests that submitVariantsForProperty and regenerateVariant walk the same
 * provider failover chain as the A-path in runGenerationSubmit:
 *   - on a permanent provider error, append to excluded and try the next
 *     selectProviderForScene decision
 *   - only degrade (or throw) when all providers are exhausted
 *
 * The real functions are driven — no tautologies. Mocks cover supabase,
 * provider router, errors classifier, db helpers, and atlas cost helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mutable state shared between vi.mock factories and tests.
// Module-level so the vi.mock hoisted factories can close over them.
// ---------------------------------------------------------------------------

// generateClip call sequence — each call pops the front element.
// Push Error instances to simulate failures, or { jobId } objects for success.
type GenResult = Error | { jobId: string };
const genQueue: GenResult[] = [];

// Captured upserts on scene_variants.
const upsertCalls: Array<Record<string, unknown>> = [];

// Per-test scene row returned by the scenes table.
let scenesTableData: unknown[] = [];

// ---------------------------------------------------------------------------
// Supabase mock — scene rows come from scenesTableData so tests can vary them.
// ---------------------------------------------------------------------------
vi.mock('../client.js', () => {
  function getSupabase() {
    return {
      from: (table: string) => {
        if (table === 'scenes') {
          const chain: Record<string, unknown> = {};
          const self = () => chain;
          chain.select = self; chain.eq = self; chain.not = self;
          chain.is = self; chain.order = self; chain.neq = self;
          // submitVariantsForProperty calls .select().eq().not() with no terminal
          // method — the chain is directly awaited. Make it thenable so `await chain`
          // resolves to { data: scenesTableData, error: null }.
          chain.then = (resolve: (v: unknown) => unknown) =>
            resolve({ data: scenesTableData, error: null });
          // .limit() is used by some callers.
          chain.limit = () => Promise.resolve({ data: scenesTableData, error: null });
          // regenerateVariant calls .eq(...).single() — returns the first row.
          chain.maybeSingle = () => Promise.resolve({ data: scenesTableData[0] ?? null, error: null });
          chain.single = () => Promise.resolve({ data: scenesTableData[0] ?? null, error: null });
          chain.upsert = (p: Record<string, unknown>) => { upsertCalls.push(p); return Promise.resolve({ data: null, error: null }); };
          chain.update = () => ({ eq: () => Promise.resolve({ data: null, error: null }) });
          return chain;
        }
        if (table === 'photos') {
          const chain: Record<string, unknown> = {};
          const self = () => chain;
          chain.select = self; chain.eq = self;
          chain.single = () => Promise.resolve({ data: { file_url: 'https://example.com/photo.jpg', room_type: 'living_room' }, error: null });
          chain.maybeSingle = () => Promise.resolve({ data: { file_url: 'https://example.com/photo.jpg', room_type: 'living_room' }, error: null });
          return chain;
        }
        if (table === 'properties') {
          const chain: Record<string, unknown> = {};
          const self = () => chain;
          chain.select = self; chain.eq = self;
          chain.maybeSingle = () => Promise.resolve({ data: { pipeline_mode: 'v1' }, error: null });
          chain.single = () => Promise.resolve({ data: { pipeline_mode: 'v1' }, error: null });
          return chain;
        }
        if (table === 'scene_variants') {
          const chain: Record<string, unknown> = {};
          const self = () => chain;
          chain.select = self; chain.eq = self; chain.not = self; chain.is = self; chain.order = self;
          chain.limit = () => Promise.resolve({ data: [], error: null });
          chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
          chain.single = () => Promise.resolve({ data: null, error: null });
          chain.upsert = (p: Record<string, unknown>) => { upsertCalls.push(p); return Promise.resolve({ data: null, error: null }); };
          chain.update = () => ({ eq: () => Promise.resolve({ data: null, error: null }) });
          return chain;
        }
        // fallback
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        chain.select = self; chain.eq = self; chain.not = self; chain.is = self; chain.order = self;
        chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
        chain.single = () => Promise.resolve({ data: null, error: null });
        chain.upsert = (p: Record<string, unknown>) => { upsertCalls.push(p); return Promise.resolve({ data: null, error: null }); };
        chain.update = () => ({ eq: () => Promise.resolve({ data: null, error: null }) });
        return chain;
      },
      storage: {
        from: () => ({
          upload: () => Promise.resolve({ error: null }),
          getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn/${p}` } }),
        }),
      },
    };
  }

  return { getSupabase };
});

// ---------------------------------------------------------------------------
// Router mock — buildProviderFromDecision returns a provider whose
// generateClip pops from genQueue each time it's called.
// ---------------------------------------------------------------------------
vi.mock('../providers/router.js', () => ({
  selectProviderForScene: vi.fn((
    _scene: unknown,
    excluded: string[],
    _mode: unknown,
  ) => {
    // Return atlas first, kling second (mirrors real excluded progression).
    if (!excluded.includes('atlas')) {
      return { provider: 'atlas', modelKey: 'kling-v2-6-pro' };
    }
    return { provider: 'kling', modelKey: undefined };
  }),
  buildProviderFromDecision: vi.fn((decision: { provider: string; modelKey?: string }) => ({
    name: decision.provider,
    generateClip: vi.fn(async () => {
      const result = genQueue.shift();
      if (!result) return { jobId: 'fallback-job' };
      if (result instanceof Error) throw result;
      return result;
    }),
  })),
  forceSeedancePushInPrompt: vi.fn((p: string) => `pushin:${p}`),
  getEnabledProviders: vi.fn(() => ['atlas', 'kling']),
}));

// ---------------------------------------------------------------------------
// errors mock — classifyProviderError: 400/permanent → shouldFailover=true
// ---------------------------------------------------------------------------
vi.mock('../providers/errors.js', () => ({
  classifyProviderError: vi.fn((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    const permanent = /\b400\b|permanent/.test(msg);
    return {
      kind: permanent ? 'permanent' : 'transient',
      message: msg,
      retryable: !permanent,
      shouldFailover: permanent,
    };
  }),
}));

// ---------------------------------------------------------------------------
// DB helpers mock
// ---------------------------------------------------------------------------
vi.mock('../db.js', () => ({
  recordCostEvent: vi.fn().mockResolvedValue(undefined),
  log: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Atlas cost mock
// ---------------------------------------------------------------------------
vi.mock('../providers/atlas.js', () => ({
  atlasClipCostCents: vi.fn().mockReturnValue(50),
  V1_DEFAULT_SKU: 'kling-v2-6-pro',
}));

// ---------------------------------------------------------------------------
// Shared scene fixture
// ---------------------------------------------------------------------------
const BASE_SCENE = {
  id: 'scene-1',
  scene_number: 1,
  photo_id: 'photo-1',
  prompt: 'beautiful living room',
  duration_seconds: 5,
  camera_movement: 'push_in',
  provider: 'atlas',
  provider_task_id: 'atlas-a-task-99', // simulates A having landed
  end_photo_id: null,
  end_image_url: null,
  property_id: 'prop-1',
};

function makeAtlas400Error() {
  return Object.assign(new Error('Atlas HTTP 400 {"code":400,"msg":"not found"}'), { status: 400 });
}

// ---------------------------------------------------------------------------
// submitVariantsForProperty — failover tests
// ---------------------------------------------------------------------------

describe('submitVariantsForProperty — B-variant provider failover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    genQueue.length = 0;
    upsertCalls.length = 0;
    scenesTableData = [BASE_SCENE];
  });

  it('first provider 400s → fails over to second → B row ends with second provider task id, not degraded', async () => {
    const { submitVariantsForProperty } = await import('./variants');

    // atlas 400s, kling succeeds.
    genQueue.push(makeAtlas400Error());
    genQueue.push({ jobId: 'kling-b-task-42' });

    await submitVariantsForProperty('prop-1', 'run-1');

    // The successful B upsert must carry the kling task id.
    const bSuccess = upsertCalls.find(
      (u) => u.variant === 'B' && u.provider_task_id === 'kling-b-task-42',
    );
    expect(bSuccess).toBeDefined();
    expect(bSuccess!.degraded).toBeFalsy();
    expect(bSuccess!.error).toBeFalsy();

    // No degraded B row should exist.
    const bDegraded = upsertCalls.find((u) => u.variant === 'B' && u.degraded === true);
    expect(bDegraded).toBeUndefined();
  });

  it('all decisions fail → B row ends degraded=true', async () => {
    const { submitVariantsForProperty } = await import('./variants');

    // Both providers 400 permanently.
    genQueue.push(makeAtlas400Error());
    genQueue.push(Object.assign(new Error('Kling 400 permanent'), { status: 400 }));

    await submitVariantsForProperty('prop-1', 'run-1');

    // A degraded B upsert must have been written.
    const bDegraded = upsertCalls.find((u) => u.variant === 'B' && u.degraded === true);
    expect(bDegraded).toBeDefined();

    // No successful B task id should have landed.
    const bSuccess = upsertCalls.find(
      (u) => u.variant === 'B' && u.provider_task_id != null,
    );
    expect(bSuccess).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// regenerateVariant — failover tests
// ---------------------------------------------------------------------------

describe('regenerateVariant — provider failover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    genQueue.length = 0;
    upsertCalls.length = 0;
    scenesTableData = [BASE_SCENE];
  });

  it('first provider 400s → falls over to second → upsert ends with second provider task id, not degraded', async () => {
    const { regenerateVariant } = await import('./variants');

    genQueue.push(makeAtlas400Error());
    genQueue.push({ jobId: 'kling-regen-task-7' });

    await regenerateVariant('run-1', 'scene-1', 'B');

    const successUpsert = upsertCalls.find(
      (u) => u.provider_task_id === 'kling-regen-task-7' && u.variant === 'B',
    );
    expect(successUpsert).toBeDefined();
    expect(successUpsert!.degraded).toBeFalsy();
    expect(successUpsert!.error).toBeFalsy();
  });

  it('all decisions fail → regenerateVariant throws (caller degrades the row)', async () => {
    const { regenerateVariant } = await import('./variants');

    genQueue.push(makeAtlas400Error());
    genQueue.push(Object.assign(new Error('Kling 400 permanent'), { status: 400 }));

    await expect(regenerateVariant('run-1', 'scene-1', 'A')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// regenerateVariant — explicit model override (paired regenerate picker)
// ---------------------------------------------------------------------------

describe('regenerateVariant — explicit modelOverride (seedance-pair opt-in)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    genQueue.length = 0;
    upsertCalls.length = 0;
    scenesTableData = [{ ...BASE_SCENE, end_photo_id: 'photo-end-1', end_image_url: 'https://example.com/end.jpg' }];
  });

  it('bypasses selectProviderForScene and submits atlas + the chosen model', async () => {
    const { regenerateVariant } = await import('./variants');
    const { selectProviderForScene, buildProviderFromDecision, forceSeedancePushInPrompt } = await import('../providers/router.js');

    genQueue.push({ jobId: 'seedance-pair-task-1' });

    await regenerateVariant('run-1', 'scene-1', 'A', { modelOverride: 'seedance-pair' });

    // Router routing is fully bypassed — the operator's choice is the decision.
    expect(vi.mocked(selectProviderForScene)).not.toHaveBeenCalled();
    expect(vi.mocked(buildProviderFromDecision)).toHaveBeenCalledWith({
      provider: 'atlas', modelKey: 'seedance-pair', fallback: undefined,
    });
    // Pair mode uses the scene's own prompt — NO push-in preamble (that
    // override is keyed on the exact string 'seedance-pro-pushin').
    expect(vi.mocked(forceSeedancePushInPrompt)).not.toHaveBeenCalled();

    const successUpsert = upsertCalls.find((u) => u.provider_task_id === 'seedance-pair-task-1');
    expect(successUpsert).toBeDefined();
    expect(successUpsert!.provider).toBe('atlas');
  });

  it('does NOT fail over to another model on a permanent error — throws instead', async () => {
    const { regenerateVariant } = await import('./variants');
    const { selectProviderForScene } = await import('../providers/router.js');

    genQueue.push(makeAtlas400Error());
    genQueue.push({ jobId: 'should-never-be-used' });

    await expect(
      regenerateVariant('run-1', 'scene-1', 'B', { modelOverride: 'seedance-pair' }),
    ).rejects.toThrow();

    // One attempt only; no router consultation, no success upsert.
    expect(vi.mocked(selectProviderForScene)).not.toHaveBeenCalled();
    const successUpsert = upsertCalls.find((u) => u.provider_task_id != null);
    expect(successUpsert).toBeUndefined();
  });
});
