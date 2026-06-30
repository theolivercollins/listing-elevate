// lib/operator-studio/__tests__/ingest.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const insertProperty = vi.fn();
const insertPhotos = vi.fn();
const insertRevisionNote = vi.fn();
const selectClient = vi.fn();
const mockCreateRun = vi.fn();

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
  }),
}));

// Mock the dynamic import of runs.ts so we can assert on createRun args.
vi.mock('../../delivery/runs', () => ({
  createRun: (...args: unknown[]) => mockCreateRun(...args),
}));

// Mock atlas so isOperatorSkuAvailable is controllable without real env vars.
vi.mock('../../providers/atlas', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../providers/atlas')>();
  return {
    ...real,
    isOperatorSkuAvailable: (key: string | null) =>
      key === 'seedance-2-0-4k' || key === 'seedance-pro-pushin' || key === 'kling-v2-6-pro',
  };
});

import { manualIngest, toPublicPhotoUrl } from '../ingest';
import type { ManualIngestInput } from '../../types/operator-studio';

const FAKE_SUPABASE_URL = 'https://abcdef.supabase.co';

beforeEach(() => {
  process.env.SUPABASE_URL = FAKE_SUPABASE_URL;
  insertProperty.mockReset().mockReturnValue({ select: () => ({ single: () => Promise.resolve({ data: { id: 'new-prop-id' }, error: null }) }) });
  insertPhotos.mockReset().mockResolvedValue({ data: null, error: null });
  insertRevisionNote.mockReset().mockResolvedValue({ data: null, error: null });
  selectClient.mockReset().mockResolvedValue({ data: { agent_name: 'Jane Agent', name: 'Acme Realty' }, error: null });
  mockCreateRun.mockReset().mockResolvedValue({ id: 'run-1' });
});

afterEach(() => {
  delete process.env.SUPABASE_URL;
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

  it('inserts photo rows with absolute public URLs (bare paths → full Supabase URL)', async () => {
    const paths = Array(8).fill('7f9fed83-abc/raw/kitchen.jpg');
    await manualIngest({ ...baseInput, photo_storage_paths: paths });
    const photosArg = insertPhotos.mock.calls[0][0];
    expect(Array.isArray(photosArg)).toBe(true);
    expect(photosArg).toHaveLength(8);
    const expectedUrl = `${FAKE_SUPABASE_URL}/storage/v1/object/public/property-photos/7f9fed83-abc/raw/kitchen.jpg`;
    expect(photosArg[0]).toMatchObject({ property_id: 'new-prop-id', file_url: expectedUrl, file_name: 'kitchen.jpg' });
    expect(photosArg[7]).toMatchObject({ property_id: 'new-prop-id', file_url: expectedUrl });
  });

  it('inserts a director-notes row only when notes are non-empty', async () => {
    await manualIngest(baseInput);
    expect(insertRevisionNote).not.toHaveBeenCalled();
    await manualIngest({ ...baseInput, director_notes: 'Faster pace on kitchen' });
    expect(insertRevisionNote).toHaveBeenCalledWith(expect.objectContaining({ property_id: 'new-prop-id', source: 'operator', body: 'Faster pace on kitchen' }));
  });

  it('passes already-absolute URLs through unchanged (idempotent)', async () => {
    const absUrl = `${FAKE_SUPABASE_URL}/storage/v1/object/public/property-photos/uuid/raw/living.jpg`;
    const paths = Array(8).fill(absUrl);
    await manualIngest({ ...baseInput, photo_storage_paths: paths });
    const photosArg = insertPhotos.mock.calls[0][0];
    expect(photosArg[0]).toMatchObject({ file_url: absUrl });
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

  it('forwards auto_run:true to createRun when set at intake', async () => {
    await manualIngest({ ...baseInput, auto_run: true });
    expect(mockCreateRun).toHaveBeenCalledWith(expect.objectContaining({ auto_run: true }));
  });

  it('forwards auto_run as undefined (falsy) to createRun when omitted from intake', async () => {
    // baseInput has no auto_run field — createRun receives undefined; the DB
    // layer (createRun implementation) is responsible for coercing that to false.
    await manualIngest(baseInput);
    expect(mockCreateRun).toHaveBeenCalledWith(
      expect.objectContaining({ property_id: 'new-prop-id' }),
    );
    const callArg = mockCreateRun.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.auto_run == null || callArg.auto_run === false).toBe(true);
  });

  it('persists a valid video_model_sku when provided', async () => {
    await manualIngest({ ...baseInput, video_model_sku: 'seedance-2-0-4k' });
    expect(insertProperty).toHaveBeenCalledWith(expect.objectContaining({
      video_model_sku: 'seedance-2-0-4k',
    }));
  });

  it('coerces an unknown/invalid video_model_sku to null (stale client guard)', async () => {
    await manualIngest({ ...baseInput, video_model_sku: 'some-future-unknown-sku' });
    expect(insertProperty).toHaveBeenCalledWith(expect.objectContaining({
      video_model_sku: null,
    }));
  });

  it('persists video_model_sku=null when not provided', async () => {
    await manualIngest(baseInput); // no video_model_sku in baseInput
    expect(insertProperty).toHaveBeenCalledWith(expect.objectContaining({
      video_model_sku: null,
    }));
  });
});

describe('toPublicPhotoUrl', () => {
  it('expands a bare storage path to an absolute public URL', () => {
    process.env.SUPABASE_URL = FAKE_SUPABASE_URL;
    const result = toPublicPhotoUrl('abc123/raw/photo.jpg');
    expect(result).toBe(`${FAKE_SUPABASE_URL}/storage/v1/object/public/property-photos/abc123/raw/photo.jpg`);
    delete process.env.SUPABASE_URL;
  });

  it('leaves an https:// URL unchanged (idempotent)', () => {
    const abs = 'https://abcdef.supabase.co/storage/v1/object/public/property-photos/x/y.jpg';
    expect(toPublicPhotoUrl(abs)).toBe(abs);
  });

  it('leaves an http:// URL unchanged', () => {
    const abs = 'http://localhost:54321/storage/v1/object/public/property-photos/x/y.jpg';
    expect(toPublicPhotoUrl(abs)).toBe(abs);
  });
});
