/**
 * api/stripe/__tests__/webhook.test.ts
 *
 * Tests for the Stripe webhook handler.
 * Verifies: signature failure → 400, checkout.session.completed marks paid +
 * fires pipeline, voice_clone_setup variant updates user_profiles,
 * checkout.session.expired → cancelled, unknown events → 200 no-op.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockVerifyWebhookSignature = vi.fn();
vi.mock("../../../lib/billing/stripe.js", () => ({
  verifyWebhookSignature: (...args: unknown[]) => mockVerifyWebhookSignature(...args),
  getStripeClient: vi.fn(),
}));

const mockRunPipeline = vi.fn();
vi.mock("../../../lib/pipeline.js", () => ({
  runPipeline: (...args: unknown[]) => mockRunPipeline(...args),
}));

const mockGetSupabase = vi.fn();
vi.mock("../../../lib/db.js", () => ({
  getSupabase: (...args: unknown[]) => mockGetSupabase(...args),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRawBodyReq(body: string, stripeSignature?: string) {
  const chunks: Buffer[] = [Buffer.from(body)];
  let endCb: (() => void) | null = null;
  const req = {
    method: "POST",
    headers: {
      "stripe-signature": stripeSignature ?? "t=123,v1=abc",
    },
    on(event: string, cb: (...args: unknown[]) => void) {
      if (event === "data") {
        // simulate pushing chunks synchronously
        chunks.forEach((c) => cb(c));
      }
      if (event === "end") {
        endCb = cb as () => void;
        // trigger end immediately
        setTimeout(() => endCb?.(), 0);
      }
      if (event === "error") {
        // no-op
      }
      return req;
    },
  };
  return req;
}

function makeRes() {
  const res = {
    _status: 200,
    _body: null as unknown,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(body: unknown) {
      res._body = body;
      return res;
    },
    setHeader: vi.fn(),
  };
  return res;
}

function makeSupabaseUpdateStub(error: null | { message: string } = null) {
  const eqFn = vi.fn().mockResolvedValue({ error });
  const updateFn = vi.fn().mockReturnValue({ eq: eqFn });
  const fromFn = vi.fn().mockReturnValue({ update: updateFn });
  return { from: fromFn, _eq: eqFn, _update: updateFn };
}

/**
 * More flexible stub: supports both update chains and select/maybeSingle chains.
 * The properties update returns { data: propertyData } so the webhook can read
 * submitted_by and add_voice_clone back.
 */
function makeSupabaseFullStub(opts: {
  propertyData?: Record<string, unknown> | null;
  profileData?: Record<string, unknown> | null;
  updateError?: null | { message: string };
} = {}) {
  const { propertyData = null, profileData = null, updateError = null } = opts;

  const maybeSingleFn = vi.fn().mockResolvedValue({ data: profileData, error: null });
  const singleFn = vi.fn().mockResolvedValue({ data: propertyData, error: updateError });

  // select chain used for profile lookup
  const selectChain = {
    eq: vi.fn().mockReturnValue({ maybeSingle: maybeSingleFn }),
  };

  // update chain used for property + user_profiles updates
  const updateEqFn = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: singleFn }) });
  const updateFn = vi.fn().mockReturnValue({ eq: updateEqFn, select: vi.fn().mockReturnValue({ single: singleFn }) });

  // simple eq for profile update
  const profileUpdateEqFn = vi.fn().mockResolvedValue({ error: null });
  const profileUpdateFn = vi.fn().mockReturnValue({ eq: profileUpdateEqFn });

  let callCount = 0;
  const fromFn = vi.fn().mockImplementation((table: string) => {
    if (table === 'user_profiles') {
      callCount++;
      // First call to user_profiles = select (check existing paid_at)
      // Second call = update (set paid)
      if (callCount <= 1 && profileData !== undefined) {
        return {
          update: profileUpdateFn,
          select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: maybeSingleFn }) }),
        };
      }
      return { update: profileUpdateFn };
    }
    // properties table
    return { update: updateFn };
  });

  return {
    from: fromFn,
    _updateFn: updateFn,
    _updateEqFn: updateEqFn,
    _singleFn: singleFn,
    _profileUpdateFn: profileUpdateFn,
    _profileUpdateEqFn: profileUpdateEqFn,
    _maybeSingleFn: maybeSingleFn,
  };
}

function makeEvent(
  type: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  return { type, data: { object: data } };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/stripe/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunPipeline.mockResolvedValue(undefined);
  });

  it("returns 400 when stripe-signature is missing", async () => {
    const { default: handler } = await import("../webhook.js");
    const req = makeRawBodyReq("{}", undefined);
    // Remove stripe-signature header
    (req.headers as Record<string, unknown>)["stripe-signature"] = undefined;
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res._status).toBe(400);
    const body = res._body as Record<string, unknown>;
    expect(body.error).toContain("stripe-signature");
  });

  it("returns 400 when signature verification fails", async () => {
    mockVerifyWebhookSignature.mockImplementation(() => {
      throw new Error("invalid signature");
    });

    const { default: handler } = await import("../webhook.js");
    const req = makeRawBodyReq("{}", "bad-sig");
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res._status).toBe(400);
    const body = res._body as Record<string, unknown>;
    expect((body.error as string)).toContain("verification failed");
  });

  it("checkout.session.completed marks property paid + fires pipeline", async () => {
    const event = makeEvent("checkout.session.completed", {
      id: "cs_test_123",
      client_reference_id: "prop-abc",
      payment_intent: "pi_abc",
      metadata: { propertyId: "prop-abc", userId: "user-xyz" },
    });
    mockVerifyWebhookSignature.mockReturnValue(event);

    // Property has no voice clone — simple path.
    const supaStub = makeSupabaseFullStub({
      propertyData: { submitted_by: "user-xyz", add_voice_clone: false },
    });
    mockGetSupabase.mockReturnValue(supaStub);

    const { default: handler } = await import("../webhook.js");
    const req = makeRawBodyReq(JSON.stringify(event));
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res._status).toBe(200);

    // DB update called with correct fields
    expect(supaStub.from).toHaveBeenCalledWith("properties");
    expect(supaStub._updateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "queued",
        stripe_payment_status: "paid",
        stripe_payment_intent_id: "pi_abc",
      }),
    );

    // Give the fire-and-forget runPipeline call time to execute.
    // The webhook fires it without await so the response is fast;
    // a short real-timer wait is sufficient in the test environment.
    await new Promise((r) => setTimeout(r, 20));
    expect(mockRunPipeline).toHaveBeenCalledWith("prop-abc");
  });

  it("checkout.session.completed with add_voice_clone records voice_clone_paid_cents on user_profiles", async () => {
    const event = makeEvent("checkout.session.completed", {
      id: "cs_clone_order",
      client_reference_id: "prop-clone-paid",
      payment_intent: "pi_clone_order",
      metadata: { propertyId: "prop-clone-paid", userId: "user-clone-order" },
    });
    mockVerifyWebhookSignature.mockReturnValue(event);

    // Property has voice clone; profile has not yet been paid.
    const supaStub = makeSupabaseFullStub({
      propertyData: { submitted_by: "user-clone-order", add_voice_clone: true },
      profileData: { voice_clone_paid_at: null },
    });
    mockGetSupabase.mockReturnValue(supaStub);

    const { default: handler } = await import("../webhook.js");
    const req = makeRawBodyReq(JSON.stringify(event));
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res._status).toBe(200);

    // user_profiles should be updated with paid amount
    expect(supaStub._profileUpdateFn).toHaveBeenCalledWith(
      expect.objectContaining({ voice_clone_paid_cents: 12500 }),
    );
    expect(supaStub._profileUpdateEqFn).toHaveBeenCalledWith("user_id", "user-clone-order");
  });

  it("voice_clone payment idempotency: does NOT update user_profiles if voice_clone_paid_at is already set", async () => {
    const event = makeEvent("checkout.session.completed", {
      id: "cs_clone_repeat",
      client_reference_id: "prop-clone-repeat",
      payment_intent: "pi_clone_repeat",
      metadata: {},
    });
    mockVerifyWebhookSignature.mockReturnValue(event);

    // Profile already has paid_at set — should skip the update.
    const supaStub = makeSupabaseFullStub({
      propertyData: { submitted_by: "user-repeat", add_voice_clone: true },
      profileData: { voice_clone_paid_at: "2026-05-01T12:00:00Z" },
    });
    mockGetSupabase.mockReturnValue(supaStub);

    const { default: handler } = await import("../webhook.js");
    const req = makeRawBodyReq(JSON.stringify(event));
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res._status).toBe(200);
    // Profile update must NOT be called again (idempotent)
    expect(supaStub._profileUpdateFn).not.toHaveBeenCalled();
  });

  it("checkout.session.completed with voice_clone_setup updates user_profiles only", async () => {
    const event = makeEvent("checkout.session.completed", {
      id: "cs_clone_123",
      client_reference_id: null,
      payment_intent: "pi_clone",
      metadata: { purpose: "voice_clone_setup", userId: "user-clone" },
    });
    mockVerifyWebhookSignature.mockReturnValue(event);

    const supaStub = makeSupabaseUpdateStub();
    mockGetSupabase.mockReturnValue(supaStub);

    const { default: handler } = await import("../webhook.js");
    const req = makeRawBodyReq(JSON.stringify(event));
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res._status).toBe(200);

    // user_profiles updated, not properties
    expect(supaStub.from).toHaveBeenCalledWith("user_profiles");
    expect(supaStub._update).toHaveBeenCalledWith(
      expect.objectContaining({ voice_clone_paid_cents: 12500 }),
    );

    // Pipeline NOT fired for voice clone setup
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it("checkout.session.expired sets stripe_payment_status=cancelled", async () => {
    const event = makeEvent("checkout.session.expired", {
      id: "cs_expired",
      client_reference_id: "prop-exp",
      metadata: {},
    });
    mockVerifyWebhookSignature.mockReturnValue(event);

    const supaStub = makeSupabaseUpdateStub();
    mockGetSupabase.mockReturnValue(supaStub);

    const { default: handler } = await import("../webhook.js");
    const req = makeRawBodyReq(JSON.stringify(event));
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res._status).toBe(200);
    expect(supaStub.from).toHaveBeenCalledWith("properties");
    expect(supaStub._update).toHaveBeenCalledWith(
      expect.objectContaining({ stripe_payment_status: "cancelled" }),
    );
  });

  it("unknown event type returns 200 no-op without touching DB", async () => {
    const event = makeEvent("customer.created", { id: "cus_test" });
    mockVerifyWebhookSignature.mockReturnValue(event);

    const supaStub = makeSupabaseUpdateStub();
    mockGetSupabase.mockReturnValue(supaStub);

    const { default: handler } = await import("../webhook.js");
    const req = makeRawBodyReq(JSON.stringify(event));
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res._status).toBe(200);
    // No DB calls for unknown events
    expect(supaStub.from).not.toHaveBeenCalled();
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it("payment_intent.payment_failed sets stripe_payment_status=failed", async () => {
    const event = makeEvent("payment_intent.payment_failed", {
      id: "pi_failed",
      status: "requires_payment_method",
    });
    mockVerifyWebhookSignature.mockReturnValue(event);

    const supaStub = makeSupabaseUpdateStub();
    mockGetSupabase.mockReturnValue(supaStub);

    const { default: handler } = await import("../webhook.js");
    const req = makeRawBodyReq(JSON.stringify(event));
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res._status).toBe(200);
    expect(supaStub.from).toHaveBeenCalledWith("properties");
    expect(supaStub._update).toHaveBeenCalledWith(
      expect.objectContaining({ stripe_payment_status: "failed" }),
    );
  });
});
