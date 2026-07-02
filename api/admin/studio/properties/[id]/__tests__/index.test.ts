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

    // No active delivery run → delivery field is null
    expect((body as unknown as { cost: { delivery: unknown } }).cost.delivery).toBeNull();
  });

  it('returns a final_video entry with a Bunny embed_url when the persisted URL is Bunny-hosted', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    process.env.BUNNY_STREAM_API_KEY = 'fake-key';
    process.env.BUNNY_STREAM_LIBRARY_ID = '99999';
    process.env.BUNNY_STREAM_CDN_HOSTNAME = 'vz-01cb8232-b48.b-cdn.net';
    const guid = 'c2feb4b1-3421-4d34-9d80-31be5b0d9c2e';

    const sampleProperty = {
      id: 'prop-bunny',
      address: '9 Bunny Way',
      status: 'complete',
      horizontal_video_url: `https://vz-01cb8232-b48.b-cdn.net/${guid}/play_1080p.mp4`,
      horizontal_hls_url: `https://vz-01cb8232-b48.b-cdn.net/${guid}/playlist.m3u8`,
      vertical_video_url: null,
      vertical_hls_url: null,
      client: null,
    };

    mockGetSupabase.mockReturnValue(makeDb([
      { data: sampleProperty, error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: null, error: null },
    ]));

    const res = makeRes();
    try {
      await handler(makeReq({ query: { id: 'prop-bunny' } }), res as unknown as VercelResponse);
    } finally {
      delete process.env.BUNNY_STREAM_API_KEY;
      delete process.env.BUNNY_STREAM_LIBRARY_ID;
      delete process.env.BUNNY_STREAM_CDN_HOSTNAME;
    }
    expect(res._status).toBe(200);

    const body = res._body as {
      final_video: {
        horizontal: { embed_url: string | null; mp4_url: string; hls_url: string | null } | null;
        vertical: unknown;
      };
    };

    expect(body.final_video.horizontal).not.toBeNull();
    expect(body.final_video.horizontal!.mp4_url).toBe(sampleProperty.horizontal_video_url);
    expect(body.final_video.horizontal!.hls_url).toBe(sampleProperty.horizontal_hls_url);
    expect(body.final_video.horizontal!.embed_url).toBe(
      `https://iframe.mediadelivery.net/embed/99999/${guid}`,
    );
    expect(body.final_video.vertical).toBeNull();
  });

  it('returns final_video: null for a non-Bunny (provider fallback) URL', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);

    const sampleProperty = {
      id: 'prop-fallback',
      address: '4 Fallback Ln',
      status: 'complete',
      horizontal_video_url: 'https://cdn.creatomate.com/renders/abc123.mp4',
      horizontal_hls_url: null,
      vertical_video_url: null,
      vertical_hls_url: null,
      client: null,
    };

    mockGetSupabase.mockReturnValue(makeDb([
      { data: sampleProperty, error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: null, error: null },
    ]));

    const res = makeRes();
    await handler(makeReq({ query: { id: 'prop-fallback' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(200);

    const body = res._body as { final_video: { horizontal: unknown; vertical: unknown } };
    expect(body.final_video.horizontal).toBeNull();
    expect(body.final_video.vertical).toBeNull();
  });

  it('returns delivery breakdown when active run has tagged cost events', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);

    const sampleProperty = { id: 'prop-456', address: '2 Elm St', status: 'assembling', client: null };
    const runId = 'run-abc';
    const sampleCostEvents = [
      // Tagged to this run
      { stage: 'generation', provider: 'kling', cost_cents: 2000, metadata: { delivery_run_id: runId } },
      { stage: 'qc', provider: 'google', cost_cents: 300, metadata: { delivery_run_id: runId } },
      { stage: 'assembly', provider: 'elevenlabs', cost_cents: 150, metadata: { delivery_run_id: runId, kind: 'voiceover' } },
      { stage: 'assembly', provider: 'elevenlabs', cost_cents: 100, metadata: { delivery_run_id: runId, kind: 'music_generation' } },
      // NOT tagged to this run (older / unrelated events)
      { stage: 'generation', provider: 'kling', cost_cents: 500, metadata: null },
      { stage: 'analysis', provider: 'anthropic', cost_cents: 80, metadata: {} },
    ];

    mockGetSupabase.mockReturnValue(makeDb([
      { data: sampleProperty, error: null },                           // properties
      { data: [], error: null },                                       // scenes
      { data: [], error: null },                                       // revision_notes
      { data: sampleCostEvents, error: null },                        // cost_events
      { data: [], error: null },                                       // previews
      { data: { id: runId, stage: 'assembling' }, error: null },     // delivery_runs
    ]));

    const res = makeRes();
    await handler(makeReq({ query: { id: 'prop-456' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(200);

    const body = res._body as {
      cost: {
        total_cents: number;
        by_provider: Record<string, number>;
        delivery: { total_cents: number; by_stage: Record<string, number> } | null;
      };
    };

    // Total includes all events
    expect(body.cost.total_cents).toBe(3130);

    // Delivery sub-block covers only run-tagged events
    expect(body.cost.delivery).not.toBeNull();
    expect(body.cost.delivery!.total_cents).toBe(2550);
    // generation: 2000, qc: 300, assembly: 150 + 100 = 250
    expect(body.cost.delivery!.by_stage.generation).toBe(2000);
    expect(body.cost.delivery!.by_stage.qc).toBe(300);
    expect(body.cost.delivery!.by_stage.assembly).toBe(250);
  });

  it('returns delivery: null when no cost events match the active run id', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);

    const sampleProperty = { id: 'prop-789', address: '3 Oak Ave', status: 'generating', client: null };
    const runId = 'run-xyz';
    const sampleCostEvents = [
      // Only untagged events (pre-delivery)
      { stage: 'generation', provider: 'kling', cost_cents: 1000, metadata: null },
    ];

    mockGetSupabase.mockReturnValue(makeDb([
      { data: sampleProperty, error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: sampleCostEvents, error: null },
      { data: [], error: null },
      { data: { id: runId, stage: 'generating' }, error: null },
    ]));

    const res = makeRes();
    await handler(makeReq({ query: { id: 'prop-789' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(200);

    const body = res._body as { cost: { delivery: { total_cents: number; by_stage: Record<string, number> } | null } };

    // Run exists but no cost events tagged to it → delivery total = 0, by_stage = {}
    expect(body.cost.delivery).not.toBeNull();
    expect(body.cost.delivery!.total_cents).toBe(0);
    expect(Object.keys(body.cost.delivery!.by_stage)).toHaveLength(0);
  });

  it('surfaces per-provider event counts and QC re-render sub-totals in by_provider_detail', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);

    const sampleProperty = { id: 'prop-326f', address: '326f005e Ave', status: 'complete', client: null };
    // Real prod shape (326f005e): 7 Atlas (kling) render events totaling $3.92,
    // 3 kept clips + 4 re-renders, only 1 of the 4 re-renders tagged discarded
    // (most re-render events lack render_outcome entirely — do not infer from
    // untagged events).
    const sampleCostEvents = [
      { stage: 'generation', provider: 'kling', cost_cents: 56, metadata: { source: 'cron', scene_number: 1, duration_seconds: 5, generation_time_ms: 300000 } },
      { stage: 'generation', provider: 'kling', cost_cents: 56, metadata: { source: 'cron', scene_number: 2, duration_seconds: 5, generation_time_ms: 300000 } },
      { stage: 'generation', provider: 'kling', cost_cents: 56, metadata: { source: 'cron', scene_number: 3, duration_seconds: 5, generation_time_ms: 300000 } },
      { stage: 'generation', provider: 'kling', cost_cents: 56, metadata: { source: 'cron', scene_number: 4, render_outcome: 'qc_rerender_discarded', duration_seconds: 5, generation_time_ms: 332307 } },
      { stage: 'generation', provider: 'kling', cost_cents: 56, metadata: { source: 'cron', scene_number: 4, duration_seconds: 5, generation_time_ms: 300000 } },
      // Untagged re-renders (real prod behavior: no render_outcome at all) — must NOT be counted as rerenders.
      { stage: 'generation', provider: 'kling', cost_cents: 56, metadata: { source: 'cron', scene_number: 5, duration_seconds: 5, generation_time_ms: 300000 } },
      { stage: 'generation', provider: 'kling', cost_cents: 56, metadata: { source: 'cron', scene_number: 5, duration_seconds: 5, generation_time_ms: 300000 } },
      // $0 event — must still show up in event_count.
      { stage: 'analysis', provider: 'anthropic', cost_cents: 0, metadata: { source: 'cron' } },
    ];

    mockGetSupabase.mockReturnValue(makeDb([
      { data: sampleProperty, error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: sampleCostEvents, error: null },
      { data: [], error: null },
      { data: null, error: null },
    ]));

    const res = makeRes();
    await handler(makeReq({ query: { id: 'prop-326f' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(200);

    const body = res._body as {
      cost: {
        total_cents: number;
        by_provider: Record<string, number>;
        by_provider_detail: Record<string, { cost_cents: number; event_count: number; rerender_count: number; rerender_cents: number }>;
      };
    };

    // Totals unchanged — 7 kling events x 56 = 392 ($3.92), matching prod verification.
    expect(body.cost.total_cents).toBe(392);
    expect(body.cost.by_provider.kling).toBe(392);

    // by_provider_detail is additive: event counts + tagged-only rerender sub-aggregate.
    expect(body.cost.by_provider_detail.kling.cost_cents).toBe(392);
    expect(body.cost.by_provider_detail.kling.event_count).toBe(7);
    expect(body.cost.by_provider_detail.kling.rerender_count).toBe(1);
    expect(body.cost.by_provider_detail.kling.rerender_cents).toBe(56);

    // $0 anthropic event is still counted — proves "every call is logged" claim.
    expect(body.cost.by_provider_detail.anthropic.cost_cents).toBe(0);
    expect(body.cost.by_provider_detail.anthropic.event_count).toBe(1);
    expect(body.cost.by_provider_detail.anthropic.rerender_count).toBe(0);
    expect(body.cost.by_provider_detail.anthropic.rerender_cents).toBe(0);
  });
});
