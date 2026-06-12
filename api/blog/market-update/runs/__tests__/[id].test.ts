// Tests for GET /api/blog/market-update/runs/:id — draft enrichment.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockRequireAdmin = vi.fn();
const mockGetSupabase = vi.fn();

vi.mock('../../../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock('../../../../../lib/client', () => ({
  getSupabase: () => mockGetSupabase(),
}));

import handler from '../[id]';

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
    method: 'GET',
    query: { id: 'run-abc-123' },
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

const adminUser = { user: { id: 'u1', email: 'admin@test.com' }, profile: { role: 'admin' } };

const sampleRun = {
  id: 'run-abc-123',
  site_id: 'site-1',
  period_month: 5,
  period_year: 2026,
  status: 'generated',
  created_post_ids: ['post-1', 'post-2'],
  created_email_ids: ['email-1'],
  cost_usd_cents: 300,
  region_results: [],
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
};

const samplePosts = [
  {
    id: 'post-1',
    title: 'Charlotte County May 2026',
    state: 'awaiting_approval',
    external_post_url: null,
    external_post_id: null,
    active: true,
  },
  {
    id: 'post-2',
    title: 'Deep Creek May 2026',
    state: 'published',
    external_post_url: 'https://example.com/dc',
    external_post_id: '999',
    active: true,
  },
];

const sampleEmails = [
  { id: 'email-1', subject: 'Charlotte County Market Update', state: 'draft', sent_at: null, active: true },
];

// Build a chainable Supabase mock that handles the three table queries:
// market_update_runs (.single()), blog_posts (.in()), emails (.in()).
function makeSupabase(
  runResult: { data: unknown; error: { message: string } | null },
  postsResult: { data: unknown[]; error: { message: string } | null },
  emailsResult: { data: unknown[]; error: { message: string } | null },
) {
  return {
    from(table: string) {
      if (table === 'market_update_runs') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve(runResult),
            }),
          }),
        };
      }
      if (table === 'blog_posts') {
        return {
          select: () => ({
            in: () => Promise.resolve(postsResult),
          }),
        };
      }
      if (table === 'emails') {
        return {
          select: () => ({
            in: () => Promise.resolve(emailsResult),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

beforeEach(() => {
  mockRequireAdmin.mockReset();
  mockGetSupabase.mockReset();
});

describe('GET /api/blog/market-update/runs/[id]', () => {
  it('returns 401 when requireAdmin returns null', async () => {
    mockRequireAdmin.mockImplementation(
      (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
        res.status(401).json({ error: 'Unauthorized' });
        return null;
      },
    );
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
  });

  it('returns 405 for non-GET methods', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const res = makeRes();
    await handler(makeReq({ method: 'POST' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
  });

  it('returns 400 when id is missing', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const res = makeRes();
    await handler(makeReq({ query: {} }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });

  it('(c) returns 404 when run is not found', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetSupabase.mockReturnValue(
      makeSupabase(
        { data: null, error: { message: 'not found' } },
        { data: [], error: null },
        { data: [], error: null },
      ),
    );
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
  });

  it('(a) returns drafts.posts and drafts.emails populated from created_post_ids/created_email_ids with state fields', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetSupabase.mockReturnValue(
      makeSupabase(
        { data: sampleRun, error: null },
        { data: samplePosts, error: null },
        { data: sampleEmails, error: null },
      ),
    );
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);

    const body = res._body as {
      run: typeof sampleRun;
      drafts: { posts: typeof samplePosts; emails: typeof sampleEmails };
    };
    expect(body.run).toEqual(sampleRun);
    expect(body.drafts.posts).toHaveLength(2);
    expect(body.drafts.posts[0]).toMatchObject({ id: 'post-1', state: 'awaiting_approval' });
    expect(body.drafts.posts[1]).toMatchObject({ id: 'post-2', state: 'published', external_post_url: 'https://example.com/dc' });
    expect(body.drafts.emails).toHaveLength(1);
    expect(body.drafts.emails[0]).toMatchObject({ id: 'email-1', state: 'draft', sent_at: null });
  });

  it('(b) returns empty arrays when the run has no drafts yet', async () => {
    const runNoDrafts = { ...sampleRun, created_post_ids: [], created_email_ids: [], status: 'ready' };
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetSupabase.mockReturnValue(
      makeSupabase(
        { data: runNoDrafts, error: null },
        { data: [], error: null },
        { data: [], error: null },
      ),
    );
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { drafts: { posts: unknown[]; emails: unknown[] } };
    expect(body.drafts.posts).toEqual([]);
    expect(body.drafts.emails).toEqual([]);
  });

  it('soft-deleted drafts still appear in the response (no active filter)', async () => {
    const softDeletedPost = { ...samplePosts[0], state: 'deleted', active: false };
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetSupabase.mockReturnValue(
      makeSupabase(
        { data: sampleRun, error: null },
        { data: [softDeletedPost, samplePosts[1]], error: null },
        { data: sampleEmails, error: null },
      ),
    );
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { drafts: { posts: Array<{ active: boolean }> } };
    // Both posts returned — soft-deleted one is not filtered out
    expect(body.drafts.posts).toHaveLength(2);
    expect(body.drafts.posts[0].active).toBe(false);
  });
});
