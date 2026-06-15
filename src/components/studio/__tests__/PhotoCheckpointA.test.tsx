import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoCheckpointA } from '../PhotoCheckpointA';

const authedFetch = vi.fn();

vi.mock('@/lib/api', () => ({
  authedFetch: (...args: unknown[]) => authedFetch(...args),
}));

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

const bundle = {
  photo_selection: {
    selected_photo_ids: ['front', 'laundry'],
    photos: [
      {
        id: 'front',
        file_url: 'https://cdn.test/front.jpg',
        file_name: 'front.jpg',
        selected: true,
        room_type: 'exterior_front',
        aesthetic_score: 9.1,
        quality_score: 9,
        analysis_provider: 'google',
        discard_reason: null,
        analysis_json: {
          selection_verdict: {
            status: 'selected',
            rank: 1,
            reason: 'Required room - exterior front (effective 9.1/10)',
          },
        },
      },
      {
        id: 'laundry',
        file_url: 'https://cdn.test/laundry.jpg',
        file_name: 'laundry.jpg',
        selected: true,
        room_type: 'laundry',
        aesthetic_score: 8.8,
        quality_score: 8,
        analysis_provider: 'google',
        discard_reason: null,
        analysis_json: {
          selection_verdict: {
            status: 'selected',
            rank: 2,
            reason: 'Fill slot - aesthetic 8.8/10, laundry',
          },
        },
      },
      {
        id: 'kitchen',
        file_url: 'https://cdn.test/kitchen.jpg',
        file_name: 'kitchen.jpg',
        selected: false,
        room_type: 'kitchen',
        aesthetic_score: 8.4,
        quality_score: 8,
        analysis_provider: 'google',
        discard_reason: 'Not selected',
        analysis_json: {
          selection_verdict: {
            status: 'not_selected',
            rank: null,
            reason: 'Kitchen quota was already full',
          },
        },
      },
    ],
  },
};

describe('PhotoCheckpointA', () => {
  beforeEach(() => {
    authedFetch.mockReset();
    authedFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (!init) return Promise.resolve(jsonResponse(bundle));
      return Promise.resolve(jsonResponse({ ok: true }));
    });
  });

  it('replaces a selected photo and submits ordered picks with rejection reason', async () => {
    const onChanged = vi.fn();
    render(<PhotoCheckpointA runId="run-1" onChanged={onChanged} />);

    await screen.findByText('2 photos queued for the director');
    expect(screen.getByText(/required room - exterior front/i)).toBeInTheDocument();

    const replaceButtons = screen.getAllByText('Replace');
    fireEvent.click(replaceButtons[1]);
    fireEvent.click(screen.getByText(/kitchen · 8\.4/i));

    const reason = screen.getByPlaceholderText('Why this photo should not be picked');
    fireEvent.change(reason, { target: { value: 'Laundry room is not useful for this listing video' } });

    fireEvent.click(screen.getByText('Approve photos'));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    const post = authedFetch.mock.calls.find((call) => call[1]?.method === 'POST');
    expect(post?.[0]).toBe('/api/admin/studio/delivery/run-1');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      action: 'approve_photo_selection',
      photo_order: ['front', 'kitchen'],
      accepted: [
        { photo_id: 'front', category: 'hero_exterior', note: null },
        { photo_id: 'kitchen', category: 'primary_room', note: null },
      ],
      rejected: [
        {
          photo_id: 'laundry',
          category: 'low_value_room',
          reason: 'Laundry room is not useful for this listing video',
        },
      ],
    });
  });
});
