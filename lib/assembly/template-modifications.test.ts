import { describe, it, expect } from "vitest";
import {
  buildTemplateModifications,
  categoryLabelForPackage,
  displayAddress,
  splitAddress,
} from "./template-modifications.js";

describe("displayAddress", () => {
  it("strips a trailing 5-digit zip", () => {
    expect(displayAddress("5019 San Massimo Dr, Punta Gorda, FL 33950")).toBe(
      "5019 San Massimo Dr, Punta Gorda, FL",
    );
  });

  it("strips a trailing zip+4", () => {
    expect(displayAddress("5019 San Massimo Dr, Punta Gorda, FL 33950-1234")).toBe(
      "5019 San Massimo Dr, Punta Gorda, FL",
    );
  });

  it("leaves an address without a zip unchanged", () => {
    expect(displayAddress("123 Waymay Dr, Punta Gorda FL")).toBe(
      "123 Waymay Dr, Punta Gorda FL",
    );
  });

  it("strips a trailing ', USA' (with or without a zip before it)", () => {
    expect(displayAddress("5019 San Massimo Dr, Punta Gorda, FL 33950, USA")).toBe(
      "5019 San Massimo Dr, Punta Gorda, FL",
    );
    expect(displayAddress("5019 San Massimo Dr, Punta Gorda, FL, USA")).toBe(
      "5019 San Massimo Dr, Punta Gorda, FL",
    );
  });

  it("strips a trailing ', United States'", () => {
    expect(displayAddress("1 Main St, Tampa, FL 33602, United States")).toBe(
      "1 Main St, Tampa, FL",
    );
  });

  it("does not strip 5-digit street numbers (zip must be trailing)", () => {
    expect(displayAddress("33950 Ocean Blvd, Naples, FL")).toBe(
      "33950 Ocean Blvd, Naples, FL",
    );
  });

  it("handles empty / null input", () => {
    expect(displayAddress(null)).toBe("");
    expect(displayAddress(undefined)).toBe("");
    expect(displayAddress("   ")).toBe("");
  });
});

describe("splitAddress", () => {
  it("returns ['', ''] for empty input", () => {
    expect(splitAddress(null)).toEqual(["", ""]);
    expect(splitAddress(undefined)).toEqual(["", ""]);
    expect(splitAddress("")).toEqual(["", ""]);
    expect(splitAddress("   ")).toEqual(["", ""]);
  });

  it("splits on a single comma", () => {
    expect(splitAddress("123 Waymay Dr, Punta Gorda FL")).toEqual([
      "123 Waymay Dr",
      "Punta Gorda FL",
    ]);
  });

  it("splits on the LAST comma when there are multiple", () => {
    expect(splitAddress("123 Main St, Apt 4, Punta Gorda FL")).toEqual([
      "123 Main St, Apt 4",
      "Punta Gorda FL",
    ]);
  });

  it("returns the whole string + empty city when no comma", () => {
    expect(splitAddress("123 Waymay Dr")).toEqual(["123 Waymay Dr", ""]);
  });

  it("trims whitespace on both sides", () => {
    expect(splitAddress("  123 Waymay Dr  ,  Punta Gorda FL  ")).toEqual([
      "123 Waymay Dr",
      "Punta Gorda FL",
    ]);
  });
});

describe("categoryLabelForPackage", () => {
  it("maps each known package", () => {
    expect(categoryLabelForPackage("just_listed")).toBe("Just Listed");
    expect(categoryLabelForPackage("just_pended")).toBe("Just Pended");
    expect(categoryLabelForPackage("just_closed")).toBe("Just Closed");
    expect(categoryLabelForPackage("life_cycle")).toBe("Just Listed");
  });

  it("defaults to Just Listed for null / unknown", () => {
    expect(categoryLabelForPackage(null)).toBe("Just Listed");
    expect(categoryLabelForPackage(undefined)).toBe("Just Listed");
    expect(categoryLabelForPackage("future_tier")).toBe("Just Listed");
  });
});

describe("buildTemplateModifications", () => {
  it("writes intro/mid/final text fields matching the Just Listed #01 rev-2 names", () => {
    const mods = buildTemplateModifications({
      address: "123 Waymay Dr, Punta Gorda FL",
      selectedPackage: "just_listed",
      agentName: "Brian Helgemo",
      brokerageName: "Compass",
    });
    expect(mods).toMatchObject({
      "St#/StName-Intro.text": "123 Waymay Dr",
      "City/State-Intro.text": "Punta Gorda FL",
      "Vid-Category-Intro.text": "Just Listed",
      "Listing-Agent-Mid.text": "Brian Helgemo",
      "Listing-Agent-Final.text": "Brian Helgemo",
      "Listing-Brokerage-Mid.text": "Compass",
      "Listing-Brokerage-Final.text": "Compass",
      "Full-Address-Final.text": "123 Waymay Dr, Punta Gorda FL",
    });
  });

  it("substitutes empty string when brokerage is null", () => {
    const mods = buildTemplateModifications({
      address: "1 Main, Punta Gorda FL",
      selectedPackage: "just_listed",
      agentName: "Brian",
      brokerageName: null,
    });
    expect(mods["Listing-Agent-Mid.text"]).toBe("Brian");
    expect(mods["Listing-Brokerage-Mid.text"]).toBe("");
    expect(mods["Listing-Brokerage-Final.text"]).toBe("");
  });

  it("emits Clip-N.source + duration when clips are provided", () => {
    const mods = buildTemplateModifications({
      address: "1 Main, Punta Gorda FL",
      selectedPackage: "just_listed",
      agentName: "Brian",
      brokerageName: "Compass",
      clips: [
        { url: "https://a/clip1.mp4", durationSeconds: 4 },
        { url: "https://a/clip2.mp4", durationSeconds: 3.5 },
      ],
    });
    expect(mods["Clip-1.source"]).toBe("https://a/clip1.mp4");
    expect(mods["Clip-1.duration"]).toBe(4);
    expect(mods["Clip-2.source"]).toBe("https://a/clip2.mp4");
    expect(mods["Clip-2.duration"]).toBe(3.5);
  });

  it("omits Clip keys when no clips are provided", () => {
    const mods = buildTemplateModifications({
      address: "1 Main, Punta Gorda FL",
      selectedPackage: "just_listed",
      agentName: "Brian",
      brokerageName: "Compass",
    });
    expect(Object.keys(mods).some((k) => k.startsWith("Clip"))).toBe(false);
  });

  it("writes Audio-Music.source + Agent-Headshot-Final.source when provided", () => {
    const mods = buildTemplateModifications({
      address: "1 Main, Punta Gorda FL",
      selectedPackage: "just_listed",
      agentName: "Brian",
      brokerageName: "Compass",
      musicUrl: "https://audio/track.mp3",
      agentHeadshotUrl: "https://headshots/brian.png",
    });
    expect(mods["Audio-Music.source"]).toBe("https://audio/track.mp3");
    expect(mods["Agent-Headshot-Final.source"]).toBe("https://headshots/brian.png");
  });

  it("writes Audio-Voiceover.source AND legacy Voice-Over.source when voiceoverUrl is provided", () => {
    const mods = buildTemplateModifications({
      address: "1 Main, Punta Gorda FL",
      selectedPackage: "just_listed",
      agentName: "Brian",
      brokerageName: "Compass",
      voiceoverUrl: "https://audio/vo.mp3",
    });
    expect(mods["Audio-Voiceover.source"]).toBe("https://audio/vo.mp3");
    expect(mods["Voice-Over.source"]).toBe("https://audio/vo.mp3");
  });

  it("omits voiceover keys when voiceoverUrl is not provided", () => {
    const mods = buildTemplateModifications({
      address: "1 Main, Punta Gorda FL",
      selectedPackage: "just_listed",
      agentName: "Brian",
      brokerageName: "Compass",
    });
    expect(mods).not.toHaveProperty("Audio-Voiceover.source");
    expect(mods).not.toHaveProperty("Voice-Over.source");
  });

  it("does not pollute output with music/headshot keys when not provided", () => {
    const mods = buildTemplateModifications({
      address: "1 Main, Punta Gorda FL",
      selectedPackage: "just_listed",
      agentName: "Brian",
      brokerageName: "Compass",
    });
    expect(mods).not.toHaveProperty("Audio-Music.source");
    expect(mods).not.toHaveProperty("Agent-Headshot-Final.source");
  });

  it("Full-Address-Final keeps the full original string", () => {
    const mods = buildTemplateModifications({
      address: "456 Oak Ave, Apt B, Tampa FL",
      selectedPackage: "just_listed",
      agentName: "Brian",
      brokerageName: "Compass",
    });
    expect(mods["Full-Address-Final.text"]).toBe("456 Oak Ave, Apt B, Tampa FL");
    // And the intro split keeps street vs city/state distinct
    expect(mods["St#/StName-Intro.text"]).toBe("456 Oak Ave, Apt B");
    expect(mods["City/State-Intro.text"]).toBe("Tampa FL");
  });
});

// "15 seconds - Just Listed" template (075d3024…), created 2026-06-04.
// Different element names from Just Listed #01 — single-line text fields,
// 5 clip slots, an Image-Headshot, and a Text-Phone-Number that #01 lacked.
describe("buildTemplateModifications — 15s Just Listed template element names", () => {
  it("writes the 15s template's single-line text fields", () => {
    const mods = buildTemplateModifications({
      address: "2750 Palm Tree Dr, Punta Gorda, FL",
      selectedPackage: "just_listed",
      agentName: "Brian Helgemo, Realtor",
      brokerageName: "- The Helgemo Team | Compass",
    });
    expect(mods).toMatchObject({
      "Text-Agent-Name.text": "Brian Helgemo, Realtor",
      "Text-JL.text": "Just Listed",
      "Text-Address.text": "2750 Palm Tree Dr, Punta Gorda, FL",
      "Text-Brokerage-Team.text": "- The Helgemo Team | Compass",
    });
  });

  it("maps Text-Brokerage-Team to empty string when brokerage is null", () => {
    const mods = buildTemplateModifications({
      address: "1 Main, Punta Gorda FL",
      selectedPackage: "just_listed",
      agentName: "Brian",
      brokerageName: null,
    });
    expect(mods["Text-Brokerage-Team.text"]).toBe("");
  });

  it("emits Text-Phone-Number.text when agentPhone is provided", () => {
    const mods = buildTemplateModifications({
      address: "1 Main, Punta Gorda FL",
      selectedPackage: "just_listed",
      agentName: "Brian",
      brokerageName: "Compass",
      agentPhone: "c: 941.205.9011",
    });
    expect(mods["Text-Phone-Number.text"]).toBe("c: 941.205.9011");
  });

  it("omits Text-Phone-Number when agentPhone is absent (keeps template default)", () => {
    const mods = buildTemplateModifications({
      address: "1 Main, Punta Gorda FL",
      selectedPackage: "just_listed",
      agentName: "Brian",
      brokerageName: "Compass",
    });
    expect(mods).not.toHaveProperty("Text-Phone-Number.text");
  });

  it("writes Image-Headshot.source from the same headshot URL as #01", () => {
    const mods = buildTemplateModifications({
      address: "1 Main, Punta Gorda FL",
      selectedPackage: "just_listed",
      agentName: "Brian",
      brokerageName: "Compass",
      agentHeadshotUrl: "https://headshots/brian.png",
    });
    expect(mods["Image-Headshot.source"]).toBe("https://headshots/brian.png");
    // still backward-compatible with #01's Agent-Headshot-Final
    expect(mods["Agent-Headshot-Final.source"]).toBe("https://headshots/brian.png");
  });

  it("omits Image-Headshot when no headshot URL is provided", () => {
    const mods = buildTemplateModifications({
      address: "1 Main, Punta Gorda FL",
      selectedPackage: "just_listed",
      agentName: "Brian",
      brokerageName: "Compass",
    });
    expect(mods).not.toHaveProperty("Image-Headshot.source");
  });
});

// Owner feedback 2026-06: the rendered address must show NO zip code and must
// stay on ONE line (shrink to fit, never wrap).
describe("buildTemplateModifications — address display: no zip, one-line fit", () => {
  const ctx = {
    selectedPackage: "just_listed",
    agentName: "Brian",
    brokerageName: "Compass",
  };

  it("strips the zip from Text-Address and Full-Address-Final", () => {
    const mods = buildTemplateModifications({
      ...ctx,
      address: "5019 San Massimo Dr, Punta Gorda, FL 33950",
    });
    expect(mods["Text-Address.text"]).toBe("5019 San Massimo Dr, Punta Gorda, FL");
    expect(mods["Full-Address-Final.text"]).toBe(
      "5019 San Massimo Dr, Punta Gorda, FL",
    );
  });

  it("strips the zip from the City/State-Intro split line too", () => {
    const mods = buildTemplateModifications({
      ...ctx,
      address: "5019 San Massimo Dr, Punta Gorda, FL 33950",
    });
    expect(mods["St#/StName-Intro.text"]).toBe("5019 San Massimo Dr, Punta Gorda");
    expect(mods["City/State-Intro.text"]).toBe("FL");
  });

  it("emits auto-size + no-wrap (font_size: null, text_wrap: false) for long addresses", () => {
    const mods = buildTemplateModifications({
      ...ctx,
      // 36 chars after zip strip — the real prod failure case that wrapped.
      address: "5019 San Massimo Dr, Punta Gorda, FL 33950",
    });
    expect(mods["Text-Address.font_size"]).toBeNull();
    expect(mods["Text-Address.text_wrap"]).toBe(false);
    expect(mods["Full-Address-Final.font_size"]).toBeNull();
    expect(mods["Full-Address-Final.text_wrap"]).toBe(false);
  });

  it("omits the fit keys for short addresses (keeps the template's designed size)", () => {
    const mods = buildTemplateModifications({
      ...ctx,
      address: "1 Main, Punta Gorda FL", // 22 chars ≤ 28 threshold
    });
    expect(mods).not.toHaveProperty("Text-Address.font_size");
    expect(mods).not.toHaveProperty("Text-Address.text_wrap");
    expect(mods).not.toHaveProperty("Full-Address-Final.font_size");
    expect(mods).not.toHaveProperty("Full-Address-Final.text_wrap");
  });

  it("gates the fit on the DISPLAY length, not the raw address length", () => {
    // Raw is 31 chars, but after zip-strip it's 22 — under the threshold.
    const mods = buildTemplateModifications({
      ...ctx,
      address: "1 Main, Punta Gorda FL 33950",
    });
    expect(mods["Text-Address.text"]).toBe("1 Main, Punta Gorda FL");
    expect(mods).not.toHaveProperty("Text-Address.font_size");
    expect(mods).not.toHaveProperty("Text-Address.text_wrap");
  });
});
