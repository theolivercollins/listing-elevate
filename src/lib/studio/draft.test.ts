import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuthedFetch = vi.fn();

vi.mock('@/lib/api', () => ({
  authedFetch: (...args: unknown[]) => mockAuthedFetch(...args),
}));

import { getLatestDraft, saveDraft, deleteDraft, isDraftMeaningful } from './draft';

function makeResponse(ok: boolean, body: unknown): Response {
  return { ok, json: async () => body } as Response;
}

beforeEach(() => {
  mockAuthedFetch.mockReset();
});

describe('getLatestDraft', () => {
  it('GETs /api/admin/studio/drafts and returns the draft', async () => {
    mockAuthedFetch.mockResolvedValue(makeResponse(true, { draft: { id: 'd1', address: '123 Oak St' } }));
    const draft = await getLatestDraft();
    expect(mockAuthedFetch).toHaveBeenCalledWith('/api/admin/studio/drafts');
    expect(draft).toEqual({ id: 'd1', address: '123 Oak St' });
  });

  it('returns null on a non-ok response', async () => {
    mockAuthedFetch.mockResolvedValue(makeResponse(false, {}));
    expect(await getLatestDraft()).toBeNull();
  });

  it('returns null when the server has no draft', async () => {
    mockAuthedFetch.mockResolvedValue(makeResponse(true, { draft: null }));
    expect(await getLatestDraft()).toBeNull();
  });

  it('returns null when the response body cannot be parsed', async () => {
    mockAuthedFetch.mockResolvedValue({
      ok: true,
      json: async () => { throw new Error('bad json'); },
    } as unknown as Response);
    expect(await getLatestDraft()).toBeNull();
  });
});

describe('saveDraft', () => {
  it('PUTs the payload as JSON and returns the saved draft', async () => {
    mockAuthedFetch.mockResolvedValue(makeResponse(true, { draft: { id: 'd1' } }));
    const result = await saveDraft({ address: '123 Oak St' });
    expect(mockAuthedFetch).toHaveBeenCalledWith('/api/admin/studio/drafts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '123 Oak St' }),
    });
    expect(result).toEqual({ id: 'd1' });
  });

  it('returns null on a non-ok response (best-effort autosave)', async () => {
    mockAuthedFetch.mockResolvedValue(makeResponse(false, {}));
    expect(await saveDraft({ address: 'x' })).toBeNull();
  });

  it('forwards an AbortSignal when given (autosave sequence guard)', async () => {
    mockAuthedFetch.mockResolvedValue(makeResponse(true, { draft: { id: 'd1' } }));
    const controller = new AbortController();
    await saveDraft({ address: '123 Oak St' }, controller.signal);
    const [, init] = mockAuthedFetch.mock.calls[0];
    expect((init as RequestInit).signal).toBe(controller.signal);
  });
});

describe('deleteDraft', () => {
  it('DELETEs /api/admin/studio/drafts/:id (row only, no purge)', async () => {
    mockAuthedFetch.mockResolvedValue(makeResponse(true, {}));
    const ok = await deleteDraft('d1');
    expect(mockAuthedFetch).toHaveBeenCalledWith('/api/admin/studio/drafts/d1', { method: 'DELETE' });
    expect(ok).toBe(true);
  });

  it('appends ?purge=1 when purge is requested (Discard reclaims storage)', async () => {
    mockAuthedFetch.mockResolvedValue(makeResponse(true, {}));
    await deleteDraft('d1', { purge: true });
    expect(mockAuthedFetch).toHaveBeenCalledWith('/api/admin/studio/drafts/d1?purge=1', {
      method: 'DELETE',
    });
  });

  it('returns false on failure', async () => {
    mockAuthedFetch.mockResolvedValue(makeResponse(false, {}));
    expect(await deleteDraft('d1')).toBe(false);
  });
});

describe('isDraftMeaningful', () => {
  it('is false for a totally empty form', () => {
    expect(isDraftMeaningful({})).toBe(false);
  });

  it('is true when address is set', () => {
    expect(isDraftMeaningful({ address: '123 Oak St' })).toBe(true);
  });

  it('is true when a client is picked', () => {
    expect(isDraftMeaningful({ client_id: 'c1' })).toBe(true);
  });

  it('is true when at least one photo exists', () => {
    expect(isDraftMeaningful({ photo_paths: [{ path: 'a', url: 'b', name: 'c' }] })).toBe(true);
  });

  it('is false for an empty photo_paths array', () => {
    expect(isDraftMeaningful({ photo_paths: [] })).toBe(false);
  });

  it('is true when director_notes is set', () => {
    expect(isDraftMeaningful({ director_notes: 'shoot the pool at dusk' })).toBe(true);
  });

  it('is true when a numeric field is set (including 0)', () => {
    expect(isDraftMeaningful({ bedrooms: 3 })).toBe(true);
    expect(isDraftMeaningful({ bathrooms: 0 })).toBe(true);
  });

  it('ignores whitespace-only address/notes', () => {
    expect(isDraftMeaningful({ address: '   ', director_notes: '  ' })).toBe(false);
  });
});
