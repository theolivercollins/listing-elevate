/**
 * Unit tests for lib/delivery/auto-run.ts — autopilot resolver core.
 *
 * Strategy:
 *   - Guard branches (pure, no I/O) — covered without Supabase.
 *   - Resolver branches (advance vs pause) — lib functions, Supabase, and the
 *     Anthropic SDK are all vi.mock'd so no real I/O occurs.
 *   - pauseForHuman itself requires a live DB; that path is exercised in the
 *     integration suite (T7). Here we assert it was called with the right args.
 */

import { describe, it, expect, afterEach, beforeEach, vi, type Mock } from 'vitest';
import {
  resolveGate,
  resolveAssembling,
  canWrite,
  AUTO_JUDGE_MARGIN,
  AUTO_DELIVER_THRESHOLD,
  AUTO_PHOTO_MIN_SELECTED,
  resolveCheckpointA,
  resolveDetails,
  resolvePhotoSelection,
  resolveVoiceover,
  resolveMusic,
  resolveCheckpointB,
  pauseForHuman,
  buildOrderedRoomSequence,
  reclaimStrandedRefiningLocks,
  STRANDED_REFINING_LOCK_TTL_MS,
} from '../auto-run.js';
import type { DeliveryRunRow } from '../../types/operator-studio.js';

// ─── MODULE MOCKS ─────────────────────────────────────────────────────────────

vi.mock('../../client.js', () => ({
  getSupabase: vi.fn(),
}));

vi.mock('../runs.js', () => ({
  getRun: vi.fn(),
  getVariantsForRun: vi.fn(),
  updateRun: vi.fn(),
  recordMlEvent: vi.fn(),
  advanceRun: vi.fn(),
}));

vi.mock('../voiceover-script.js', () => ({
  generateDeliveryScript: vi.fn(),
}));

vi.mock('../../voiceover/generate-audio.js', () => ({
  generateVoiceoverAudio: vi.fn(),
}));

// Shared audio runner (duration-audit + synth) — resolveVoiceover delegates to it.
vi.mock('../audio.js', () => ({
  runDeliveryAudio: vi.fn(),
}));

// Assembly driver — resolveMusic drives assembling → checkpoint_b through it.
vi.mock('../assemble.js', () => ({
  runAssembleStage: vi.fn(),
}));

vi.mock('../../voiceover/voices.js', () => ({
  VOICES: [
    { id: 'voice-mark', name: 'Mark', gender: 'male', description: 'Natural, conversational' },
    { id: 'voice-jack', name: 'Jack', gender: 'male', description: 'Deep, commanding narrator' },
    { id: 'voice-amanda', name: 'Amanda', gender: 'female', description: 'Warm, polished, informative' },
    { id: 'voice-jessica', name: 'Jessica', gender: 'female', description: 'Young, conversational, natural' },
  ],
  defaultVoiceId: vi.fn().mockReturnValue('voice-amanda'),
}));

vi.mock('../../assembly/music.js', () => ({
  moodForPackage: vi.fn().mockReturnValue('upbeat'),
  MoodTag: undefined,
}));

vi.mock('../../utils/claude-cost.js', () => ({
  computeClaudeCost: vi.fn().mockReturnValue({ costCents: 0.01, totalTokens: 100, model: 'claude-haiku-4-5', breakdown: {} }),
}));

vi.mock('../../db.js', () => ({
  recordCostEvent: vi.fn().mockResolvedValue(undefined),
}));

// Assembly-router — used by resolveAssembling (Path 2: resume polling job IDs).
vi.mock('../../providers/assembly-router.js', () => ({
  selectAssemblyProvider: vi.fn().mockReturnValue({
    name: 'creatomate',
    checkStatus: vi.fn(),
    assemble: vi.fn(),
  }),
  pollAssemblyJob: vi.fn(),
  assemblyProviderCostCents: vi.fn().mockReturnValue(100),
}));

// Finalize — resolveAssembling calls this after a job completes.
vi.mock('../../assembly/finalize.js', () => ({
  finalizeAssemblyRender: vi.fn().mockResolvedValue({
    url: 'https://bunny.cdn/final.mp4',
    bitrateKbps: 9000,
    outputBytes: null,
    bunnyWasCalled: false,
  }),
}));

// Bunny cost emitter — resolveAssembling emits per finalized orientation on resume.
vi.mock('../../assembly/bunny-finalize-cost.js', () => ({
  emitBunnyFinalizeCostEvent: vi.fn().mockResolvedValue(undefined),
}));

// Photo selection — resolvePhotoSelection reads AI-recommended ids and applies them.
vi.mock('../photo-selection.js', () => ({
  getPhotoSelectionForRun: vi.fn(),
  applyPhotoSelectionForRun: vi.fn(),
}));

const mockAnthropicCreate = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockAnthropicCreate },
  })),
}));

// Import mocked modules for use in tests
import { getSupabase } from '../../client.js';
import { getRun, getVariantsForRun, updateRun, recordMlEvent, advanceRun } from '../runs.js';
import { generateDeliveryScript } from '../voiceover-script.js';
import { runDeliveryAudio } from '../audio.js';
import { runAssembleStage } from '../assemble.js';
import { recordCostEvent } from '../../db.js';
import { pollAssemblyJob, assemblyProviderCostCents } from '../../providers/assembly-router.js';
import { finalizeAssemblyRender } from '../../assembly/finalize.js';
import { emitBunnyFinalizeCostEvent } from '../../assembly/bunny-finalize-cost.js';
import { getPhotoSelectionForRun, applyPhotoSelectionForRun } from '../photo-selection.js';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Minimal valid DeliveryRunRow for testing — override fields as needed. */
function makeRun(overrides: Partial<DeliveryRunRow> = {}): DeliveryRunRow {
  return {
    id: 'run-1',
    property_id: 'prop-1',
    client_id: null,
    video_type: 'just_listed',
    duration_seconds: 30,
    stage: 'checkpoint_a',
    listing_details: {},
    scene_order: null,
    voiceover_script: null,
    voiceover_voice_id: null,
    voiceover_audio_url: null,
    music_track_id: null,
    error: null,
    auto_run: true,
    paused_reason: null,
    auto_paused_at: null,
    created_at: '2026-06-26T00:00:00Z',
    updated_at: '2026-06-26T00:00:00Z',
    ...overrides,
  };
}

/** Build a mock SceneVariantRow. */
function makeVariant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sv-1',
    delivery_run_id: 'run-1',
    scene_id: 'scene-1',
    variant: 'A' as const,
    provider: null,
    provider_task_id: null,
    clip_url: 'https://example.com/a.mp4',
    cost_cents: null,
    gemini_scores: null,
    winner: false,
    winner_source: null,
    degraded: false,
    error: null,
    created_at: '2026-06-26T00:00:00Z',
    updated_at: '2026-06-26T00:00:00Z',
    ...overrides,
  };
}

/** Mock Supabase chainable query builder returning `data`. */
function makeDbChain(data: unknown, error: unknown = null) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    single: vi.fn().mockResolvedValue({ data, error }),
  };
  return chain;
}

function makeLlmResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 50, output_tokens: 5 },
  };
}

/** Save and restore process.env fields so tests don't bleed into each other. */
const savedEnv: Record<string, string | undefined> = {};
function setEnv(key: string, value: string | undefined): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  for (const key of Object.keys(savedEnv)) {
    delete savedEnv[key];
  }
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// Fresh-read guard (P1-1) default: every resolveGate/resolveAssembling test in
// this file that does NOT itself exercise the new guard should behave exactly
// as it did before the guard existed — i.e. the "fresh" read agrees with
// whatever paused_reason the in-memory `run` fixture already carries (null,
// for every pre-existing fixture). Dedicated tests below override this
// per-call with mockResolvedValueOnce/mockResolvedValue. Set in beforeEach
// (not afterEach) so it applies before the very first test too, and is
// reasserted before every subsequent test regardless of what a prior test set.
beforeEach(() => {
  (getRun as Mock).mockResolvedValue({ paused_reason: null } as DeliveryRunRow);
});

// ─── canWrite() ───────────────────────────────────────────────────────────────

describe('canWrite()', () => {
  it('returns false when neither env var is set', () => {
    setEnv('VERCEL_ENV', undefined);
    setEnv('LE_ALLOW_NONPROD_WRITES', undefined);
    expect(canWrite()).toBe(false);
  });

  it('returns true when VERCEL_ENV is "production"', () => {
    setEnv('VERCEL_ENV', 'production');
    setEnv('LE_ALLOW_NONPROD_WRITES', undefined);
    expect(canWrite()).toBe(true);
  });

  it('returns true when LE_ALLOW_NONPROD_WRITES is "true"', () => {
    setEnv('VERCEL_ENV', undefined);
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    expect(canWrite()).toBe(true);
  });

  it('returns false when VERCEL_ENV is "preview" (not production)', () => {
    setEnv('VERCEL_ENV', 'preview');
    setEnv('LE_ALLOW_NONPROD_WRITES', undefined);
    expect(canWrite()).toBe(false);
  });
});

// ─── CONFIG EXPORTS ──────────────────────────────────────────────────────────

describe('exported config constants', () => {
  it('AUTO_JUDGE_MARGIN is a positive number < 1', () => {
    expect(AUTO_JUDGE_MARGIN).toBeGreaterThan(0);
    expect(AUTO_JUDGE_MARGIN).toBeLessThan(1);
  });

  it('AUTO_DELIVER_THRESHOLD is a positive number < 1', () => {
    expect(AUTO_DELIVER_THRESHOLD).toBeGreaterThan(0);
    expect(AUTO_DELIVER_THRESHOLD).toBeLessThan(1);
  });

  it('AUTO_PHOTO_MIN_SELECTED is a positive integer', () => {
    expect(AUTO_PHOTO_MIN_SELECTED).toBeGreaterThan(0);
    expect(Number.isInteger(AUTO_PHOTO_MIN_SELECTED)).toBe(true);
  });
});

// ─── resolveGate — guard branches ────────────────────────────────────────────

describe('resolveGate — Guard 1: auto_run off', () => {
  it('returns noop when auto_run is false', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    const result = await resolveGate(makeRun({ auto_run: false }));
    expect(result).toEqual({ action: 'noop', reason: 'auto_run off' });
  });
});

describe('resolveGate — Guard 2: already paused', () => {
  it('returns noop when paused_reason is set', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    const result = await resolveGate(
      makeRun({ auto_run: true, paused_reason: 'low judge margin on scene abc' }),
    );
    expect(result).toEqual({ action: 'noop', reason: 'paused' });
  });

  it('does NOT short-circuit when paused_reason is null (passes Guard 2)', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    const result = await resolveGate(
      makeRun({ auto_run: true, paused_reason: null, stage: 'intake' }),
    );
    // Should hit Guard 3, not Guard 2
    expect(result).toEqual({ action: 'noop', reason: 'not a gate stage' });
  });
});

describe('resolveGate — Guard 3: non-gate stage', () => {
  // photo_selection is now a GATE stage — it is intentionally absent from this list.
  it.each([
    'intake', 'scraping', 'generating', 'judging', 'assembling', 'delivered',
  ])('returns noop for auto-stage "%s"', async (stage) => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    const result = await resolveGate(makeRun({ auto_run: true, paused_reason: null, stage }));
    expect(result).toEqual({ action: 'noop', reason: 'not a gate stage' });
  });
});

describe('resolveGate — Guard 4: write guard', () => {
  it('returns noop when neither prod env var is set', async () => {
    setEnv('VERCEL_ENV', undefined);
    setEnv('LE_ALLOW_NONPROD_WRITES', undefined);
    const result = await resolveGate(
      makeRun({ auto_run: true, paused_reason: null, stage: 'checkpoint_a' }),
    );
    expect(result).toEqual({ action: 'noop', reason: 'write guard: non-prod' });
  });

  it('returns noop when VERCEL_ENV is "preview" (not production)', async () => {
    setEnv('VERCEL_ENV', 'preview');
    setEnv('LE_ALLOW_NONPROD_WRITES', undefined);
    const result = await resolveGate(
      makeRun({ auto_run: true, paused_reason: null, stage: 'checkpoint_a' }),
    );
    expect(result).toEqual({ action: 'noop', reason: 'write guard: non-prod' });
  });
});

// ─── resolveCheckpointA ───────────────────────────────────────────────────────

describe('resolveCheckpointA', () => {
  it('advances when all judged scenes have margin ≥ AUTO_JUDGE_MARGIN', async () => {
    // Scene with margin = 0.25 (above 0.15 threshold).
    // A=20 total, B=15 total → margin = |20-15| / 20 = 0.25
    const variantA = makeVariant({
      variant: 'A', scene_id: 'sc1', winner: true, winner_source: 'gemini',
      gemini_scores: { motion_quality: 5, artifacts: 5, realism: 5, composition: 5 }, // total 20
    });
    const variantB = makeVariant({
      variant: 'B', scene_id: 'sc1', winner: false, winner_source: null,
      gemini_scores: { motion_quality: 4, artifacts: 4, realism: 4, composition: 3 }, // total 15
    });
    (getVariantsForRun as Mock).mockResolvedValue([variantA, variantB]);
    (recordMlEvent as Mock).mockResolvedValue(undefined);
    (advanceRun as Mock).mockResolvedValue({});

    const result = await resolveCheckpointA(makeRun());
    expect(result).toEqual({ action: 'advanced', to: 'details' });
    expect(advanceRun).toHaveBeenCalledWith('run-1', 'details');
    expect(recordMlEvent).toHaveBeenCalledWith('run-1', 'auto_advance', expect.objectContaining({
      source: 'auto', gate: 'checkpoint_a',
    }));
  });

  it('auto-accepts degraded scenes (winner_source=default) and advances', async () => {
    const variantA = makeVariant({
      variant: 'A', scene_id: 'sc1', winner: true, winner_source: 'default',
      gemini_scores: { judge_error: 'degraded pair' },
    });
    const variantB = makeVariant({
      variant: 'B', scene_id: 'sc1', winner: false, winner_source: null,
    });
    (getVariantsForRun as Mock).mockResolvedValue([variantA, variantB]);
    (recordMlEvent as Mock).mockResolvedValue(undefined);
    (advanceRun as Mock).mockResolvedValue({});

    const result = await resolveCheckpointA(makeRun());
    expect(result).toEqual({ action: 'advanced', to: 'details' });
  });

  it('pauses when a scene margin is below AUTO_JUDGE_MARGIN', async () => {
    // Margin = |10-9| / 20 = 0.05 (below 0.15)
    const variantA = makeVariant({
      variant: 'A', scene_id: 'sc1', winner: true, winner_source: 'gemini',
      gemini_scores: { motion_quality: 3, artifacts: 2, realism: 3, composition: 2 }, // 10
    });
    const variantB = makeVariant({
      variant: 'B', scene_id: 'sc1', winner: false, winner_source: null,
      gemini_scores: { motion_quality: 3, artifacts: 2, realism: 2, composition: 2 }, // 9
    });
    (getVariantsForRun as Mock).mockResolvedValue([variantA, variantB]);

    // Mock pauseForHuman (it calls getSupabase internally)
    const db = makeDbChain(null);
    db.update.mockReturnThis();
    (db.update as unknown as Mock).mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    (db.insert as unknown as Mock).mockResolvedValue({ error: null });
    (getSupabase as Mock).mockReturnValue(db);

    const result = await resolveCheckpointA(makeRun());
    expect(result.action).toBe('paused');
    expect((result as { action: 'paused'; reason: string }).reason).toMatch(/low judge margin on scene sc1/);
  });

  it('advances with confidence=1 when run has NO variant rows (empty run)', async () => {
    (getVariantsForRun as Mock).mockResolvedValue([]);
    (recordMlEvent as Mock).mockResolvedValue(undefined);
    (advanceRun as Mock).mockResolvedValue({});

    const result = await resolveCheckpointA(makeRun());
    expect(result).toEqual({ action: 'advanced', to: 'details' });
  });
});

// ─── resolveDetails ───────────────────────────────────────────────────────────

describe('resolveDetails', () => {
  it('advances when price, beds, baths are all present', async () => {
    (recordMlEvent as Mock).mockResolvedValue(undefined);
    (advanceRun as Mock).mockResolvedValue({});

    const run = makeRun({ listing_details: { price: 500000, beds: 3, baths: 2 } });
    const result = await resolveDetails(run);
    expect(result).toEqual({ action: 'advanced', to: 'voiceover' });
    expect(advanceRun).toHaveBeenCalledWith('run-1', 'voiceover');
    expect(recordMlEvent).toHaveBeenCalledWith('run-1', 'auto_advance', expect.objectContaining({
      source: 'auto', gate: 'details', confidence: 1,
    }));
  });

  it('pauses when price is missing', async () => {
    const db = makeDbChain(null);
    (db.update as unknown as Mock).mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    (db.insert as unknown as Mock).mockResolvedValue({ error: null });
    (getSupabase as Mock).mockReturnValue(db);

    const run = makeRun({ listing_details: { beds: 3, baths: 2 } });
    const result = await resolveDetails(run);
    expect(result.action).toBe('paused');
    expect((result as { action: 'paused'; reason: string }).reason).toMatch(/missing listing field: price/);
  });

  it('pauses when beds is missing', async () => {
    const db = makeDbChain(null);
    (db.update as unknown as Mock).mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    (db.insert as unknown as Mock).mockResolvedValue({ error: null });
    (getSupabase as Mock).mockReturnValue(db);

    const run = makeRun({ listing_details: { price: 500000, baths: 2 } });
    const result = await resolveDetails(run);
    expect(result.action).toBe('paused');
    expect((result as { action: 'paused'; reason: string }).reason).toMatch(/missing listing field: beds/);
  });

  it('pauses when baths is missing', async () => {
    const db = makeDbChain(null);
    (db.update as unknown as Mock).mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    (db.insert as unknown as Mock).mockResolvedValue({ error: null });
    (getSupabase as Mock).mockReturnValue(db);

    const run = makeRun({ listing_details: { price: 500000, beds: 3 } });
    const result = await resolveDetails(run);
    expect(result.action).toBe('paused');
    expect((result as { action: 'paused'; reason: string }).reason).toMatch(/missing listing field: baths/);
  });
});

// ─── resolvePhotoSelection ────────────────────────────────────────────────────

describe('resolvePhotoSelection', () => {
  /** Set up getSupabase for pauseForHuman calls (delivery_runs update + ml_events insert). */
  function setupPauseDb() {
    const db = makeDbChain(null);
    (db.update as unknown as Mock).mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    (db.insert as unknown as Mock).mockResolvedValue({ error: null });
    (getSupabase as Mock).mockReturnValue(db);
  }

  it('confident: 12 photos — applies selection, logs auto_advance, triggers continue hop, returns advanced→generating', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `photo-${i + 1}`);
    (getPhotoSelectionForRun as Mock).mockResolvedValue({ selected_photo_ids: ids, photos: [] });
    (applyPhotoSelectionForRun as Mock).mockResolvedValue({ selected_photo_ids: ids });
    (recordMlEvent as Mock).mockResolvedValue(undefined);

    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
    setEnv('VERCEL_URL', 'listingelevate.vercel.app');

    const run = makeRun({ stage: 'photo_selection' });
    const result = await resolvePhotoSelection(run);

    // Applied with all 12 recommended ids, no rejected array.
    expect(applyPhotoSelectionForRun).toHaveBeenCalledWith('run-1', { photo_order: ids });

    // auto_advance ml_event logged with correct gate and count.
    expect(recordMlEvent).toHaveBeenCalledWith('run-1', 'auto_advance', {
      source: 'auto',
      gate: 'photo_selection',
      confidence: 1,
      selected_count: 12,
    });

    // Continue hop fired at the correct URL.
    expect(mockFetch).toHaveBeenCalledWith(
      `https://listingelevate.vercel.app/api/pipeline/continue/run-1`,
      { method: 'POST' },
    );

    expect(result).toEqual({ action: 'advanced', to: 'generating' });
  });

  it('pause: 3 photos (< AUTO_PHOTO_MIN_SELECTED=6) — pauseForHuman called, apply NOT called', async () => {
    (getPhotoSelectionForRun as Mock).mockResolvedValue({ selected_photo_ids: ['a', 'b', 'c'], photos: [] });
    setupPauseDb();

    const run = makeRun({ stage: 'photo_selection' });
    const result = await resolvePhotoSelection(run);

    expect(result.action).toBe('paused');
    expect((result as { action: 'paused'; reason: string }).reason).toMatch(/only 3 photos selected \(min 6\)/);
    expect(applyPhotoSelectionForRun).not.toHaveBeenCalled();
  });

  it('pause: 0 AI-recommended photos — pauseForHuman called with no-photos reason, apply NOT called', async () => {
    (getPhotoSelectionForRun as Mock).mockResolvedValue({ selected_photo_ids: [], photos: [] });
    setupPauseDb();

    const run = makeRun({ stage: 'photo_selection' });
    const result = await resolvePhotoSelection(run);

    expect(result.action).toBe('paused');
    expect((result as { action: 'paused'; reason: string }).reason).toMatch(/no AI-recommended photos/);
    expect(applyPhotoSelectionForRun).not.toHaveBeenCalled();
  });

  it('continue hop fires even when recordMlEvent rejects (telemetry must not block the hop)', async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `photo-${i + 1}`);
    (getPhotoSelectionForRun as Mock).mockResolvedValue({ selected_photo_ids: ids, photos: [] });
    (applyPhotoSelectionForRun as Mock).mockResolvedValue({ selected_photo_ids: ids });
    // Telemetry throws — the hop must still have fired before this and advanced returned.
    (recordMlEvent as Mock).mockRejectedValue(new Error('ml_events insert failed'));

    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
    setEnv('VERCEL_URL', 'listingelevate.vercel.app');

    const run = makeRun({ stage: 'photo_selection' });
    const result = await resolvePhotoSelection(run);

    // Hop fired before telemetry — must be present regardless of recordMlEvent outcome.
    expect(mockFetch).toHaveBeenCalledWith(
      `https://listingelevate.vercel.app/api/pipeline/continue/run-1`,
      { method: 'POST' },
    );
    // Returns advanced despite the telemetry error (best-effort).
    expect(result).toEqual({ action: 'advanced', to: 'generating' });
  });

  it('continue hop is skipped gracefully when VERCEL_URL is unset', async () => {
    const ids = Array.from({ length: 8 }, (_, i) => `photo-${i + 1}`);
    (getPhotoSelectionForRun as Mock).mockResolvedValue({ selected_photo_ids: ids, photos: [] });
    (applyPhotoSelectionForRun as Mock).mockResolvedValue({ selected_photo_ids: ids });
    (recordMlEvent as Mock).mockResolvedValue(undefined);

    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    setEnv('VERCEL_URL', undefined);

    const run = makeRun({ stage: 'photo_selection' });
    const result = await resolvePhotoSelection(run);

    // Still advances — missing host is non-fatal (reaper recovers).
    expect(result).toEqual({ action: 'advanced', to: 'generating' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── buildOrderedRoomSequence ───────────────────────────────────────────────

describe('buildOrderedRoomSequence', () => {
  it('returns null (no I/O) when scene_order is null', async () => {
    const result = await buildOrderedRoomSequence(makeRun({ scene_order: null }));
    expect(result).toBeNull();
    expect(getSupabase).not.toHaveBeenCalled();
  });

  it('returns null when scene_order is an empty array', async () => {
    const result = await buildOrderedRoomSequence(makeRun({ scene_order: [] }));
    expect(result).toBeNull();
    expect(getSupabase).not.toHaveBeenCalled();
  });

  it('orders rooms by scene_order position, not DB row order', async () => {
    const inMock = vi.fn().mockResolvedValue({
      data: [
        { id: 'sc-b', room_type: 'kitchen' },
        { id: 'sc-a', room_type: 'exterior_front' },
      ],
      error: null,
    });
    (getSupabase as Mock).mockReturnValue({
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ in: inMock }) }),
    });

    const result = await buildOrderedRoomSequence(makeRun({ scene_order: ['sc-a', 'sc-b'] }));
    expect(result).toEqual([
      { position: 1, room: 'exterior_front' },
      { position: 2, room: 'kitchen' },
    ]);
  });

  it('falls back to "interior" for a scene with a null room_type', async () => {
    const inMock = vi.fn().mockResolvedValue({
      data: [{ id: 'sc-a', room_type: null }],
      error: null,
    });
    (getSupabase as Mock).mockReturnValue({
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ in: inMock }) }),
    });

    const result = await buildOrderedRoomSequence(makeRun({ scene_order: ['sc-a'] }));
    expect(result).toEqual([{ position: 1, room: 'interior' }]);
  });

  it('returns null on a DB error (fail open, no crash)', async () => {
    const inMock = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    (getSupabase as Mock).mockReturnValue({
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ in: inMock }) }),
    });

    const result = await buildOrderedRoomSequence(makeRun({ scene_order: ['sc-a'] }));
    expect(result).toBeNull();
  });

  it('returns null when getSupabase throws (fail open, no crash)', async () => {
    (getSupabase as Mock).mockImplementation(() => {
      throw new Error('no client');
    });

    const result = await buildOrderedRoomSequence(makeRun({ scene_order: ['sc-a'] }));
    expect(result).toBeNull();
  });
});

// ─── resolveVoiceover ─────────────────────────────────────────────────────────

describe('resolveVoiceover', () => {
  /**
   * @param scenesResult - rows (or { error }) returned for .from('scenes').select().in() —
   *   used by buildOrderedRoomSequence. Defaults to an empty result (no scene_order set).
   */
  function setupDbWithAddress(
    address: string | null,
    scenesResult: { data?: Array<{ id: string; room_type: string | null }>; error?: unknown } = { data: [] },
  ) {
    // Build a mock that supports: .from('properties').select().eq().maybeSingle()
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: address ? { address } : null, error: null });
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    // .from('scenes').select().in() — feeds buildOrderedRoomSequence
    const scenesInMock = vi.fn().mockResolvedValue({
      data: scenesResult.data ?? null,
      error: scenesResult.error ?? null,
    });
    const scenesSelectMock = vi.fn().mockReturnValue({ in: scenesInMock });
    // Also need update/insert for pauseForHuman when address is null
    const updateEqMock = vi.fn().mockResolvedValue({ error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock });
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'properties') return { select: selectMock };
      if (table === 'scenes') return { select: scenesSelectMock };
      return { update: updateMock, insert: insertMock };
    });
    const db = { from: fromMock, update: updateMock, insert: insertMock };
    (getSupabase as Mock).mockReturnValue(db);
    return db;
  }

  it('advances: generates script, picks voice via LLM, runs shared audio runner', async () => {
    setupDbWithAddress('123 Main St');
    (generateDeliveryScript as Mock).mockResolvedValue({ script: 'Great home!', wordCount: 2 });
    (updateRun as Mock).mockResolvedValue({});
    mockAnthropicCreate.mockResolvedValue(makeLlmResponse('Amanda'));
    (runDeliveryAudio as Mock).mockResolvedValue({ ok: true, run: {} });
    (recordCostEvent as Mock).mockResolvedValue(undefined);
    (recordMlEvent as Mock).mockResolvedValue(undefined);
    (advanceRun as Mock).mockResolvedValue({});

    const result = await resolveVoiceover(makeRun());
    expect(result).toEqual({ action: 'advanced', to: 'music' });
    expect(generateDeliveryScript).toHaveBeenCalled();
    // Voice is persisted BEFORE synth so the shared runner reads it fresh.
    expect(updateRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ voiceover_voice_id: 'voice-amanda' }));
    // Synth goes through the shared duration-audited runner, not a raw call.
    expect(runDeliveryAudio).toHaveBeenCalledWith('run-1');
    expect(recordCostEvent).toHaveBeenCalled();
    expect(advanceRun).toHaveBeenCalledWith('run-1', 'music');
  });

  it('builds the ordered room sequence from scene_order + scenes.room_type and passes it to generateDeliveryScript', async () => {
    setupDbWithAddress('123 Main St', {
      data: [
        { id: 'sc-3', room_type: 'garage' },
        { id: 'sc-1', room_type: 'exterior_front' },
        { id: 'sc-2', room_type: 'kitchen' },
      ],
    });
    (generateDeliveryScript as Mock).mockResolvedValue({ script: 'Great home!', wordCount: 2 });
    (updateRun as Mock).mockResolvedValue({});
    mockAnthropicCreate.mockResolvedValue(makeLlmResponse('Amanda'));
    (runDeliveryAudio as Mock).mockResolvedValue({ ok: true, run: {} });
    (recordCostEvent as Mock).mockResolvedValue(undefined);
    (recordMlEvent as Mock).mockResolvedValue(undefined);
    (advanceRun as Mock).mockResolvedValue({});

    const run = makeRun({ scene_order: ['sc-1', 'sc-2', 'sc-3'] });
    const result = await resolveVoiceover(run);

    expect(result).toEqual({ action: 'advanced', to: 'music' });
    // Sequence follows scene_order (display order), not the DB row order.
    expect(generateDeliveryScript).toHaveBeenCalledWith(
      expect.objectContaining({
        roomSequence: [
          { position: 1, room: 'exterior_front' },
          { position: 2, room: 'kitchen' },
          { position: 3, room: 'garage' },
        ],
      }),
    );
  });

  it('falls back to no room sequence (undefined) when scene_order is null', async () => {
    setupDbWithAddress('123 Main St');
    (generateDeliveryScript as Mock).mockResolvedValue({ script: 'Great home!', wordCount: 2 });
    (updateRun as Mock).mockResolvedValue({});
    mockAnthropicCreate.mockResolvedValue(makeLlmResponse('Amanda'));
    (runDeliveryAudio as Mock).mockResolvedValue({ ok: true, run: {} });
    (recordCostEvent as Mock).mockResolvedValue(undefined);
    (recordMlEvent as Mock).mockResolvedValue(undefined);
    (advanceRun as Mock).mockResolvedValue({});

    const run = makeRun({ scene_order: null });
    const result = await resolveVoiceover(run);

    expect(result).toEqual({ action: 'advanced', to: 'music' });
    expect(generateDeliveryScript).toHaveBeenCalledWith(
      expect.objectContaining({ roomSequence: undefined }),
    );
  });

  it('skips script generation if voiceover_script already set', async () => {
    setupDbWithAddress('123 Main St');
    mockAnthropicCreate.mockResolvedValue(makeLlmResponse('Mark'));
    (runDeliveryAudio as Mock).mockResolvedValue({ ok: true, run: {} });
    (recordCostEvent as Mock).mockResolvedValue(undefined);
    (updateRun as Mock).mockResolvedValue({});
    (recordMlEvent as Mock).mockResolvedValue(undefined);
    (advanceRun as Mock).mockResolvedValue({});

    const run = makeRun({ voiceover_script: 'Pre-existing script.' });
    const result = await resolveVoiceover(run);
    expect(result).toEqual({ action: 'advanced', to: 'music' });
    expect(generateDeliveryScript).not.toHaveBeenCalled();
  });

  it('IDEMPOTENT: skips voice-pick LLM + synth when voiceover_audio_url already set', async () => {
    setupDbWithAddress('123 Main St');
    (recordMlEvent as Mock).mockResolvedValue(undefined);
    (advanceRun as Mock).mockResolvedValue({});

    const run = makeRun({ voiceover_script: 'Existing.', voiceover_audio_url: 'https://cdn.example.com/x.mp3' });
    const result = await resolveVoiceover(run);
    expect(result).toEqual({ action: 'advanced', to: 'music' });
    // No paid calls: no script gen, no voice-pick Haiku, no audio synth.
    expect(generateDeliveryScript).not.toHaveBeenCalled();
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    expect(runDeliveryAudio).not.toHaveBeenCalled();
    expect(advanceRun).toHaveBeenCalledWith('run-1', 'music');
  });

  it('pauses when property address is not found', async () => {
    setupDbWithAddress(null);

    const result = await resolveVoiceover(makeRun());
    expect(result.action).toBe('paused');
    expect((result as { action: 'paused'; reason: string }).reason).toMatch(/address not found/);
  });

  it('pauses when the shared audio runner returns a failure', async () => {
    (generateDeliveryScript as Mock).mockResolvedValue({ script: 'Script.', wordCount: 1 });
    (updateRun as Mock).mockResolvedValue({});
    mockAnthropicCreate.mockResolvedValue(makeLlmResponse('Amanda'));
    (recordCostEvent as Mock).mockResolvedValue(undefined);
    (runDeliveryAudio as Mock).mockResolvedValue({ ok: false, status: 502, error: 'ElevenLabs 500' });

    // getSupabase serves the address lookup (properties) AND pauseForHuman writes.
    const db = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      }),
    };
    (getSupabase as Mock).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'properties') {
          const mS = vi.fn().mockResolvedValue({ data: { address: '123 Main St' }, error: null });
          return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: mS }) }) };
        }
        return db.from(table);
      }),
    });

    const result = await resolveVoiceover(makeRun());
    expect(result.action).toBe('paused');
    expect((result as { action: 'paused'; reason: string }).reason).toMatch(/audio synthesis failed/);
  });
});

// ─── resolveMusic ─────────────────────────────────────────────────────────────

describe('resolveMusic', () => {
  function setupMusicDb(moodTracks: Array<{ id: string }>, feedbackRows: Array<{ track_id: string; verdict: string }> = []) {
    const neutralTrack = { id: 'track-neutral' };

    const db = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'music_tracks') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: neutralTrack, error: null }),
            // Let the last call in chain resolve
            then: undefined,
            // vitest: chain ends with awaiting the object — need custom handling
          };
        }
        if (table === 'music_track_feedback') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            then: undefined,
          };
        }
        // delivery_runs update/insert for pauseForHuman
        return {
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }),
    };

    // We need a more controlled mock for the chained queries.
    // Build a mock that tracks .from calls and returns appropriate data.
    let musicEqCalls = 0;
    const musicChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation(() => {
        musicEqCalls++;
        // After 2 eq calls (mood_tag + active), return data on await
        if (musicEqCalls >= 2) {
          return Promise.resolve({ data: moodTracks, error: null });
        }
        return musicChain;
      }),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: neutralTrack, error: null }),
    };
    // Make it thenable so `await db.from('music_tracks').select().eq().eq()` works
    (musicChain.eq as Mock).mockReturnValue({
      ...musicChain,
      eq: vi.fn().mockReturnValue(Promise.resolve({ data: moodTracks, error: null })),
    });

    const fbChain = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnValue(Promise.resolve({ data: feedbackRows, error: null })),
    };

    (db.from as Mock).mockImplementation((table: string) => {
      if (table === 'music_tracks') return musicChain;
      if (table === 'music_track_feedback') return fbChain;
      return {
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
    });

    (getSupabase as Mock).mockReturnValue(db);
    return db;
  }

  it('advances when a mood-matching track is found', async () => {
    mockAnthropicCreate.mockResolvedValue(makeLlmResponse('upbeat'));
    (recordCostEvent as Mock).mockResolvedValue(undefined);
    (updateRun as Mock).mockResolvedValue({});
    (recordMlEvent as Mock).mockResolvedValue(undefined);
    (advanceRun as Mock).mockResolvedValue({});
    (runAssembleStage as Mock).mockResolvedValue(undefined);
    setupMusicDb([{ id: 'track-upbeat-1' }]);

    const result = await resolveMusic(makeRun());
    // advanceMusicToAssembling advances to 'assembling' then immediately drives
    // runAssembleStage → self-advances to 'checkpoint_b'. Report the real final stage.
    expect(result).toEqual({ action: 'advanced', to: 'checkpoint_b' });
    expect(advanceRun).toHaveBeenCalledWith('run-1', 'assembling');
    expect(updateRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ music_track_id: 'track-upbeat-1' }));
    expect(recordMlEvent).toHaveBeenCalledWith('run-1', 'auto_advance', expect.objectContaining({
      source: 'auto', gate: 'music',
    }));
    expect(recordCostEvent).toHaveBeenCalled();
  });

  it('prefers the highest net-positive feedback track', async () => {
    mockAnthropicCreate.mockResolvedValue(makeLlmResponse('upbeat'));
    (recordCostEvent as Mock).mockResolvedValue(undefined);
    (updateRun as Mock).mockResolvedValue({});
    (recordMlEvent as Mock).mockResolvedValue(undefined);
    (advanceRun as Mock).mockResolvedValue({});
    (runAssembleStage as Mock).mockResolvedValue(undefined);

    setupMusicDb(
      [{ id: 'track-a' }, { id: 'track-b' }],
      [
        { track_id: 'track-a', verdict: 'down' },
        { track_id: 'track-b', verdict: 'up' },
        { track_id: 'track-b', verdict: 'up' },
      ],
    );

    const result = await resolveMusic(makeRun());
    // advanceMusicToAssembling drives runAssembleStage → self-advances to 'checkpoint_b'.
    expect(result).toEqual({ action: 'advanced', to: 'checkpoint_b' });
    expect(updateRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ music_track_id: 'track-b' }));
  });

  it('pauses when no tracks exist for mood and no neutral fallback', async () => {
    mockAnthropicCreate.mockResolvedValue(makeLlmResponse('upbeat'));
    (recordCostEvent as Mock).mockResolvedValue(undefined);

    // music_tracks mood query: .select().eq(mood).eq(active) → empty
    // music_tracks neutral fallback: .select().eq(neutral).eq(active).limit(1).maybeSingle() → null
    // Build a chain that handles both paths: after the second eq call we need either
    // a Promise (mood query — awaited directly) or .limit+.maybeSingle (neutral query).
    const emptyMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    // After second eq(), return an object thenable AND with limit support.
    const innerResult = Object.assign(Promise.resolve({ data: [], error: null }), {
      limit: vi.fn().mockReturnValue({ maybeSingle: emptyMaybeSingle }),
      maybeSingle: emptyMaybeSingle,
    });
    const afterFirstEq = { eq: vi.fn().mockReturnValue(innerResult) };
    const musicTrackChain = {
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue(afterFirstEq) }),
    };

    const fbChain = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: [], error: null }),
    };

    const pauseDb = {
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      insert: vi.fn().mockResolvedValue({ error: null }),
    };

    (getSupabase as Mock).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'music_tracks') return musicTrackChain;
        if (table === 'music_track_feedback') return fbChain;
        return pauseDb;
      }),
    });

    const result = await resolveMusic(makeRun());
    expect(result.action).toBe('paused');
    expect((result as { action: 'paused'; reason: string }).reason).toMatch(/no track for mood/);
  });

  it('drives assembly (runAssembleStage) after advancing music → assembling', async () => {
    mockAnthropicCreate.mockResolvedValue(makeLlmResponse('upbeat'));
    (recordCostEvent as Mock).mockResolvedValue(undefined);
    (updateRun as Mock).mockResolvedValue({});
    (recordMlEvent as Mock).mockResolvedValue(undefined);
    (advanceRun as Mock).mockResolvedValue({});
    (runAssembleStage as Mock).mockResolvedValue(undefined);
    setupMusicDb([{ id: 'track-1' }]);

    const result = await resolveMusic(makeRun());
    expect(advanceRun).toHaveBeenCalledWith('run-1', 'assembling');
    expect(runAssembleStage).toHaveBeenCalledWith('run-1');
    // runAssembleStage self-advances to checkpoint_b — report the real final stage.
    expect(result).toEqual({ action: 'advanced', to: 'checkpoint_b' });
  });

  it('IDEMPOTENT: skips mood LLM + track pick when music_track_id already set', async () => {
    (advanceRun as Mock).mockResolvedValue({});
    (runAssembleStage as Mock).mockResolvedValue(undefined);

    const run = makeRun({ stage: 'music', music_track_id: 'track-existing' });
    const result = await resolveMusic(run);
    // runAssembleStage self-advances to checkpoint_b — report the real final stage.
    expect(result).toEqual({ action: 'advanced', to: 'checkpoint_b' });
    // No paid mood pick, no track re-selection write.
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    expect(updateRun).not.toHaveBeenCalled();
    expect(runAssembleStage).toHaveBeenCalledWith('run-1');
  });

  it('pauses when assembly fails after the music advance', async () => {
    (advanceRun as Mock).mockResolvedValue({});
    (runAssembleStage as Mock).mockRejectedValue(new Error('creatomate 500'));
    // pauseForHuman writes go through getSupabase.
    (getSupabase as Mock).mockReturnValue({
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    // music_track_id set → idempotent skip → straight into the assembly drive.
    const run = makeRun({ stage: 'music', music_track_id: 'track-1' });
    const result = await resolveMusic(run);
    expect(result.action).toBe('paused');
    expect((result as { action: 'paused'; reason: string }).reason).toMatch(/assembly failed/);
  });

  it('noops (does not pause) when assembly times out — run stays at assembling for next tick', async () => {
    // A render that exceeds the cron budget throws a tagged [ASSEMBLY_TIMEOUT] error.
    // advanceMusicToAssembling must NOT pauseForHuman — instead return noop so the
    // run stays at stage='assembling' for resolveAssembling to resume next sweep tick.
    const timeoutErr = Object.assign(
      new Error('[ASSEMBLY_TIMEOUT] Horizontal render timed out after 200000ms'),
      { isAssemblyTimeout: true },
    );
    (advanceRun as Mock).mockResolvedValue({});
    (runAssembleStage as Mock).mockRejectedValue(timeoutErr);

    const run = makeRun({ stage: 'music', music_track_id: 'track-1' });
    const result = await resolveMusic(run);

    // Should return noop, NOT paused.
    expect(result.action).toBe('noop');
    expect((result as { action: 'noop'; reason?: string }).reason).toMatch(/in progress|timeout/i);
    // pauseForHuman must NOT have been called (no getSupabase interaction needed here).
  });
});

// ─── resolveAssembling ───────────────────────────────────────────────────────

describe('resolveAssembling', () => {
  /**
   * Build a multi-table getSupabase mock for resolveAssembling paths.
   *  - claimRows: what the lease CAS select returns ([] = lost, [{id}] = won)
   *  - propData:  what properties.maybeSingle() returns
   *  - jobRowData: what delivery_runs job-columns maybeSingle() returns
   */
  function makeAssemblingDb(opts: {
    claimRows: unknown[];
    propData: unknown;
    jobRowData?: unknown;
  }) {
    const { claimRows, propData, jobRowData = null } = opts;

    const claimSelect = vi.fn().mockResolvedValue({ data: claimRows, error: null });
    // Single eq-result fn for delivery_runs updates that aren't the lease claim.
    const drUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const propUpdateEq = vi.fn().mockResolvedValue({ error: null });
    // Named (not inline) so tests can assert on the exact object passed to
    // properties.update(...) — e.g. hls/poster conditional-spread fields.
    const propUpdate = vi.fn().mockReturnValue({ eq: propUpdateEq });
    const mlEventsInsert = vi.fn().mockResolvedValue({ error: null });

    const db = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'properties') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: propData, error: null }),
              }),
            }),
            update: propUpdate,
          };
        }
        if (table === 'delivery_runs') {
          return {
            update: vi.fn().mockImplementation((patch: Record<string, unknown>) => {
              // Lease claim: resolving_at is a truthy ISO timestamp.
              if (patch.resolving_at) {
                return {
                  eq: vi.fn().mockReturnValue({
                    or: vi.fn().mockReturnValue({ select: claimSelect }),
                  }),
                };
              }
              // Release, job-clear, pauseForHuman → just needs .eq().
              return { eq: drUpdateEq };
            }),
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: jobRowData, error: null }),
              }),
            }),
          };
        }
        if (table === 'ml_events') {
          return { insert: mlEventsInsert };
        }
        return {
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }),
    };

    return { db, drUpdateEq, propUpdateEq, propUpdate, mlEventsInsert };
  }

  it('guard: returns noop when auto_run is false', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    const run = makeRun({ stage: 'assembling', auto_run: false });
    const result = await resolveAssembling(run);
    expect(result).toEqual({ action: 'noop', reason: 'auto_run off' });
  });

  it('guard: returns noop when run is already paused', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    const run = makeRun({ stage: 'assembling', paused_reason: 'test pause' });
    const result = await resolveAssembling(run);
    expect(result).toEqual({ action: 'noop', reason: 'paused' });
  });

  it('guard: returns noop when stage is not assembling', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    const run = makeRun({ stage: 'checkpoint_a' });
    const result = await resolveAssembling(run);
    expect(result).toEqual({ action: 'noop', reason: 'not assembling stage' });
  });

  it('guard: returns noop when write guard fails (non-prod)', async () => {
    setEnv('VERCEL_ENV', undefined);
    setEnv('LE_ALLOW_NONPROD_WRITES', undefined);
    const run = makeRun({ stage: 'assembling' });
    const result = await resolveAssembling(run);
    expect(result).toEqual({ action: 'noop', reason: 'write guard: non-prod' });
  });

  it('Path 1: all required URLs already exist → advances to checkpoint_b, never calls runAssembleStage', async () => {
    // Scenario: horizontal-only run; render completed but Vercel was killed before
    // advanceRun('checkpoint_b') could be called. Next sweep tick picks it up here.
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');

    const { db } = makeAssemblingDb({
      claimRows: [{ id: 'run-1' }],
      propData: {
        horizontal_video_url: 'https://bunny.cdn/h.mp4',
        vertical_video_url: null,
        selected_orientation: 'horizontal', // only H is needed
      },
    });
    (getSupabase as Mock).mockReturnValue(db);
    (advanceRun as Mock).mockResolvedValue({});

    const run = makeRun({ stage: 'assembling' });
    const result = await resolveAssembling(run);

    expect(result).toEqual({ action: 'advanced', to: 'checkpoint_b' });
    expect(advanceRun).toHaveBeenCalledWith('run-1', 'checkpoint_b');
    // No re-spend: runAssembleStage and pollAssemblyJob must NOT have been called.
    expect(runAssembleStage).not.toHaveBeenCalled();
    expect(pollAssemblyJob).not.toHaveBeenCalled();
    // Fresh-read guard (P1-1): re-read happened and (default mock) agreed
    // paused_reason is still null, so resolution proceeded as before.
    expect(getRun).toHaveBeenCalledWith('run-1');
  });

  it('Path 2: in-flight job ID + poll times out → noop, NOT pauseForHuman', async () => {
    // Scenario: H render was submitted (jobId persisted) but the poll exceeded the
    // cron budget. The run stays at assembling; next tick resumes without re-submitting.
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');

    const hJob = { jobId: 'job-h-123', environment: 'v1' as const };
    const { db } = makeAssemblingDb({
      claimRows: [{ id: 'run-1' }],
      propData: {
        horizontal_video_url: null,
        vertical_video_url: null,
        selected_orientation: 'horizontal',
      },
      jobRowData: { assembly_h_job: hJob, assembly_v_job: null },
    });
    (getSupabase as Mock).mockReturnValue(db);

    // pollAssemblyJob returns the timed-out sentinel — budget was exhausted.
    (pollAssemblyJob as Mock).mockResolvedValue({
      status: 'failed',
      error: 'Assembly render timed out',
    });

    const run = makeRun({ stage: 'assembling' });
    const result = await resolveAssembling(run, 50_000);

    // Must be noop — NOT paused. Run stays at assembling; job token survives.
    expect(result.action).toBe('noop');
    // advanceRun must NOT have been called — still in-flight.
    expect(advanceRun).not.toHaveBeenCalled();
    // No finalize call — render didn't complete.
    expect(finalizeAssemblyRender).not.toHaveBeenCalled();
    // runAssembleStage must NOT have been called — job already existed.
    expect(runAssembleStage).not.toHaveBeenCalled();
  });

  it('Path 2: in-flight job ID + poll completes → finalizes, writes URL, emits cost rows, advances to checkpoint_b', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');

    const hJob = { jobId: 'job-h-456', environment: 'v1' as const };
    const { db, propUpdateEq } = makeAssemblingDb({
      claimRows: [{ id: 'run-1' }],
      propData: {
        horizontal_video_url: null,
        vertical_video_url: null,
        selected_orientation: 'horizontal',
      },
      jobRowData: { assembly_h_job: hJob, assembly_v_job: null },
    });
    (getSupabase as Mock).mockReturnValue(db);
    (advanceRun as Mock).mockResolvedValue({});
    (recordCostEvent as Mock).mockResolvedValue(undefined);
    (emitBunnyFinalizeCostEvent as Mock).mockResolvedValue(undefined);
    (assemblyProviderCostCents as Mock).mockReturnValue(150);

    // Poll returns complete with a provider URL.
    (pollAssemblyJob as Mock).mockResolvedValue({
      status: 'complete',
      videoUrl: 'https://provider.example.com/output.mp4',
      durationSeconds: 30,
    });
    (finalizeAssemblyRender as Mock).mockResolvedValue({
      url: 'https://bunny.cdn/final-h.mp4',
      bitrateKbps: 9000,
      outputBytes: null,
      bunnyWasCalled: false,
    });

    const run = makeRun({ stage: 'assembling' });
    const result = await resolveAssembling(run, 60_000);

    expect(result).toEqual({ action: 'advanced', to: 'checkpoint_b' });
    // Finalize was called with the provider URL and correct aspect ratio.
    expect(finalizeAssemblyRender).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: 'prop-1',
      aspectRatio: '16:9',
      providerUrl: 'https://provider.example.com/output.mp4',
    }));
    // URL written back to properties.
    expect(propUpdateEq).toHaveBeenCalled();
    // Run advanced to checkpoint_b.
    expect(advanceRun).toHaveBeenCalledWith('run-1', 'checkpoint_b');
    // No re-submit: runAssembleStage was not called.
    expect(runAssembleStage).not.toHaveBeenCalled();
    // COST TRACKING: both rows emitted on resume (regression-fix for cost hole).
    expect(emitBunnyFinalizeCostEvent).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: 'prop-1',
      aspectRatio: '16:9',
    }));
    expect(recordCostEvent).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'assembly',
      unitType: 'renders',
      metadata: expect.objectContaining({ reason: 'autopilot_resume', aspect_ratio: '16:9' }),
    }));
  });

  // ── Bunny HLS + poster persist wiring (migration 102) ─────────────────────
  //
  // finalizeAssemblyRender returns hlsUrl/posterUrl only on the fully-successful
  // Bunny host path (null on every fallback). mp4 + hls + poster are ONE coupled
  // encode: the autopilot resume path writes all three of an orientation together
  // and clears hls/poster to null on a fallback, so a stale playlist can never
  // outlive the mp4 it describes.

  it('Path 2 (hls/poster): writes horizontal_hls_url + horizontal_poster_url when finalize returns them', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');

    const hJob = { jobId: 'job-h-hls', environment: 'v1' as const };
    const { db, propUpdate } = makeAssemblingDb({
      claimRows: [{ id: 'run-1' }],
      propData: {
        horizontal_video_url: null,
        vertical_video_url: null,
        selected_orientation: 'horizontal',
      },
      jobRowData: { assembly_h_job: hJob, assembly_v_job: null },
    });
    (getSupabase as Mock).mockReturnValue(db);
    (advanceRun as Mock).mockResolvedValue({});
    (recordCostEvent as Mock).mockResolvedValue(undefined);
    (emitBunnyFinalizeCostEvent as Mock).mockResolvedValue(undefined);
    (assemblyProviderCostCents as Mock).mockReturnValue(150);
    (pollAssemblyJob as Mock).mockResolvedValue({
      status: 'complete',
      videoUrl: 'https://provider.example.com/output.mp4',
      durationSeconds: 30,
    });
    (finalizeAssemblyRender as Mock).mockResolvedValue({
      url: 'https://bunny.cdn/final-h.mp4',
      bitrateKbps: 9000,
      outputBytes: 50_000_000,
      bunnyWasCalled: true,
      hlsUrl: 'https://bunny.cdn/final-h.m3u8',
      posterUrl: 'https://bunny.cdn/final-h-poster.jpg',
    });

    const run = makeRun({ stage: 'assembling' });
    const result = await resolveAssembling(run, 60_000);

    expect(result).toEqual({ action: 'advanced', to: 'checkpoint_b' });
    expect(propUpdate).toHaveBeenCalledWith({
      horizontal_video_url: 'https://bunny.cdn/final-h.mp4',
      horizontal_hls_url: 'https://bunny.cdn/final-h.m3u8',
      horizontal_poster_url: 'https://bunny.cdn/final-h-poster.jpg',
    });
  });

  it('Path 2 (hls/poster): clears horizontal_hls_url/horizontal_poster_url to null when finalize falls back (hlsUrl/posterUrl null)', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');

    const hJob = { jobId: 'job-h-fallback', environment: 'v1' as const };
    const { db, propUpdate } = makeAssemblingDb({
      claimRows: [{ id: 'run-1' }],
      propData: {
        horizontal_video_url: null,
        vertical_video_url: null,
        selected_orientation: 'horizontal',
      },
      jobRowData: { assembly_h_job: hJob, assembly_v_job: null },
    });
    (getSupabase as Mock).mockReturnValue(db);
    (advanceRun as Mock).mockResolvedValue({});
    (recordCostEvent as Mock).mockResolvedValue(undefined);
    (emitBunnyFinalizeCostEvent as Mock).mockResolvedValue(undefined);
    (assemblyProviderCostCents as Mock).mockReturnValue(150);
    (pollAssemblyJob as Mock).mockResolvedValue({
      status: 'complete',
      videoUrl: 'https://provider.example.com/output.mp4',
      durationSeconds: 30,
    });
    // Fallback path: Bunny unconfigured/download failed — url falls back to the
    // provider URL, hls/poster stay null.
    (finalizeAssemblyRender as Mock).mockResolvedValue({
      url: 'https://provider.example.com/output.mp4',
      bitrateKbps: null,
      outputBytes: null,
      bunnyWasCalled: false,
      hlsUrl: null,
      posterUrl: null,
    });

    const run = makeRun({ stage: 'assembling' });
    await resolveAssembling(run, 60_000);

    // mp4 + hls + poster are ONE coupled encode: this fallback re-render writes a
    // new mp4 with no HLS, so hls/poster are CLEARED to null in the same update —
    // never omitted. Omitting them would let a stale *_hls_url from a previous
    // successful render survive, and the player would serve the OLD video.
    expect(propUpdate).toHaveBeenCalledWith({
      horizontal_video_url: 'https://provider.example.com/output.mp4',
      horizontal_hls_url: null,
      horizontal_poster_url: null,
    });
  });

  it('Path 2 (hls/poster): writes vertical_hls_url + vertical_poster_url when finalize returns them (vertical-only run)', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');

    const vJob = { jobId: 'job-v-hls', environment: 'v1' as const };
    const { db, propUpdate } = makeAssemblingDb({
      claimRows: [{ id: 'run-1' }],
      propData: {
        horizontal_video_url: null,
        vertical_video_url: null,
        selected_orientation: 'vertical',
      },
      jobRowData: { assembly_h_job: null, assembly_v_job: vJob },
    });
    (getSupabase as Mock).mockReturnValue(db);
    (advanceRun as Mock).mockResolvedValue({});
    (recordCostEvent as Mock).mockResolvedValue(undefined);
    (emitBunnyFinalizeCostEvent as Mock).mockResolvedValue(undefined);
    (assemblyProviderCostCents as Mock).mockReturnValue(150);
    (pollAssemblyJob as Mock).mockResolvedValue({
      status: 'complete',
      videoUrl: 'https://provider.example.com/v-output.mp4',
      durationSeconds: 30,
    });
    (finalizeAssemblyRender as Mock).mockResolvedValue({
      url: 'https://bunny.cdn/final-v.mp4',
      bitrateKbps: 5200,
      outputBytes: 30_000_000,
      bunnyWasCalled: true,
      hlsUrl: 'https://bunny.cdn/final-v.m3u8',
      posterUrl: 'https://bunny.cdn/final-v-poster.jpg',
    });

    const run = makeRun({ stage: 'assembling' });
    const result = await resolveAssembling(run, 60_000);

    expect(result).toEqual({ action: 'advanced', to: 'checkpoint_b' });
    expect(propUpdate).toHaveBeenCalledWith({
      vertical_video_url: 'https://bunny.cdn/final-v.mp4',
      vertical_hls_url: 'https://bunny.cdn/final-v.m3u8',
      vertical_poster_url: 'https://bunny.cdn/final-v-poster.jpg',
    });
  });

  it('Path 2: provider returns no durationSeconds → cost row has nonzero costCents + duration_source:fallback', async () => {
    // Verifies the ?? 0 bug is closed: when the provider omits durationSeconds,
    // the resume path resolves duration via job-token or run.duration_seconds fallback,
    // never passes 0 to cost functions, and marks the row with duration_source:'fallback'.
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');

    const hJob = { jobId: 'job-h-nodur', environment: 'v1' as const, expectedDurationSeconds: 45 };
    const { db } = makeAssemblingDb({
      claimRows: [{ id: 'run-1' }],
      propData: {
        horizontal_video_url: null,
        vertical_video_url: null,
        selected_orientation: 'horizontal',
      },
      jobRowData: { assembly_h_job: hJob, assembly_v_job: null },
    });
    (getSupabase as Mock).mockReturnValue(db);
    (advanceRun as Mock).mockResolvedValue({});
    (recordCostEvent as Mock).mockResolvedValue(undefined);
    (emitBunnyFinalizeCostEvent as Mock).mockResolvedValue(undefined);
    // Return a nonzero cost so we can verify the right duration was forwarded.
    (assemblyProviderCostCents as Mock).mockImplementation(
      (_prov: string, dur: number, _ratio: string) => Math.round(dur * 5)
    );

    // Provider returns complete but NO durationSeconds.
    (pollAssemblyJob as Mock).mockResolvedValue({
      status: 'complete',
      videoUrl: 'https://provider.example.com/output.mp4',
      // durationSeconds deliberately absent — simulates provider omission.
    });
    (finalizeAssemblyRender as Mock).mockResolvedValue({
      url: 'https://bunny.cdn/final-h.mp4',
      bitrateKbps: 9000,
      outputBytes: null,
      bunnyWasCalled: false,
    });

    const run = makeRun({ stage: 'assembling' }); // duration_seconds: 30 from makeRun
    const result = await resolveAssembling(run, 60_000);

    expect(result).toEqual({ action: 'advanced', to: 'checkpoint_b' });

    // assemblyProviderCostCents must have been called with the fallback duration (45,
    // from expectedDurationSeconds), NOT with 0.
    expect(assemblyProviderCostCents).toHaveBeenCalledWith(
      expect.any(String),
      45, // expectedDurationSeconds wins over run.duration_seconds(30)
      '16:9'
    );

    // The cost row must be nonzero and carry duration_source:'fallback'.
    expect(recordCostEvent).toHaveBeenCalledWith(expect.objectContaining({
      costCents: 225, // 45 * 5
      metadata: expect.objectContaining({
        output_duration_seconds: 45,
        duration_source: 'fallback',
      }),
    }));
  });

  it('Path 2: job-column read returns 42703 → throws so sweep can surface leaseError', async () => {
    // Scenario: migration 092 deployed but not applied — column does not exist.
    // resolveAssembling should throw (not noop), short-circuiting Path 3 re-submit.
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');

    const db = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'delivery_runs') {
          return {
            update: vi.fn().mockImplementation((patch: Record<string, unknown>) => {
              if (patch.resolving_at) {
                return {
                  eq: vi.fn().mockReturnValue({
                    or: vi.fn().mockReturnValue({
                      select: vi.fn().mockResolvedValue({ data: [{ id: 'run-1' }], error: null }),
                    }),
                  }),
                };
              }
              return { eq: vi.fn().mockResolvedValue({ error: null }) };
            }),
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                // Job-column SELECT fails with 42703 — migration 092 not applied.
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: '42703', message: 'column assembly_h_job of relation delivery_runs does not exist' },
                }),
              }),
            }),
          };
        }
        if (table === 'properties') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { horizontal_video_url: null, vertical_video_url: null, selected_orientation: 'horizontal' },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
          };
        }
        return {
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }),
    };
    (getSupabase as Mock).mockReturnValue(db);

    const run = makeRun({ stage: 'assembling' });
    // Must throw — not return a noop — so the sweep's catch can increment leaseError.
    await expect(resolveAssembling(run, 50_000)).rejects.toThrow('42703');
    // runAssembleStage must NOT have been called (no re-spend on Path 3).
    expect(runAssembleStage).not.toHaveBeenCalled();
  });

  it('Path 2: both-orientation — V poll uses remaining budget, skips V when budget exhausted after H', async () => {
    // Scenario: "both" run, H render job is in-flight but poll immediately returns
    // timed-out (simulating H consuming all the budget). V job exists but with only
    // <10_000ms remaining the V poll must be SKIPPED — run stays at assembling.
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');

    const hJob = { jobId: 'job-h-both', environment: 'v1' as const };
    const vJob = { jobId: 'job-v-both', environment: 'v1' as const };
    const { db } = makeAssemblingDb({
      claimRows: [{ id: 'run-1' }],
      propData: {
        horizontal_video_url: null,
        vertical_video_url: null,
        selected_orientation: 'both',
      },
      jobRowData: { assembly_h_job: hJob, assembly_v_job: vJob },
    });
    (getSupabase as Mock).mockReturnValue(db);

    // H poll times out — simulates it using up nearly all the budget.
    (pollAssemblyJob as Mock).mockResolvedValue({
      status: 'failed',
      error: 'Assembly render timed out',
    });

    // Pass a budget of 14_000ms: hTimeout = max(10_000, 14_000-5_000)=10_000;
    // after H poll (which is instant in the mock but "consumed" the time),
    // vTimeout would be ≈ budget - elapsed - 5_000 ≈ near-zero → skip V.
    // Use a tiny budget to guarantee vTimeout < 10_000.
    const run = makeRun({ stage: 'assembling' });
    const result = await resolveAssembling(run, 14_000);

    // Must be noop — V render also stays in-flight.
    expect(result.action).toBe('noop');
    // pollAssemblyJob called once (for H) — V was budget-skipped, NOT polled.
    expect(pollAssemblyJob).toHaveBeenCalledTimes(1);
    expect(pollAssemblyJob).toHaveBeenCalledWith(expect.anything(), hJob, expect.any(Number));
  });
});

// ─── resolveGate — resolve lease (double-spend guard) ─────────────────────────

describe('resolveGate — resolve lease', () => {
  /** getSupabase mock whose CAS lease-claim resolves to `claimRows`. Also serves
   *  the release update (resolving_at: null). */
  function makeLeaseDb(claimRows: unknown[]) {
    const claimSelect = vi.fn().mockResolvedValue({ data: claimRows, error: null });
    const releaseEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockImplementation((patch: { resolving_at?: unknown }) => {
      if (patch && patch.resolving_at) {
        // claim: .update({resolving_at: now}).eq().or().select()
        return { eq: vi.fn().mockReturnValue({ or: vi.fn().mockReturnValue({ select: claimSelect }) }) };
      }
      // release: .update({resolving_at: null}).eq()
      return { eq: releaseEq };
    });
    return {
      db: { from: vi.fn().mockReturnValue({ update }) },
      releaseEq,
    };
  }

  it('no-ops when the lease is already held (CAS claims 0 rows)', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    const { db } = makeLeaseDb([]); // 0 rows claimed → lost the race
    (getSupabase as Mock).mockReturnValue(db);

    const run = makeRun({ stage: 'details', listing_details: { price: 1, beds: 1, baths: 1 } });
    const result = await resolveGate(run);
    expect(result).toEqual({ action: 'noop', reason: 'resolve lease held by concurrent actor' });
    // Resolver never ran → no spend, no advance.
    expect(advanceRun).not.toHaveBeenCalled();
  });

  it('claims the lease, dispatches to the resolver, then releases it', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    const { db, releaseEq } = makeLeaseDb([{ id: 'run-1' }]); // won the claim
    (getSupabase as Mock).mockReturnValue(db);
    (recordMlEvent as Mock).mockResolvedValue(undefined);
    (advanceRun as Mock).mockResolvedValue({});

    const run = makeRun({ stage: 'details', listing_details: { price: 1, beds: 1, baths: 1 } });
    const result = await resolveGate(run);
    expect(result).toEqual({ action: 'advanced', to: 'voiceover' });
    expect(advanceRun).toHaveBeenCalledWith('run-1', 'voiceover');
    expect(releaseEq).toHaveBeenCalled(); // lease released in finally
    // Fresh-read guard (P1-1): re-read happened and (default mock) agreed
    // paused_reason is still null, so the resolver proceeded as before.
    expect(getRun).toHaveBeenCalledWith('run-1');
  });
});

// ─── resolveGate / resolveAssembling — fresh-read guard (P1-1) ───────────────

describe('resolveGate — fresh-read guard (P1-1 double-submit fix)', () => {
  it('no-ops WITHOUT touching the DB or dispatching when the fresh read shows paused_reason now set (stale in-memory null)', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    // In-memory `run` (as the sweep's earlier batch SELECT read it) is unpaused...
    const run = makeRun({ stage: 'details', paused_reason: null, listing_details: { price: 1, beds: 1, baths: 1 } });
    // ...but a refine executor locked it in the meantime — the FRESH read sees that.
    (getRun as Mock).mockResolvedValue({ paused_reason: 'refining' } as DeliveryRunRow);

    const result = await resolveGate(run);

    expect(result).toEqual({ action: 'noop', reason: 'paused_reason changed since read (fresh-read guard)' });
    expect(getRun).toHaveBeenCalledWith('run-1');
    // Never reached the lease claim (no DB call at all) or any per-gate resolver.
    expect(getSupabase).not.toHaveBeenCalled();
    expect(advanceRun).not.toHaveBeenCalled();
    expect(recordMlEvent).not.toHaveBeenCalled();
  });

  it('no-ops when the fresh read shows the run no longer exists', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    const run = makeRun({ stage: 'details', listing_details: { price: 1, beds: 1, baths: 1 } });
    (getRun as Mock).mockResolvedValue(null);

    const result = await resolveGate(run);

    expect(result.action).toBe('noop');
    expect(getSupabase).not.toHaveBeenCalled();
    expect(advanceRun).not.toHaveBeenCalled();
  });
});

describe('resolveAssembling — fresh-read guard (P1-1 double-submit fix)', () => {
  it('no-ops WITHOUT touching the DB or calling runAssembleStage/pollAssemblyJob when the fresh read shows paused_reason now set', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    const run = makeRun({ stage: 'assembling', paused_reason: null });
    (getRun as Mock).mockResolvedValue({ paused_reason: 'refining' } as DeliveryRunRow);

    const result = await resolveAssembling(run);

    expect(result).toEqual({ action: 'noop', reason: 'paused_reason changed since read (fresh-read guard)' });
    expect(getRun).toHaveBeenCalledWith('run-1');
    expect(getSupabase).not.toHaveBeenCalled();
    expect(runAssembleStage).not.toHaveBeenCalled();
    expect(pollAssemblyJob).not.toHaveBeenCalled();
    expect(advanceRun).not.toHaveBeenCalled();
  });

  it('no-ops when the fresh read shows the run no longer exists', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    const run = makeRun({ stage: 'assembling' });
    (getRun as Mock).mockResolvedValue(null);

    const result = await resolveAssembling(run);

    expect(result.action).toBe('noop');
    expect(getSupabase).not.toHaveBeenCalled();
    expect(runAssembleStage).not.toHaveBeenCalled();
  });
});

// ─── resolveCheckpointB ───────────────────────────────────────────────────────

describe('resolveCheckpointB', () => {
  function makeHighQualityRun(): DeliveryRunRow {
    return makeRun({
      stage: 'checkpoint_b',
      listing_details: { price: 500000, beds: 3, baths: 2 },
      voiceover_audio_url: 'https://cdn.example.com/audio.mp3',
      music_track_id: 'track-1',
      error: null,
    });
  }

  function setupGoodVariants() {
    // margin = |20 - 14| / 20 = 0.3 (above 0.15) → +0.1 confident bonus
    const variantA = makeVariant({
      variant: 'A', scene_id: 'sc1', winner: true, winner_source: 'gemini',
      gemini_scores: { motion_quality: 5, artifacts: 5, realism: 5, composition: 5 }, // 20
    });
    const variantB = makeVariant({
      variant: 'B', scene_id: 'sc1', winner: false,
      gemini_scores: { motion_quality: 4, artifacts: 4, realism: 3, composition: 3 }, // 14
    });
    (getVariantsForRun as Mock).mockResolvedValue([variantA, variantB]);
  }

  it('advances to delivered when quality score ≥ AUTO_DELIVER_THRESHOLD', async () => {
    setupGoodVariants();
    (recordMlEvent as Mock).mockResolvedValue(undefined);
    (advanceRun as Mock).mockResolvedValue({});

    // Score: 0.5 base + 0.1 confident + 0.1 listing + 0.1 audio + 0.1 music = 0.9
    const result = await resolveCheckpointB(makeHighQualityRun());
    expect(result).toEqual({ action: 'advanced', to: 'delivered' });
    expect(advanceRun).toHaveBeenCalledWith('run-1', 'delivered');
    // Both rating + auto_advance ml_events
    expect(recordMlEvent).toHaveBeenCalledWith('run-1', 'rating', expect.objectContaining({ source: 'auto' }));
    expect(recordMlEvent).toHaveBeenCalledWith('run-1', 'auto_advance', expect.objectContaining({
      source: 'auto', gate: 'checkpoint_b',
    }));
  });

  it('pauses when there are ZERO scene variants (empty run, would deliver nothing)', async () => {
    // Even with full listing + audio + music bonuses (0.5+0.1+0.1+0.1 = 0.8 ≥ 0.7),
    // an empty byScene must NOT auto-deliver.
    (getVariantsForRun as Mock).mockResolvedValue([]);
    const db = makeDbChain(null);
    (db.update as unknown as Mock).mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    (db.insert as unknown as Mock).mockResolvedValue({ error: null });
    (getSupabase as Mock).mockReturnValue(db);

    const run = makeRun({
      stage: 'checkpoint_b',
      listing_details: { price: 500000, beds: 3, baths: 2 },
      voiceover_audio_url: 'https://cdn.example.com/audio.mp3',
      music_track_id: 'track-1',
    });
    const result = await resolveCheckpointB(run);
    expect(result.action).toBe('paused');
    expect((result as { action: 'paused'; reason: string }).reason).toMatch(/no scene variants|empty run/);
    expect(advanceRun).not.toHaveBeenCalled();
  });

  it('pauses immediately when run.error is set', async () => {
    const db = makeDbChain(null);
    (db.update as unknown as Mock).mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    (db.insert as unknown as Mock).mockResolvedValue({ error: null });
    (getSupabase as Mock).mockReturnValue(db);

    const run = makeRun({ stage: 'checkpoint_b', error: 'assembly failed' });
    const result = await resolveCheckpointB(run);
    expect(result.action).toBe('paused');
    expect((result as { action: 'paused'; reason: string }).reason).toMatch(/run has error/);
    expect(getVariantsForRun).not.toHaveBeenCalled();
  });

  it('pauses when quality score is below AUTO_DELIVER_THRESHOLD', async () => {
    // Only degraded variants → 0.5 - 0.1 degraded = 0.4 (below 0.7)
    const variantA = makeVariant({
      variant: 'A', scene_id: 'sc1', winner: true, winner_source: 'default',
      gemini_scores: { judge_error: 'degraded' },
    });
    (getVariantsForRun as Mock).mockResolvedValue([variantA]);

    const db = makeDbChain(null);
    (db.update as unknown as Mock).mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    (db.insert as unknown as Mock).mockResolvedValue({ error: null });
    (getSupabase as Mock).mockReturnValue(db);

    // Run with no audio, no music, no listing details → low score
    const run = makeRun({ stage: 'checkpoint_b', listing_details: {} });
    const result = await resolveCheckpointB(run);
    expect(result.action).toBe('paused');
    expect((result as { action: 'paused'; reason: string }).reason).toMatch(/quality below threshold/);
  });

  it('counts degraded variants as a penalty', async () => {
    // 3 degraded scenes → 0.5 - 0.3 = 0.2 + other bonuses still under threshold
    const variants = [1, 2, 3].map(i => makeVariant({
      variant: 'A', scene_id: `sc${i}`, winner: true, winner_source: 'default',
      gemini_scores: { judge_error: 'degraded' },
    }));
    (getVariantsForRun as Mock).mockResolvedValue(variants);

    const db = makeDbChain(null);
    (db.update as unknown as Mock).mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    (db.insert as unknown as Mock).mockResolvedValue({ error: null });
    (getSupabase as Mock).mockReturnValue(db);

    const run = makeRun({
      stage: 'checkpoint_b',
      listing_details: { price: 500000, beds: 3, baths: 2 },
      voiceover_audio_url: 'https://cdn.example.com/audio.mp3',
      music_track_id: 'track-1',
    });
    // Score: 0.5 - 0.3(3 degraded) + 0.1(listing) + 0.1(audio) + 0.1(music) = 0.5
    // 0.5 < 0.7 threshold → paused
    const result = await resolveCheckpointB(run);
    expect(result.action).toBe('paused');
  });
});

// ─── pauseForHuman ────────────────────────────────────────────────────────────

describe('pauseForHuman', () => {
  it('updates delivery_runs and inserts ml_events row', async () => {
    const updateEqFn = vi.fn().mockResolvedValue({ error: null });
    const insertFn = vi.fn().mockResolvedValue({ error: null });
    const db = {
      from: vi.fn().mockImplementation(() => ({
        update: vi.fn().mockReturnValue({ eq: updateEqFn }),
        insert: insertFn,
      })),
    };
    (getSupabase as Mock).mockReturnValue(db);

    await pauseForHuman('run-99', 'test reason');

    expect(db.from).toHaveBeenCalledWith('delivery_runs');
    expect(updateEqFn).toHaveBeenCalledWith('id', 'run-99');
    expect(db.from).toHaveBeenCalledWith('ml_events');
    expect(insertFn).toHaveBeenCalledWith(expect.objectContaining({
      run_id: 'run-99',
      event_type: 'auto_pause',
      payload: { source: 'auto', reason: 'test reason' },
    }));
  });

  it('throws when delivery_runs update fails', async () => {
    const db = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: { message: 'DB write failed' } }),
        }),
      }),
    };
    (getSupabase as Mock).mockReturnValue(db);

    await expect(pauseForHuman('run-99', 'reason')).rejects.toThrow('pauseForHuman: update failed');
  });
});

// ─── reclaimStrandedRefiningLocks (FIX B1) ───────────────────────────────────

describe('reclaimStrandedRefiningLocks', () => {
  type ReclaimRow = { id: string; stage: string; auto_run: boolean; paused_reason: string | null; updated_at: string };

  /**
   * Minimal in-memory filter mirroring the real Postgres WHERE clause for this
   * one query (auto_run=true AND paused_reason='refining' AND updated_at <
   * staleBefore). Lets tests assert the FULL round trip — a too-fresh row, or
   * a genuinely human-paused row, is never even returned by the "DB" — rather
   * than just trusting a hand-fed mock response for the interesting cases.
   */
  function makeReclaimDb(rows: ReclaimRow[]) {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockImplementation((_col: string, value: string) => {
        const filtered = rows.filter(
          r => r.auto_run === true && r.paused_reason === 'refining' && r.updated_at < value,
        );
        return Promise.resolve({ data: filtered.map(({ id, stage }) => ({ id, stage })), error: null });
      }),
    };
    return { db: { from: vi.fn().mockReturnValue(chain) } };
  }

  it('TTL constant is exactly 10 minutes', () => {
    expect(STRANDED_REFINING_LOCK_TTL_MS).toBe(10 * 60 * 1000);
  });

  it('write guard: returns {reclaimed:0} and never touches the DB when canWrite() is false', async () => {
    setEnv('VERCEL_ENV', undefined);
    setEnv('LE_ALLOW_NONPROD_WRITES', undefined);

    const result = await reclaimStrandedRefiningLocks();

    expect(result).toEqual({ reclaimed: 0 });
    expect(getSupabase).not.toHaveBeenCalled();
  });

  it('SELECT is scoped correctly: auto_run=true, paused_reason=refining, updated_at < ~10min ago', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    const selectMock = vi.fn().mockReturnThis();
    const eqMock = vi.fn().mockReturnThis();
    const ltMock = vi.fn().mockResolvedValue({ data: [], error: null });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock, eq: eqMock, lt: ltMock });
    (getSupabase as Mock).mockReturnValue({ from: fromMock });

    await reclaimStrandedRefiningLocks();

    expect(fromMock).toHaveBeenCalledWith('delivery_runs');
    expect(selectMock).toHaveBeenCalledWith('id, stage');
    expect(eqMock).toHaveBeenCalledWith('auto_run', true);
    expect(eqMock).toHaveBeenCalledWith('paused_reason', 'refining');
    expect(ltMock).toHaveBeenCalledWith('updated_at', expect.any(String));

    const cutoffArg = ltMock.mock.calls[0]![1] as string;
    const cutoffMs = new Date(cutoffArg).getTime();
    const expectedMs = Date.now() - STRANDED_REFINING_LOCK_TTL_MS;
    expect(Math.abs(cutoffMs - expectedMs)).toBeLessThan(2000); // 2s tolerance for test exec time
  });

  it("reclaims a run stuck at paused_reason='refining' with updated_at 11 minutes ago", async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    const elevenMinAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const { db } = makeReclaimDb([
      { id: 'run-stale', stage: 'assembling', auto_run: true, paused_reason: 'refining', updated_at: elevenMinAgo },
    ]);
    (getSupabase as Mock).mockReturnValue(db);
    (updateRun as Mock).mockResolvedValue({});

    const result = await reclaimStrandedRefiningLocks();

    expect(result).toEqual({ reclaimed: 1 });
    expect(updateRun).toHaveBeenCalledWith('run-stale', { paused_reason: null });
  });

  it('does NOT reclaim the same shape of run at 5 minutes old (still within the TTL)', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { db } = makeReclaimDb([
      { id: 'run-fresh', stage: 'assembling', auto_run: true, paused_reason: 'refining', updated_at: fiveMinAgo },
    ]);
    (getSupabase as Mock).mockReturnValue(db);

    const result = await reclaimStrandedRefiningLocks();

    expect(result).toEqual({ reclaimed: 0 });
    expect(updateRun).not.toHaveBeenCalled();
  });

  it('NEVER reclaims a genuinely human-paused run regardless of age', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { db } = makeReclaimDb([
      { id: 'run-human', stage: 'details', auto_run: true, paused_reason: 'missing listing field: price', updated_at: oneDayAgo },
    ]);
    (getSupabase as Mock).mockReturnValue(db);

    const result = await reclaimStrandedRefiningLocks();

    expect(result).toEqual({ reclaimed: 0 });
    expect(updateRun).not.toHaveBeenCalled();
  });

  it('reclaims only the stranded rows out of a mixed batch and counts correctly', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    const elevenMinAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { db } = makeReclaimDb([
      { id: 'run-stale-1', stage: 'assembling', auto_run: true, paused_reason: 'refining', updated_at: elevenMinAgo },
      { id: 'run-fresh', stage: 'checkpoint_a', auto_run: true, paused_reason: 'refining', updated_at: fiveMinAgo },
      { id: 'run-human', stage: 'details', auto_run: true, paused_reason: 'missing listing field: price', updated_at: oneDayAgo },
      { id: 'run-stale-2', stage: 'music', auto_run: true, paused_reason: 'refining', updated_at: elevenMinAgo },
    ]);
    (getSupabase as Mock).mockReturnValue(db);
    (updateRun as Mock).mockResolvedValue({});

    const result = await reclaimStrandedRefiningLocks();

    expect(result).toEqual({ reclaimed: 2 });
    expect(updateRun).toHaveBeenCalledWith('run-stale-1', { paused_reason: null });
    expect(updateRun).toHaveBeenCalledWith('run-stale-2', { paused_reason: null });
    expect(updateRun).not.toHaveBeenCalledWith('run-fresh', expect.anything());
    expect(updateRun).not.toHaveBeenCalledWith('run-human', expect.anything());
  });

  it('logs the run id + stage for each reclaim', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    const elevenMinAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const { db } = makeReclaimDb([
      { id: 'run-stale', stage: 'checkpoint_b', auto_run: true, paused_reason: 'refining', updated_at: elevenMinAgo },
    ]);
    (getSupabase as Mock).mockReturnValue(db);
    (updateRun as Mock).mockResolvedValue({});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await reclaimStrandedRefiningLocks();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('run-stale'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('checkpoint_b'));
    logSpy.mockRestore();
  });

  it('fails open (returns {reclaimed:0}, never throws) on a SELECT error', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockResolvedValue({ data: null, error: { message: 'connection refused' } }),
    };
    (getSupabase as Mock).mockReturnValue({ from: vi.fn().mockReturnValue(chain) });

    await expect(reclaimStrandedRefiningLocks()).resolves.toEqual({ reclaimed: 0 });
    expect(updateRun).not.toHaveBeenCalled();
  });

  it('fails open (returns {reclaimed:0}, never throws) when getSupabase itself throws', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    (getSupabase as Mock).mockImplementation(() => {
      throw new Error('no client');
    });

    await expect(reclaimStrandedRefiningLocks()).resolves.toEqual({ reclaimed: 0 });
  });

  it('one row failing updateRun does not abort the loop — other rows still reclaimed', async () => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    const elevenMinAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const { db } = makeReclaimDb([
      { id: 'run-fails', stage: 'assembling', auto_run: true, paused_reason: 'refining', updated_at: elevenMinAgo },
      { id: 'run-ok', stage: 'assembling', auto_run: true, paused_reason: 'refining', updated_at: elevenMinAgo },
    ]);
    (getSupabase as Mock).mockReturnValue(db);
    (updateRun as Mock)
      .mockRejectedValueOnce(new Error('DB write failed'))
      .mockResolvedValueOnce({});

    const result = await reclaimStrandedRefiningLocks();

    expect(result).toEqual({ reclaimed: 1 });
    expect(updateRun).toHaveBeenCalledTimes(2);
  });
});
