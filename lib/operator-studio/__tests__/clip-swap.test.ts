import { describe, it, expect, vi, beforeEach } from 'vitest';

const sceneSelect = vi.fn();
const iterSelect = vi.fn();
const sceneUpdate = vi.fn();
const rerunAssembly = vi.fn();

vi.mock('../../client', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table === 'scenes') return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => sceneSelect() }) }) }),
        update: (patch: unknown) => ({ eq: () => sceneUpdate(patch) }),
      };
      if (table === 'prompt_lab_listing_scene_iterations') return {
        select: () => ({ eq: () => ({ maybeSingle: () => iterSelect() }) }),
      };
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));
vi.mock('../../pipeline', () => ({ rerunAssembly: (...a: unknown[]) => rerunAssembly(...a) }));

import { swapClip } from '../clip-swap';

beforeEach(() => {
  sceneSelect.mockReset();
  iterSelect.mockReset();
  sceneUpdate.mockReset().mockResolvedValue({ error: null });
  rerunAssembly.mockReset().mockResolvedValue(undefined);
});

describe('swapClip', () => {
  it('rejects when scene is not found', async () => {
    sceneSelect.mockResolvedValue({ data: null, error: null });
    await expect(swapClip('p1', 3, 'iter-1')).rejects.toThrow(/scene not found/i);
  });

  it('rejects when iteration is not found', async () => {
    sceneSelect.mockResolvedValue({ data: { id: 's1', room_type: 'kitchen' }, error: null });
    iterSelect.mockResolvedValue({ data: null, error: null });
    await expect(swapClip('p1', 3, 'iter-1')).rejects.toThrow(/iteration .* not found/i);
  });

  it('rejects when room types mismatch', async () => {
    sceneSelect.mockResolvedValue({ data: { id: 's1', room_type: 'kitchen' }, error: null });
    iterSelect.mockResolvedValue({ data: { id: 'iter-1', clip_url: 'u', room_type: 'living_room' }, error: null });
    await expect(swapClip('p1', 3, 'iter-1')).rejects.toThrow(/mismatch/i);
  });

  it('rejects when iteration has no clip_url', async () => {
    sceneSelect.mockResolvedValue({ data: { id: 's1', room_type: 'kitchen' }, error: null });
    iterSelect.mockResolvedValue({ data: { id: 'iter-1', clip_url: null, room_type: 'kitchen' }, error: null });
    await expect(swapClip('p1', 3, 'iter-1')).rejects.toThrow(/no clip_url/i);
  });

  it('happy path: updates scene + calls rerunAssembly', async () => {
    sceneSelect.mockResolvedValue({ data: { id: 's1', room_type: 'kitchen' }, error: null });
    iterSelect.mockResolvedValue({ data: { id: 'iter-1', clip_url: 'https://x/clip.mp4', room_type: 'kitchen' }, error: null });

    await swapClip('p1', 3, 'iter-1');

    const patch = sceneUpdate.mock.calls[0][0];
    expect(patch.clip_url).toBe('https://x/clip.mp4');
    expect(patch.replaced_at).toEqual(expect.any(String));
    expect(rerunAssembly).toHaveBeenCalledWith('p1');
  });
});
