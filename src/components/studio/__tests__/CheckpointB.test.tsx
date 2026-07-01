/**
 * CheckpointB — video-player wiring tests (the studio-perf pass).
 *
 * Proves the raw <video src controls> was replaced by HlsPlayer, that the HLS
 * playlist + poster are preferred when present, and that legacy mp4-only rows
 * still play (mp4 src, no poster) — the additive switch never breaks existing
 * rows.
 *
 * HlsPlayer is mocked to a marker div that echoes the src/poster/preload props
 * it receives; authedFetch is stubbed (the Download button imports it but these
 * tests never click it).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CheckpointB } from '../CheckpointB';

vi.mock('@/lib/api', () => ({
  authedFetch: vi.fn(),
}));

vi.mock('@/components/preview/HlsPlayer', () => ({
  default: (props: { src: string; poster?: string; preload?: string }) => (
    <div
      data-testid="hls-player"
      data-src={props.src}
      data-poster={props.poster ?? ''}
      data-preload={props.preload ?? ''}
    />
  ),
}));

const noop = () => {};

describe('CheckpointB video player', () => {
  it('renders HlsPlayer with the HLS src + poster when both are present', () => {
    render(
      <CheckpointB
        runId="run-1"
        propertyId="prop-1"
        videoUrl="https://cdn/v.mp4"
        hlsUrl="https://cdn/v.m3u8"
        posterUrl="https://cdn/poster.jpg"
        onDelivered={noop}
      />,
    );
    const player = screen.getByTestId('hls-player');
    // HLS playlist preferred over the progressive mp4.
    expect(player).toHaveAttribute('data-src', 'https://cdn/v.m3u8');
    expect(player).toHaveAttribute('data-poster', 'https://cdn/poster.jpg');
    // A real preload so metadata (duration + first frame) is fetched.
    expect(player).toHaveAttribute('data-preload', 'metadata');
  });

  it('falls back to the mp4 src and no poster for legacy mp4-only rows', () => {
    render(
      <CheckpointB
        runId="run-1"
        propertyId="prop-1"
        videoUrl="https://cdn/legacy.mp4"
        onDelivered={noop}
      />,
    );
    const player = screen.getByTestId('hls-player');
    // No hlsUrl → the mp4 is the playback source (unchanged from before).
    expect(player).toHaveAttribute('data-src', 'https://cdn/legacy.mp4');
    // No poster persisted → HlsPlayer receives undefined (blank until 1st frame).
    expect(player).toHaveAttribute('data-poster', '');
  });

  it('shows the processing placeholder and no player when there is no source at all', () => {
    render(
      <CheckpointB
        runId="run-1"
        propertyId="prop-1"
        videoUrl={null}
        onDelivered={noop}
      />,
    );
    expect(screen.queryByTestId('hls-player')).toBeNull();
    expect(screen.getByText(/Video processing/i)).toBeTruthy();
  });
});
