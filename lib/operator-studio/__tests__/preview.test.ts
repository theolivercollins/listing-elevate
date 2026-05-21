import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
const mockRpc = vi.fn();
vi.mock('../../client', () => ({
  getSupabase: () => ({ from: mockFrom, rpc: mockRpc }),
}));
vi.mock('../preview-tokens', () => ({
  generatePreviewToken: () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
}));

import { createPreviewLink, fetchByToken, recordPreviewView, insertClientNote } from '../preview';

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset().mockResolvedValue({ data: null, error: null });
});

describe('createPreviewLink', () => {
  it('inserts a row with the generated token + property_id', async () => {
    const insert = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnThis();
    const single = vi.fn().mockResolvedValue({ data: { id: 'pv1', token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', property_id: 'p1' }, error: null });
    mockFrom.mockReturnValue({ insert, select, single });
    const row = await createPreviewLink('p1');
    expect(mockFrom).toHaveBeenCalledWith('property_previews');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ property_id: 'p1', token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }));
    expect(row.id).toBe('pv1');
  });

  it('throws when DB returns an error', async () => {
    const insert = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnThis();
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'db boom' } });
    mockFrom.mockReturnValue({ insert, select, single });
    await expect(createPreviewLink('p1')).rejects.toThrow(/db boom/);
  });

  it('passes expires_at when provided', async () => {
    const insert = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnThis();
    const single = vi.fn().mockResolvedValue({ data: { id: 'pv2', token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', property_id: 'p1', expires_at: '2099-01-01T00:00:00Z' }, error: null });
    mockFrom.mockReturnValue({ insert, select, single });
    const row = await createPreviewLink('p1', '2099-01-01T00:00:00Z');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ expires_at: '2099-01-01T00:00:00Z' }));
    expect(row.id).toBe('pv2');
  });
});

describe('fetchByToken', () => {
  it('returns null when token not found', async () => {
    mockFrom.mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) });
    expect(await fetchByToken('nope')).toBeNull();
  });

  it('marks expired when expires_at is in the past', async () => {
    mockFrom
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { property_id: 'p1', expires_at: '2020-01-01T00:00:00Z' } }) }) }) })
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'p1', address: '1 Oak', client_id: null } }) }) }) });
    const r = await fetchByToken('t');
    expect(r?.expired).toBe(true);
  });

  it('marks not-expired when expires_at is null', async () => {
    mockFrom
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { property_id: 'p1', expires_at: null } }) }) }) })
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'p1', address: '1 Oak', client_id: null } }) }) }) });
    const r = await fetchByToken('t');
    expect(r?.expired).toBe(false);
  });

  it('returns null when property not found', async () => {
    mockFrom
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { property_id: 'p1', expires_at: null } }) }) }) })
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) });
    expect(await fetchByToken('t')).toBeNull();
  });

  it('includes client brand fields when client_id is set', async () => {
    mockFrom
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { property_id: 'p1', expires_at: null } }) }) }) })
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'p1', address: '1 Oak', client_id: 'c1' } }) }) }) })
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: 'Helgemo', brand_logo_url: 'logo.png', agent_name: 'Abby' } }) }) }) });
    const r = await fetchByToken('t');
    expect(r?.client?.name).toBe('Helgemo');
    expect(r?.client?.agent_name).toBe('Abby');
    expect(r?.client?.brand_logo_url).toBe('logo.png');
  });

  it('sets client to null when no client_id', async () => {
    mockFrom
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { property_id: 'p1', expires_at: null } }) }) }) })
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'p1', address: '1 Oak', client_id: null } }) }) }) });
    const r = await fetchByToken('t');
    expect(r?.client).toBeNull();
  });
});

describe('recordPreviewView', () => {
  it('calls the increment_preview_view RPC', async () => {
    await recordPreviewView('tok');
    expect(mockRpc).toHaveBeenCalledWith('increment_preview_view', { p_token: 'tok' });
  });
});

describe('insertClientNote', () => {
  it('inserts a property_revision_notes row tagged client_preview', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert });
    await insertClientNote({ property_id: 'p1', source: 'client_preview', body: 'fix it' });
    expect(mockFrom).toHaveBeenCalledWith('property_revision_notes');
    expect(insert).toHaveBeenCalledWith({ property_id: 'p1', source: 'client_preview', body: 'fix it' });
  });

  it('throws when DB insert fails', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'constraint violation' } });
    mockFrom.mockReturnValue({ insert });
    await expect(insertClientNote({ property_id: 'p1', source: 'client_preview', body: 'oops' })).rejects.toThrow(/constraint violation/);
  });
});
