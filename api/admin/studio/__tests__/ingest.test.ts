import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockRequireAdmin = vi.fn();
const mockManualIngest = vi.fn();

vi.mock('../../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock('../../../../lib/operator-studio/ingest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/operator-studio/ingest')>();
  return {
    ...actual,
    manualIngest: (...args: unknown[]) => mockManualIngest(...args),
  };
});

import handler from '../ingest';

function makeRes() {
  const res = {
    _status: 0,
    _body: {} as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
  };
  return res;
}

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'POST',
    query: {},
    body: {
      client_id: 'c1',
      address: '123 Main St',
      photo_storage_paths: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'],
    },
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

const adminUser = { user: { id: 'u1', email: 'admin@test.com' }, profile: { role: 'admin' } };

beforeEach(() => {
  mockRequireAdmin.mockReset();
  mockManualIngest.mockReset();
});

describe('POST /api/admin/studio/ingest', () => {
  it('returns 401 when requireAdmin returns null', async () => {
    mockRequireAdmin.mockImplementation((_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
  });

  it('returns 201 with property_id on success', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockManualIngest.mockResolvedValue('prop-xyz-123');
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(201);
    expect((res._body as { property_id: string }).property_id).toBe('prop-xyz-123');
  });

  it('returns 400 when manualIngest throws a "required" validation error', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockManualIngest.mockRejectedValue(new Error('client_id is required'));
    const res = makeRes();
    await handler(makeReq({ body: {} }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toMatch(/required/i);
  });

  it('returns 400 when manualIngest throws an "at least" validation error', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockManualIngest.mockRejectedValue(new Error('At least 5 photos are required to ingest a property.'));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });

  it('returns 400 when manualIngest throws an "invalid" validation error', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockManualIngest.mockRejectedValue(new Error('invalid client_id format'));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });

  it('returns 500 on generic error', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockManualIngest.mockRejectedValue(new Error('db connection error'));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(500);
    expect((res._body as { error: string }).error).toMatch(/db connection error/);
  });
});

describe('non-POST methods', () => {
  it('returns 405 for GET', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
    expect((res._body as { error: string }).error).toBe('method_not_allowed');
  });
});
