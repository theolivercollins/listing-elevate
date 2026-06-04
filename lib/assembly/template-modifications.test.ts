import { describe, it, expect } from "vitest";
import {
  buildTemplateModifications,
  categoryLabelForPackage,
  splitAddress,
} from "./template-modifications.js";

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
