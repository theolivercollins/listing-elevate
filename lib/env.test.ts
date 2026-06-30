import { describe, it, expect, afterEach } from "vitest";
import { isNonProdEnv } from "./env.js";

// Capture originals so each test can restore the exact state it found.
const origVercelEnv = process.env.VERCEL_ENV;
const origAllowWrites = process.env.LE_ALLOW_NONPROD_WRITES;

afterEach(() => {
  // Restore env after every test to avoid cross-test pollution.
  if (origVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = origVercelEnv;

  if (origAllowWrites === undefined) delete process.env.LE_ALLOW_NONPROD_WRITES;
  else process.env.LE_ALLOW_NONPROD_WRITES = origAllowWrites;
});

describe("isNonProdEnv()", () => {
  it("returns true when neither env var is set (local dev / CI)", () => {
    delete process.env.VERCEL_ENV;
    delete process.env.LE_ALLOW_NONPROD_WRITES;
    expect(isNonProdEnv()).toBe(true);
  });

  it("returns true on Vercel preview deploys (VERCEL_ENV=preview)", () => {
    process.env.VERCEL_ENV = "preview";
    delete process.env.LE_ALLOW_NONPROD_WRITES;
    expect(isNonProdEnv()).toBe(true);
  });

  it("returns true on Vercel development deploys (VERCEL_ENV=development)", () => {
    process.env.VERCEL_ENV = "development";
    delete process.env.LE_ALLOW_NONPROD_WRITES;
    expect(isNonProdEnv()).toBe(true);
  });

  it("returns false on production (VERCEL_ENV=production)", () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.LE_ALLOW_NONPROD_WRITES;
    expect(isNonProdEnv()).toBe(false);
  });

  it("returns false when LE_ALLOW_NONPROD_WRITES=true — intentional real-data write", () => {
    delete process.env.VERCEL_ENV;
    process.env.LE_ALLOW_NONPROD_WRITES = "true";
    expect(isNonProdEnv()).toBe(false);
  });

  it("returns false when both production flags are set", () => {
    process.env.VERCEL_ENV = "production";
    process.env.LE_ALLOW_NONPROD_WRITES = "true";
    expect(isNonProdEnv()).toBe(false);
  });

  it("returns true when LE_ALLOW_NONPROD_WRITES is a non-'true' value", () => {
    delete process.env.VERCEL_ENV;
    process.env.LE_ALLOW_NONPROD_WRITES = "1";
    expect(isNonProdEnv()).toBe(true);
  });
});
