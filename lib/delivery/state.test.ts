import { describe, it, expect } from 'vitest';
import { DELIVERY_STAGES, nextStage, canAdvance, isDeliveryStage, stageIndex } from './state';

describe('DELIVERY_STAGES', () => {
  it('is the locked 11-stage sequence', () => {
    expect(DELIVERY_STAGES).toEqual([
      'intake', 'scraping', 'generating', 'judging', 'checkpoint_a',
      'details', 'voiceover', 'music', 'assembling', 'checkpoint_b', 'delivered',
    ]);
  });
});

describe('nextStage', () => {
  it('walks the chain', () => {
    expect(nextStage('intake')).toBe('scraping');
    expect(nextStage('checkpoint_a')).toBe('details');
    expect(nextStage('checkpoint_b')).toBe('delivered');
  });
  it('terminal stage has no next', () => {
    expect(nextStage('delivered')).toBeNull();
  });
});

describe('canAdvance', () => {
  it('allows only single forward steps', () => {
    expect(canAdvance('judging', 'checkpoint_a')).toBe(true);
    expect(canAdvance('intake', 'generating')).toBe(false); // no skipping
    expect(canAdvance('details', 'checkpoint_a')).toBe(false); // no going back
    expect(canAdvance('delivered', 'intake')).toBe(false);
  });
});

describe('isDeliveryStage / stageIndex', () => {
  it('guards and indexes', () => {
    expect(isDeliveryStage('voiceover')).toBe(true);
    expect(isDeliveryStage('nonsense')).toBe(false);
    expect(stageIndex('intake')).toBe(0);
    expect(stageIndex('delivered')).toBe(10);
  });
});
