import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateSpy = vi.fn();
const mockChain: Record<string, unknown> = {};
for (const m of ['from', 'select', 'insert', 'update', 'eq', 'order', 'maybeSingle', 'single']) {
  mockChain[m] = vi.fn().mockReturnValue(mockChain);
}
vi.mock('../client.js', () => ({ getSupabase: () => mockChain }));

import { advanceRun, recordMlEvent } from './runs';

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of Object.keys(mockChain)) (mockChain[m] as ReturnType<typeof vi.fn>).mockReturnValue(mockChain);
  (mockChain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'r1', stage: 'judging' }, error: null });
  (mockChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'r1', stage: 'checkpoint_a' }, error: null });
  void updateSpy;
});

describe('advanceRun', () => {
  it('rejects an illegal transition without writing', async () => {
    await expect(advanceRun('r1', 'voiceover')).rejects.toThrow(/illegal transition/i);
    expect(mockChain.update).not.toHaveBeenCalled();
  });
  it('advances a legal single step', async () => {
    const row = await advanceRun('r1', 'checkpoint_a');
    expect(row.stage).toBe('checkpoint_a');
    expect(mockChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'checkpoint_a', error: null }),
    );
  });
});

describe('recordMlEvent', () => {
  it('rejects unknown event types', async () => {
    // @ts-expect-error — runtime guard test
    await expect(recordMlEvent('r1', 'bogus', {})).rejects.toThrow(/event_type/i);
    expect(mockChain.insert).not.toHaveBeenCalled();
  });
});
