/**
 * CheckpointB — video-player wiring tests.
 *
 * Proves the single-video-player pattern via FinalVideoPlayer: the Bunny
 * iframe embed takes priority when present (built-in adaptive-quality menu —
 * the "load full quality" affordance), the raw HlsPlayer fallback now
 * prefers the progressive mp4 over the HLS playlist (hls.js's zero-config
 * ABR starts at a low rendition and looks blurry — the mp4 is always sharp),
 * and legacy mp4-only rows still play.
 *
 * HlsPlayer is mocked to a marker div that echoes the src/poster/preload
 * props it receives; authedFetch is stubbed (the Download button imports it
 * but these tests never click it).
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
  it('renders the Bunny iframe embed when embedUrl is present, even with mp4/hls also present', () => {
    render(
      <CheckpointB
        runId="run-1"
        propertyId="prop-1"
        videoUrl="https://cdn/v.mp4"
        hlsUrl="https://cdn/v.m3u8"
        embedUrl="https://iframe.mediadelivery.net/embed/12345/guid-1"
        posterUrl="https://cdn/poster.jpg"
        onDelivered={noop}
      />,
    );
    const iframe = screen.getByTitle('Final video review');
    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe).toHaveAttribute('src', 'https://iframe.mediadelivery.net/embed/12345/guid-1');
    // No raw HlsPlayer fallback rendered alongside the embed.
    expect(screen.queryByTestId('hls-player')).toBeNull();
  });

  it('falls back to HlsPlayer with the mp4 src preferred over HLS when there is no embedUrl', () => {
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
    // mp4 now preferred over the HLS playlist for the fallback path — HLS's
    // zero-config ABR is the blurry-video regression this fixes.
    expect(player).toHaveAttribute('data-src', 'https://cdn/v.mp4');
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
