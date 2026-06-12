import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockIsWellFormedToken = vi.fn();
const mockFetchByToken = vi.fn();
const mockStampApproval = vi.fn();
const mockInsertPreviewNote = vi.fn();

vi.mock('../../../lib/operator-studio/preview-tokens', () => ({
  isWellFormedToken: (t: string) => mockIsWellFormedToken(t),
}));
vi.mock('../../../lib/operator-studio/preview', () => ({
  fetchByToken: (t: string) => mockFetchByToken(t),
  stampApproval: (token: string) => mockStampApproval(token),
  insertPreviewNote: (args: unknown) => mockInsertPreviewNote(args),
}));

import handler from '../[token]/approve';

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
    query: { token: 'validtoken1234567890validtoken12' },
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

/** Full fetchByToken result with allow_approve enabled. */
function makeApprovalResult(overrides: {
  expired?: boolean;
  allow_approve?: boolean;
  approved_at?: string | null;
} = {}) {
  return {
    expired: overrides.expired ?? false,
    property: {
      id: 'p1',
      address: '5019 San Massimo Dr, Punta Gorda, FL 33950, USA',
      horizontal_video_url: 'https://cdn/h.mp4',
      vertical_video_url: null,
      client_id: null,
    },
    client: null,
    preview: {
      kind: 'client',
      allow_download: true,
      allow_approve: overrides.allow_approve ?? true,
      allow_revision: true,
      approved_at: overrides.approved_at ?? null,
    },
  };
}

beforeEach(() => {
  mockIsWellFormedToken.mockReset();
  mockFetchByToken.mockReset();
  mockStampApproval.mockReset();
  mockInsertPreviewNote.mockReset();
});

describe('POST /api/preview/[token]/approve', () => {
  it('returns 404 for malformed token', async () => {
    mockIsWellFormedToken.mockReturnValue(false);
    const res = makeRes();
    await handler(makeReq({ query: { token: '!!!' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
    expect(mockFetchByToken).not.toHaveBeenCalled();
  });

  it('returns 404 when token not found', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
  });

  it('returns 404 when preview is expired', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeApprovalResult({ expired: true }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
  });

  it('returns 403 when allow_approve is false', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeApprovalResult({ allow_approve: false }));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(403);
    expect((res._body as { error: string }).error).toBe('not_allowed');
    expect(mockStampApproval).not.toHaveBeenCalled();
    expect(mockInsertPreviewNote).not.toHaveBeenCalled();
  });

  it('returns 503 when preview is null (pre-migration: capability columns absent, safe rejection)', async () => {
    // When migration 083 has not yet been applied, fetchByToken returns preview: null
    // because the capability columns don't exist. Proceeding to stampApproval would
    // throw Postgres 42703; the route now returns 503 instead of 500/crashing.
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue({
      expired: false,
      property: { id: 'p1', address: '1 Oak', horizontal_video_url: null, vertical_video_url: null, client_id: null },
      client: null,
      preview: null,
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(503);
    expect((res._body as { error: string }).error).toBe('not_ready');
    // stampApproval must never be called — the column doesn't exist yet
    expect(mockStampApproval).not.toHaveBeenCalled();
    expect(mockInsertPreviewNote).not.toHaveBeenCalled();
  });

  it('stamps approval and inserts note on first approve', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeApprovalResult({ approved_at: null }));
    const approvedAt = '2026-06-11T10:00:00Z';
    mockStampApproval.mockResolvedValue({ approved_at: approvedAt, already_approved: false });
    mockInsertPreviewNote.mockResolvedValue(undefined);

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    expect((res._body as { ok: boolean; approved_at: string }).ok).toBe(true);
    expect((res._body as { approved_at: string }).approved_at).toBe(approvedAt);
    expect(mockStampApproval).toHaveBeenCalledWith('validtoken1234567890validtoken12');
    // note inserted on first approve
    expect(mockInsertPreviewNote).toHaveBeenCalledWith({
      property_id: 'p1',
      source: 'client_approval',
      body: 'Approved via preview link',
    });
  });

  it('idempotent: re-approve returns ok with existing timestamp and does NOT insert a second note', async () => {
    const existingTs = '2026-06-11T09:00:00Z';
    mockIsWellFormedToken.mockReturnValue(true);
    mockFetchByToken.mockResolvedValue(makeApprovalResult({ approved_at: existingTs }));
    mockStampApproval.mockResolvedValue({ approved_at: existingTs, already_approved: true });

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    expect((res._body as { ok: boolean; approved_at: string }).ok).toBe(true);
    expect((res._body as { approved_at: string }).approved_at).toBe(existingTs);
    // no second note on re-approve
    expect(mockInsertPreviewNote).not.toHaveBeenCalled();
  });

  it('returns 405 for GET method', async () => {
    mockIsWellFormedToken.mockReturnValue(true);
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
  });
});
