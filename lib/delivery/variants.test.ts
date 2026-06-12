import { describe, it, expect, vi, beforeEach } from 'vitest';
import { variantPairStatus } from './variants';

const v = (over: Record<string, unknown>) => ({
  id: 'x', delivery_run_id: 'r1', scene_id: 's1', variant: 'A', provider: 'atlas',
  provider_task_id: 't', clip_url: null, cost_cents: null, gemini_scores: null,
  winner: false, winner_source: null, degraded: false, error: null,
  created_at: '', updated_at: '', ...over,
});

describe('variantPairStatus', () => {
  it('pending while either variant is in flight', () => {
    expect(variantPairStatus(v({ clip_url: 'a.mp4' }), v({ variant: 'B' }))).toBe('pending');
  });
  it('ready when both clips landed', () => {
    expect(variantPairStatus(v({ clip_url: 'a.mp4' }), v({ variant: 'B', clip_url: 'b.mp4' }))).toBe('ready');
  });
  it('degraded when B errored and A landed', () => {
    expect(variantPairStatus(v({ clip_url: 'a.mp4' }), v({ variant: 'B', error: 'submit failed', provider_task_id: null }))).toBe('degraded');
  });
  it('degraded when B is missing entirely', () => {
    expect(variantPairStatus(v({ clip_url: 'a.mp4' }), null)).toBe('degraded');
  });
  it('failed when neither produced a clip and nothing is in flight', () => {
    expect(variantPairStatus(v({ error: 'x', provider_task_id: null }), v({ variant: 'B', error: 'y', provider_task_id: null }))).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// pollPendingVariants — discriminator: original-A vs regenerated-A vs B
// ---------------------------------------------------------------------------
// The real function is called; mocks cover supabase, selectProvider, db helpers,
// and atlas cost helpers. If the `.eq('variant','B')` filter were re-introduced,
// the regen-A and B collection tests would both fail because those rows would
// never enter the polling loop.

// --- supabase mock ------------------------------------------------------------
// Holds per-test configuration: what `pending` rows to return and what the
// scene row looks like. Built as a table-dispatch fluent mock so the real
// function's chain (from→select→not→is→order→limit, from→select→eq→single,
// from→update→eq, storage.*) all resolve correctly.

type PendingConfig = {
  pendingRows: ReturnType<typeof v>[];
  sceneRow: {
    property_id: string; scene_number: number;
    duration_seconds: number; provider_task_id: string;
  };
};

const mockConfig: PendingConfig = {
  pendingRows: [],
  sceneRow: { property_id: 'prop-1', scene_number: 1, duration_seconds: 5, provider_task_id: 'scene-task' },
};

// Captured update calls so tests can assert on what was written.
const updateCalls: { table: string; patch: Record<string, unknown> }[] = [];
// Storage uploads must NOT happen on the Bunny host path — uploadCalls stays empty.
const uploadCalls: { path: string }[] = [];
// Captured Bunny host calls (title is the old clipPath string; identifies the clip).
const bunnyHostCalls: { title: string }[] = [];

vi.mock('../client.js', () => {
  function makeChain(resolvedData: unknown) {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    chain.select = self;
    chain.not = self;
    chain.is = self;
    chain.order = self;
    chain.limit = () => Promise.resolve({ data: resolvedData, error: null });
    chain.eq = self;
    chain.single = () => Promise.resolve({ data: resolvedData, error: null });
    chain.update = (patch: Record<string, unknown>) => {
      // Capture the table name by closure — set below per-table.
      (chain as { _patch?: Record<string, unknown> })._patch = patch;
      const eqChain: Record<string, unknown> = {};
      eqChain.eq = () => Promise.resolve({ data: null, error: null });
      return eqChain;
    };
    return chain;
  }

  const storageBuilder = {
    upload: (_path: string) => {
      uploadCalls.push({ path: _path });
      return Promise.resolve({ error: null });
    },
    getPublicUrl: (path: string) => ({
      data: { publicUrl: `https://cdn.example.com/${path}` },
    }),
  };

  function getSupabase() {
    return {
      from: (table: string) => {
        if (table === 'scene_variants') {
          // Two roles: the initial SELECT (returns pendingRows) and UPDATE calls.
          // We distinguish by tracking call order via a proxy.
          const chain: Record<string, unknown> = {};
          const self = () => chain;
          chain.select = self;
          chain.not = self;
          chain.is = self;
          chain.order = self;
          chain.limit = () => Promise.resolve({ data: mockConfig.pendingRows, error: null });
          chain.eq = self;
          chain.single = () => Promise.resolve({ data: mockConfig.pendingRows[0] ?? null, error: null });
          chain.update = (patch: Record<string, unknown>) => {
            updateCalls.push({ table: 'scene_variants', patch });
            const eq = { eq: () => Promise.resolve({ data: null, error: null }) };
            return eq;
          };
          return chain;
        }
        if (table === 'scenes') {
          return makeChain(mockConfig.sceneRow);
        }
        // Fallback for any other table (cost events etc.)
        return makeChain(null);
      },
      storage: {
        from: (_bucket: string) => storageBuilder,
      },
    };
  }

  return { getSupabase };
});

vi.mock('../providers/router.js', () => ({
  selectProvider: vi.fn(),
  selectProviderForScene: vi.fn(),
  buildProviderFromDecision: vi.fn(),
  forceSeedancePushInPrompt: vi.fn((p: string) => p),
}));

vi.mock('../db.js', () => ({
  recordCostEvent: vi.fn().mockResolvedValue(undefined),
  log: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../providers/atlas.js', () => ({
  atlasClipCostCents: vi.fn().mockReturnValue(50),
  V1_DEFAULT_SKU: 'atlas-v1',
}));

// Bunny Stream mock — video hosting target since 2026-06-12. Default: configured
// + successful host returning a CDN mp4 URL derived from the title (old clipPath),
// so tests can assert clip_url is the Bunny URL. Tests override per-case to
// simulate unconfigured / host failure.
vi.mock('../providers/bunny-stream.js', () => ({
  isBunnyConfigured: vi.fn().mockReturnValue(true),
  hostVideoOnBunny: vi.fn(async (title: string) => {
    bunnyHostCalls.push({ title });
    return {
      guid: 'guid-' + title,
      mp4Url: `https://bunny.example.com/${encodeURIComponent(title)}/play_720p.mp4`,
      hlsUrl: `https://bunny.example.com/${encodeURIComponent(title)}/playlist.m3u8`,
      status: 4,
    };
  }),
  bunnyStreamCostCents: vi.fn().mockReturnValue(0),
}));

// Helper: build a mock provider that resolves checkStatus to completed with a clip.
function makeCompletedProvider(providerName: string) {
  return {
    name: providerName,
    checkStatus: vi.fn().mockResolvedValue({
      status: 'completed',
      videoUrl: 'https://provider.example.com/clip.mp4',
      costCents: 50,
      providerUnits: 1,
      providerUnitType: 'credits',
    }),
    downloadClip: vi.fn().mockResolvedValue(Buffer.from('fakevideo')),
  };
}

describe('pollPendingVariants — discriminator paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateCalls.length = 0;
    uploadCalls.length = 0;
    bunnyHostCalls.length = 0;
    mockConfig.pendingRows = [];
    mockConfig.sceneRow = {
      property_id: 'prop-1', scene_number: 1,
      duration_seconds: 5, provider_task_id: 'scene-task-original',
    };
  });

  // (a) original-A row: task id matches the scene → skip entirely.
  //     Regression proof: if the `.eq('variant','B')` filter were re-added to
  //     the SELECT, the row would be absent from pending[], the test would still
  //     pass — but the *next* two tests drive the function with A rows that
  //     SHOULD be processed, and those would fail because they'd be filtered out.
  //     This test's value is the NEGATIVE assertion: checkStatus is never called
  //     and the row is never updated.
  it('(a) skips an original-A row — no provider call, no row update', async () => {
    const { pollPendingVariants } = await import('./variants');
    const { selectProvider } = await import('../providers/router.js');

    // Pending: one A row whose task id matches the scene's task id exactly.
    mockConfig.pendingRows = [v({ variant: 'A', provider_task_id: 'scene-task-original', provider: 'atlas' })];
    mockConfig.sceneRow = { property_id: 'prop-1', scene_number: 1, duration_seconds: 5, provider_task_id: 'scene-task-original' };

    const result = await pollPendingVariants(10);

    // Nothing completed or failed — the row was skipped.
    expect(result).toEqual({ polled: 1, completed: 0, failed: 0 });
    // selectProvider was never called (no checkStatus path entered).
    expect(vi.mocked(selectProvider)).not.toHaveBeenCalled();
    // The scene_variants row was never updated.
    expect(updateCalls).toHaveLength(0);
    // Neither storage nor Bunny was touched.
    expect(uploadCalls).toHaveLength(0);
    expect(bunnyHostCalls).toHaveLength(0);
  });

  // (b) regenerated-A row: task id DIFFERS from scene's → should be collected.
  //     Regression proof: if `.eq('variant','B')` were added to the SELECT, this
  //     A row would not appear in pending[], pollPendingVariants would return
  //     { polled:0, completed:0, failed:0 }, and the completed===1 assertion fails.
  it('(b) collects a regenerated-A row — hosts on Bunny (title ends _A.mp4), clip_url is the Bunny URL, no Supabase upload', async () => {
    const { pollPendingVariants } = await import('./variants');
    const { selectProvider } = await import('../providers/router.js');
    const { hostVideoOnBunny, bunnyStreamCostCents } = await import('../providers/bunny-stream.js');
    const { recordCostEvent } = await import('../db.js');

    const mockProvider = makeCompletedProvider('atlas');
    vi.mocked(selectProvider).mockReturnValue(mockProvider as ReturnType<typeof selectProvider>);

    // A row with a NEW task id (regenerateVariant just fired a fresh render).
    mockConfig.pendingRows = [v({ id: 'var-regen-a', variant: 'A', provider_task_id: 'regen-task-new', provider: 'atlas', scene_id: 'scene-1' })];
    mockConfig.sceneRow = { property_id: 'prop-1', scene_number: 3, duration_seconds: 5, provider_task_id: 'scene-task-original' };

    const result = await pollPendingVariants(10);

    expect(result).toEqual({ polled: 1, completed: 1, failed: 0 });
    // Provider was used to check status, and the clip downloaded.
    expect(mockProvider.checkStatus).toHaveBeenCalledWith('regen-task-new');
    expect(mockProvider.downloadClip).toHaveBeenCalled();
    // The clip was hosted on Bunny (NOT uploaded to Supabase Storage). The Bunny
    // title is the old clipPath, which ends with _A.mp4.
    expect(uploadCalls).toHaveLength(0);
    expect(bunnyHostCalls).toHaveLength(1);
    expect(bunnyHostCalls[0].title).toMatch(/_A\.mp4$/);
    expect(vi.mocked(hostVideoOnBunny)).toHaveBeenCalledTimes(1);
    // Row was updated with clip_url === the Bunny CDN URL.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].patch.clip_url).toMatch(/^https:\/\/bunny\.example\.com\//);
    // A bunny cost_event was emitted in addition to the render cost_event.
    expect(vi.mocked(bunnyStreamCostCents)).toHaveBeenCalled();
    expect(vi.mocked(recordCostEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'bunny', unitType: 'renders', metadata: expect.objectContaining({ bunny_hosted: true, source: 'delivery' }) }),
    );
  });

  // (c) B row: variant='B' short-circuits the discriminator → always collected.
  //     Regression proof: if `.eq('variant','B')` were re-added, this row WOULD
  //     still appear in pending[], so this test alone doesn't catch the regression.
  //     Test (b) above is the primary regression detector; (c) confirms the B
  //     path produces the correct storage suffix and cost recording.
  it('(c) collects a B row — hosts on Bunny (title ends _B.mp4), clip_url is the Bunny URL', async () => {
    const { pollPendingVariants } = await import('./variants');
    const { selectProvider } = await import('../providers/router.js');

    const mockProvider = makeCompletedProvider('atlas');
    vi.mocked(selectProvider).mockReturnValue(mockProvider as ReturnType<typeof selectProvider>);

    mockConfig.pendingRows = [v({ id: 'var-b', variant: 'B', provider_task_id: 'b-task-1', provider: 'atlas', scene_id: 'scene-1' })];
    mockConfig.sceneRow = { property_id: 'prop-1', scene_number: 2, duration_seconds: 5, provider_task_id: 'scene-task-original' };

    const result = await pollPendingVariants(10);

    expect(result).toEqual({ polled: 1, completed: 1, failed: 0 });
    expect(mockProvider.checkStatus).toHaveBeenCalledWith('b-task-1');
    expect(uploadCalls).toHaveLength(0);
    expect(bunnyHostCalls).toHaveLength(1);
    // Bunny title (old clipPath) must end with _B.mp4 (variant B suffix).
    expect(bunnyHostCalls[0].title).toMatch(/_B\.mp4$/);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].patch.clip_url).toMatch(/^https:\/\/bunny\.example\.com\//);
  });

  // (d) Bunny unconfigured → graceful fallback to the provider videoUrl, no throw,
  //     no bunny host, no bunny cost_event. The clip is still collected (completed).
  it('(d) Bunny unconfigured → falls back to provider videoUrl, no host, no throw', async () => {
    const { pollPendingVariants } = await import('./variants');
    const { selectProvider } = await import('../providers/router.js');
    const { isBunnyConfigured, hostVideoOnBunny } = await import('../providers/bunny-stream.js');
    const { recordCostEvent } = await import('../db.js');

    vi.mocked(isBunnyConfigured).mockReturnValueOnce(false);
    const mockProvider = makeCompletedProvider('atlas');
    vi.mocked(selectProvider).mockReturnValue(mockProvider as unknown as ReturnType<typeof selectProvider>);

    mockConfig.pendingRows = [v({ id: 'var-b', variant: 'B', provider_task_id: 'b-task-1', provider: 'atlas', scene_id: 'scene-1' })];
    mockConfig.sceneRow = { property_id: 'prop-1', scene_number: 2, duration_seconds: 5, provider_task_id: 'scene-task-original' };

    const result = await pollPendingVariants(10);

    expect(result).toEqual({ polled: 1, completed: 1, failed: 0 });
    expect(vi.mocked(hostVideoOnBunny)).not.toHaveBeenCalled();
    expect(bunnyHostCalls).toHaveLength(0);
    // clip_url falls back to the provider videoUrl.
    expect(updateCalls[0].patch.clip_url).toBe('https://provider.example.com/clip.mp4');
    // No bunny cost_event (render cost_event still emitted, but not provider:'bunny').
    expect(vi.mocked(recordCostEvent)).not.toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'bunny' }),
    );
  });

  // (e) Bunny host THROWS → graceful fallback to the provider videoUrl, run continues
  //     (zero-HITL: a Bunny outage must never break the autonomous poll).
  it('(e) Bunny host throws → falls back to provider videoUrl, completes without throwing', async () => {
    const { pollPendingVariants } = await import('./variants');
    const { selectProvider } = await import('../providers/router.js');
    const { hostVideoOnBunny } = await import('../providers/bunny-stream.js');

    vi.mocked(hostVideoOnBunny).mockRejectedValueOnce(new Error('Bunny 500'));
    const mockProvider = makeCompletedProvider('atlas');
    vi.mocked(selectProvider).mockReturnValue(mockProvider as unknown as ReturnType<typeof selectProvider>);

    mockConfig.pendingRows = [v({ id: 'var-b', variant: 'B', provider_task_id: 'b-task-1', provider: 'atlas', scene_id: 'scene-1' })];
    mockConfig.sceneRow = { property_id: 'prop-1', scene_number: 2, duration_seconds: 5, provider_task_id: 'scene-task-original' };

    const result = await pollPendingVariants(10);

    // The poll did NOT throw — the row is still collected and clip_url falls back.
    expect(result).toEqual({ polled: 1, completed: 1, failed: 0 });
    expect(updateCalls[0].patch.clip_url).toBe('https://provider.example.com/clip.mp4');
  });
});
