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

import { describe, it, expect, afterEach, vi, type Mock } from 'vitest';
import {
  resolveGate,
  canWrite,
  AUTO_JUDGE_MARGIN,
  AUTO_DELIVER_THRESHOLD,
  resolveCheckpointA,
  resolveDetails,
  resolveVoiceover,
  resolveMusic,
  resolveCheckpointB,
  pauseForHuman,
} from '../auto-run.js';
import type { DeliveryRunRow } from '../../types/operator-studio.js';

// ─── MODULE MOCKS ─────────────────────────────────────────────────────────────

vi.mock('../../client.js', () => ({
  getSupabase: vi.fn(),
}));

vi.mock('../runs.js', () => ({
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

const mockAnthropicCreate = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockAnthropicCreate },
  })),
}));

// Import mocked modules for use in tests
import { getSupabase } from '../../client.js';
import { getVariantsForRun, updateRun, recordMlEvent, advanceRun } from '../runs.js';
import { generateDeliveryScript } from '../voiceover-script.js';
import { generateVoiceoverAudio } from '../../voiceover/generate-audio.js';
import { recordCostEvent } from '../../db.js';

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
  it.each([
    'intake', 'scraping', 'photo_selection', 'generating', 'judging', 'assembling', 'delivered',
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

// ─── resolveVoiceover ─────────────────────────────────────────────────────────

describe('resolveVoiceover', () => {
  function setupDbWithAddress(address: string | null) {
    // Build a mock that supports: .from('properties').select().eq().maybeSingle()
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: address ? { address } : null, error: null });
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    // Also need update/insert for pauseForHuman when address is null
    const updateEqMock = vi.fn().mockResolvedValue({ error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock });
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const db = { from: fromMock, update: updateMock, insert: insertMock };
    (fromMock as Mock).mockImplementation((table: string) => {
      if (table === 'properties') return { select: selectMock };
      return { update: updateMock, insert: insertMock };
    });
    (getSupabase as Mock).mockReturnValue(db);
    return db;
  }

  it('advances: generates script, picks voice via LLM, synthesizes audio', async () => {
    setupDbWithAddress('123 Main St');
    (generateDeliveryScript as Mock).mockResolvedValue({ script: 'Great home!', wordCount: 2 });
    (updateRun as Mock).mockResolvedValue({});
    mockAnthropicCreate.mockResolvedValue(makeLlmResponse('Amanda'));
    (generateVoiceoverAudio as Mock).mockResolvedValue({ audioUrl: 'https://cdn.example.com/audio.mp3', durationMs: 28000 });
    (recordCostEvent as Mock).mockResolvedValue(undefined);
    (recordMlEvent as Mock).mockResolvedValue(undefined);
    (advanceRun as Mock).mockResolvedValue({});

    const result = await resolveVoiceover(makeRun());
    expect(result).toEqual({ action: 'advanced', to: 'music' });
    expect(generateDeliveryScript).toHaveBeenCalled();
    expect(generateVoiceoverAudio).toHaveBeenCalledWith(expect.objectContaining({
      script: 'Great home!',
      voiceId: 'voice-amanda',
    }));
    expect(recordCostEvent).toHaveBeenCalled();
    expect(advanceRun).toHaveBeenCalledWith('run-1', 'music');
  });

  it('skips script generation if voiceover_script already set', async () => {
    setupDbWithAddress('123 Main St');
    mockAnthropicCreate.mockResolvedValue(makeLlmResponse('Mark'));
    (generateVoiceoverAudio as Mock).mockResolvedValue({ audioUrl: 'https://cdn.example.com/audio.mp3', durationMs: 28000 });
    (recordCostEvent as Mock).mockResolvedValue(undefined);
    (updateRun as Mock).mockResolvedValue({});
    (recordMlEvent as Mock).mockResolvedValue(undefined);
    (advanceRun as Mock).mockResolvedValue({});

    const run = makeRun({ voiceover_script: 'Pre-existing script.' });
    const result = await resolveVoiceover(run);
    expect(result).toEqual({ action: 'advanced', to: 'music' });
    expect(generateDeliveryScript).not.toHaveBeenCalled();
  });

  it('pauses when property address is not found', async () => {
    setupDbWithAddress(null);

    const result = await resolveVoiceover(makeRun());
    expect(result.action).toBe('paused');
    expect((result as { action: 'paused'; reason: string }).reason).toMatch(/address not found/);
  });

  it('pauses when audio synthesis throws', async () => {
    setupDbWithAddress('123 Main St');
    (generateDeliveryScript as Mock).mockResolvedValue({ script: 'Script.', wordCount: 1 });
    (updateRun as Mock).mockResolvedValue({});
    mockAnthropicCreate.mockResolvedValue(makeLlmResponse('Amanda'));
    (generateVoiceoverAudio as Mock).mockRejectedValue(new Error('ElevenLabs 500'));
    (recordCostEvent as Mock).mockResolvedValue(undefined);

    // pauseForHuman needs a db
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
    setupMusicDb([{ id: 'track-upbeat-1' }]);

    const result = await resolveMusic(makeRun());
    expect(result).toEqual({ action: 'advanced', to: 'assembling' });
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

    setupMusicDb(
      [{ id: 'track-a' }, { id: 'track-b' }],
      [
        { track_id: 'track-a', verdict: 'down' },
        { track_id: 'track-b', verdict: 'up' },
        { track_id: 'track-b', verdict: 'up' },
      ],
    );

    const result = await resolveMusic(makeRun());
    expect(result).toEqual({ action: 'advanced', to: 'assembling' });
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
