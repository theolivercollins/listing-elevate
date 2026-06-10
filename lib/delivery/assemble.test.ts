import { describe, it, expect } from 'vitest';
import { applySceneOrder } from './assemble';

describe('applySceneOrder', () => {
  it('reorders scenes to the run order, appending unknown scenes at the end', () => {
    const scenes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as Array<{ id: string }>;
    expect(applySceneOrder(scenes, ['c', 'a']).map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('null/empty order is a no-op', () => {
    const scenes = [{ id: 'a' }, { id: 'b' }] as Array<{ id: string }>;
    expect(applySceneOrder(scenes, null).map((s) => s.id)).toEqual(['a', 'b']);
    expect(applySceneOrder(scenes, []).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('breaks ties among missing scenes deterministically by scene_number', () => {
    // c and d are absent from the order; they must trail in scene_number
    // order regardless of the input array order.
    const scenes = [
      { id: 'd', scene_number: 9 },
      { id: 'a', scene_number: 1 },
      { id: 'c', scene_number: 3 },
      { id: 'b', scene_number: 2 },
    ];
    expect(applySceneOrder(scenes, ['b', 'a']).map((s) => s.id)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('is independent of input array order (deterministic)', () => {
    const a = [
      { id: 'x', scene_number: 2 },
      { id: 'y', scene_number: 1 },
      { id: 'z', scene_number: 3 },
    ];
    const b = [...a].reverse();
    const order = ['z'];
    expect(applySceneOrder(a, order).map((s) => s.id)).toEqual(
      applySceneOrder(b, order).map((s) => s.id),
    );
    // z first (in order), then x/y by scene_number ascending.
    expect(applySceneOrder(a, order).map((s) => s.id)).toEqual(['z', 'y', 'x']);
  });

  it('falls back to id when scene_number is absent for all-missing scenes', () => {
    const scenes = [{ id: 'b' }, { id: 'a' }];
    expect(applySceneOrder(scenes, ['x']).map((s) => s.id)).toEqual(['a', 'b']); // both missing -> by id
  });
});
