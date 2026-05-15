import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockRequireAdmin = vi.fn();
const mockCreatePreviewLink = vi.fn();

vi.mock('../../../../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock('../../../../../../lib/operator-studio/preview', () => ({
  createPreviewLink: (...args: unknown[]) => mockCreatePreviewLink(...args),
}));

import handler from '../preview-link';

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
    query: { id: 'prop-abc' },
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

beforeEach(() => {
  mockRequireAdmin.mockReset();
  mockCreatePreviewLink.mockReset();
});

describe('POST /api/admin/studio/properties/[id]/preview-link', () => {
  it('returns 401 when requireAdmin returns null', async () => {
    mockRequireAdmin.mockImplementation((_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
  });

  it('returns 405 for non-POST methods', async () => {
    mockRequireAdmin.mockResolvedValue({ user: { id: 'u1' }, profile: { role: 'admin' } });
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
  });

  it('happy path: returns 201 with token and url', async () => {
    mockRequireAdmin.mockResolvedValue({ user: { id: 'u1' }, profile: { role: 'admin' } });
    mockCreatePreviewLink.mockResolvedValue({ id: 'pv1', token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', property_id: 'prop-abc' });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(201);
    const body = res._body as { token: string; url: string };
    expect(body.token).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(body.url).toMatch(/\/preview\/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$/);
  });

  it('passes expires_at from request body', async () => {
    mockRequireAdmin.mockResolvedValue({ user: { id: 'u1' }, profile: { role: 'admin' } });
    mockCreatePreviewLink.mockResolvedValue({ id: 'pv2', token: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', property_id: 'prop-abc' });
    const res = makeRes();
    await handler(makeReq({ body: { expires_at: '2099-12-31T23:59:59Z' } }), res as unknown as VercelResponse);
    expect(mockCreatePreviewLink).toHaveBeenCalledWith('prop-abc', '2099-12-31T23:59:59Z');
  });

  it('returns 500 when createPreviewLink throws', async () => {
    mockRequireAdmin.mockResolvedValue({ user: { id: 'u1' }, profile: { role: 'admin' } });
    mockCreatePreviewLink.mockRejectedValue(new Error('db exploded'));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(500);
    expect((res._body as { error: string }).error).toMatch(/db exploded/);
  });
});
