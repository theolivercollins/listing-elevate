import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
// vi.mock calls are hoisted to the top of the file by Vitest's transform;
// vi.hoisted ensures these values are available inside the factory closures.

const {
  mockRequireAdmin,
  mockFindFinalSubfolder,
  mockListFinalImages,
  mockDownloadFile,
  MockDriveUnconfiguredError,
  mockLookupMlsByAddress,
  MockMlsProviderUnconfiguredError,
  mockUpload,
} = vi.hoisted(() => {
  class MockDriveUnconfiguredError extends Error {
    constructor() {
      super('Google Drive not configured');
      this.name = 'DriveUnconfiguredError';
    }
  }
  class MockMlsProviderUnconfiguredError extends Error {
    constructor() {
      super('MLS provider not configured');
      this.name = 'MlsProviderUnconfiguredError';
    }
  }
  return {
    mockRequireAdmin: vi.fn(),
    mockFindFinalSubfolder: vi.fn(),
    mockListFinalImages: vi.fn(),
    mockDownloadFile: vi.fn(),
    MockDriveUnconfiguredError,
    mockLookupMlsByAddress: vi.fn(),
    MockMlsProviderUnconfiguredError,
    mockUpload: vi.fn(),
  };
});

vi.mock('../../../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

vi.mock('../../../../../lib/drive/client', () => ({
  DriveUnconfiguredError: MockDriveUnconfiguredError,
  findFinalSubfolder: (...args: unknown[]) => mockFindFinalSubfolder(...args),
  listFinalImages: (...args: unknown[]) => mockListFinalImages(...args),
  downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
}));

vi.mock('../../../../../lib/mls/lookup', () => ({
  MlsProviderUnconfiguredError: MockMlsProviderUnconfiguredError,
  lookupMlsByAddress: (...args: unknown[]) => mockLookupMlsByAddress(...args),
}));

vi.mock('../../../../../lib/client', () => ({
  getSupabase: () => ({
    storage: {
      from: (_bucket: string) => ({ upload: mockUpload }),
    },
  }),
}));

vi.mock('../../../../../lib/operator-studio/ingest', () => ({
  toPublicPhotoUrl: (path: string) => `https://supabase.test/storage/v1/object/public/property-photos/${path}`,
}));

import handler from '../pull';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeRes() {
  return {
    _status: 0,
    _body: {} as unknown,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(body: unknown) {
      this._body = body;
      return this;
    },
  };
}

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'POST',
    query: {},
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

const adminUser = { user: { id: 'admin-1', email: 'admin@test.com' }, profile: { role: 'admin' } };

const fakeImages = [
  { id: 'file-1', name: 'photo 1.jpg', mimeType: 'image/jpeg' },
  { id: 'file-2', name: 'photo_2.jpg', mimeType: 'image/jpeg' },
];

const fakeBytes = new ArrayBuffer(16);

const fakeMlsResult = {
  source: 'redfin' as const,
  address: '123 Main St, Austin, TX 78701',
  price: 750000,
  bedrooms: 4,
  bathrooms: 3,
  sqft: 2200,
  description: 'A lovely home.',
  agent: null,
  listingUrl: null,
};

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  mockRequireAdmin.mockReset();
  mockFindFinalSubfolder.mockReset();
  mockListFinalImages.mockReset();
  mockDownloadFile.mockReset();
  mockLookupMlsByAddress.mockReset();
  mockUpload.mockReset();

  // Sensible defaults for happy-path tests
  mockRequireAdmin.mockResolvedValue(adminUser);
  mockFindFinalSubfolder.mockResolvedValue({ id: 'final-folder', name: 'Final' });
  mockListFinalImages.mockResolvedValue(fakeImages);
  mockDownloadFile.mockImplementation(async (id: string) => ({
    bytes: fakeBytes,
    name: id === 'file-1' ? 'photo 1.jpg' : 'photo_2.jpg',
    mimeType: 'image/jpeg',
  }));
  mockUpload.mockResolvedValue({ error: null });
  mockLookupMlsByAddress.mockResolvedValue(fakeMlsResult);

  process.env.LE_ALLOW_NONPROD_WRITES = 'true';
});

afterEach(() => {
  delete process.env.LE_ALLOW_NONPROD_WRITES;
  delete process.env.VERCEL_ENV;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('non-POST → 405', () => {
  it('returns 405 for GET', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
    expect((res._body as { error: string }).error).toBe('method_not_allowed');
  });

  it('returns 405 for DELETE', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'DELETE' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
  });
});

describe('missing body → 400', () => {
  it('returns 400 when folderId missing', async () => {
    const res = makeRes();
    await handler(
      makeReq({ body: { folderName: '123 Main St' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toBe('folderId and folderName required');
  });

  it('returns 400 when folderName missing', async () => {
    const res = makeRes();
    await handler(
      makeReq({ body: { folderId: 'abc123' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toBe('folderId and folderName required');
  });

  it('returns 400 when body is empty', async () => {
    const res = makeRes();
    await handler(makeReq({ body: {} }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });
});

describe('write guard → 403', () => {
  it('returns 403 in non-prod without override flag', async () => {
    delete process.env.LE_ALLOW_NONPROD_WRITES;
    delete process.env.VERCEL_ENV;
    const res = makeRes();
    await handler(
      makeReq({ body: { folderId: 'abc', folderName: '123 Main St' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(403);
    expect((res._body as { error: string }).error).toBe('writes disabled in this environment');
  });
});

describe('happy path', () => {
  it('downloads N images, uploads each, returns photos + metadata + address', async () => {
    const res = makeRes();
    await handler(
      makeReq({ body: { folderId: 'folder-abc', folderName: '123 Main St, Austin, TX' } }),
      res as unknown as VercelResponse,
    );

    expect(res._status).toBe(200);
    const body = res._body as {
      address: string;
      metadata: { price: number; bedrooms: number; bathrooms: number; sqft: number; description: string };
      photos: { path: string; url: string }[];
      photoCount: number;
      mlsError?: string;
    };

    expect(body.address).toBe('123 Main St, Austin, TX');
    expect(body.photoCount).toBe(2);
    expect(body.photos).toHaveLength(2);

    // Each photo must have a storage path under drive-pull/<folderId>/
    for (const photo of body.photos) {
      expect(photo.path).toMatch(/^drive-pull\/folder-abc\//);
      expect(photo.url).toContain('property-photos');
    }

    // Metadata comes from the MLS mock
    expect(body.metadata.price).toBe(750000);
    expect(body.metadata.bedrooms).toBe(4);
    expect(body.metadata.bathrooms).toBe(3);
    expect(body.metadata.sqft).toBe(2200);
    expect(body.metadata.description).toBe('A lovely home.');

    // No MLS error when lookup succeeds
    expect(body.mlsError).toBeUndefined();

    // Drive + storage calls wired correctly
    expect(mockFindFinalSubfolder).toHaveBeenCalledWith('folder-abc');
    expect(mockListFinalImages).toHaveBeenCalledWith('final-folder');
    expect(mockDownloadFile).toHaveBeenCalledTimes(2);
    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(mockLookupMlsByAddress).toHaveBeenCalledWith('123 Main St, Austin, TX', null);
  });

  it('passes contentType to the storage upload', async () => {
    const res = makeRes();
    await handler(
      makeReq({ body: { folderId: 'folder-abc', folderName: '123 Main St' } }),
      res as unknown as VercelResponse,
    );
    const [, , options] = mockUpload.mock.calls[0] as [string, Buffer, { contentType: string }];
    expect(options.contentType).toBe('image/jpeg');
  });
});

describe('Final-missing fallback', () => {
  it('falls back to folderId when no Final subfolder exists', async () => {
    // findFinalSubfolder returns null — handler must use folderId directly
    mockFindFinalSubfolder.mockResolvedValue(null);

    const res = makeRes();
    await handler(
      makeReq({ body: { folderId: 'root-folder', folderName: '456 Oak Ave' } }),
      res as unknown as VercelResponse,
    );

    expect(res._status).toBe(200);
    // listFinalImages must be called with the root folder, not a null/undefined
    expect(mockListFinalImages).toHaveBeenCalledWith('root-folder');
  });
});

describe('Redfin throws MlsProviderUnconfiguredError', () => {
  it('returns photos + null metadata + mlsError=unconfigured, not 5xx', async () => {
    mockLookupMlsByAddress.mockRejectedValue(new MockMlsProviderUnconfiguredError());

    const res = makeRes();
    await handler(
      makeReq({ body: { folderId: 'folder-abc', folderName: '123 Main St' } }),
      res as unknown as VercelResponse,
    );

    expect(res._status).toBe(200);
    const body = res._body as {
      photos: unknown[];
      metadata: { price: null; bedrooms: null; bathrooms: null; sqft: null; description: null };
      mlsError: string;
    };

    // Photos must still be present
    expect(body.photos).toHaveLength(2);

    // Metadata all nulls
    expect(body.metadata.price).toBeNull();
    expect(body.metadata.bedrooms).toBeNull();
    expect(body.metadata.bathrooms).toBeNull();
    expect(body.metadata.sqft).toBeNull();
    expect(body.metadata.description).toBeNull();

    // Correct error discriminator
    expect(body.mlsError).toBe('unconfigured');
  });

  it('sets mlsError=lookup_failed for generic Redfin errors', async () => {
    mockLookupMlsByAddress.mockRejectedValue(new Error('scraper timeout'));

    const res = makeRes();
    await handler(
      makeReq({ body: { folderId: 'folder-abc', folderName: '123 Main St' } }),
      res as unknown as VercelResponse,
    );

    expect(res._status).toBe(200);
    expect((res._body as { mlsError: string }).mlsError).toBe('lookup_failed');
  });
});

describe('zero photos → 502', () => {
  it('returns 502 when every upload fails', async () => {
    mockUpload.mockResolvedValue({ error: new Error('storage quota exceeded') });

    const res = makeRes();
    await handler(
      makeReq({ body: { folderId: 'folder-abc', folderName: '123 Main St' } }),
      res as unknown as VercelResponse,
    );

    expect(res._status).toBe(502);
    expect((res._body as { error: string }).error).toBe('no photos could be pulled');
  });

  it('returns 502 when listFinalImages returns empty', async () => {
    mockListFinalImages.mockResolvedValue([]);

    const res = makeRes();
    await handler(
      makeReq({ body: { folderId: 'folder-abc', folderName: '123 Main St' } }),
      res as unknown as VercelResponse,
    );

    expect(res._status).toBe(502);
    expect((res._body as { error: string }).error).toBe('no photos could be pulled');
  });
});

describe('DriveUnconfiguredError → 503', () => {
  it('returns 503 when Drive is not configured', async () => {
    mockFindFinalSubfolder.mockRejectedValue(new MockDriveUnconfiguredError());

    const res = makeRes();
    await handler(
      makeReq({ body: { folderId: 'folder-abc', folderName: '123 Main St' } }),
      res as unknown as VercelResponse,
    );

    expect(res._status).toBe(503);
    expect((res._body as { error: string }).error).toBe(
      'Google Drive service account not configured',
    );
  });
});
