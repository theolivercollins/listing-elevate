import { describe, it, expect } from "vitest";
import { ensureVoiceover, synthesizeDescription } from "./ensure-voiceover.js";

// Minimal property factory — only the fields ensureVoiceover reads.
function prop(overrides: Record<string, unknown> = {}) {
  return {
    id: "prop-1",
    address: "42 Maple Street",
    price: 750000,
    bedrooms: 4,
    bathrooms: 3,
    brokerage: "Acme Realty",
    selected_package: "just_listed",
    selected_duration: 30,
    add_voiceover: false,
    voiceover_url: null,
    voiceover_voice_id: null,
    voiceover_compass_url: null,
    custom_request_text: null,
    ...overrides,
  } as unknown as Parameters<typeof ensureVoiceover>[0];
}

describe("synthesizeDescription", () => {
  it("includes address, bed/bath, price and brokerage", () => {
    const d = synthesizeDescription(prop());
    expect(d).toContain("42 Maple Street");
    expect(d).toContain("4 bedrooms");
    expect(d).toContain("3 bathrooms");
    expect(d).toContain("$750,000");
    expect(d).toContain("Acme Realty");
  });

  it("singularizes a 1 bed / 1 bath home", () => {
    const d = synthesizeDescription(prop({ bedrooms: 1, bathrooms: 1 }));
    expect(d).toContain("1 bedroom,");
    expect(d).toContain("1 bathroom");
    expect(d).not.toContain("1 bedrooms");
  });

  it("appends a custom request when present", () => {
    const d = synthesizeDescription(prop({ custom_request_text: "Emphasize the chef's kitchen." }));
    expect(d).toContain("Emphasize the chef's kitchen.");
  });
});

describe("ensureVoiceover no-op branches", () => {
  it("is a no-op when the add-on is off", async () => {
    const res = await ensureVoiceover(prop({ add_voiceover: false }));
    expect(res).toEqual({ voiceoverUrl: null, generated: false });
  });

  it("reuses an existing voiceover_url (preview flow) without regenerating", async () => {
    const res = await ensureVoiceover(
      prop({ add_voiceover: true, voiceover_url: "https://cdn/existing.mp3" }),
    );
    expect(res).toEqual({ voiceoverUrl: "https://cdn/existing.mp3", generated: false });
  });
});
