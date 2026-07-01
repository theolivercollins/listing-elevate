/**
 * googleIdentity.ts — the GSI "Sign in with Google" ID-token flow helper.
 *
 * `loadScript` (the generic <script> injector shared with google-picker.ts)
 * is mocked here rather than re-exercised — its own script-tag-injection
 * behavior (real DOM append + happy-dom's synchronous "loading disabled"
 * error) is already covered by google-picker.test.ts. This file only
 * verifies googleIdentity.ts's OWN logic: nonce hashing, the `initialize`
 * call shape, and the credential-callback → signInWithIdToken exchange.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateNonce, initGoogleIdentity, GOOGLE_CLIENT_ID } from "../googleIdentity";
import { supabase } from "../supabase";

vi.mock("../google-picker", () => ({
  loadScript: vi.fn(() => Promise.resolve()),
}));

vi.mock("../supabase", () => ({
  supabase: {
    auth: {
      signInWithIdToken: vi.fn(() => Promise.resolve({ error: null })),
    },
  },
}));

const HEX64 = /^[0-9a-f]{64}$/;

describe("generateNonce", () => {
  it("produces a 64-hex-char raw value and its SHA-256 hex digest, and never repeats across calls", async () => {
    const a = await generateNonce();
    const b = await generateNonce();

    expect(a.raw).toMatch(HEX64);
    expect(a.hashed).toMatch(HEX64);
    expect(a.raw).not.toBe(a.hashed);
    expect(a.raw).not.toBe(b.raw);
  });
});

describe("initGoogleIdentity", () => {
  let initializeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    initializeMock = vi.fn();
    (globalThis as unknown as { google: unknown }).google = {
      accounts: { id: { initialize: initializeMock } },
    };
  });

  afterEach(() => {
    delete (globalThis as { google?: unknown }).google;
  });

  it("initializes GSI with the public client id and the HASHED nonce, auto_select off, FedCM on", async () => {
    await initGoogleIdentity({ onSuccess: vi.fn(), onError: vi.fn() });

    expect(initializeMock).toHaveBeenCalledTimes(1);
    const config = initializeMock.mock.calls[0][0];
    expect(config.client_id).toBe(GOOGLE_CLIENT_ID);
    expect(config.auto_select).toBe(false);
    expect(config.use_fedcm_for_prompt).toBe(true);
    expect(config.nonce).toMatch(HEX64);
    expect(typeof config.callback).toBe("function");
  });

  it("the credential callback exchanges the token via signInWithIdToken with the RAW nonce (not the hashed one), then calls onSuccess", async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    await initGoogleIdentity({ onSuccess, onError });

    const config = initializeMock.mock.calls[0][0];
    await config.callback({ credential: "google-id-token-abc" });

    expect(supabase.auth.signInWithIdToken).toHaveBeenCalledTimes(1);
    expect(supabase.auth.signInWithIdToken).toHaveBeenCalledWith({
      provider: "google",
      token: "google-id-token-abc",
      nonce: expect.stringMatching(HEX64),
    });

    // The RAW nonce sent to Supabase must differ from the HASHED nonce sent
    // to Google — that's the entire point of hashing before initialize().
    const sentNonce = (supabase.auth.signInWithIdToken as ReturnType<typeof vi.fn>).mock
      .calls[0][0].nonce;
    expect(sentNonce).not.toBe(config.nonce);

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("surfaces the Supabase error via onError when signInWithIdToken returns one, without calling onSuccess", async () => {
    (supabase.auth.signInWithIdToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      error: new Error("invalid nonce"),
    });
    const onSuccess = vi.fn();
    const onError = vi.fn();
    await initGoogleIdentity({ onSuccess, onError });

    const config = initializeMock.mock.calls[0][0];
    await config.callback({ credential: "google-id-token-abc" });

    expect(onError).toHaveBeenCalledWith("invalid nonce");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("rejects when the GSI script fails to load, without ever calling initialize", async () => {
    const { loadScript } = await import("../google-picker");
    (loadScript as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Failed to load script: https://accounts.google.com/gsi/client"),
    );

    await expect(
      initGoogleIdentity({ onSuccess: vi.fn(), onError: vi.fn() }),
    ).rejects.toThrow("Failed to load script");
    expect(initializeMock).not.toHaveBeenCalled();
  });
});
