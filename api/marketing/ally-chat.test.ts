import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "./ally-chat";

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      constructor(_opts: unknown) {}
      messages = {
        create: vi.fn(async () => ({
          content: [{ type: "text", text: MOCK_ASSISTANT_REPLY }],
          usage: { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 1800, cache_creation_input_tokens: 0 },
          model: "claude-sonnet-4-6",
          stop_reason: "end_turn",
        })),
      };
    },
  };
});

vi.mock("../../lib/client.js", () => ({
  getSupabase: () => makeSupabaseStub(),
}));

vi.mock("../../lib/marketing/rate-limit.js", () => ({
  assertRateLimit: vi.fn(async () => undefined),
  RateLimitError: class extends Error {
    constructor(public scope: string, public retryAfterSeconds: number) { super(scope); }
  },
  LIMITS: { IP_PER_MIN: 5, IP_PER_DAY: 50, CONV_MAX_MESSAGES: 30, CONV_MAX_COST_CENTS: 100, GLOBAL_PER_DAY: 500 },
}));

const MOCK_ASSISTANT_REPLY = `<reply>
Hey! Most listings turn around in under an hour. Want me to walk you through how to get started?
</reply>
<ally_followup_chips>
What do you need from me?; Show me pricing; How does it work?
</ally_followup_chips>
<ally_cta>
get_started
</ally_cta>`;

function makeSupabaseStub() {
  const inserts: any[] = [];
  const updates: any[] = [];
  return {
    inserts, updates,
    from: (table: string) => ({
      insert: (rows: any) => { inserts.push({ table, rows }); return { error: null }; },
      upsert: (rows: any, opts?: any) => { updates.push({ table, rows, opts }); return { error: null, data: rows }; },
      update: (changes: any) => ({
        eq: (_col: string, _val: any) => { updates.push({ table, changes }); return { error: null }; },
      }),
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { conversation: [], total_messages: 0, total_cost_cents: 0 }, error: null }) }),
      }),
    }),
    rpc: vi.fn(async () => ({ data: 1, error: null })),
  };
}

function makeReqRes(body: unknown) {
  const req: any = {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.7", cookie: "" },
    body,
    socket: { remoteAddress: "203.0.113.7" },
  };
  let statusCode = 200;
  let payload: any = null;
  const headers: Record<string, string> = {};
  const res: any = {
    status(code: number) { statusCode = code; return res; },
    json(data: any) { payload = data; return res; },
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; },
    end() { return res; },
  };
  return { req, res, get statusCode() { return statusCode; }, get payload() { return payload; }, headers };
}

beforeEach(() => {
  process.env.IP_HASH_SALT = "test-salt";
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("POST /api/marketing/ally-chat", () => {
  it("returns 405 for non-POST", async () => {
    const ctx = makeReqRes({});
    ctx.req.method = "GET";
    await handler(ctx.req, ctx.res);
    expect(ctx.statusCode).toBe(405);
  });

  it("returns 400 when messages is missing", async () => {
    const ctx = makeReqRes({});
    await handler(ctx.req, ctx.res);
    expect(ctx.statusCode).toBe(400);
  });

  it("returns parsed reply + followup_chips + cta on a valid request", async () => {
    const ctx = makeReqRes({ messages: [{ role: "user", content: "How long does turnaround take?" }] });
    await handler(ctx.req, ctx.res);
    expect(ctx.statusCode).toBe(200);
    expect(ctx.payload.reply).toMatch(/under an hour/);
    expect(ctx.payload.followup_chips).toEqual([
      "What do you need from me?",
      "Show me pricing",
      "How does it work?",
    ]);
    expect(ctx.payload.cta).toBe("get_started");
    expect(ctx.payload.lead_capture).toBeNull();
  });

  it("issues a Set-Cookie when no cookie is present", async () => {
    const ctx = makeReqRes({ messages: [{ role: "user", content: "hi" }] });
    await handler(ctx.req, ctx.res);
    expect(ctx.headers["set-cookie"]).toContain("mally_cid=");
  });

  it("returns 429 when rate limit is hit", async () => {
    const { assertRateLimit, RateLimitError } = await import("../../lib/marketing/rate-limit.js");
    (assertRateLimit as any).mockImplementationOnce(async () => {
      throw new (RateLimitError as any)("ip_per_min", 60);
    });
    const ctx = makeReqRes({ messages: [{ role: "user", content: "hi" }] });
    await handler(ctx.req, ctx.res);
    expect(ctx.statusCode).toBe(429);
    expect(ctx.headers["retry-after"]).toBe("60");
  });
});
