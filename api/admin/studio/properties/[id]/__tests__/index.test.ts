import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockRequireAdmin = vi.fn();
const mockGetSupabase = vi.fn();

vi.mock('../../../../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock('../../../../../../lib/client', () => ({
  getSupabase: () => mockGetSupabase(),
}));

import handler from '../../[id]';

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
    query: { id: 'prop-123' },
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

const adminUser = { user: { id: 'u1', email: 'admin@test.com' }, profile: { role: 'admin' } };

// Build a mock supabase db where each sequential .from() call returns the next result
function makeDb(results: Array<{ data: unknown; error: unknown }>) {
  let callIdx = 0;
  return {
    from: (_table: string) => {
      const result = results[callIdx++] ?? { data: null, error: null };
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.neq = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.maybeSingle = () => Promise.resolve(result);
      // Make the chain thenable so it resolves as a Promise when awaited
      // (the Promise.all in the handler awaits each parallel call)
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return chain;
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('GET /api/admin/studio/properties/[id]', () => {
  it('returns 401 when requireAdmin returns null', async () => {
    mockRequireAdmin.mockImplementation((_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
  });

  it('returns 405 on POST', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const res = makeRes();
    await handler(makeReq({ method: 'POST' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
    expect((res._body as { error: string }).error).toBe('method_not_allowed');
  });

  it('returns 404 when property not found', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetSupabase.mockReturnValue(makeDb([
      { data: null, error: null },  // properties → not found
      { data: [], error: null },    // scenes
      { data: [], error: null },    // revision_notes
      { data: [], error: null },    // cost_events
      { data: [], error: null },    // previews
      { data: null, error: null },  // delivery_runs
    ]));
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
    expect((res._body as { error: string }).error).toBe('not_found');
  });

  it('returns 200 with all bundle fields on happy path', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);

    const sampleProperty = {
      id: 'prop-123',
      address: '1 Main St',
      status: 'needs_review',
      client: { id: 'c1', name: 'Helgemo Team', brand_primary_hex: '#3b82f6' },
    };
    const sampleScenes = [
      { id: 's1', scene_number: 1, room_type: 'kitchen', clip_url: 'https://cdn.example.com/clip1.mp4' },
      { id: 's2', scene_number: 2, room_type: 'living_room', clip_url: null },
    ];
    const sampleNotes = [
      { id: 'n1', property_id: 'prop-123', source: 'operator', body: 'Looks good', created_at: '2026-05-15T10:00:00Z' },
    ];
    const sampleCostEvents = [
      { stage: 'generation', provider: 'kling', cost_cents: 1500 },
      { stage: 'analysis', provider: 'anthropic', cost_cents: 200 },
      { stage: 'generation', provider: 'kling', cost_cents: 1000 },
    ];
    const samplePreviews = [
      { token: 'abc123', expires_at: null, viewed_count: 2, last_viewed_at: null, created_at: '2026-05-15T09:00:00Z' },
    ];

    mockGetSupabase.mockReturnValue(makeDb([
      { data: sampleProperty, error: null },  // properties
      { data: sampleScenes, error: null },    // scenes
      { data: sampleNotes, error: null },     // revision_notes
      { data: sampleCostEvents, error: null },// cost_events
      { data: samplePreviews, error: null },  // previews
      { data: null, error: null },            // delivery_runs (none yet)
    ]));

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);

    const body = res._body as {
      property: typeof sampleProperty;
      scenes: typeof sampleScenes;
      revision_notes: typeof sampleNotes;
      previews: typeof samplePreviews;
      cost: { total_cents: number; by_provider: Record<string, number> };
    };

    // Property data present
    expect(body.property.id).toBe('prop-123');
    expect(body.property.client.name).toBe('Helgemo Team');

    // Scenes present and ordered
    expect(body.scenes).toHaveLength(2);
    expect(body.scenes[0].scene_number).toBe(1);

    // Revision notes present
    expect(body.revision_notes).toHaveLength(1);
    expect(body.revision_notes[0].source).toBe('operator');

    // Previews present
    expect(body.previews).toHaveLength(1);
    expect(body.previews[0].token).toBe('abc123');

    // Cost rollup: kling = 1500 + 1000 = 2500, anthropic = 200, total = 2700
    expect(body.cost.total_cents).toBe(2700);
    expect(body.cost.by_provider.kling).toBe(2500);
    expect(body.cost.by_provider.anthropic).toBe(200);
  });
});
