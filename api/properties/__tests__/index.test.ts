/**
 * api/properties/__tests__/index.test.ts
 *
 * Tests POST /api/properties creates the property row, calls createCheckoutSession,
 * and returns { property, checkoutUrl } without triggering the pipeline.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockCreateProperty = vi.fn();
const mockGetSupabase = vi.fn();
const mockInsertPhotos = vi.fn();

vi.mock("../../../lib/db.js", () => ({
  createProperty: (...args: unknown[]) => mockCreateProperty(...args),
  getSupabase: (...args: unknown[]) => mockGetSupabase(...args),
  insertPhotos: (...args: unknown[]) => mockInsertPhotos(...args),
}));

const mockCreateCheckoutSession = vi.fn();
const mockFormatLineItemsForOrder = vi.fn();
const mockSumLineItemsCents = vi.fn();

vi.mock("../../../lib/billing/stripe.js", () => ({
  createCheckoutSession: (...args: unknown[]) => mockCreateCheckoutSession(...args),
  formatLineItemsForOrder: (...args: unknown[]) => mockFormatLineItemsForOrder(...args),
  sumLineItemsCents: (...args: unknown[]) => mockSumLineItemsCents(...args),
}));

const mockRequireAuth = vi.fn();

vi.mock("../../../lib/auth.js", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const FAKE_AUTH = {
  user: { id: "user-456", email: "agent@test.com" },
  profile: { role: "user", voice_clone_status: "none", elevenlabs_voice_id: null },
};

function makeReq(body: Record<string, unknown> = {}, method = "POST") {
  return {
    method,
    headers: { origin: "http://localhost:5173", authorization: "Bearer fake-token" },
    query: {},
    body: {
      address: "123 Main St",
      price: "500000",
      bedrooms: "3",
      bathrooms: "2",
      listing_agent: "Agent Smith",
      selectedPackage: "just_listed",
      selectedDuration: "30s",
      selectedOrientation: "vertical",
      addVoiceover: false,
      addVoiceClone: false,
      addCustomRequest: false,
      ...body,
    },
  };
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

function makeSupabaseStub(profileData: Record<string, unknown> | null = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: profileData, error: null });
  const from = vi.fn().mockReturnValue({
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "https://cdn.test/photo.jpg" } }),
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    maybeSingle,
  });
  const storage = {
    from: vi.fn().mockReturnValue({
      getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "https://cdn.test/photo.jpg" } }),
    }),
  };
  return { from, storage };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/properties", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: auth succeeds.
    mockRequireAuth.mockResolvedValue(FAKE_AUTH);
  });

  it("creates property + returns checkoutUrl, does NOT fire pipeline", async () => {
    const fakeProperty = {
      id: "prop-123",
      address: "123 Main St",
      status: "pending_payment",
      stripe_payment_status: "unpaid",
      submitted_by: "user-456",
      selected_package: "just_listed",
      selected_duration: 30,
      selected_orientation: "vertical",
      add_voiceover: false,
      add_voice_clone: false,
      add_custom_request: false,
    };

    mockCreateProperty.mockResolvedValue(fakeProperty);
    mockFormatLineItemsForOrder.mockReturnValue([{ name: "30-Second Just Listed", amountCents: 12500 }]);
    mockSumLineItemsCents.mockReturnValue(12500);
    mockCreateCheckoutSession.mockResolvedValue({
      sessionId: "cs_test_abc",
      url: "https://checkout.stripe.com/pay/cs_test_abc",
    });

    const supaStub = makeSupabaseStub();
    mockGetSupabase.mockReturnValue(supaStub);

    const { default: handler } = await import("../index.js");

    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res._status).toBe(201);
    const body = res._body as Record<string, unknown>;
    expect(body).toHaveProperty("checkoutUrl", "https://checkout.stripe.com/pay/cs_test_abc");
    expect(body).toHaveProperty("property");

    // Verify createProperty was called with pending_payment status
    expect(mockCreateProperty).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending_payment", stripe_payment_status: "unpaid" }),
    );

    // Verify createCheckoutSession was called
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: "prop-123",
        lineItems: [{ name: "30-Second Just Listed", amountCents: 12500 }],
      }),
    );
  });

  it("returns 400 when required fields are missing", async () => {
    mockGetSupabase.mockReturnValue(makeSupabaseStub());

    const { default: handler } = await import("../index.js");
    const req = makeReq({ address: "" }); // missing address
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res._status).toBe(400);
    const body = res._body as Record<string, unknown>;
    expect(body.error).toContain("Missing required fields");
  });

  it("returns 405 for GET-like requests directed at POST handler variant", async () => {
    mockGetSupabase.mockReturnValue(makeSupabaseStub());

    const { default: handler } = await import("../index.js");
    const req = makeReq({}, "DELETE");
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res._status).toBe(405);
  });

  it("returns 401 when user is not authenticated", async () => {
    // requireAuth writes the 401 and returns null.
    mockRequireAuth.mockImplementation((_req: unknown, res: { status: (n: number) => { json: (b: unknown) => unknown } }) => {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    });

    const { default: handler } = await import("../index.js");
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res._status).toBe(401);
  });

  it("creates property with submitted_by populated from auth user", async () => {
    const fakeProperty = {
      id: "prop-789",
      address: "123 Main St",
      status: "pending_payment",
      stripe_payment_status: "unpaid",
      submitted_by: "user-456",
      add_voice_clone: false,
      add_voiceover: false,
      add_custom_request: false,
    };

    mockCreateProperty.mockResolvedValue(fakeProperty);
    mockFormatLineItemsForOrder.mockReturnValue([{ name: "30-Second Just Listed", amountCents: 12500 }]);
    mockSumLineItemsCents.mockReturnValue(12500);
    mockCreateCheckoutSession.mockResolvedValue({
      sessionId: "cs_test_xyz",
      url: "https://checkout.stripe.com/pay/cs_test_xyz",
    });

    const supaStub = makeSupabaseStub(null); // no existing profile
    mockGetSupabase.mockReturnValue(supaStub);

    const { default: handler } = await import("../index.js");
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res._status).toBe(201);
    expect(mockCreateProperty).toHaveBeenCalledWith(
      expect.objectContaining({ submitted_by: "user-456" }),
    );
  });

  it("POST with addVoiceClone=true for new user includes $125 setup in line items call", async () => {
    const fakeProperty = {
      id: "prop-clone-new",
      address: "123 Main St",
      status: "pending_payment",
      stripe_payment_status: "unpaid",
      submitted_by: "user-456",
      add_voice_clone: true,
      add_voiceover: false,
      add_custom_request: false,
    };

    mockCreateProperty.mockResolvedValue(fakeProperty);
    // formatLineItemsForOrder returns items including the setup fee for new user
    const setupLineItems = [
      { name: "30-Second Just Listed", amountCents: 12500 },
      { name: "Voice Clone Setup (one-time)", amountCents: 12500 },
      { name: "AI Voiceover (Cloned Voice)", amountCents: 1000 },
    ];
    mockFormatLineItemsForOrder.mockReturnValue(setupLineItems);
    mockSumLineItemsCents.mockReturnValue(26000);
    mockCreateCheckoutSession.mockResolvedValue({
      sessionId: "cs_clone_new",
      url: "https://checkout.stripe.com/pay/cs_clone_new",
    });

    // Profile: no existing clone (voice_clone_status='none')
    const supaStub = makeSupabaseStub({ voice_clone_status: "none", elevenlabs_voice_id: null });
    mockGetSupabase.mockReturnValue(supaStub);

    const { default: handler } = await import("../index.js");
    const req = makeReq({ addVoiceClone: true });
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res._status).toBe(201);
    // formatLineItemsForOrder called with hasExistingVoiceClone=false
    expect(mockFormatLineItemsForOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ hasExistingVoiceClone: false }),
    );
    // Checkout receives 4 line items (including setup)
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ lineItems: setupLineItems }),
    );
  });

  it("POST with addVoiceClone=true for user with existing clone skips $125 setup", async () => {
    const fakeProperty = {
      id: "prop-clone-existing",
      address: "123 Main St",
      status: "pending_payment",
      stripe_payment_status: "unpaid",
      submitted_by: "user-456",
      add_voice_clone: true,
      add_voiceover: false,
      add_custom_request: false,
    };

    mockCreateProperty.mockResolvedValue(fakeProperty);
    // formatLineItemsForOrder returns items WITHOUT setup fee for existing clone
    const noSetupLineItems = [
      { name: "30-Second Just Listed", amountCents: 12500 },
      { name: "AI Voiceover (Cloned Voice)", amountCents: 1000 },
    ];
    mockFormatLineItemsForOrder.mockReturnValue(noSetupLineItems);
    mockSumLineItemsCents.mockReturnValue(13500);
    mockCreateCheckoutSession.mockResolvedValue({
      sessionId: "cs_clone_existing",
      url: "https://checkout.stripe.com/pay/cs_clone_existing",
    });

    // Profile: existing ready clone
    const supaStub = makeSupabaseStub({ voice_clone_status: "ready", elevenlabs_voice_id: "voice_abc" });
    mockGetSupabase.mockReturnValue(supaStub);

    const { default: handler } = await import("../index.js");
    const req = makeReq({ addVoiceClone: true });
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res._status).toBe(201);
    // formatLineItemsForOrder called with hasExistingVoiceClone=true
    expect(mockFormatLineItemsForOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ hasExistingVoiceClone: true }),
    );
    // Checkout does NOT include setup fee line items
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ lineItems: noSetupLineItems }),
    );
  });
});
