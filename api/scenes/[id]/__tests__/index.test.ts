/**
 * Tests for GET /api/scenes/:id — auth + owner-gate IDOR fix (F12).
 *
 * Before this fix the route returned scene + photos + pipeline_logs to any
 * caller with no auth check, leaking cross-tenant director prompts (IP).
 *
 * Success criteria:
 *  - GET no auth                    → 401
 *  - GET non-owner non-admin token  → 403
 *  - GET by property owner          → 200 with scene + logs
 *  - GET by admin (not owner)       → 200 with scene + logs
 *  - GET unknown scene id           → 404
 *  - GET scene with no property_id  → 404
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Auth mock ─────────────────────────────────────────────────────────────────

const mockVerifyAuth = vi.fn();

vi.mock('../../../../lib/auth', () => ({
  verifyAuth: (...args: unknown[]) => mockVerifyAuth(...args),
  setNoStore: vi.fn(),
}));

// ── DB mock ───────────────────────────────────────────────────────────────────

const ownerUserId = 'user-owner-123';
const otherUserId = 'user-other-456';

const mockProperty = {
  id: 'prop-uuid-1',
  address: '1 Main St',
  status: 'complete',
  submitted_by: ownerUserId,
  created_at: '2026-01-01T00:00:00Z',
};

const mockScene = {
  id: 'scene-uuid-1',
  property_id: 'prop-uuid-1',
  prompt: 'Director confidential: push in on the vanity light',
  photos: [],
};

const mockLogs = [
  { id: 'log-1', stage: 'analyze', created_at: '2026-01-01T00:00:01Z' },
];

const mockGetProperty = vi.fn();
// Controlled per-test via mockResolvedValue / mockRejectedValue
const mockSceneSingleFn = vi.fn();
const mockLogsOrderFn = vi.fn();

vi.mock('../../../../lib/db', () => {
  // Scene chain: from('scenes').select().eq().single()
  const sceneChain: Record<string, () => unknown> = {
    select: function() { return sceneChain; },
    eq: function() { return sceneChain; },
    single: function() { return mockSceneSingleFn(); },
  };
  // Logs chain: from('pipeline_logs').select().eq().order()
  const logsChain: Record<string, () => unknown> = {
    select: function() { return logsChain; },
    eq: function() { return logsChain; },
    order: function() { return mockLogsOrderFn(); },
  };
  return {
    getProperty: (...args: unknown[]) => mockGetProperty(...args),
    getSupabase: () => ({
      from: (table: string) => table === 'pipeline_logs' ? logsChain : sceneChain,
    }),
  };
});

import handler from '../index.js';

// ── Auth fixtures ─────────────────────────────────────────────────────────────

const ownerAuth = {
  user: { id: ownerUserId, email: 'owner@test.com' },
  profile: { role: 'user' as const },
};
const adminAuth = {
  user: { id: 'user-admin-789', email: 'admin@test.com' },
  profile: { role: 'admin' as const },
};
const strangerAuth = {
  user: { id: otherUserId, email: 'stranger@test.com' },
  profile: { role: 'user' as const },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRes() {
  return {
    _status: 0,
    _body: {} as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
    setHeader() { return this; },
  };
}

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'GET',
    query: { id: 'scene-uuid-1' },
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetProperty.mockResolvedValue(mockProperty);
  mockSceneSingleFn.mockResolvedValue({ data: mockScene, error: null });
  mockLogsOrderFn.mockResolvedValue({ data: mockLogs });
});

describe('GET /api/scenes/:id — auth + IDOR guards (F12)', () => {
  it('returns 401 when no auth token is provided', async () => {
    mockVerifyAuth.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
  });

  it('returns 403 when caller is authenticated but is not the owner and not an admin', async () => {
    mockVerifyAuth.mockResolvedValue(strangerAuth);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(403);
  });

  it('returns 200 with scene and logs when caller is the property owner', async () => {
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as Record<string, unknown>;
    expect(body.id).toBe('scene-uuid-1');
    expect(Array.isArray(body.logs)).toBe(true);
  });

  it('returns 200 with scene and logs when caller is an admin (not the owner)', async () => {
    mockVerifyAuth.mockResolvedValue(adminAuth);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as Record<string, unknown>;
    expect(body.id).toBe('scene-uuid-1');
  });

  it('returns 404 when the scene does not exist', async () => {
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    mockSceneSingleFn.mockResolvedValue({ data: null, error: new Error('not found') });
    const res = makeRes();
    await handler(makeReq({ query: { id: 'nonexistent' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
  });

  it('returns 404 when scene has no property_id (orphaned row)', async () => {
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    mockSceneSingleFn.mockResolvedValue({
      data: { id: 'scene-orphan', property_id: undefined, photos: [] },
      error: null,
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
  });

  it('returns 404 when the owning property cannot be resolved', async () => {
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    mockGetProperty.mockRejectedValue(new Error('not found'));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
  });

  it('does not leak director prompts to a cross-tenant caller (403 before data is returned)', async () => {
    // Confirm the 403 fires before any scene data reaches the response body.
    mockVerifyAuth.mockResolvedValue(strangerAuth);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(403);
    // Body must not contain any scene fields
    const body = res._body as Record<string, unknown>;
    expect(body.prompt).toBeUndefined();
    expect(body.logs).toBeUndefined();
  });
});
