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
      from: (_bucket: string) => ({
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://test.supabase.co/storage/v1/object/public/property-photos/${path}` },
        }),
      }),
    },
  }),
}));

import { manualIngest, toPublicPhotoUrl } from '../ingest';
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

  it('inserts photo rows into the photos table (adapted: file_url + file_name)', async () => {
    await manualIngest(baseInput);
    const photosArg = insertPhotos.mock.calls[0][0];
    expect(Array.isArray(photosArg)).toBe(true);
    expect(photosArg).toHaveLength(8);
    // file_url is normalized to an absolute public URL (the analyzer fetches it).
    expect(photosArg[0]).toMatchObject({
      property_id: 'new-prop-id',
      file_url: 'https://test.supabase.co/storage/v1/object/public/property-photos/p.jpg',
    });
    expect(photosArg[7].file_url).toMatch(/^https:\/\/.*\/property-photos\/p\.jpg$/);
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

  it('defaults pipeline_mode to v1.1 when not provided in input', async () => {
    await manualIngest(baseInput);
    expect(insertProperty).toHaveBeenCalledWith(expect.objectContaining({
      pipeline_mode: 'v1.1',
    }));
  });

  it('honours an explicit pipeline_mode override (e.g. v1)', async () => {
    await manualIngest({ ...baseInput, pipeline_mode: 'v1' });
    expect(insertProperty).toHaveBeenCalledWith(expect.objectContaining({
      pipeline_mode: 'v1',
    }));
  });
});

describe('toPublicPhotoUrl', () => {
  const pub = (path: string) => `https://x.supabase.co/storage/v1/object/public/property-photos/${path}`;

  it('passes absolute http(s) URLs through unchanged', () => {
    const url = 'https://x.supabase.co/storage/v1/object/public/property-photos/a/raw/p.jpg';
    expect(toPublicPhotoUrl(url, pub)).toBe(url);
  });

  it('converts a bare storage path to a public URL (the 8bd86c4f bug)', () => {
    expect(toPublicPhotoUrl('ae22add0/raw/p.jpg', pub)).toBe(pub('ae22add0/raw/p.jpg'));
  });

  it('strips a leading slash and an accidental bucket prefix before resolving', () => {
    expect(toPublicPhotoUrl('/ae22add0/raw/p.jpg', pub)).toBe(pub('ae22add0/raw/p.jpg'));
    expect(toPublicPhotoUrl('property-photos/ae22add0/raw/p.jpg', pub)).toBe(pub('ae22add0/raw/p.jpg'));
  });
});
