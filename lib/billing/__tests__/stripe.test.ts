/**
 * lib/billing/__tests__/stripe.test.ts
 *
 * Unit tests for formatLineItemsForOrder and related helpers.
 * No real Stripe API calls — the SDK is never instantiated.
 */
import { describe, it, expect } from "vitest";
import { formatLineItemsForOrder, sumLineItemsCents } from "../stripe.js";
import type { Property } from "../../types.js";

// Minimal Property stub — only fields used by formatLineItemsForOrder.
function makeProperty(overrides: Partial<Property> = {}): Property {
  return {
    id: "test-id",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
    address: "123 Test St",
    price: 500000,
    bedrooms: 3,
    bathrooms: 2,
    listing_agent: "Test Agent",
    brokerage: null,
    status: "pending_payment",
    photo_count: 0,
    selected_photo_count: 0,
    total_cost_cents: 0,
    processing_time_ms: null,
    horizontal_video_url: null,
    vertical_video_url: null,
    thumbnail_url: null,
    submitted_by: null,
    selected_package: null,
    selected_duration: null,
    selected_orientation: null,
    add_voiceover: false,
    add_voice_clone: false,
    add_custom_request: false,
    custom_request_text: null,
    days_on_market: null,
    sold_price: null,
    voiceover_script: null,
    voiceover_audio_url: null,
    voiceover_voice_id_used: null,
    voiceover_chars: null,
    voiceover_duration_seconds: null,
    stripe_session_id: null,
    stripe_payment_intent_id: null,
    stripe_payment_status: "unpaid",
    stripe_paid_at: null,
    stripe_amount_cents: null,
    ...overrides,
  };
}

// ── Base price tests ─────────────────────────────────────────────────────────

describe("formatLineItemsForOrder — base price", () => {
  it("15s just_listed → $75 base, no extras", () => {
    const items = formatLineItemsForOrder(
      makeProperty({
        selected_package: "just_listed",
        selected_duration: 15,
        selected_orientation: "vertical",
        add_voiceover: false,
        add_voice_clone: false,
        add_custom_request: false,
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].name).toContain("Just Listed");
    expect(items[0].name).toContain("15-Second");
    expect(items[0].amountCents).toBe(7500);
  });

  it("30s just_listed → $125 base", () => {
    const items = formatLineItemsForOrder(
      makeProperty({
        selected_package: "just_listed",
        selected_duration: 30,
        selected_orientation: "horizontal",
      }),
    );
    const base = items.find((i) => i.name.includes("Just Listed"));
    expect(base?.amountCents).toBe(12500);
  });

  it("60s just_listed → $175 base", () => {
    const items = formatLineItemsForOrder(
      makeProperty({
        selected_package: "just_listed",
        selected_duration: 60,
        selected_orientation: "vertical",
      }),
    );
    const base = items.find((i) => i.name.includes("Just Listed"));
    expect(base?.amountCents).toBe(17500);
  });

  it("15s life_cycle → $90 base", () => {
    const items = formatLineItemsForOrder(
      makeProperty({
        selected_package: "life_cycle",
        selected_duration: 15,
        selected_orientation: "vertical",
      }),
    );
    const base = items.find((i) => i.name.includes("Life Cycle"));
    expect(base?.amountCents).toBe(9000);
  });

  it("30s life_cycle → $140 base", () => {
    const items = formatLineItemsForOrder(
      makeProperty({
        selected_package: "life_cycle",
        selected_duration: 30,
        selected_orientation: "horizontal",
      }),
    );
    const base = items.find((i) => i.name.includes("Life Cycle"));
    expect(base?.amountCents).toBe(14000);
  });

  it("60s life_cycle → $190 base", () => {
    const items = formatLineItemsForOrder(
      makeProperty({
        selected_package: "life_cycle",
        selected_duration: 60,
        selected_orientation: "horizontal",
      }),
    );
    const base = items.find((i) => i.name.includes("Life Cycle"));
    expect(base?.amountCents).toBe(19000);
  });

  it("just_pended package is labelled correctly", () => {
    const items = formatLineItemsForOrder(
      makeProperty({
        selected_package: "just_pended",
        selected_duration: 30,
        selected_orientation: "vertical",
      }),
    );
    expect(items[0].name).toContain("Just Pended");
  });

  it("just_closed package is labelled correctly", () => {
    const items = formatLineItemsForOrder(
      makeProperty({
        selected_package: "just_closed",
        selected_duration: 60,
        selected_orientation: "vertical",
      }),
    );
    expect(items[0].name).toContain("Just Closed");
  });
});

// ── Orientation extra tests ──────────────────────────────────────────────────

describe("formatLineItemsForOrder — orientation extra", () => {
  it("orientation=both adds $10 extra for non-life_cycle", () => {
    const items = formatLineItemsForOrder(
      makeProperty({
        selected_package: "just_listed",
        selected_duration: 30,
        selected_orientation: "both",
      }),
    );
    const extra = items.find((i) => i.name.includes("Orientations"));
    expect(extra).toBeDefined();
    expect(extra?.amountCents).toBe(1000);
  });

  it("orientation=vertical has no extra", () => {
    const items = formatLineItemsForOrder(
      makeProperty({
        selected_package: "just_listed",
        selected_duration: 30,
        selected_orientation: "vertical",
      }),
    );
    expect(items.every((i) => !i.name.includes("Orientation"))).toBe(true);
  });

  it("orientation=horizontal has no extra", () => {
    const items = formatLineItemsForOrder(
      makeProperty({
        selected_package: "just_listed",
        selected_duration: 30,
        selected_orientation: "horizontal",
      }),
    );
    expect(items.every((i) => !i.name.includes("Orientation"))).toBe(true);
  });

  it("life_cycle with orientation=both has NO orientation extra", () => {
    const items = formatLineItemsForOrder(
      makeProperty({
        selected_package: "life_cycle",
        selected_duration: 30,
        selected_orientation: "both",
      }),
    );
    expect(items.every((i) => !i.name.includes("Orientation"))).toBe(true);
  });
});

// ── Add-on tests ─────────────────────────────────────────────────────────────

describe("formatLineItemsForOrder — add-ons", () => {
  it("add_voiceover=true adds $10 voiceover line", () => {
    const items = formatLineItemsForOrder(
      makeProperty({
        selected_package: "just_listed",
        selected_duration: 30,
        selected_orientation: "vertical",
        add_voiceover: true,
      }),
    );
    const vo = items.find((i) => i.name.includes("Voiceover"));
    expect(vo?.amountCents).toBe(1000);
    expect(vo?.name).not.toContain("Cloned");
  });

  it("add_custom_request=true adds $15 custom request line", () => {
    const items = formatLineItemsForOrder(
      makeProperty({
        selected_package: "just_listed",
        selected_duration: 30,
        selected_orientation: "vertical",
        add_custom_request: true,
      }),
    );
    const custom = items.find((i) => i.name.includes("Custom Request"));
    expect(custom?.amountCents).toBe(1500);
  });

  it("add_voice_clone=true (no opts) adds $125 setup line AND $10 per-video line", () => {
    const items = formatLineItemsForOrder(
      makeProperty({
        selected_package: "just_listed",
        selected_duration: 30,
        selected_orientation: "vertical",
        add_voice_clone: true,
      }),
    );
    const setupLine = items.find((i) => i.name.includes("Clone Setup"));
    expect(setupLine).toBeDefined();
    expect(setupLine?.amountCents).toBe(12500); // $125

    const voLine = items.find((i) => i.name.includes("Voiceover"));
    expect(voLine).toBeDefined();
    expect(voLine?.amountCents).toBe(1000); // $10

    // Total: $125 base + $125 setup + $10 voiceover = $260
    const total = items.reduce((sum, i) => sum + i.amountCents, 0);
    expect(total).toBe(26000);
  });

  it("add_voice_clone=true with hasExistingVoiceClone=true skips $125 setup but keeps $10 voiceover", () => {
    const items = formatLineItemsForOrder(
      makeProperty({
        selected_package: "just_listed",
        selected_duration: 30,
        selected_orientation: "vertical",
        add_voice_clone: true,
      }),
      { hasExistingVoiceClone: true },
    );
    const setupLine = items.find((i) => i.name.includes("Clone Setup"));
    expect(setupLine).toBeUndefined(); // waived

    const voLine = items.find((i) => i.name.includes("Voiceover"));
    expect(voLine).toBeDefined();
    expect(voLine?.amountCents).toBe(1000); // $10 still applies

    // Total: $125 base + $10 voiceover = $135
    const total = items.reduce((sum, i) => sum + i.amountCents, 0);
    expect(total).toBe(13500);
  });

  it("add_voice_clone=false adds no setup line regardless of opts", () => {
    const items = formatLineItemsForOrder(
      makeProperty({
        selected_package: "just_listed",
        selected_duration: 30,
        selected_orientation: "vertical",
        add_voice_clone: false,
      }),
    );
    const setupLine = items.find((i) => i.name.includes("Clone Setup"));
    expect(setupLine).toBeUndefined();
  });
});

// ── Full-order total tests ───────────────────────────────────────────────────

describe("formatLineItemsForOrder — full-order totals", () => {
  it("30s just_listed + both + voiceover + custom → $75+$0+$10+$15 = n/a (30s base $125 +10+10+15=$160)", () => {
    const items = formatLineItemsForOrder(
      makeProperty({
        selected_package: "just_listed",
        selected_duration: 30,
        selected_orientation: "both",
        add_voiceover: true,
        add_custom_request: true,
      }),
    );
    const total = sumLineItemsCents(items);
    // $125 base + $10 orientation + $10 voiceover + $15 custom = $160
    expect(total).toBe(16000);
  });

  it("60s just_listed + vertical + no add-ons → $175 total", () => {
    const items = formatLineItemsForOrder(
      makeProperty({
        selected_package: "just_listed",
        selected_duration: 60,
        selected_orientation: "vertical",
      }),
    );
    expect(sumLineItemsCents(items)).toBe(17500);
  });

  it("empty property (null package/duration) → 0 items", () => {
    const items = formatLineItemsForOrder(makeProperty());
    // No duration, no package — base price is 0, so nothing is added.
    const totalCents = sumLineItemsCents(items);
    expect(totalCents).toBe(0);
  });
});
