// lib/operator-studio/__tests__/creatives.test.ts
import { describe, it, expect, vi } from 'vitest';

const mockFrom = vi.fn();
vi.mock('../../client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

import {
  generateShareToken,
  hashPassword,
  verifyPassword,
  evaluateShareAccess,
  buildSharePayload,
} from '../creatives';
import type { CreativeRow } from '../../types/creatives';

const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

function makeRow(over: Partial<CreativeRow> = {}): CreativeRow {
  return {
    id: 'cr1',
    title: 'Listing reel',
    description: null,
    source: 'render',
    kind: 'video',
    bucket: 'property-videos',
    storage_path: null,
    public_url: 'https://cdn.example.com/v.mp4',
    thumbnail_url: 'https://cdn.example.com/p.jpg',
    mime_type: 'video/mp4',
    duration_seconds: 15,
    width: 1080,
    height: 1920,
    file_size_bytes: 1234,
    property_id: null,
    share_token: 'tok',
    visibility: 'unlisted',
    allow_download: false,
    allow_embed: true,
    presentation_enabled: true,
    password_hash: null,
    expires_at: null,
    view_count: 0,
    last_viewed_at: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('share token', () => {
  it('generates a 32-char base64url token', () => {
    expect(generateShareToken()).toMatch(TOKEN_RE);
  });
  it('is unique across calls', () => {
    expect(generateShareToken()).not.toEqual(generateShareToken());
  });
});

describe('password', () => {
  it('verifies a correct password and rejects wrong', () => {
    const h = hashPassword('hunter2');
    expect(verifyPassword('hunter2', h)).toBe(true);
    expect(verifyPassword('nope', h)).toBe(false);
  });
  it('treats a null hash as open', () => {
    expect(verifyPassword('anything', null)).toBe(true);
  });
});

describe('evaluateShareAccess', () => {
  const base = { password_hash: null as string | null, expires_at: null as string | null };

  it('allows when open', () => {
    expect(
      evaluateShareAccess({ ...base }, { now: new Date('2026-01-01'), password: null }).status,
    ).toBe('ok');
  });

  it('blocks when expired', () => {
    expect(
      evaluateShareAccess(
        { ...base, expires_at: '2025-01-01T00:00:00Z' },
        { now: new Date('2026-01-01'), password: null },
      ).status,
    ).toBe('expired');
  });

  it('requires password when set and missing', () => {
    const h = hashPassword('pw');
    expect(
      evaluateShareAccess({ ...base, password_hash: h }, { now: new Date(), password: null }).status,
    ).toBe('password_required');
  });

  it('requires password when set and wrong', () => {
    const h = hashPassword('pw');
    expect(
      evaluateShareAccess({ ...base, password_hash: h }, { now: new Date(), password: 'bad' }).status,
    ).toBe('password_required');
  });

  it('allows when password set and correct', () => {
    const h = hashPassword('pw');
    expect(
      evaluateShareAccess({ ...base, password_hash: h }, { now: new Date(), password: 'pw' }).status,
    ).toBe('ok');
  });

  it('treats expiry as winning over password', () => {
    const h = hashPassword('pw');
    expect(
      evaluateShareAccess(
        { password_hash: h, expires_at: '2025-01-01T00:00:00Z' },
        { now: new Date('2026-01-01'), password: null },
      ).status,
    ).toBe('expired');
  });
});

describe('buildSharePayload', () => {
  it('omits downloadUrl when allow_download is false', () => {
    const payload = buildSharePayload(makeRow({ allow_download: false }), 'play', 'dl');
    expect(payload.downloadUrl).toBeNull();
    expect(payload.playbackUrl).toBe('play');
    expect(payload.posterUrl).toBe('https://cdn.example.com/p.jpg');
  });

  it('includes downloadUrl when allow_download is true', () => {
    const payload = buildSharePayload(makeRow({ allow_download: true }), 'play', 'dl');
    expect(payload.downloadUrl).toBe('dl');
    expect(payload.allow_download).toBe(true);
  });

  it('maps dimensions and kind from the row', () => {
    const payload = buildSharePayload(makeRow({ kind: 'image', width: 800, height: 600 }), 'play', null);
    expect(payload.kind).toBe('image');
    expect(payload.width).toBe(800);
    expect(payload.height).toBe(600);
  });
});
