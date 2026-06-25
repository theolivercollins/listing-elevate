/**
 * Unit tests for lib/delivery/auto-run.ts — autopilot resolver core skeleton.
 *
 * Strategy: all guard branches are pure (no I/O) and are covered here without
 * touching Supabase. pauseForHuman is NOT exercised in these unit tests because
 * it requires a live DB; integration tests (T7) cover that path.
 *
 * Resolver stubs return noop immediately, so the "passes all guards" test also
 * requires no Supabase call.
 */

import { describe, it, expect, afterEach } from 'vitest';
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
} from '../auto-run.js';
import type { DeliveryRunRow } from '../../types/operator-studio.js';

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
  // Clear saved state for the next test
  for (const key of Object.keys(savedEnv)) {
    delete savedEnv[key];
  }
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
    // Provide non-gate stage so Guard 3 fires, not Guard 2
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

// ─── resolveGate — all guards pass, reaches resolver ─────────────────────────

describe('resolveGate — dispatch to stub resolver when all guards pass', () => {
  // Each gate stage should reach its (stubbed) resolver and return its TODO noop.
  it.each([
    ['checkpoint_a', 'TODO: checkpoint_a resolver not implemented'],
    ['details',      'TODO: details resolver not implemented'],
    ['voiceover',    'TODO: voiceover resolver not implemented'],
    ['music',        'TODO: music resolver not implemented'],
    ['checkpoint_b', 'TODO: checkpoint_b resolver not implemented'],
  ] as const)('stage "%s" reaches its stub resolver', async (stage, expectedReason) => {
    setEnv('LE_ALLOW_NONPROD_WRITES', 'true');
    const result = await resolveGate(
      makeRun({ auto_run: true, paused_reason: null, stage }),
    );
    expect(result).toEqual({ action: 'noop', reason: expectedReason });
  });
});

// ─── Individual resolver stubs ────────────────────────────────────────────────
// Guard that each exported resolver returns the expected TODO noop so T3 knows
// exactly what it's replacing.

describe('resolver stubs — return TODO noop', () => {
  const run = makeRun();

  it('resolveCheckpointA', async () => {
    const r = await resolveCheckpointA(run);
    expect(r).toEqual({ action: 'noop', reason: 'TODO: checkpoint_a resolver not implemented' });
  });

  it('resolveDetails', async () => {
    const r = await resolveDetails(run);
    expect(r).toEqual({ action: 'noop', reason: 'TODO: details resolver not implemented' });
  });

  it('resolveVoiceover', async () => {
    const r = await resolveVoiceover(run);
    expect(r).toEqual({ action: 'noop', reason: 'TODO: voiceover resolver not implemented' });
  });

  it('resolveMusic', async () => {
    const r = await resolveMusic(run);
    expect(r).toEqual({ action: 'noop', reason: 'TODO: music resolver not implemented' });
  });

  it('resolveCheckpointB', async () => {
    const r = await resolveCheckpointB(run);
    expect(r).toEqual({ action: 'noop', reason: 'TODO: checkpoint_b resolver not implemented' });
  });
});
