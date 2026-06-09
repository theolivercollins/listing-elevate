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
  // getRun uses maybeSingle (default: run in stage 'judging')
  (mockChain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'r1', stage: 'judging' }, error: null });
  // updateRun (non-CAS path) uses single
  (mockChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'r1', stage: 'checkpoint_a' }, error: null });
  void updateSpy;
});

describe('advanceRun', () => {
  it('rejects an illegal transition without writing', async () => {
    await expect(advanceRun('r1', 'voiceover')).rejects.toThrow(/illegal transition/i);
    expect(mockChain.update).not.toHaveBeenCalled();
  });

  it('advances a legal single step (CAS row returned)', async () => {
    // First maybeSingle call → getRun (stage: judging)
    // Second maybeSingle call → CAS update result (stage: checkpoint_a)
    (mockChain.maybeSingle as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { id: 'r1', stage: 'judging' }, error: null })
      .mockResolvedValueOnce({ data: { id: 'r1', stage: 'checkpoint_a' }, error: null });
    const row = await advanceRun('r1', 'checkpoint_a');
    expect(row.stage).toBe('checkpoint_a');
    expect(mockChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'checkpoint_a', error: null }),
    );
  });

  it('throws "stage moved" when CAS update matches no row (conflict)', async () => {
    // getRun returns stage: judging (valid from-state)
    // CAS update returns null → another actor already advanced
    (mockChain.maybeSingle as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { id: 'r1', stage: 'judging' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    await expect(advanceRun('r1', 'checkpoint_a')).rejects.toThrow(/stage moved/i);
  });
});

describe('recordMlEvent', () => {
  it('rejects unknown event types', async () => {
    // @ts-expect-error — runtime guard test
    await expect(recordMlEvent('r1', 'bogus', {})).rejects.toThrow(/event_type/i);
    expect(mockChain.insert).not.toHaveBeenCalled();
  });
});
