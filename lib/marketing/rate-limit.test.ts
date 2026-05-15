import { describe, it, expect, beforeEach, vi } from "vitest";
import { assertRateLimit, RateLimitError, LIMITS } from "./rate-limit";

function makeMockSupabase() {
  // Simulates Postgres INSERT ... ON CONFLICT DO UPDATE RETURNING count.
  // In-memory bucket store keyed by bucket_key.
  const store = new Map<string, number>();
  const rpc = vi.fn(async (_fn: string, args: { p_key: string; p_expires_at: string }) => {
    const next = (store.get(args.p_key) ?? 0) + 1;
    store.set(args.p_key, next);
    return { data: next, error: null };
  });
  return { rpc, store };
}

describe("assertRateLimit", () => {
  let supabase: any;
  let store: Map<string, number>;

  beforeEach(() => {
    const m = makeMockSupabase();
    supabase = m;
    store = m.store;
  });

  it("passes when all buckets are under their limits", async () => {
    await expect(
      assertRateLimit(supabase as any, { ipHash: "ip1", conversationId: "c1", sessionCostCents: 0 }),
    ).resolves.toBeUndefined();
  });

  it("throws RateLimitError when per-IP-per-minute exceeds limit", async () => {
    for (let i = 0; i < LIMITS.IP_PER_MIN; i++) {
      await assertRateLimit(supabase as any, { ipHash: "ip-burst", conversationId: `c${i}`, sessionCostCents: 0 });
    }
    await expect(
      assertRateLimit(supabase as any, { ipHash: "ip-burst", conversationId: "c-final", sessionCostCents: 0 }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("throws RateLimitError when per-conversation message cap exceeded", async () => {
    for (let i = 0; i < LIMITS.CONV_MAX_MESSAGES; i++) {
      // Use unique ipHash per iteration so the per-IP/min burst bucket
      // never fires — we're isolating the per-conversation cap.
      await assertRateLimit(supabase as any, { ipHash: `ip-conv-${i}`, conversationId: "c-long", sessionCostCents: 0 });
    }
    await expect(
      assertRateLimit(supabase as any, { ipHash: "ip-conv-final", conversationId: "c-long", sessionCostCents: 0 }),
    ).rejects.toMatchObject({ scope: "conversation_messages" });
  });

  it("throws RateLimitError when session cost cap exceeded", async () => {
    await expect(
      assertRateLimit(supabase as any, { ipHash: "ipA", conversationId: "c-spendy", sessionCostCents: LIMITS.CONV_MAX_COST_CENTS + 1 }),
    ).rejects.toMatchObject({ scope: "conversation_cost" });
  });

  it("throws RateLimitError when global daily cap exceeded", async () => {
    for (let i = 0; i < LIMITS.GLOBAL_PER_DAY; i++) {
      await assertRateLimit(supabase as any, { ipHash: `ip-${i}`, conversationId: `c-${i}`, sessionCostCents: 0 });
    }
    await expect(
      assertRateLimit(supabase as any, { ipHash: "ip-overflow", conversationId: "c-overflow", sessionCostCents: 0 }),
    ).rejects.toMatchObject({ scope: "global_daily" });
  });
});
