/**
 * Verify that the operator ingest path stamps is_test on the properties row.
 *
 * lib/operator-studio/ingest.ts inserts into `properties` directly (bypassing
 * createProperty) so it must independently call isNonProdEnv().
 *
 * Mock strategy:
 * - vi.mock('@supabase/supabase-js') intercepts the createClient call in
 *   lib/client.ts so the ingest module picks up the fake client.
 * - vi.mock('../delivery/runs.js') stubs the dynamic import of createRun
 *   (non-fatal; we just need it to not throw).
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// ── Capture every .insert() call ─────────────────────────────────────────────

type InsertRecord = { table: string; payload: Record<string, unknown> | Array<Record<string, unknown>> };
const inserts: InsertRecord[] = [];

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => ({
      // properties insert chains .select().single()
      insert: (payload: Record<string, unknown> | Array<Record<string, unknown>>) => {
        inserts.push({ table, payload });
        return {
          // properties path
          select: () => ({
            single: () =>
              Promise.resolve({
                data: { id: "fake-prop-id", ...(Array.isArray(payload) ? {} : payload) },
                error: null,
              }),
          }),
          // photos path — just needs { error: null }; no chaining
          then: undefined,
          // vitest awaits the PromiseLike returned by supabase; the insert
          // for photos returns a thenable with error:null
          error: null,
        };
      },
      // clients lookup (unused when client_id is omitted in test)
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  }),
}));

// Stub runs.js — the dynamic import in ingest.ts is wrapped in try/catch
// so a stub returning a no-op createRun is fine.
vi.mock("../delivery/runs.js", () => ({
  createRun: vi.fn().mockResolvedValue(undefined),
}));

// Provide the Supabase env vars getSupabase() requires.
process.env.SUPABASE_URL = "https://fake.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key";

const origVercelEnv = process.env.VERCEL_ENV;
const origAllowWrites = process.env.LE_ALLOW_NONPROD_WRITES;

afterEach(() => {
  inserts.length = 0;
  if (origVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = origVercelEnv;
  if (origAllowWrites === undefined) delete process.env.LE_ALLOW_NONPROD_WRITES;
  else process.env.LE_ALLOW_NONPROD_WRITES = origAllowWrites;
});

// Minimal valid ingest input (5 photos, address, submitted_by required).
// Explicit mutable type to satisfy ManualIngestWithActor (no readonly arrays).
const minimalInput: import("./ingest.js").ManualIngestWithActor = {
  client_id: null,
  address: "456 Operator Ave",
  price: 750_000,
  bedrooms: 4,
  bathrooms: 3,
  square_footage: null,
  photo_storage_paths: [
    "https://example.com/1.jpg",
    "https://example.com/2.jpg",
    "https://example.com/3.jpg",
    "https://example.com/4.jpg",
    "https://example.com/5.jpg",
  ],
  director_notes: null,
  submitted_by: "operator@test.com",
};

// ── operator ingest is_test marker ────────────────────────────────────────────

describe("ingest (operator) — is_test marker on properties row", () => {
  it("sets is_test=true on a preview deploy", async () => {
    process.env.VERCEL_ENV = "preview";
    delete process.env.LE_ALLOW_NONPROD_WRITES;

    const { manualIngest } = await import("./ingest.js");
    await manualIngest(minimalInput);

    const hit = inserts.find((i) => i.table === "properties");
    expect(hit).toBeDefined();
    expect(hit!.payload).toMatchObject({ is_test: true });
  });

  it("sets is_test=false on production", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.LE_ALLOW_NONPROD_WRITES;

    const { manualIngest } = await import("./ingest.js");
    await manualIngest(minimalInput);

    const hit = inserts.find((i) => i.table === "properties");
    expect(hit).toBeDefined();
    expect(hit!.payload).toMatchObject({ is_test: false });
  });

  it("sets is_test=false when LE_ALLOW_NONPROD_WRITES=true (intentional real write)", async () => {
    delete process.env.VERCEL_ENV;
    process.env.LE_ALLOW_NONPROD_WRITES = "true";

    const { manualIngest } = await import("./ingest.js");
    await manualIngest(minimalInput);

    const hit = inserts.find((i) => i.table === "properties");
    expect(hit).toBeDefined();
    expect(hit!.payload).toMatchObject({ is_test: false });
  });
});
