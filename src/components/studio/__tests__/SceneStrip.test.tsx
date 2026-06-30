import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SceneStrip } from '../SceneStrip';

const baseScene = {
  id: 'scene-1',
  scene_number: 2,
  room_type: 'bathroom',
  clip_url: null as string | null,
  status: 'pending',
};

describe('SceneStrip — degraded scene rendering', () => {
  it('renders a "Needs review" badge (not a blank tile) for needs_review with no clip', () => {
    render(
      <SceneStrip
        scenes={[{ ...baseScene, status: 'needs_review' }]}
        propertyId="prop-1"
        onSwapped={vi.fn()}
      />
    );
    expect(screen.getByText('Needs review')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
  });

  it('renders a "Generation failed" badge for failed with no clip', () => {
    render(
      <SceneStrip
        scenes={[{ ...baseScene, status: 'failed' }]}
        propertyId="prop-1"
        onSwapped={vi.fn()}
      />
    );
    expect(screen.getByText('Generation failed')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
  });

  it('renders a "Generating…" badge for in-flight statuses with no clip', () => {
    render(
      <SceneStrip
        scenes={[{ ...baseScene, status: 'generating' }]}
        propertyId="prop-1"
        onSwapped={vi.fn()}
      />
    );
    expect(screen.getByText('Generating…')).toBeInTheDocument();
  });

  it('treats qc rejects as needs-review', () => {
    render(
      <SceneStrip
        scenes={[{ ...baseScene, status: 'qc_hard_reject' }]}
        propertyId="prop-1"
        onSwapped={vi.fn()}
      />
    );
    expect(screen.getByText('Needs review')).toBeInTheDocument();
  });

  it('still renders a <video> element when clip_url is present, no status badge', () => {
    const { container } = render(
      <SceneStrip
        scenes={[{ ...baseScene, status: 'qc_pass', clip_url: 'https://example.com/clip.mp4' }]}
        propertyId="prop-1"
        onSwapped={vi.fn()}
      />
    );
    expect(container.querySelector('video')).not.toBeNull();
    expect(screen.queryByText('Needs review')).not.toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
  });

  it('always shows the scene number badge, even without a clip', () => {
    render(
      <SceneStrip
        scenes={[{ ...baseScene, status: 'pending' }]}
        propertyId="prop-1"
        onSwapped={vi.fn()}
      />
    );
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });
});
