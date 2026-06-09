import { describe, it, expect } from 'vitest';
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
