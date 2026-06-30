/**
 * auth-gate.test.ts
 *
 * F4 security fix — asserts that each admin read endpoint rejects
 * unauthenticated requests with HTTP 401 before touching any data.
 *
 * Endpoints covered:
 *   GET /api/admin/prompts
 *   GET /api/admin/prompt-revisions
 *   GET /api/admin/learning
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Auth mock ─────────────────────────────────────────────────────────────────
// requireAdmin is the gate — simulate what the real implementation does when no
// valid token is present: write 401, return null.

const mockRequireAdmin = vi.fn();

vi.mock('../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

// ── DB mock — not reached on auth failure, but imported at module level ───────

vi.mock('../../../lib/db', () => ({
  getSupabase: () => ({ from: () => ({}) }),
}));

// ── Handler imports (after mocks are hoisted) ─────────────────────────────────

import promptsHandler from '../prompts.js';
import promptRevisionsHandler from '../prompt-revisions.js';
import learningHandler from '../learning.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRes() {
  let currentStatus = 200;
  const calls: Array<{ status: number; body: unknown }> = [];
  const res = {
    status(code: number) { currentStatus = code; return res; },
    json(body: unknown) { calls.push({ status: currentStatus, body }); return res; },
    setHeader: vi.fn(),
    _calls: calls,
    _last() { return calls[calls.length - 1]; },
  };
  return res as unknown as VercelResponse & { _calls: typeof calls; _last(): typeof calls[0] };
}

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'GET',
    query: {},
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: unauthenticated — sends 401 and returns null, matching requireAdmin
  // behaviour when no valid bearer token is present.
  mockRequireAdmin.mockImplementation(
    async (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => unknown } }) => {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    },
  );
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/prompts — auth gate (F4)', () => {
  it('returns 401 for unauthenticated request', async () => {
    const res = makeRes();
    await promptsHandler(makeReq(), res as VercelResponse);
    expect(res._last().status).toBe(401);
  });
});

describe('GET /api/admin/prompt-revisions — auth gate (F4)', () => {
  it('returns 401 for unauthenticated request', async () => {
    const res = makeRes();
    await promptRevisionsHandler(makeReq(), res as VercelResponse);
    expect(res._last().status).toBe(401);
  });
});

describe('GET /api/admin/learning — auth gate (F4)', () => {
  it('returns 401 for unauthenticated request', async () => {
    const res = makeRes();
    await learningHandler(makeReq(), res as VercelResponse);
    expect(res._last().status).toBe(401);
  });
});
