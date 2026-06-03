// lib/operator-studio/__tests__/ingest.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertProperty = vi.fn();
const insertPhotos = vi.fn();
const insertRevisionNote = vi.fn();
const selectClient = vi.fn();

vi.mock('../../client', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table === 'properties') return {
        insert: insertProperty,
      };
      if (table === 'photos') return { insert: insertPhotos };
      if (table === 'property_revision_notes') return { insert: insertRevisionNote };
      if (table === 'clients') return {
        select: () => ({ eq: () => ({ maybeSingle: selectClient }) }),
      };
      throw new Error(`unexpected table: ${table}`);
    },
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/${bucket}/${path}` },
        }),
      }),
    },
  }),
}));

import { manualIngest } from '../ingest';
import type { ManualIngestInput } from '../../types/operator-studio';

beforeEach(() => {
  insertProperty.mockReset().mockReturnValue({ select: () => ({ single: () => Promise.resolve({ data: { id: 'new-prop-id' }, error: null }) }) });
  insertPhotos.mockReset().mockResolvedValue({ data: null, error: null });
  insertRevisionNote.mockReset().mockResolvedValue({ data: null, error: null });
  selectClient.mockReset().mockResolvedValue({ data: { agent_name: 'Jane Agent', name: 'Acme Realty' }, error: null });
});

const baseInput: ManualIngestInput & { submitted_by: string } = {
  client_id: 'c1',
  address: '123 Oak St',
  bedrooms: 3,
  bathrooms: 2,
  square_footage: 1850,
  price: 750000,
  photo_storage_paths: Array(8).fill('p.jpg'),
  director_notes: null,
  submitted_by: 'admin-user-id',
};

describe('manualIngest', () => {
  it('rejects when fewer than 5 photos are provided', async () => {
    await expect(manualIngest({ ...baseInput, photo_storage_paths: ['a.jpg'] })).rejects.toThrow(/at least 5 photos/i);
  });

  it('returns the new property id', async () => {
    const id = await manualIngest(baseInput);
    expect(id).toBe('new-prop-id');
  });

  it('inserts a property row tagged operator + ingest_source=manual', async () => {
    await manualIngest(baseInput);
    expect(insertProperty).toHaveBeenCalledWith(expect.objectContaining({
      order_mode: 'operator',
      client_id: 'c1',
      ingest_source: 'manual',
      address: '123 Oak St',
      status: 'queued',
      photo_count: 8,
      submitted_by: 'admin-user-id',
      listing_agent: 'Jane Agent',
      brokerage: 'Acme Realty',
    }));
  });

  it('extracts message from PostgrestError-shaped objects instead of "[object Object]"', async () => {
    insertProperty.mockReset().mockReturnValue({
      select: () => ({
        single: () => Promise.resolve({
          data: null,
          error: { message: 'null value in column "listing_agent"', code: '23502', details: 'col is NOT NULL', hint: 'check constraint' },
        }),
      }),
    });
    await expect(manualIngest(baseInput)).rejects.toThrow(/listing_agent.*23502/i);
  });

  it('falls back to "Operator" when there is no client', async () => {
    selectClient.mockResolvedValue({ data: null, error: null });
    await manualIngest({ ...baseInput, client_id: null });
    expect(insertProperty).toHaveBeenCalledWith(expect.objectContaining({
      client_id: null,
      listing_agent: 'Operator',
      brokerage: null,
    }));
  });

  it('inserts photo rows with a fully-qualified public URL (NOT bare storage path)', async () => {
    // Regression: 2026-05-20 .. 2026-06-02 the operator ingest stored bare
    // storage paths in photos.file_url, which made fetch() in the Gemini
    // analyzer throw "Failed to parse URL" and stranded properties in
    // status='generating' with zero scenes. file_url must always be an
    // absolute URL the analyzer can fetch.
    await manualIngest({ ...baseInput, photo_storage_paths: ['user-a/raw/one.jpg', 'user-a/raw/two.jpg', 'user-a/raw/three.jpg', 'user-a/raw/four.jpg', 'user-a/raw/five.jpg'] });
    const photosArg = insertPhotos.mock.calls[0][0];
    expect(Array.isArray(photosArg)).toBe(true);
    expect(photosArg).toHaveLength(5);
    expect(photosArg[0]).toMatchObject({
      property_id: 'new-prop-id',
      file_url: 'https://example.supabase.co/storage/v1/object/public/property-photos/user-a/raw/one.jpg',
      file_name: 'one.jpg',
    });
    expect(photosArg[4]).toMatchObject({
      file_url: 'https://example.supabase.co/storage/v1/object/public/property-photos/user-a/raw/five.jpg',
      file_name: 'five.jpg',
    });
  });

  it('inserts a director-notes row only when notes are non-empty', async () => {
    await manualIngest(baseInput);
    expect(insertRevisionNote).not.toHaveBeenCalled();
    await manualIngest({ ...baseInput, director_notes: 'Faster pace on kitchen' });
    expect(insertRevisionNote).toHaveBeenCalledWith(expect.objectContaining({ property_id: 'new-prop-id', source: 'operator', body: 'Faster pace on kitchen' }));
  });

  it('does NOT trigger the pipeline (client-side responsibility)', async () => {
    // No fetch mock, no pipeline-trigger mock — manualIngest must not network out.
    const id = await manualIngest(baseInput);
    expect(id).toBe('new-prop-id');
  });
});
