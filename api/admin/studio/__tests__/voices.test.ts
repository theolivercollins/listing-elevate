import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { VOICES } from '../../../../lib/voiceover/voices';

const mockRequireAdmin = vi.fn();
const mockDbFrom = vi.fn();
const mockDbSelect = vi.fn();
const mockDbEq = vi.fn();
const mockDbMaybeSingle = vi.fn();

vi.mock('../../../../lib/auth', () => ({
  requireAdmin: (...a: unknown[]) => mockRequireAdmin(...a),
}));
vi.mock('../../../../lib/client', () => ({
  getSupabase: () => ({ from: (...a: unknown[]) => mockDbFrom(...a) }),
}));

import handler from '../voices';

function makeRes() {
  return {
    _status: 0,
    _body: {} as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
  };
}

const adminUser = { user: { id: 'u1', email: 'a@t.com' }, profile: { role: 'admin' } };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminUser);
  // Chain: .from('clients').select(...).eq('id', clientId).maybeSingle()
  mockDbMaybeSingle.mockResolvedValue({ data: null, error: null });
  mockDbEq.mockReturnValue({ maybeSingle: mockDbMaybeSingle });
  mockDbSelect.mockReturnValue({ eq: mockDbEq });
  mockDbFrom.mockReturnValue({ select: mockDbSelect });
});

describe('GET /api/admin/studio/voices', () => {
  it('returns 405 on non-GET', async () => {
    const res = makeRes();
    await handler(
      { method: 'POST', query: {}, headers: {} } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(405);
  });

  it('returns the catalog with null client_voice_id when no client_id is given', async () => {
    const res = makeRes();
    await handler(
      { method: 'GET', query: {}, headers: {} } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    const body = res._body as { voices: unknown[]; client_voice_id: string | null };
    expect(body.voices).toEqual(VOICES);
    expect(body.client_voice_id).toBeNull();
    expect(mockDbFrom).not.toHaveBeenCalled();
  });

  it('returns the catalog unchanged when the client voice is already in the catalog', async () => {
    mockDbMaybeSingle.mockResolvedValue({
      data: { voice_id: VOICES[0].id, name: 'Acme Realty' },
      error: null,
    });
    const res = makeRes();
    await handler(
      { method: 'GET', query: { client_id: 'c1' }, headers: {} } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    const body = res._body as { voices: unknown[]; client_voice_id: string | null };
    expect(body.voices).toEqual(VOICES);
    expect(body.client_voice_id).toBe(VOICES[0].id);
  });

  it('prepends a synthesized entry when the client has a custom ElevenLabs voice', async () => {
    mockDbMaybeSingle.mockResolvedValue({
      data: { voice_id: 'custom-eleven-id-123', name: 'Acme Realty' },
      error: null,
    });
    const res = makeRes();
    await handler(
      { method: 'GET', query: { client_id: 'c1' }, headers: {} } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    const body = res._body as {
      voices: Array<{ id: string; name: string; gender: string; description: string }>;
      client_voice_id: string | null;
    };
    expect(body.client_voice_id).toBe('custom-eleven-id-123');
    expect(body.voices).toHaveLength(VOICES.length + 1);
    expect(body.voices[0]).toEqual({
      id: 'custom-eleven-id-123',
      name: 'Acme Realty (client voice)',
      gender: 'custom',
      description: "Client's custom ElevenLabs voice",
    });
    // Catalog entries follow, untouched.
    expect(body.voices.slice(1)).toEqual(VOICES);
  });

  it('falls back to a generic label when the client row has no name', async () => {
    mockDbMaybeSingle.mockResolvedValue({
      data: { voice_id: 'custom-eleven-id-123', name: null },
      error: null,
    });
    const res = makeRes();
    await handler(
      { method: 'GET', query: { client_id: 'c1' }, headers: {} } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    const body = res._body as { voices: Array<{ name: string }> };
    expect(body.voices[0].name).toBe('Client voice');
  });
});
