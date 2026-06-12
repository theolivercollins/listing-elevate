// lib/operator-studio/__tests__/clients.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('../../client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

import { listClients, getClient, createClient, updateClient, archiveClient } from '../clients';

beforeEach(() => { mockFrom.mockReset(); });

describe('clients CRUD', () => {
  it('listClients excludes archived by default', async () => {
    const select = vi.fn().mockReturnThis();
    const is = vi.fn().mockReturnThis();
    const order = vi.fn().mockResolvedValue({ data: [{ id: 'c1', name: 'Alice' }], error: null });
    mockFrom.mockReturnValue({ select, is, order });

    const rows = await listClients({ includeArchived: false });
    expect(mockFrom).toHaveBeenCalledWith('clients');
    expect(is).toHaveBeenCalledWith('archived_at', null);
    expect(rows).toEqual([{ id: 'c1', name: 'Alice' }]);
  });

  it('listClients includes archived when asked', async () => {
    const select = vi.fn().mockReturnThis();
    const is = vi.fn().mockReturnThis();
    const order = vi.fn().mockResolvedValue({ data: [{ id: 'c1' }, { id: 'c2', archived_at: '2026-01-01' }], error: null });
    mockFrom.mockReturnValue({ select, is, order });

    const rows = await listClients({ includeArchived: true });
    expect(is).not.toHaveBeenCalled();
    expect(rows).toHaveLength(2);
  });

  it('createClient rejects when name is missing', async () => {
    await expect(createClient({ name: '' } as never)).rejects.toThrow(/name/i);
    await expect(createClient({ name: '   ' } as never)).rejects.toThrow(/name/i);
  });

  it('createClient inserts and returns the new row, trimming the name', async () => {
    const insert = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnThis();
    const single = vi.fn().mockResolvedValue({ data: { id: 'c2', name: 'Bob' }, error: null });
    mockFrom.mockReturnValue({ insert, select, single });

    const row = await createClient({ name: '  Bob  ' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ name: 'Bob' }));
    expect(row.id).toBe('c2');
  });

  it('archiveClient sets archived_at to now', async () => {
    const update = vi.fn().mockReturnThis();
    const eq = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnThis();
    const single = vi.fn().mockResolvedValue({ data: { id: 'c1', archived_at: '2026-05-15T00:00:00Z' }, error: null });
    mockFrom.mockReturnValue({ update, eq, select, single });

    await archiveClient('c1');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ archived_at: expect.any(String) }));
    expect(eq).toHaveBeenCalledWith('id', 'c1');
  });

  it('getClient returns null for missing id', async () => {
    const select = vi.fn().mockReturnThis();
    const eq = vi.fn().mockReturnThis();
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockReturnValue({ select, eq, maybeSingle });
    expect(await getClient('nope')).toBeNull();
  });

  it('updateClient sends a patch and bumps updated_at', async () => {
    const update = vi.fn().mockReturnThis();
    const eq = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnThis();
    const single = vi.fn().mockResolvedValue({ data: { id: 'c1', notes: 'hi' }, error: null });
    mockFrom.mockReturnValue({ update, eq, select, single });

    await updateClient('c1', { notes: 'hi' });
    const payload = update.mock.calls[0][0];
    expect(payload.notes).toBe('hi');
    expect(payload.updated_at).toEqual(expect.any(String));
  });
});
