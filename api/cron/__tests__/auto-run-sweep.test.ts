/**
 * Tests for the autopilot sweep cron handler — api/cron/auto-run-sweep.ts
 *
 * Strategy:
 *   - Mock lib/client.js (getSupabase) and lib/delivery/auto-run.js (resolveGate)
 *     to avoid any real Supabase or Gemini calls.
 *   - Build a lightweight fake VercelRequest/VercelResponse to exercise the handler.
 *   - Assert: (a) unauthenticated requests are rejected, (b) resolveGate is called
 *     for each run returned by the query, (c) summary counts in the response body
 *     correctly reflect advanced / paused / noop outcomes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by Vitest)
// ---------------------------------------------------------------------------

vi.mock('../../../lib/client.js', () => ({
  getSupabase: vi.fn(),
}));

vi.mock('../../../lib/delivery/auto-run.js', () => ({
  resolveGate: vi.fn(),
  resolveAssembling: vi.fn(),
  reclaimStrandedRefiningLocks: vi.fn(),
  // The cron now imports the single source of truth for gate stages.
  GATE_STAGES: ['checkpoint_a', 'details', 'voiceover', 'music', 'checkpoint_b'],
}));

// ---------------------------------------------------------------------------
// Imports after vi.mock declarations
// ---------------------------------------------------------------------------

import { getSupabase } from '../../../lib/client.js';
import { resolveGate, resolveAssembling, reclaimStrandedRefiningLocks } from '../../../lib/delivery/auto-run.js';
import handler from '../auto-run-sweep.js';
import type { DeliveryRunRow } from '../../../lib/types/operator-studio.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type GateStage = 'checkpoint_a' | 'details' | 'voiceover' | 'music' | 'checkpoint_b';

function makeRun(id: string, stage: GateStage | 'assembling' = 'checkpoint_a'): DeliveryRunRow {
  return {
    id,
    property_id: `prop-${id}`,
    client_id: null,
    stage,
    auto_run: true,
    paused_reason: null,
    auto_paused_at: null,
    error: null,
    video_type: 'horizontal',
    duration_seconds: 30,
    listing_details: null,
    scene_order: null,
    music_track_id: null,
    voiceover_script: null,
    voiceover_audio_url: null,
    voiceover_voice_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as unknown as DeliveryRunRow;
}

/** Build a minimal fake VercelRequest. Defaults to an AUTHED request (the cron
 *  now hard-requires CRON_SECRET) so functional tests exercise the happy path;
 *  the 401 cases override `headers` explicitly. */
function makeReq(overrides: Partial<{ headers: Record<string, string> }> = {}): VercelRequest {
  return {
    method: 'GET',
    headers: { authorization: 'Bearer test-secret' },
    ...overrides,
  } as unknown as VercelRequest;
}

/** Capture the JSON body + status code from a fake VercelResponse. */
function makeRes(): { res: VercelResponse; captured: { status: number; body: unknown } } {
  const captured = { status: 200, body: {} as unknown };
  const res = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(data: unknown) {
      captured.body = data;
      return res;
    },
  } as unknown as VercelResponse;
  return { res, captured };
}

/** Build a fake Supabase client whose delivery_runs query resolves to `rows`. */
function makeSupabase(rows: DeliveryRunRow[], queryError?: string) {
  const chain = {
    eq: () => chain,
    is: () => chain,
    in: () => Promise.resolve(queryError
      ? { data: null, error: { message: queryError } }
      : { data: rows, error: null }),
  };
  return {
    from: () => ({ select: () => chain }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('auto-run-sweep cron handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default to a configured secret so the (now hard-required) auth guard lets
    // authed functional requests through; the 401 cases tweak this per-test.
    process.env.CRON_SECRET = 'test-secret';
    // Default the reclaim pass to "nothing stranded" so every pre-existing
    // test (which doesn't care about it) behaves exactly as before it existed.
    vi.mocked(reclaimStrandedRefiningLocks).mockResolvedValue({ reclaimed: 0 });
  });

  // ── Auth guard ─────────────────────────────────────────────────────────────

  it('returns 401 when CRON_SECRET is set and the header is missing', async () => {
    process.env.CRON_SECRET = 'test-secret';
    const { res, captured } = makeRes();
    await handler(makeReq({ headers: {} }), res);
    expect(captured.status).toBe(401);
    expect((captured.body as { ok: boolean }).ok).toBe(false);
  });

  it('returns 401 when CRON_SECRET is set and the header is wrong', async () => {
    process.env.CRON_SECRET = 'test-secret';
    const { res, captured } = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer wrong' } }), res);
    expect(captured.status).toBe(401);
  });

  it('passes when CRON_SECRET is set and the header matches', async () => {
    process.env.CRON_SECRET = 'test-secret';
    vi.mocked(getSupabase).mockReturnValue(makeSupabase([]) as never);
    const { res, captured } = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer test-secret' } }), res);
    expect(captured.status).toBe(200);
  });

  it('returns 401 when CRON_SECRET is NOT set (hard-required, never runs open)', async () => {
    // This cron drives autonomous spend — a missing secret must reject, not allow.
    delete process.env.CRON_SECRET;
    vi.mocked(getSupabase).mockReturnValue(makeSupabase([]) as never);
    const { res, captured } = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer anything' } }), res);
    expect(captured.status).toBe(401);
    expect((captured.body as { ok: boolean }).ok).toBe(false);
  });

  // ── resolveGate call-per-run ────────────────────────────────────────────────

  it('calls resolveGate once per run and returns correct processed count', async () => {
    const runs = [makeRun('run-1', 'checkpoint_a'), makeRun('run-2', 'details')];
    vi.mocked(getSupabase).mockReturnValue(makeSupabase(runs) as never);
    vi.mocked(resolveGate).mockResolvedValue({ action: 'noop', reason: 'TODO stub' });

    const { res, captured } = makeRes();
    await handler(makeReq(), res);

    expect(vi.mocked(resolveGate)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(resolveGate)).toHaveBeenCalledWith(runs[0]);
    expect(vi.mocked(resolveGate)).toHaveBeenCalledWith(runs[1]);
    const body = captured.body as { processed: number };
    expect(body.processed).toBe(2);
  });

  // ── Summary counts ──────────────────────────────────────────────────────────

  it('counts advanced outcomes correctly', async () => {
    const runs = [makeRun('run-1'), makeRun('run-2'), makeRun('run-3')];
    vi.mocked(getSupabase).mockReturnValue(makeSupabase(runs) as never);
    vi.mocked(resolveGate)
      .mockResolvedValueOnce({ action: 'advanced', to: 'details' })
      .mockResolvedValueOnce({ action: 'advanced', to: 'voiceover' })
      .mockResolvedValueOnce({ action: 'noop', reason: 'TODO stub' });

    const { res, captured } = makeRes();
    await handler(makeReq(), res);

    const body = captured.body as { processed: number; advanced: number; paused: number; noop: number };
    expect(body.processed).toBe(3);
    expect(body.advanced).toBe(2);
    expect(body.paused).toBe(0);
    expect(body.noop).toBe(1);
  });

  it('counts paused outcomes correctly', async () => {
    const runs = [makeRun('run-1'), makeRun('run-2')];
    vi.mocked(getSupabase).mockReturnValue(makeSupabase(runs) as never);
    vi.mocked(resolveGate)
      .mockResolvedValueOnce({ action: 'paused', reason: 'low judge margin' })
      .mockResolvedValueOnce({ action: 'advanced', to: 'details' });

    const { res, captured } = makeRes();
    await handler(makeReq(), res);

    const body = captured.body as { paused: number; advanced: number };
    expect(body.paused).toBe(1);
    expect(body.advanced).toBe(1);
  });

  it('counts a resolveGate throw as noop and does not abort the sweep', async () => {
    const runs = [makeRun('run-1'), makeRun('run-2')];
    vi.mocked(getSupabase).mockReturnValue(makeSupabase(runs) as never);
    vi.mocked(resolveGate)
      .mockRejectedValueOnce(new Error('simulated DB failure'))
      .mockResolvedValueOnce({ action: 'advanced', to: 'details' });

    const { res, captured } = makeRes();
    await handler(makeReq(), res);

    // Both runs processed, second one advanced despite first throwing.
    const body = captured.body as { processed: number; advanced: number; noop: number };
    expect(body.processed).toBe(2);
    expect(body.advanced).toBe(1);
    expect(body.noop).toBe(1);
    expect(captured.status).toBe(200);
  });

  it('returns zero counts when no qualifying runs exist', async () => {
    vi.mocked(getSupabase).mockReturnValue(makeSupabase([]) as never);

    const { res, captured } = makeRes();
    await handler(makeReq(), res);

    const body = captured.body as { processed: number; advanced: number; paused: number; noop: number; ok: boolean };
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(0);
    expect(body.advanced).toBe(0);
    expect(body.paused).toBe(0);
    expect(body.noop).toBe(0);
  });

  it('returns 500 when the DB query errors', async () => {
    vi.mocked(getSupabase).mockReturnValue(makeSupabase([], 'connection refused') as never);

    const { res, captured } = makeRes();
    await handler(makeReq(), res);

    expect(captured.status).toBe(500);
    const body = captured.body as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('connection refused');
  });

  // ── leaseError surfacing (migration 091 column missing) ────────────────────

  it('reports leaseError count when resolveGate throws a 42703 postgres error', async () => {
    // Migration 091 (resolving_at column) not yet applied: the CAS update fails
    // with Postgres undefined_column code 42703. The sweep must surface this in
    // the response body — NOT silently count it as a plain noop — so operators
    // can diagnose deploy-before-migration scenarios.
    const runs = [makeRun('run-1', 'checkpoint_a'), makeRun('run-2', 'details')];
    vi.mocked(getSupabase).mockReturnValue(makeSupabase(runs) as never);
    vi.mocked(resolveGate)
      .mockRejectedValueOnce(new Error('claimResolveLease: column delivery_runs.resolving_at does not exist (42703)'))
      .mockRejectedValueOnce(new Error('claimResolveLease: column delivery_runs.resolving_at does not exist (42703)'));

    const { res, captured } = makeRes();
    await handler(makeReq(), res);

    expect(captured.status).toBe(200); // sweep continues; leaseError is diagnostic, not fatal
    const body = captured.body as { leaseError: number; noop: number; processed: number; ok: boolean };
    expect(body.ok).toBe(true);
    expect(body.leaseError).toBe(2);
    expect(body.noop).toBe(2);
    expect(body.processed).toBe(2);
  });

  it('leaseError count is 0 when no 42703 errors occur', async () => {
    vi.mocked(getSupabase).mockReturnValue(makeSupabase([]) as never);

    const { res, captured } = makeRes();
    await handler(makeReq(), res);

    const body = captured.body as { leaseError: number };
    expect(body.leaseError).toBe(0);
  });

  // ── assembling runs picked up and routed to resolveAssembling ─────────────

  it('calls resolveAssembling for runs at assembling stage', async () => {
    const runs = [makeRun('run-asm', 'assembling')];
    vi.mocked(getSupabase).mockReturnValue(makeSupabase(runs) as never);
    vi.mocked(resolveAssembling).mockResolvedValue({ action: 'advanced', to: 'checkpoint_b' });

    const { res, captured } = makeRes();
    await handler(makeReq(), res);

    expect(vi.mocked(resolveAssembling)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resolveAssembling)).toHaveBeenCalledWith(runs[0], expect.any(Number));
    expect(vi.mocked(resolveGate)).not.toHaveBeenCalled();
    const body = captured.body as { advanced: number; processed: number };
    expect(body.advanced).toBe(1);
    expect(body.processed).toBe(1);
  });

  it('counts resolveAssembling outcomes correctly alongside gate outcomes', async () => {
    const gateRun = makeRun('run-gate', 'checkpoint_a');
    const asmRun = makeRun('run-asm', 'assembling');
    vi.mocked(getSupabase).mockReturnValue(makeSupabase([gateRun, asmRun]) as never);
    vi.mocked(resolveGate).mockResolvedValue({ action: 'advanced', to: 'details' });
    vi.mocked(resolveAssembling).mockResolvedValue({ action: 'noop', reason: 'renders still in-flight' });

    const { res, captured } = makeRes();
    await handler(makeReq(), res);

    const body = captured.body as { processed: number; advanced: number; noop: number };
    expect(body.processed).toBe(2);
    expect(body.advanced).toBe(1);  // gate run advanced
    expect(body.noop).toBe(1);      // asm run noop (still in-flight)
  });

  it('reports leaseError when resolveAssembling throws 42703', async () => {
    const runs = [makeRun('run-asm', 'assembling')];
    vi.mocked(getSupabase).mockReturnValue(makeSupabase(runs) as never);
    vi.mocked(resolveAssembling).mockRejectedValue(
      new Error('claimResolveLease: column delivery_runs.resolving_at does not exist (42703)'),
    );

    const { res, captured } = makeRes();
    await handler(makeReq(), res);

    const body = captured.body as { leaseError: number; noop: number };
    expect(body.leaseError).toBe(1);
    expect(body.noop).toBe(1);
    expect(captured.status).toBe(200);
  });

  // ── Reclaim pass (FIX B1) — runs before the main pass, count surfaced ──────

  it('calls reclaimStrandedRefiningLocks once per invocation and surfaces its count in the response', async () => {
    vi.mocked(getSupabase).mockReturnValue(makeSupabase([]) as never);
    vi.mocked(reclaimStrandedRefiningLocks).mockResolvedValue({ reclaimed: 3 });

    const { res, captured } = makeRes();
    await handler(makeReq(), res);

    expect(vi.mocked(reclaimStrandedRefiningLocks)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reclaimStrandedRefiningLocks)).toHaveBeenCalledWith();
    const body = captured.body as { reclaimed: number; ok: boolean };
    expect(body.ok).toBe(true);
    expect(body.reclaimed).toBe(3);
  });

  it('reclaimed defaults to 0 when nothing was stranded', async () => {
    vi.mocked(getSupabase).mockReturnValue(makeSupabase([]) as never);
    vi.mocked(reclaimStrandedRefiningLocks).mockResolvedValue({ reclaimed: 0 });

    const { res, captured } = makeRes();
    await handler(makeReq(), res);

    const body = captured.body as { reclaimed: number };
    expect(body.reclaimed).toBe(0);
  });

  it('runs the reclaim pass BEFORE the main delivery_runs query (same-tick pickup)', async () => {
    const order: string[] = [];
    vi.mocked(reclaimStrandedRefiningLocks).mockImplementation(async () => {
      order.push('reclaim');
      return { reclaimed: 1 };
    });
    const inner = makeSupabase([]);
    vi.mocked(getSupabase).mockImplementation(() => {
      order.push('main-select');
      return inner as never;
    });

    const { res } = makeRes();
    await handler(makeReq(), res);

    expect(order[0]).toBe('reclaim');
    expect(order).toContain('main-select');
  });

  it('does not abort the sweep when reclaimStrandedRefiningLocks rejects — main pass still runs, reclaimed=0', async () => {
    vi.mocked(reclaimStrandedRefiningLocks).mockRejectedValue(new Error('boom'));
    const runs = [makeRun('run-1', 'checkpoint_a')];
    vi.mocked(getSupabase).mockReturnValue(makeSupabase(runs) as never);
    vi.mocked(resolveGate).mockResolvedValue({ action: 'advanced', to: 'details' });

    const { res, captured } = makeRes();
    await handler(makeReq(), res);

    expect(captured.status).toBe(200);
    const body = captured.body as { ok: boolean; advanced: number; reclaimed: number };
    expect(body.ok).toBe(true);
    expect(body.advanced).toBe(1);
    expect(body.reclaimed).toBe(0); // failed reclaim counted as 0, not fatal
  });
});
