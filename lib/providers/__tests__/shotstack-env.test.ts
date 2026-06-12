/**
 * shotstack-env.test.ts
 *
 * resolveShotstackConfig must never pair the sandbox endpoint with a
 * production key (or vice-versa) — that mismatch is the Shotstack 403
 * "This API key belongs to the Production environment and cannot be used
 * with the Sandbox API". These cases lock the endpoint↔key invariant.
 */

import { describe, it, expect } from "vitest";
import { resolveShotstackConfig } from "../shotstack.js";

describe("resolveShotstackConfig", () => {
  it("uses v1 + prod key when only the production key is set (no SHOTSTACK_ENV) — the Vercel prod case", () => {
    const cfg = resolveShotstackConfig({ SHOTSTACK_API_KEY: "prod-key" } as NodeJS.ProcessEnv);
    expect(cfg.environment).toBe("v1");
    expect(cfg.apiKey).toBe("prod-key");
  });

  it("auto-corrects to v1 when SHOTSTACK_ENV=stage but only the prod key exists (prevents the 403)", () => {
    const cfg = resolveShotstackConfig({
      SHOTSTACK_ENV: "stage",
      SHOTSTACK_API_KEY: "prod-key",
    } as NodeJS.ProcessEnv);
    // No stage key to honor "stage" with → must use the prod endpoint that
    // matches the only available key, not send the prod key to the sandbox.
    expect(cfg.environment).toBe("v1");
    expect(cfg.apiKey).toBe("prod-key");
  });

  it("uses sandbox + stage key when only the stage key is set", () => {
    const cfg = resolveShotstackConfig({ SHOTSTACK_API_KEY_STAGE: "stage-key" } as NodeJS.ProcessEnv);
    expect(cfg.environment).toBe("stage");
    expect(cfg.apiKey).toBe("stage-key");
  });

  it("honors SHOTSTACK_ENV=production when both keys are set (keeps local renders unwatermarked)", () => {
    const cfg = resolveShotstackConfig({
      SHOTSTACK_ENV: "production",
      SHOTSTACK_API_KEY: "prod-key",
      SHOTSTACK_API_KEY_STAGE: "stage-key",
    } as NodeJS.ProcessEnv);
    expect(cfg.environment).toBe("v1");
    expect(cfg.apiKey).toBe("prod-key");
  });

  it("defaults to sandbox when both keys are set and SHOTSTACK_ENV is unset", () => {
    const cfg = resolveShotstackConfig({
      SHOTSTACK_API_KEY: "prod-key",
      SHOTSTACK_API_KEY_STAGE: "stage-key",
    } as NodeJS.ProcessEnv);
    expect(cfg.environment).toBe("stage");
    expect(cfg.apiKey).toBe("stage-key");
  });

  it("honors SHOTSTACK_ENV=stage when the stage key is present", () => {
    const cfg = resolveShotstackConfig({
      SHOTSTACK_ENV: "stage",
      SHOTSTACK_API_KEY: "prod-key",
      SHOTSTACK_API_KEY_STAGE: "stage-key",
    } as NodeJS.ProcessEnv);
    expect(cfg.environment).toBe("stage");
    expect(cfg.apiKey).toBe("stage-key");
  });

  it("throws a clear error when no key is configured", () => {
    expect(() => resolveShotstackConfig({} as NodeJS.ProcessEnv)).toThrow(/not configured/i);
  });
});
