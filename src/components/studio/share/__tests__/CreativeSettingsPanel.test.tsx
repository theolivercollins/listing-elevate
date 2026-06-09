import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CreativeSettingsPanel } from '../CreativeSettingsPanel';
import type { Creative } from '@/lib/share-api';

function makeCreative(overrides: Partial<Creative> = {}): Creative {
  return {
    id: 'c1',
    title: 'Sunny Loft Tour',
    description: null,
    source: 'upload',
    kind: 'video',
    public_url: 'https://example.com/v.mp4',
    storage_path: 'c1/123_video.mp4',
    bucket: 'creatives',
    thumbnail_url: null,
    visibility: 'unlisted',
    allow_download: false,
    allow_embed: true,
    presentation_enabled: true,
    expires_at: null,
    view_count: 0,
    share_token: 'abcdefghijklmnopqrstuvwxyz234567',
    property_id: null,
    created_at: '2026-06-08T00:00:00Z',
    shareUrl: '/v/abcdefghijklmnopqrstuvwxyz234567',
    embedUrl: '/embed/abcdefghijklmnopqrstuvwxyz234567',
    previewUrl: null,
    bunny_video_id: null,
    bunnyEmbedUrl: null,
    appearance: {},
    ...overrides,
  };
}

describe('CreativeSettingsPanel', () => {
  it('toggling download on calls onPatch with allow_download:true', () => {
    const onPatch = vi.fn();
    render(
      <CreativeSettingsPanel
        creative={makeCreative({ allow_download: false })}
        onPatch={onPatch}
        onDelete={() => {}}
        onClose={() => {}}
      />,
    );

    const toggle = screen.getByRole('switch', { name: /allow download/i });
    fireEvent.click(toggle);

    expect(onPatch).toHaveBeenCalledWith('c1', { allow_download: true });
  });

  it('renders the share link and embed snippet with the token', () => {
    render(
      <CreativeSettingsPanel
        creative={makeCreative()}
        onPatch={() => {}}
        onDelete={() => {}}
        onClose={() => {}}
      />,
    );
    const link = screen.getByLabelText(/presentation link/i) as HTMLInputElement;
    expect(link.value).toContain('/v/abcdefghijklmnopqrstuvwxyz234567');
    const embed = screen.getByLabelText(/embed code/i) as HTMLTextAreaElement;
    expect(embed.value).toContain('/embed/abcdefghijklmnopqrstuvwxyz234567');
  });
});
