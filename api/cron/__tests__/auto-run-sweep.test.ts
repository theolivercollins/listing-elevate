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
}));

// ---------------------------------------------------------------------------
// Imports after vi.mock declarations
// ---------------------------------------------------------------------------

import { getSupabase } from '../../../lib/client.js';
import { resolveGate } from '../../../lib/delivery/auto-run.js';
import handler from '../auto-run-sweep.js';
import type { DeliveryRunRow } from '../../../lib/types/operator-studio.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type GateStage = 'checkpoint_a' | 'details' | 'voiceover' | 'music' | 'checkpoint_b';

function makeRun(id: string, stage: GateStage = 'checkpoint_a'): DeliveryRunRow {
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

/** Build a minimal fake VercelRequest. */
function makeReq(overrides: Partial<{ headers: Record<string, string> }> = {}): VercelRequest {
  return {
    method: 'GET',
    headers: {},
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
    delete process.env.CRON_SECRET;
  });

  // ── Auth guard ─────────────────────────────────────────────────────────────

  it('returns 401 when CRON_SECRET is set and the header is missing', async () => {
    process.env.CRON_SECRET = 'test-secret';
    const { res, captured } = makeRes();
    await handler(makeReq(), res);
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

  it('passes when CRON_SECRET is not set (no auth required)', async () => {
    vi.mocked(getSupabase).mockReturnValue(makeSupabase([]) as never);
    const { res, captured } = makeRes();
    await handler(makeReq(), res);
    expect(captured.status).toBe(200);
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
});
