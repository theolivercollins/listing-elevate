import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetRun = vi.fn();
const mockAdvanceRun = vi.fn();

vi.mock('./runs.js', () => ({
  getRun: (...a: unknown[]) => mockGetRun(...a),
  advanceRun: (...a: unknown[]) => mockAdvanceRun(...a),
}));

const { advanceRunToPhotoSelection } = await import('./photo-selection-stage.js');

describe('advanceRunToPhotoSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tolerates a parallel scrape advance from intake to scraping', async () => {
    mockAdvanceRun
      .mockRejectedValueOnce(new Error('advanceRun: illegal transition scraping -> scraping'))
      .mockResolvedValueOnce({ id: 'run-1', stage: 'photo_selection' });
    mockGetRun.mockResolvedValueOnce({ id: 'run-1', stage: 'scraping' });

    await expect(advanceRunToPhotoSelection('run-1', 'intake')).resolves.toBe(true);

    expect(mockAdvanceRun).toHaveBeenNthCalledWith(1, 'run-1', 'scraping');
    expect(mockGetRun).toHaveBeenCalledWith('run-1');
    expect(mockAdvanceRun).toHaveBeenNthCalledWith(2, 'run-1', 'photo_selection');
  });

  it('returns false without advancing when the run is already past photo selection', async () => {
    await expect(advanceRunToPhotoSelection('run-1', 'generating')).resolves.toBe(false);
    expect(mockAdvanceRun).not.toHaveBeenCalled();
  });
});
