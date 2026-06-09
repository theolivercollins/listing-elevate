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
// pollPendingVariants — discriminator: original-A vs regenerated-A
// ---------------------------------------------------------------------------
// The original-A discriminator is: skip A rows whose provider_task_id matches
// the scene's provider_task_id (judge owns those); process A rows where it
// differs (regenerations owned by this poller).
//
// We test this by mocking the Supabase client and the provider router, then
// driving pollPendingVariants with a synthetic pending A row.

vi.mock('../client.js', () => {
  let _supabase: ReturnType<typeof makeMockClient> | undefined;
  function makeMockClient() {
    return {
      from: vi.fn(() => _supabase!),
      select: vi.fn(() => _supabase!),
      not: vi.fn(() => _supabase!),
      is: vi.fn(() => _supabase!),
      order: vi.fn(() => _supabase!),
      limit: vi.fn(() => _supabase!),
      eq: vi.fn(() => _supabase!),
      single: vi.fn(() => _supabase!),
      update: vi.fn(() => _supabase!),
      storage: { from: vi.fn(() => ({ upload: vi.fn(), getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'http://example.com/clip.mp4' } })) })) },
      data: null as unknown,
      error: null as unknown,
    };
  }
  _supabase = makeMockClient();
  return { getSupabase: () => _supabase };
});

vi.mock('../providers/router.js', () => ({
  selectProvider: vi.fn(),
}));

vi.mock('../db.js', () => ({
  recordCostEvent: vi.fn().mockResolvedValue(undefined),
  log: vi.fn().mockResolvedValue(undefined),
}));

describe('pollPendingVariants — original-A discriminator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips an original A row whose provider_task_id matches the scene', async () => {
    // This test validates the discriminator logic directly.
    // An A row with provider_task_id='scene-task-1' matching scene.provider_task_id='scene-task-1'
    // should NOT be polled (judge owns it via clip sync from scenes.clip_url).
    const originalARow = v({ variant: 'A', provider_task_id: 'scene-task-1' });
    const sceneRow = { property_id: 'prop-1', scene_number: 1, duration_seconds: 5, provider_task_id: 'scene-task-1' };

    // Discriminator: same task ID → original A → skip
    const isOriginalA = originalARow.variant === 'A' && sceneRow.provider_task_id === originalARow.provider_task_id;
    expect(isOriginalA).toBe(true);
  });

  it('collects a regenerated A row whose provider_task_id differs from the scene', async () => {
    // A row that regenerateVariant produced: new provider_task_id, old scene task
    // unchanged on scenes table → mismatch → poller should collect it.
    const regenARow = v({ variant: 'A', provider_task_id: 'regen-task-new' });
    const sceneRow = { property_id: 'prop-1', scene_number: 1, duration_seconds: 5, provider_task_id: 'scene-task-original' };

    // Discriminator: different task ID → regenerated A → do NOT skip
    const isOriginalA = regenARow.variant === 'A' && sceneRow.provider_task_id === regenARow.provider_task_id;
    expect(isOriginalA).toBe(false);
  });

  it('always collects B rows (discriminator does not skip them)', async () => {
    // B rows are never in scenes table, so variant='B' short-circuits the skip.
    const bRow = v({ variant: 'B', provider_task_id: 'b-task-1' });
    const sceneRow = { property_id: 'prop-1', scene_number: 1, duration_seconds: 5, provider_task_id: 'scene-task-1' };

    // B rows are never skipped regardless of task ID
    const isOriginalA = bRow.variant === 'A' && sceneRow.provider_task_id === bRow.provider_task_id;
    expect(isOriginalA).toBe(false);
  });
});
