import { describe, it, expect } from 'vitest';
import { draftOrderFromWinners } from './order';

it('orders winner scenes by the walkthrough policy (aerial first, exterior_back last)', () => {
  const order = draftOrderFromWinners([
    { id: 's-bed', scene_number: 2, room_type: 'bedroom' },
    { id: 's-aerial', scene_number: 5, room_type: 'aerial' },
    { id: 's-kitchen', scene_number: 1, room_type: 'kitchen' },
    { id: 's-back', scene_number: 3, room_type: 'exterior_back' },
  ]);
  expect(order).toEqual(['s-aerial', 's-kitchen', 's-bed', 's-back']);
});

it('keeps director order within a room bucket and tolerates null room types', () => {
  const order = draftOrderFromWinners([
    { id: 'b', scene_number: 2, room_type: null },
    { id: 'a', scene_number: 1, room_type: null },
  ]);
  expect(order).toEqual(['a', 'b']);
});
