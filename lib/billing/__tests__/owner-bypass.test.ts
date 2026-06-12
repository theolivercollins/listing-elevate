import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isOwnerBypassEligible } from "../owner-bypass.js";

describe("isOwnerBypassEligible", () => {
  const ENV_KEY = "LE_OWNER_BYPASS_EMAILS";
  const original = process.env[ENV_KEY];

  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("returns false when env var is unset", () => {
    expect(
      isOwnerBypassEligible({ email: "oliver@recasi.com", role: "admin" }),
    ).toBe(false);
  });

  it("returns false when env var is empty string", () => {
    process.env[ENV_KEY] = "";
    expect(
      isOwnerBypassEligible({ email: "oliver@recasi.com", role: "admin" }),
    ).toBe(false);
  });

  it("returns false when role is not admin even if email matches", () => {
    process.env[ENV_KEY] = "oliver@recasi.com";
    expect(
      isOwnerBypassEligible({ email: "oliver@recasi.com", role: "user" }),
    ).toBe(false);
  });

  it("returns false when email is null", () => {
    process.env[ENV_KEY] = "oliver@recasi.com";
    expect(isOwnerBypassEligible({ email: null, role: "admin" })).toBe(false);
  });

  it("returns false when email is not in allowlist", () => {
    process.env[ENV_KEY] = "oliver@recasi.com";
    expect(
      isOwnerBypassEligible({ email: "other@example.com", role: "admin" }),
    ).toBe(false);
  });

  it("returns true when admin email matches", () => {
    process.env[ENV_KEY] = "oliver@recasi.com";
    expect(
      isOwnerBypassEligible({ email: "oliver@recasi.com", role: "admin" }),
    ).toBe(true);
  });

  it("matches case-insensitively", () => {
    process.env[ENV_KEY] = "Oliver@Recasi.com";
    expect(
      isOwnerBypassEligible({ email: "OLIVER@recasi.COM", role: "admin" }),
    ).toBe(true);
  });

  it("tolerates whitespace and multiple allowlist entries", () => {
    process.env[ENV_KEY] = " oliver@recasi.com , teammate@recasi.com ";
    expect(
      isOwnerBypassEligible({ email: "teammate@recasi.com", role: "admin" }),
    ).toBe(true);
    expect(
      isOwnerBypassEligible({ email: "oliver@recasi.com", role: "admin" }),
    ).toBe(true);
    expect(
      isOwnerBypassEligible({ email: "stranger@recasi.com", role: "admin" }),
    ).toBe(false);
  });

  it("ignores empty entries in allowlist", () => {
    process.env[ENV_KEY] = ",, ,oliver@recasi.com,,";
    expect(
      isOwnerBypassEligible({ email: "oliver@recasi.com", role: "admin" }),
    ).toBe(true);
    expect(
      isOwnerBypassEligible({ email: "", role: "admin" }),
    ).toBe(false);
  });
});
