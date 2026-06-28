/**
 * Tests for POST /api/pipeline/[propertyId] auth gate (security fix F2).
 *
 * Before fix: endpoint was fully unauthenticated — any anonymous caller could
 * trigger unlimited paid provider spend for any property id.
 * After fix: caller must be the property owner or an admin.
 *
 * Success criteria:
 *  - no token           → 401, runPipeline NOT called
 *  - wrong owner token  → 403, runPipeline NOT called
 *  - property owner     → 200, runPipeline called with correct propertyId
 *  - admin (non-owner)  → 200, runPipeline called
 *  - property not found → 404, runPipeline NOT called
 *  - non-prod env       → 200 { skipped: 'non-prod' }, runPipeline NOT called
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Auth mock ─────────────────────────────────────────────────────────────────
const mockVerifyAuth = vi.fn();
vi.mock('../../../lib/auth', () => ({
  verifyAuth: (...args: unknown[]) => mockVerifyAuth(...args),
}));

// ── DB mock ───────────────────────────────────────────────────────────────────
const ownerUserId = 'user-owner-123';
const otherUserId = 'user-other-456';

const mockProperty = {
  id: 'prop-uuid-1',
  address: '1 Main St',
  status: 'queued',
  submitted_by: ownerUserId,
  created_at: '2026-01-01T00:00:00Z',
};

const mockGetProperty = vi.fn();
vi.mock('../../../lib/db', () => ({
  getProperty: (...args: unknown[]) => mockGetProperty(...args),
}));

// ── Pipeline mock ─────────────────────────────────────────────────────────────
// vi.mock hoists and intercepts both static and dynamic imports, so this
// covers the `await import('../../lib/pipeline.js')` call inside the handler.
const mockRunPipeline = vi.fn();
vi.mock('../../../lib/pipeline', () => ({
  runPipeline: (...args: unknown[]) => mockRunPipeline(...args),
}));

import handler from '../[propertyId].js';

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
    method: 'POST',
    query: { propertyId: 'prop-uuid-1' },
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

const ownerAuth = {
  user: { id: ownerUserId, email: 'owner@test.com' },
  profile: { role: 'user' as const },
};
const adminAuth = {
  user: { id: 'admin-789', email: 'admin@test.com' },
  profile: { role: 'admin' as const },
};
const strangerAuth = {
  user: { id: otherUserId, email: 'stranger@test.com' },
  profile: { role: 'user' as const },
};

// ── Env cleanup ───────────────────────────────────────────────────────────────
let origVercelEnv: string | undefined;
let origLeAllow: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetProperty.mockResolvedValue(mockProperty);
  mockRunPipeline.mockResolvedValue(undefined);
  // Snapshot and force production so the write-guard passes by default.
  origVercelEnv = process.env.VERCEL_ENV;
  origLeAllow = process.env.LE_ALLOW_NONPROD_WRITES;
  process.env.VERCEL_ENV = 'production';
  delete process.env.LE_ALLOW_NONPROD_WRITES;
});

afterEach(() => {
  if (origVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = origVercelEnv;
  if (origLeAllow === undefined) delete process.env.LE_ALLOW_NONPROD_WRITES;
  else process.env.LE_ALLOW_NONPROD_WRITES = origLeAllow;
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('POST /api/pipeline/[propertyId] — auth gate (F2)', () => {
  it('returns 401 and does not trigger runPipeline when no auth token is provided', async () => {
    mockVerifyAuth.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it('returns 403 and does not trigger runPipeline when caller is authenticated but not the owner and not an admin', async () => {
    mockVerifyAuth.mockResolvedValue(strangerAuth);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(403);
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it('returns 200 and calls runPipeline when caller is the property owner', async () => {
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect(mockRunPipeline).toHaveBeenCalledWith('prop-uuid-1');
  });

  it('returns 200 and calls runPipeline when caller is an admin (not the owner)', async () => {
    mockVerifyAuth.mockResolvedValue(adminAuth);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect(mockRunPipeline).toHaveBeenCalledWith('prop-uuid-1');
  });

  it('returns 404 and does not trigger runPipeline when the property does not exist', async () => {
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    mockGetProperty.mockRejectedValue(new Error('Not found'));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it('returns 200 { skipped: non-prod } and does not trigger runPipeline outside production', async () => {
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    process.env.VERCEL_ENV = 'preview';
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { skipped?: string };
    expect(body.skipped).toBe('non-prod');
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it('returns 200 and calls runPipeline when LE_ALLOW_NONPROD_WRITES overrides non-prod guard', async () => {
    mockVerifyAuth.mockResolvedValue(ownerAuth);
    process.env.VERCEL_ENV = 'preview';
    process.env.LE_ALLOW_NONPROD_WRITES = 'true';
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect(mockRunPipeline).toHaveBeenCalledWith('prop-uuid-1');
  });
});
