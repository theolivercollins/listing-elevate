import { describe, expect, it } from 'vitest';
import { buildPhotoSelectionEventPayload, type PhotoSelectionCandidate } from './photo-selection.js';

function photo(
  id: string,
  selected: boolean,
  roomType: string,
  score: number,
): PhotoSelectionCandidate {
  return {
    id,
    file_url: `https://cdn.test/${id}.jpg`,
    file_name: `${id}.jpg`,
    selected,
    room_type: roomType,
    aesthetic_score: score,
    quality_score: score,
    analysis_provider: 'google',
    discard_reason: selected ? null : 'Not selected',
    analysis_json: { motion_headroom: { push_in: true } },
  };
}

describe('buildPhotoSelectionEventPayload', () => {
  it('captures ordered before/after picks and rejected-photo reasons for learning', () => {
    const payload = buildPhotoSelectionEventPayload({
      before: ['front', 'laundry'],
      after: ['front', 'kitchen'],
      photos: [
        photo('front', true, 'exterior_front', 9.1),
        photo('laundry', true, 'laundry', 8.8),
        photo('kitchen', false, 'kitchen', 8.4),
      ],
      rejected: [{
        photo_id: 'laundry',
        category: 'low_value_room',
        reason: 'Laundry room is not useful for this listing video',
      }],
      accepted: [
        { photo_id: 'front', category: 'hero_exterior', note: 'Best opening frame' },
        { photo_id: 'kitchen', category: 'primary_room', note: null },
      ],
    });

    expect(payload.before).toEqual(['front', 'laundry']);
    expect(payload.after).toEqual(['front', 'kitchen']);
    expect(payload.removed).toEqual([
      expect.objectContaining({
        id: 'laundry',
        room_type: 'laundry',
        analysis_provider: 'google',
        operator_reason: 'Laundry room is not useful for this listing video',
        operator_feedback: expect.objectContaining({ category: 'low_value_room' }),
      }),
    ]);
    expect(payload.added).toEqual([
      expect.objectContaining({
        id: 'kitchen',
        room_type: 'kitchen',
        aesthetic_score: 8.4,
        operator_feedback: expect.objectContaining({ category: 'primary_room' }),
      }),
    ]);
    expect(payload.kept).toEqual([
      expect.objectContaining({
        id: 'front',
        room_type: 'exterior_front',
        operator_feedback: expect.objectContaining({ category: 'hero_exterior', note: 'Best opening frame' }),
      }),
    ]);
  });
});
