/**
 * Tests for api/hooks/welcome-email.ts
 *
 * All side-effectful modules (DB ledger, Resend client, env guard) are fully
 * mocked. No real DB or Resend API calls are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────
// Must be declared before importing the handler so vitest hoists them.

vi.mock("../../../lib/email/welcome-db.js", () => ({
  claimWelcomeEmail: vi.fn(),
  markWelcomeEmailSent: vi.fn(),
  releaseWelcomeEmailClaim: vi.fn(),
  recordWelcomeEmailCost: vi.fn(),
  lookupUserEmailById: vi.fn(),
}));

vi.mock("../../../lib/email/resend-client.js", () => ({
  sendResendEmail: vi.fn(),
}));

vi.mock("../../../lib/env.js", () => ({
  isNonProdEnv: vi.fn(),
}));

// Import after mocks are in place.
import handler from "../welcome-email.js";
import * as welcomeDb from "../../../lib/email/welcome-db.js";
import * as resendClient from "../../../lib/email/resend-client.js";
import * as env from "../../../lib/env.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = "test-webhook-secret";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const USER_EMAIL = "new-user@example.com";

function supabaseUserInsertPayload(
  recordOverrides: { id?: unknown; email?: unknown } = {},
  topOverrides: { type?: string; table?: string; schema?: string } = {},
) {
  return {
    type: "INSERT",
    table: "users",
    schema: "auth",
    record: {
      id: USER_ID,
      email: USER_EMAIL,
      ...recordOverrides,
    },
    old_record: null,
    ...topOverrides,
  };
}

/** Build a minimal fake Vercel VercelRequest. */
function makeReq(overrides: {
  method?: string;
  headers?: Record<string, string | undefined>;
  body?: unknown;
}) {
  return {
    method: overrides.method ?? "POST",
    headers: {
      "x-le-webhook-secret": WEBHOOK_SECRET,
      ...(overrides.headers ?? {}),
    },
    body: overrides.body ?? supabaseUserInsertPayload(),
  } as never;
}

/** Build a minimal fake Vercel VercelResponse that records calls. */
function makeRes() {
  const calls: { status: number; body: unknown }[] = [];
  const res = {
    _calls: calls,
    status(code: number) {
      const last = { status: code, body: undefined as unknown };
      calls.push(last);
      return {
        json(body: unknown) {
          last.body = body;
          return res;
        },
      };
    },
    setHeader() {
      return res;
    },
  };
  return res as unknown as import("@vercel/node").VercelResponse & {
    _calls: typeof calls;
  };
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();

  // Default env — flag on, secret set, prod (so sends aren't skipped), and
  // provider config present.
  process.env.WELCOME_EMAIL_ENABLED = "true";
  process.env.WELCOME_EMAIL_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.WELCOME_EMAIL_FROM = "Listing Elevate <hello@listingelevate.com>";

  vi.mocked(env.isNonProdEnv).mockReturnValue(false);
  vi.mocked(welcomeDb.claimWelcomeEmail).mockResolvedValue(true);
  vi.mocked(welcomeDb.markWelcomeEmailSent).mockResolvedValue(undefined);
  vi.mocked(welcomeDb.releaseWelcomeEmailClaim).mockResolvedValue(undefined);
  vi.mocked(welcomeDb.recordWelcomeEmailCost).mockResolvedValue(undefined);
  // The trusted, server-side lookup — defaults to resolving the same
  // address the payload carries, so tests that don't care about FIX 1
  // still exercise a realistic "lookup succeeds" path.
  vi.mocked(welcomeDb.lookupUserEmailById).mockResolvedValue(USER_EMAIL);
  vi.mocked(resendClient.sendResendEmail).mockResolvedValue({ id: "resend-msg-1" });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("api/hooks/welcome-email — flag off", () => {
  it("returns 200 skipped and never touches auth/DB/Resend when WELCOME_EMAIL_ENABLED is unset", async () => {
    delete process.env.WELCOME_EMAIL_ENABLED;
    // Even a bad secret must not matter — the flag gate runs first.
    const req = makeReq({ headers: { "x-le-webhook-secret": "wrong" } });
    const res = makeRes();

    await handler(req, res);

    expect(res._calls[0].status).toBe(200);
    expect(res._calls[0].body).toMatchObject({ ok: true, skipped: "disabled" });
    expect(welcomeDb.claimWelcomeEmail).not.toHaveBeenCalled();
    expect(resendClient.sendResendEmail).not.toHaveBeenCalled();
  });

  it("returns 200 skipped when WELCOME_EMAIL_ENABLED is set to a non-'true' value", async () => {
    process.env.WELCOME_EMAIL_ENABLED = "false";
    const req = makeReq({});
    const res = makeRes();

    await handler(req, res);

    expect(res._calls[0].status).toBe(200);
    expect(res._calls[0].body).toMatchObject({ ok: true, skipped: "disabled" });
    expect(resendClient.sendResendEmail).not.toHaveBeenCalled();
  });
});

describe("api/hooks/welcome-email — auth", () => {
  it("returns 401 on a missing/wrong secret header", async () => {
    const req = makeReq({ headers: { "x-le-webhook-secret": "wrong" } });
    const res = makeRes();

    await handler(req, res);

    expect(res._calls[0].status).toBe(401);
    expect(welcomeDb.claimWelcomeEmail).not.toHaveBeenCalled();
    expect(resendClient.sendResendEmail).not.toHaveBeenCalled();
  });

  it("returns 401 when the header is missing entirely", async () => {
    const req = makeReq({ headers: { "x-le-webhook-secret": undefined } });
    const res = makeRes();

    await handler(req, res);

    expect(res._calls[0].status).toBe(401);
  });

  it("returns 401 when WELCOME_EMAIL_WEBHOOK_SECRET is unset, even with a matching undefined header (fail closed)", async () => {
    delete process.env.WELCOME_EMAIL_WEBHOOK_SECRET;
    const req = makeReq({ headers: { "x-le-webhook-secret": undefined } });
    const res = makeRes();

    await handler(req, res);

    expect(res._calls[0].status).toBe(401);
    expect(resendClient.sendResendEmail).not.toHaveBeenCalled();
  });

  it("returns 401 when the header is sent more than once (folded into an array by Node)", async () => {
    const req = makeReq({ headers: {} });
    // Simulate Node's duplicate-header folding, which produces a string[]
    // rather than a string — must be rejected outright, not compared.
    (req as unknown as { headers: Record<string, unknown> }).headers[
      "x-le-webhook-secret"
    ] = [WEBHOOK_SECRET, WEBHOOK_SECRET];
    const res = makeRes();

    await handler(req, res);

    expect(res._calls[0].status).toBe(401);
  });

  it("returns 405 for non-POST methods (flag on, before auth is even relevant)", async () => {
    const req = makeReq({ method: "GET" });
    const res = makeRes();

    await handler(req, res);

    expect(res._calls[0].status).toBe(405);
  });
});

describe("api/hooks/welcome-email — event shape (FIX 5)", () => {
  it("no-ops (200) on a non-INSERT event and never touches lookup/claim/send", async () => {
    const req = makeReq({ body: supabaseUserInsertPayload({}, { type: "UPDATE" }) });
    const res = makeRes();

    await handler(req, res);

    expect(res._calls[0].status).toBe(200);
    expect(res._calls[0].body).toMatchObject({ ok: true, skipped: "unexpected_event" });
    expect(welcomeDb.lookupUserEmailById).not.toHaveBeenCalled();
    expect(welcomeDb.claimWelcomeEmail).not.toHaveBeenCalled();
    expect(resendClient.sendResendEmail).not.toHaveBeenCalled();
  });

  it("no-ops (200) when the table isn't 'users'", async () => {
    const req = makeReq({ body: supabaseUserInsertPayload({}, { table: "identities" }) });
    const res = makeRes();

    await handler(req, res);

    expect(res._calls[0].status).toBe(200);
    expect(res._calls[0].body).toMatchObject({ ok: true, skipped: "unexpected_event" });
    expect(resendClient.sendResendEmail).not.toHaveBeenCalled();
  });

  it("no-ops (200) when the schema isn't 'auth'", async () => {
    const req = makeReq({ body: supabaseUserInsertPayload({}, { schema: "public" }) });
    const res = makeRes();

    await handler(req, res);

    expect(res._calls[0].status).toBe(200);
    expect(res._calls[0].body).toMatchObject({ ok: true, skipped: "unexpected_event" });
    expect(resendClient.sendResendEmail).not.toHaveBeenCalled();
  });
});

describe("api/hooks/welcome-email — recipient trust boundary (FIX 1)", () => {
  it("sends to the looked-up user email, never the payload's record.email", async () => {
    const spoofedEmail = "attacker-controlled@example.com";
    const realEmail = "real-user@example.com";
    vi.mocked(welcomeDb.lookupUserEmailById).mockResolvedValue(realEmail);

    const req = makeReq({ body: supabaseUserInsertPayload({ email: spoofedEmail }) });
    const res = makeRes();

    await handler(req, res);

    expect(welcomeDb.lookupUserEmailById).toHaveBeenCalledWith(USER_ID);
    expect(welcomeDb.claimWelcomeEmail).toHaveBeenCalledWith(USER_ID, realEmail);
    expect(resendClient.sendResendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: realEmail }),
      expect.any(String),
    );
    expect(res._calls[0].status).toBe(200);
    expect(res._calls[0].body).toMatchObject({ ok: true, sent: true });
  });

  it("returns 400 and never claims when the looked-up user has no email on file", async () => {
    vi.mocked(welcomeDb.lookupUserEmailById).mockResolvedValue(undefined);
    const req = makeReq({});
    const res = makeRes();

    await handler(req, res);

    expect(res._calls[0].status).toBe(400);
    expect(welcomeDb.claimWelcomeEmail).not.toHaveBeenCalled();
    expect(resendClient.sendResendEmail).not.toHaveBeenCalled();
  });

  it("returns 400 and never claims when the looked-up email fails basic shape validation", async () => {
    vi.mocked(welcomeDb.lookupUserEmailById).mockResolvedValue("not-an-email");
    const req = makeReq({});
    const res = makeRes();

    await handler(req, res);

    expect(res._calls[0].status).toBe(400);
    expect(welcomeDb.claimWelcomeEmail).not.toHaveBeenCalled();
    expect(resendClient.sendResendEmail).not.toHaveBeenCalled();
  });

  it("returns 500 and never claims when the user lookup itself fails (transient error, safe to retry)", async () => {
    vi.mocked(welcomeDb.lookupUserEmailById).mockRejectedValue(new Error("admin API unavailable"));
    const req = makeReq({});
    const res = makeRes();

    await handler(req, res);

    expect(res._calls[0].status).toBe(500);
    expect(welcomeDb.claimWelcomeEmail).not.toHaveBeenCalled();
    expect(resendClient.sendResendEmail).not.toHaveBeenCalled();
  });
});

describe("api/hooks/welcome-email — happy path", () => {
  it("claims, sends via Resend, marks sent, and records a $0 cost_event exactly once", async () => {
    const req = makeReq({});
    const res = makeRes();

    await handler(req, res);

    expect(welcomeDb.lookupUserEmailById).toHaveBeenCalledWith(USER_ID);
    expect(welcomeDb.claimWelcomeEmail).toHaveBeenCalledWith(USER_ID, USER_EMAIL);
    expect(resendClient.sendResendEmail).toHaveBeenCalledTimes(1);
    expect(resendClient.sendResendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: USER_EMAIL,
        from: "Listing Elevate <hello@listingelevate.com>",
        subject: "Welcome to Listing Elevate",
        html: expect.stringContaining("Welcome to Listing Elevate"),
      }),
      "re_test_key",
    );
    expect(welcomeDb.markWelcomeEmailSent).toHaveBeenCalledWith(USER_ID, "resend-msg-1");
    expect(welcomeDb.recordWelcomeEmailCost).toHaveBeenCalledWith(USER_ID, "resend-msg-1");
    expect(welcomeDb.releaseWelcomeEmailClaim).not.toHaveBeenCalled();

    expect(res._calls[0].status).toBe(200);
    expect(res._calls[0].body).toMatchObject({ ok: true, sent: true, id: "resend-msg-1" });
  });

  it("returns 400 and never sends when the payload is missing record.id", async () => {
    const req = makeReq({ body: { type: "INSERT", table: "users", schema: "auth", record: {} } });
    const res = makeRes();

    await handler(req, res);

    expect(res._calls[0].status).toBe(400);
    expect(welcomeDb.lookupUserEmailById).not.toHaveBeenCalled();
    expect(welcomeDb.claimWelcomeEmail).not.toHaveBeenCalled();
    expect(resendClient.sendResendEmail).not.toHaveBeenCalled();
  });

  it("skips sending (200) on non-prod deploys, respecting the write-guard", async () => {
    vi.mocked(env.isNonProdEnv).mockReturnValue(true);
    const req = makeReq({});
    const res = makeRes();

    await handler(req, res);

    expect(res._calls[0].status).toBe(200);
    expect(res._calls[0].body).toMatchObject({ ok: true, skipped: "nonprod" });
    expect(welcomeDb.lookupUserEmailById).not.toHaveBeenCalled();
    expect(welcomeDb.claimWelcomeEmail).not.toHaveBeenCalled();
    expect(resendClient.sendResendEmail).not.toHaveBeenCalled();
  });

  it("releases the claim and returns 500 when Resend send fails", async () => {
    vi.mocked(resendClient.sendResendEmail).mockRejectedValue(new Error("Resend 500"));
    const req = makeReq({});
    const res = makeRes();

    await handler(req, res);

    expect(welcomeDb.releaseWelcomeEmailClaim).toHaveBeenCalledWith(USER_ID);
    expect(welcomeDb.markWelcomeEmailSent).not.toHaveBeenCalled();
    expect(res._calls[0].status).toBe(500);
  });

  it("releases the claim and returns 500 when RESEND_API_KEY is missing (unconfigured)", async () => {
    delete process.env.RESEND_API_KEY;
    const req = makeReq({});
    const res = makeRes();

    await handler(req, res);

    expect(resendClient.sendResendEmail).not.toHaveBeenCalled();
    expect(welcomeDb.releaseWelcomeEmailClaim).toHaveBeenCalledWith(USER_ID);
    expect(res._calls[0].status).toBe(500);
  });
});

describe("api/hooks/welcome-email — dedupe", () => {
  it("skips sending (200) when claimWelcomeEmail reports the user already has a claim", async () => {
    vi.mocked(welcomeDb.claimWelcomeEmail).mockResolvedValue(false);
    const req = makeReq({});
    const res = makeRes();

    await handler(req, res);

    expect(res._calls[0].status).toBe(200);
    expect(res._calls[0].body).toMatchObject({ ok: true, skipped: "already_sent" });
    expect(resendClient.sendResendEmail).not.toHaveBeenCalled();
    expect(welcomeDb.markWelcomeEmailSent).not.toHaveBeenCalled();
  });

  it("sends once then skips on a second call for the same user (simulated duplicate webhook delivery)", async () => {
    vi.mocked(welcomeDb.claimWelcomeEmail)
      .mockResolvedValueOnce(true) // first delivery wins the claim
      .mockResolvedValueOnce(false); // redelivery finds the row already claimed

    const req1 = makeReq({});
    const res1 = makeRes();
    await handler(req1, res1);

    const req2 = makeReq({});
    const res2 = makeRes();
    await handler(req2, res2);

    expect(resendClient.sendResendEmail).toHaveBeenCalledTimes(1);
    expect(res1._calls[0].body).toMatchObject({ ok: true, sent: true });
    expect(res2._calls[0].body).toMatchObject({ ok: true, skipped: "already_sent" });
  });
});

describe("api/hooks/welcome-email — at-most-once survives a bookkeeping failure (FIX 3)", () => {
  it("does NOT release the claim when the send succeeds but markWelcomeEmailSent throws", async () => {
    vi.mocked(welcomeDb.markWelcomeEmailSent).mockRejectedValue(new Error("db write failed"));
    const req = makeReq({});
    const res = makeRes();

    await handler(req, res);

    expect(resendClient.sendResendEmail).toHaveBeenCalledTimes(1);
    expect(welcomeDb.releaseWelcomeEmailClaim).not.toHaveBeenCalled();
    // The email genuinely went out — the response must still reflect that.
    expect(res._calls[0].status).toBe(200);
    expect(res._calls[0].body).toMatchObject({ ok: true, sent: true, id: "resend-msg-1" });
    // Cost recording still attempted despite the mark failure.
    expect(welcomeDb.recordWelcomeEmailCost).toHaveBeenCalledWith(USER_ID, "resend-msg-1");
  });

  it("a retried delivery after a bookkeeping failure does not double-send (claim still held)", async () => {
    vi.mocked(welcomeDb.markWelcomeEmailSent).mockRejectedValueOnce(new Error("db write failed"));

    const req1 = makeReq({});
    const res1 = makeRes();
    await handler(req1, res1);

    // Retry: the claim row is still present (sent_at never got written, but
    // it was never released either), so claimWelcomeEmail reports it as
    // already-claimed on the redelivery.
    vi.mocked(welcomeDb.claimWelcomeEmail).mockResolvedValueOnce(false);

    const req2 = makeReq({});
    const res2 = makeRes();
    await handler(req2, res2);

    expect(resendClient.sendResendEmail).toHaveBeenCalledTimes(1);
    expect(welcomeDb.releaseWelcomeEmailClaim).not.toHaveBeenCalled();
    expect(res2._calls[0].body).toMatchObject({ ok: true, skipped: "already_sent" });
  });
});
