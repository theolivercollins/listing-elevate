/**
 * Verify that createProperty and recordCostEvent both stamp is_test from
 * isNonProdEnv() on every insert, and that the value tracks process.env at
 * call time (not at module-load time) so it works correctly when the env
 * changes between test runs.
 *
 * Mock strategy: vi.mock('@supabase/supabase-js') is hoisted before the
 * module load so the lib/db.ts singleton picks up our fake client. The
 * captured-inserts array is cleared after each test.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// ── Capture every .insert() call across all tables ────────────────────────

type InsertRecord = { table: string; payload: Record<string, unknown> };
const inserts: InsertRecord[] = [];

// The fake client stubs only the paths exercised by createProperty and
// recordCostEvent. Other branches (update, select for addPropertyCost, etc.)
// return minimal non-throwing values.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => {
        inserts.push({ table, payload });
        // createProperty chains .insert().select().single()
        return {
          select: () => ({
            single: () =>
              Promise.resolve({
                data: { id: "fake-id", total_cost_cents: 0, ...payload },
                error: null,
              }),
          }),
        };
      },
      // getProperty (called by addPropertyCost inside recordCostEvent)
      select: (_cols?: string) => ({
        eq: (_col: string, _val: unknown) => ({
          single: () =>
            Promise.resolve({
              data: { id: "fake-id", total_cost_cents: 0 },
              error: null,
            }),
        }),
      }),
      // addPropertyCost update path
      update: (_patch: unknown) => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    }),
  }),
}));

// Stub embeddings.js — db.ts imports it but createProperty / recordCostEvent
// don't exercise it; avoids pulling in pgvector/OpenAI at test time.
vi.mock("./embeddings.js", () => ({
  buildAnalysisText: vi.fn(),
  embedTextSafe: vi.fn(),
  toPgVector: vi.fn(),
}));

// Provide the Supabase env vars getSupabase() requires.
process.env.SUPABASE_URL = "https://fake.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key";

// Capture original env so we can restore after each test.
const origVercelEnv = process.env.VERCEL_ENV;
const origAllowWrites = process.env.LE_ALLOW_NONPROD_WRITES;

afterEach(() => {
  inserts.length = 0;
  if (origVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = origVercelEnv;
  if (origAllowWrites === undefined) delete process.env.LE_ALLOW_NONPROD_WRITES;
  else process.env.LE_ALLOW_NONPROD_WRITES = origAllowWrites;
});

// ── Helpers ───────────────────────────────────────────────────────────────

const minimalProperty = {
  address: "123 Test St",
  price: 500_000,
  bedrooms: 3,
  bathrooms: 2,
  listing_agent: "Test Agent",
} as const;

const minimalCostEvent = {
  propertyId: null,
  stage: "generation" as const,
  provider: "anthropic" as const,
  costCents: 5,
} as const;

// ── createProperty ────────────────────────────────────────────────────────

describe("createProperty — is_test marker", () => {
  it("sets is_test=true when VERCEL_ENV is not production (preview deploy)", async () => {
    process.env.VERCEL_ENV = "preview";
    delete process.env.LE_ALLOW_NONPROD_WRITES;

    const { createProperty } = await import("./db.js");
    await createProperty(minimalProperty);

    const hit = inserts.find((i) => i.table === "properties");
    expect(hit).toBeDefined();
    expect(hit!.payload).toMatchObject({ is_test: true });
  });

  it("sets is_test=false when VERCEL_ENV=production", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.LE_ALLOW_NONPROD_WRITES;

    const { createProperty } = await import("./db.js");
    await createProperty(minimalProperty);

    const hit = inserts.find((i) => i.table === "properties");
    expect(hit).toBeDefined();
    expect(hit!.payload).toMatchObject({ is_test: false });
  });

  it("sets is_test=false when LE_ALLOW_NONPROD_WRITES=true", async () => {
    delete process.env.VERCEL_ENV;
    process.env.LE_ALLOW_NONPROD_WRITES = "true";

    const { createProperty } = await import("./db.js");
    await createProperty(minimalProperty);

    const hit = inserts.find((i) => i.table === "properties");
    expect(hit).toBeDefined();
    expect(hit!.payload).toMatchObject({ is_test: false });
  });
});

// ── recordCostEvent ───────────────────────────────────────────────────────

describe("recordCostEvent — is_test marker", () => {
  it("sets is_test=true when VERCEL_ENV is not production", async () => {
    process.env.VERCEL_ENV = "development";
    delete process.env.LE_ALLOW_NONPROD_WRITES;

    const { recordCostEvent } = await import("./db.js");
    await recordCostEvent(minimalCostEvent);

    const hit = inserts.find((i) => i.table === "cost_events");
    expect(hit).toBeDefined();
    expect(hit!.payload).toMatchObject({ is_test: true });
  });

  it("sets is_test=false when VERCEL_ENV=production", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.LE_ALLOW_NONPROD_WRITES;

    const { recordCostEvent } = await import("./db.js");
    await recordCostEvent(minimalCostEvent);

    const hit = inserts.find((i) => i.table === "cost_events");
    expect(hit).toBeDefined();
    expect(hit!.payload).toMatchObject({ is_test: false });
  });

  it("sets is_test=false when LE_ALLOW_NONPROD_WRITES=true", async () => {
    delete process.env.VERCEL_ENV;
    process.env.LE_ALLOW_NONPROD_WRITES = "true";

    const { recordCostEvent } = await import("./db.js");
    await recordCostEvent(minimalCostEvent);

    const hit = inserts.find((i) => i.table === "cost_events");
    expect(hit).toBeDefined();
    expect(hit!.payload).toMatchObject({ is_test: false });
  });
});

// ── rewritePromptWithDirectives (direct cost_events insert) ──────────────────
// Spot-checks one of the ~15 sites that insert into cost_events directly
// (bypassing recordCostEvent). lib/refine-prompt.ts is representative:
// it constructs and fires a cost_events insert with is_test: isNonProdEnv().

// Stub Anthropic — refine-prompt.ts calls the Anthropic SDK.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class FakeAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "rewritten prompt" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    };
  },
}));

describe("refine-prompt (direct cost_events insert) — is_test marker", () => {
  it("sets is_test=true on a non-prod deploy", async () => {
    process.env.VERCEL_ENV = "development";
    delete process.env.LE_ALLOW_NONPROD_WRITES;

    const { rewritePromptWithDirectives } = await import("./refine-prompt.js");
    await rewritePromptWithDirectives({ basePrompt: "original prompt", directives: "", isPaired: false });

    const hit = inserts.find((i) => i.table === "cost_events");
    expect(hit).toBeDefined();
    expect(hit!.payload).toMatchObject({ is_test: true });
  });

  it("sets is_test=false on production", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.LE_ALLOW_NONPROD_WRITES;

    const { rewritePromptWithDirectives } = await import("./refine-prompt.js");
    await rewritePromptWithDirectives({ basePrompt: "original prompt", directives: "", isPaired: false });

    const hit = inserts.find((i) => i.table === "cost_events");
    expect(hit).toBeDefined();
    expect(hit!.payload).toMatchObject({ is_test: false });
  });
});
