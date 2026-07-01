/**
 * Unit tests for lib/delivery/resolve-lease.ts — the shared per-run resolve
 * lease (delivery_runs.resolving_at CAS) used both by the autopilot resolver
 * (lib/delivery/auto-run.ts) and the operator "Resume generation" rerun action
 * (api/admin/studio/delivery/[runId].ts) to serialize double-spend-risky work.
 *
 * The CAS db is faked the same way auto-run.test.ts fakes it:
 *   claim   → .update({resolving_at: <iso>}).eq().or().is().select()  → { data }
 *   release → .update({resolving_at: null}).eq()                 → { error }
 */
import { describe, it, expect, vi, type Mock } from 'vitest';
import { getSupabase } from '../../client.js';
import { claimResolveLease, withResolveLease } from '../resolve-lease.js';

vi.mock('../../client.js', () => ({ getSupabase: vi.fn() }));

/** getSupabase mock whose CAS lease-claim grants at most `maxGrants` times.
 *  Tracks how many times the lease was released. */
function makeLeaseDb(maxGrants: number) {
  let grants = 0;
  let releaseCount = 0;
  const claimSelect = vi.fn().mockImplementation(() =>
    Promise.resolve(
      grants < maxGrants
        ? ((grants += 1), { data: [{ id: 'run-1' }], error: null })
        : { data: [], error: null },
    ),
  );
  const releaseEq = vi.fn().mockImplementation(() => {
    releaseCount += 1;
    return Promise.resolve({ error: null });
  });
  const update = vi.fn().mockImplementation((patch: { resolving_at?: unknown }) => {
    if (patch && patch.resolving_at) {
      // claim: .update({resolving_at: now}).eq().or().is('paused_reason', null).select()
      return { eq: () => ({ or: () => ({ is: () => ({ select: claimSelect }) }) }) };
    }
    // release: .update({resolving_at: null}).eq()
    return { eq: releaseEq };
  });
  return {
    db: { from: vi.fn().mockReturnValue({ update }) },
    getReleaseCount: () => releaseCount,
  };
}

describe('withResolveLease', () => {
  it('acquires the lease, runs fn, and releases it', async () => {
    const { db, getReleaseCount } = makeLeaseDb(1);
    (getSupabase as Mock).mockReturnValue(db);

    const fn = vi.fn().mockResolvedValue('did-work');
    const outcome = await withResolveLease('run-1', fn);

    expect(outcome).toEqual({ ran: true, result: 'did-work' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getReleaseCount()).toBe(1);
  });

  it('no-ops without running fn when the lease is already held (0 rows claimed)', async () => {
    const { db, getReleaseCount } = makeLeaseDb(0); // never grants → lost the race
    (getSupabase as Mock).mockReturnValue(db);

    const fn = vi.fn();
    const outcome = await withResolveLease('run-1', fn);

    expect(outcome).toEqual({ ran: false });
    expect(fn).not.toHaveBeenCalled();
    // Never acquired → must NOT release (would clear the real holder's lease).
    expect(getReleaseCount()).toBe(0);
  });

  it('serializes two concurrent resumes: exactly one runs fn, the other no-ops, lease released once', async () => {
    const { db, getReleaseCount } = makeLeaseDb(1); // only ONE grant available
    (getSupabase as Mock).mockReturnValue(db);

    let ranCount = 0;
    const fn = vi.fn().mockImplementation(async () => {
      await Promise.resolve();
      ranCount += 1;
    });

    const [a, b] = await Promise.all([
      withResolveLease('run-1', fn),
      withResolveLease('run-1', fn),
    ]);

    const ranOutcomes = [a, b].filter((o) => o.ran).length;
    expect(ranOutcomes).toBe(1);
    expect(ranCount).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getReleaseCount()).toBe(1); // only the winner releases
  });

  it('releases the lease even when fn throws, and propagates the error', async () => {
    const { db, getReleaseCount } = makeLeaseDb(1);
    (getSupabase as Mock).mockReturnValue(db);

    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(withResolveLease('run-1', fn)).rejects.toThrow('boom');
    expect(getReleaseCount()).toBe(1);
  });
});

// ── FIX #1: paused_reason IS NULL folded into the CAS ────────────────────────
// Closes the residual double-submit race that auto-run.ts's isPausedFresh only
// NARROWED: a Telegram refine executor CAS-sets paused_reason='refining' to lock
// a run; if that flip lands between isPausedFresh's read and the claim, the
// resolver could still win the lease and double-spend. Folding `paused_reason IS
// NULL` into the SAME row-level UPDATE makes the DB the arbiter.
describe("claimResolveLease — paused_reason IS NULL is part of the CAS", () => {
  /** CAS db that faithfully models the row-level WHERE: the claim SELECT returns
   *  the row ONLY when the configured paused_reason is null (lease assumed free).
   *  Records the exact args passed to .is(...) so the test asserts the new
   *  `paused_reason IS NULL` term is actually present in the UPDATE. */
  function makeCasDb(pausedReason: string | null) {
    const isSpy = vi.fn();
    const select = vi.fn().mockImplementation(() =>
      Promise.resolve({ data: pausedReason == null ? [{ id: 'run-1' }] : [], error: null }),
    );
    isSpy.mockReturnValue({ select });
    const update = vi.fn().mockReturnValue({
      eq: () => ({ or: () => ({ is: isSpy }) }),
    });
    return { db: { from: vi.fn().mockReturnValue({ update }) }, isSpy };
  }

  it("claims a run whose paused_reason IS NULL, and the CAS carries .is('paused_reason', null)", async () => {
    const { db, isSpy } = makeCasDb(null);
    (getSupabase as Mock).mockReturnValue(db);

    const won = await claimResolveLease('run-1');

    expect(won).toBe(true);
    expect(isSpy).toHaveBeenCalledWith('paused_reason', null);
  });

  it("REJECTS a run a refine executor just locked (paused_reason='refining') — 0 rows, no double-submit", async () => {
    const { db, isSpy } = makeCasDb('refining');
    (getSupabase as Mock).mockReturnValue(db);

    const won = await claimResolveLease('run-1');

    // The `paused_reason IS NULL` term excludes the locked row → CAS matches 0
    // rows → this caller does NOT win the lease and must not proceed to spend.
    expect(won).toBe(false);
    expect(isSpy).toHaveBeenCalledWith('paused_reason', null);
  });
});
