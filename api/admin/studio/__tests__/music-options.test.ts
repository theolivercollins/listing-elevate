import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockRequireAdmin = vi.fn();
const mockDbFrom = vi.fn();
const mockDbSelect = vi.fn();
const mockDbEq = vi.fn();
const mockDbEq2 = vi.fn();
const mockDbOrder = vi.fn();
const mockDbLimit = vi.fn();

vi.mock('../../../../lib/auth', () => ({
  requireAdmin: (...a: unknown[]) => mockRequireAdmin(...a),
}));
vi.mock('../../../../lib/client', () => ({
  getSupabase: () => ({ from: (...a: unknown[]) => mockDbFrom(...a) }),
}));
// moodForPackage is a pure function — use the real implementation via alias
vi.mock('../../../../lib/assembly/music', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/assembly/music')>();
  return { ...actual };
});

import handler from '../music-options';

function makeRes() {
  return {
    _status: 0,
    _body: {} as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
  };
}

const adminUser = { user: { id: 'u1', email: 'a@t.com' }, profile: { role: 'admin' } };

const fakeTracks = [
  { id: 't1', name: 'Celebrate!', file_url: 'https://cdn.example.com/t1.mp3', mood_tag: 'celebratory', source: 'elevenlabs_music' },
  { id: 't2', name: 'Victory',   file_url: 'https://cdn.example.com/t2.mp3', mood_tag: 'celebratory', source: 'elevenlabs_music' },
  { id: 't3', name: 'Triumph',   file_url: 'https://cdn.example.com/t3.mp3', mood_tag: 'celebratory', source: 'elevenlabs_music' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminUser);
  // Chain: .from('music_tracks').select(...).eq('mood_tag', mood).eq('active', true).order(...).limit(3)
  mockDbLimit.mockResolvedValue({ data: fakeTracks, error: null });
  mockDbOrder.mockReturnValue({ limit: mockDbLimit });
  mockDbEq2.mockReturnValue({ order: mockDbOrder });
  mockDbEq.mockReturnValue({ eq: mockDbEq2 });
  mockDbSelect.mockReturnValue({ eq: mockDbEq });
  mockDbFrom.mockReturnValue({ select: mockDbSelect });
});

describe('GET /api/admin/studio/music-options', () => {
  it('returns 405 on non-GET', async () => {
    const res = makeRes();
    await handler(
      { method: 'POST', query: {}, headers: {}, body: {} } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(405);
  });

  it('GET ?video_type=just_closed queries mood_tag=celebratory and returns up to 3 tracks', async () => {
    const res = makeRes();
    await handler(
      { method: 'GET', query: { video_type: 'just_closed' }, headers: {}, body: {} } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    // moodForPackage('just_closed') === 'celebratory'
    expect(mockDbFrom).toHaveBeenCalledWith('music_tracks');
    expect(mockDbEq).toHaveBeenCalledWith('mood_tag', 'celebratory');
    expect(mockDbEq2).toHaveBeenCalledWith('active', true);
    expect(mockDbLimit).toHaveBeenCalledWith(3);
    const body = res._body as { mood: string; tracks: unknown[] };
    expect(body.mood).toBe('celebratory');
    expect(body.tracks).toHaveLength(3);
  });

  it('GET ?video_type=just_listed returns mood=upbeat', async () => {
    const res = makeRes();
    await handler(
      { method: 'GET', query: { video_type: 'just_listed' }, headers: {}, body: {} } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockDbEq).toHaveBeenCalledWith('mood_tag', 'upbeat');
    const body = res._body as { mood: string };
    expect(body.mood).toBe('upbeat');
  });

  it('GET with unknown video_type returns mood=neutral', async () => {
    const res = makeRes();
    await handler(
      { method: 'GET', query: { video_type: 'unknown_type' }, headers: {}, body: {} } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockDbEq).toHaveBeenCalledWith('mood_tag', 'neutral');
  });

  it('GET without video_type defaults to neutral', async () => {
    const res = makeRes();
    await handler(
      { method: 'GET', query: {}, headers: {}, body: {} } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockDbEq).toHaveBeenCalledWith('mood_tag', 'neutral');
  });

  it('returns 401 when requireAdmin rejects', async () => {
    mockRequireAdmin.mockResolvedValue(null);
    const res = makeRes();
    await handler(
      { method: 'GET', query: { video_type: 'just_listed' }, headers: {}, body: {} } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    // requireAdmin itself writes the 401 — handler just returns
    expect(mockDbFrom).not.toHaveBeenCalled();
  });

  it('returns 500 on db error', async () => {
    mockDbLimit.mockResolvedValue({ data: null, error: { message: 'db error' } });
    const res = makeRes();
    await handler(
      { method: 'GET', query: { video_type: 'just_listed' }, headers: {}, body: {} } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(500);
  });
});
