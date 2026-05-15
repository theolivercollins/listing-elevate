import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { hashIp } from "./hash-ip";

describe("hashIp", () => {
  const ORIGINAL_SALT = process.env.IP_HASH_SALT;

  beforeEach(() => {
    process.env.IP_HASH_SALT = "test-salt-do-not-use-in-prod";
  });

  afterEach(() => {
    if (ORIGINAL_SALT === undefined) delete process.env.IP_HASH_SALT;
    else process.env.IP_HASH_SALT = ORIGINAL_SALT;
  });

  it("returns a deterministic 64-char hex string for the same IP", () => {
    const a = hashIp("203.0.113.42");
    const b = hashIp("203.0.113.42");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns different hashes for different IPs", () => {
    expect(hashIp("203.0.113.1")).not.toBe(hashIp("203.0.113.2"));
  });

  it("prefers the first IP from x-forwarded-for", () => {
    const fromHeader = hashIp({ headers: { "x-forwarded-for": "203.0.113.42, 10.0.0.1" } } as any);
    const direct = hashIp("203.0.113.42");
    expect(fromHeader).toBe(direct);
  });

  it("falls back to a stable 'unknown' hash when no IP is resolvable", () => {
    const unknown = hashIp({ headers: {} } as any);
    expect(unknown).toMatch(/^[0-9a-f]{64}$/);
    expect(unknown).toBe(hashIp({ headers: {} } as any));
  });

  it("throws if IP_HASH_SALT is missing", () => {
    delete process.env.IP_HASH_SALT;
    expect(() => hashIp("203.0.113.42")).toThrow(/IP_HASH_SALT/);
  });
});
