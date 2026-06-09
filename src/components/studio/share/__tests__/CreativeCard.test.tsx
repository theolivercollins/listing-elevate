import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CreativeCard } from '../CreativeCard';
import type { Creative } from '@/lib/share-api';

function makeCreative(overrides: Partial<Creative> = {}): Creative {
  return {
    id: 'c1',
    title: 'Sunny Loft Tour',
    description: null,
    source: 'upload',
    kind: 'video',
    public_url: null,
    storage_path: 'c1/123_video.mp4',
    bucket: 'creatives',
    thumbnail_url: null,
    visibility: 'unlisted',
    allow_download: false,
    allow_embed: true,
    presentation_enabled: true,
    expires_at: null,
    view_count: 42,
    share_token: 'abcdefghijklmnopqrstuvwxyz234567',
    property_id: null,
    created_at: '2026-06-08T00:00:00Z',
    shareUrl: '/v/abcdefghijklmnopqrstuvwxyz234567',
    embedUrl: '/embed/abcdefghijklmnopqrstuvwxyz234567',
    previewUrl: null,
    ...overrides,
  };
}

describe('CreativeCard', () => {
  it('renders the title, view count and an unlisted badge', () => {
    render(<CreativeCard creative={makeCreative()} onSelect={() => {}} />);
    expect(screen.getByText('Sunny Loft Tour')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('Unlisted')).toBeTruthy();
  });

  it('renders a public badge when visibility is public', () => {
    render(<CreativeCard creative={makeCreative({ visibility: 'public' })} onSelect={() => {}} />);
    expect(screen.getByText('Public')).toBeTruthy();
  });

  it('calls onSelect with the creative when clicked', () => {
    const onSelect = vi.fn();
    const creative = makeCreative();
    render(<CreativeCard creative={creative} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /open settings/i }));
    expect(onSelect).toHaveBeenCalledWith(creative);
  });
});
