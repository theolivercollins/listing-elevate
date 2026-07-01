// lib/studio/__tests__/drafts.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();

vi.mock('../../client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

import { getLatestDraft, upsertDraft, deleteDraft } from '../drafts';

beforeEach(() => {
  mockFrom.mockReset();
});

describe('getLatestDraft', () => {
  it('queries by submitted_by, orders by updated_at desc, limit 1', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'd1', submitted_by: 'u1' },
      error: null,
    });
    const limit = vi.fn().mockReturnValue({ maybeSingle });
    const order = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ select });

    const result = await getLatestDraft('u1');

    expect(mockFrom).toHaveBeenCalledWith('studio_drafts');
    expect(select).toHaveBeenCalledWith('*');
    expect(eq).toHaveBeenCalledWith('submitted_by', 'u1');
    expect(order).toHaveBeenCalledWith('updated_at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(1);
    expect(result).toEqual({ id: 'd1', submitted_by: 'u1' });
  });

  it('returns null when no draft exists', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }) }),
    });

    expect(await getLatestDraft('u1')).toBeNull();
  });

  it('throws with a readable message on a Supabase error', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }) }),
    });

    await expect(getLatestDraft('u1')).rejects.toThrow(/boom/);
  });
});

describe('upsertDraft', () => {
  it('upserts onConflict submitted_by, never sending an id', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: 'd1', submitted_by: 'u1', address: '123 Oak St' },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ single });
    const upsertSpy = vi.fn().mockReturnValue({ select });
    mockFrom.mockReturnValue({ upsert: upsertSpy });

    const photo = {
      path: '7f9fed83-1234-5678-9abc-def012345678/raw/1720000000000_a1b2c3d4_photo.jpg',
      url: 'https://x/photo.jpg',
      name: 'photo.jpg',
    };
    const result = await upsertDraft('u1', {
      address: '123 Oak St',
      photo_paths: [photo],
    });

    expect(mockFrom).toHaveBeenCalledWith('studio_drafts');
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const [payload, opts] = upsertSpy.mock.calls[0];
    expect(opts).toEqual({ onConflict: 'submitted_by' });
    expect(payload).not.toHaveProperty('id');
    expect(payload.submitted_by).toBe('u1');
    expect(payload.address).toBe('123 Oak St');
    expect(payload.photo_paths).toEqual([photo]);
    expect(typeof payload.updated_at).toBe('string');
    expect(result.id).toBe('d1');
  });

  describe('photo_paths prefix validation (defense-in-depth)', () => {
    const UUID = '7f9fed83-1234-5678-9abc-def012345678';
    const OTHER_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const valid = (uuid: string, name: string) => ({
      path: `${uuid}/raw/${name}`,
      url: `https://x/${name}`,
      name,
    });

    function mockUpsertOk() {
      const single = vi.fn().mockResolvedValue({ data: { id: 'd1' }, error: null });
      const upsertSpy = vi.fn().mockReturnValue({ select: () => ({ single }) });
      mockFrom.mockReturnValue({ upsert: upsertSpy });
      return upsertSpy;
    }

    it('accepts photo_paths that all share one {uuid}/raw/ folder', async () => {
      const upsertSpy = mockUpsertOk();
      await upsertDraft('u1', {
        photo_paths: [valid(UUID, 'a.jpg'), valid(UUID, 'b.jpg')],
      });
      expect(upsertSpy).toHaveBeenCalledTimes(1);
    });

    it('accepts an empty photo_paths array', async () => {
      const upsertSpy = mockUpsertOk();
      await upsertDraft('u1', { photo_paths: [] });
      expect(upsertSpy).toHaveBeenCalledTimes(1);
    });

    it('rejects a path that is not under a {uuid}/raw/ prefix', async () => {
      const upsertSpy = mockUpsertOk();
      await expect(
        upsertDraft('u1', { photo_paths: [{ path: 'evil.jpg', url: 'x', name: 'evil.jpg' }] }),
      ).rejects.toThrow(/invalid photo path/i);
      expect(upsertSpy).not.toHaveBeenCalled(); // rejected before any DB write
    });

    it('rejects a path that escapes the raw/ folder with extra segments', async () => {
      const upsertSpy = mockUpsertOk();
      await expect(
        upsertDraft('u1', {
          photo_paths: [{ path: `${UUID}/raw/../../other/x.jpg`, url: 'x', name: 'x.jpg' }],
        }),
      ).rejects.toThrow(/invalid photo path/i);
      expect(upsertSpy).not.toHaveBeenCalled();
    });

    it('rejects photo_paths that span multiple {uuid}/raw/ folders', async () => {
      const upsertSpy = mockUpsertOk();
      await expect(
        upsertDraft('u1', {
          photo_paths: [valid(UUID, 'a.jpg'), valid(OTHER_UUID, 'b.jpg')],
        }),
      ).rejects.toThrow(/multiple folders/i);
      expect(upsertSpy).not.toHaveBeenCalled();
    });
  });

  it('defaults omitted fields to null/false/[]', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'd1' }, error: null });
    const upsertSpy = vi.fn().mockReturnValue({ select: () => ({ single }) });
    mockFrom.mockReturnValue({ upsert: upsertSpy });

    await upsertDraft('u1', {});

    const [payload] = upsertSpy.mock.calls[0];
    expect(payload.client_id).toBeNull();
    expect(payload.address).toBeNull();
    expect(payload.bedrooms).toBeNull();
    expect(payload.bathrooms).toBeNull();
    expect(payload.square_footage).toBeNull();
    expect(payload.price).toBeNull();
    expect(payload.director_notes).toBeNull();
    expect(payload.selected_duration).toBeNull();
    expect(payload.video_type).toBeNull();
    expect(payload.video_model_sku).toBeNull();
    expect(payload.auto_run).toBe(false);
    expect(payload.photo_paths).toEqual([]);
  });

  it('throws with a readable message on a Supabase error', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'conflict' } });
    mockFrom.mockReturnValue({ upsert: () => ({ select: () => ({ single }) }) });

    await expect(upsertDraft('u1', {})).rejects.toThrow(/conflict/);
  });
});

describe('deleteDraft', () => {
  it('deletes scoped to id AND submitted_by', async () => {
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const del = vi.fn().mockReturnValue({ eq: eq1 });
    mockFrom.mockReturnValue({ delete: del });

    await deleteDraft('d1', 'u1');

    expect(mockFrom).toHaveBeenCalledWith('studio_drafts');
    expect(eq1).toHaveBeenCalledWith('id', 'd1');
    expect(eq2).toHaveBeenCalledWith('submitted_by', 'u1');
  });

  it('throws with a readable message on a Supabase error', async () => {
    const eq2 = vi.fn().mockResolvedValue({ error: { message: 'nope' } });
    mockFrom.mockReturnValue({ delete: () => ({ eq: () => ({ eq: eq2 }) }) });

    await expect(deleteDraft('d1', 'u1')).rejects.toThrow(/nope/);
  });
});
