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
});
