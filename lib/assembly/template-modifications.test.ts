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
  it("writes the 5 known text fields with split address + mapped category", () => {
    const mods = buildTemplateModifications({
      address: "123 Waymay Dr, Punta Gorda FL",
      selectedPackage: "just_listed",
      agentName: "Brian Helgemo",
      brokerageName: "Compass",
    });
    expect(mods).toMatchObject({
      "St#/StName.text": "123 Waymay Dr",
      "St#/StName-JSJ.text": "Punta Gorda FL",
      "Vid-Category/Title.text": "Just Listed",
      // Agent + brokerage combined into one centered line
      "Listing-Agent.text": "Brian Helgemo | Compass",
      "Listing-Agent-NWH.text": "",
    });
  });

  it("falls back to agent name only when brokerage is null", () => {
    const mods = buildTemplateModifications({
      address: "1 Main, Punta Gorda FL",
      selectedPackage: "just_listed",
      agentName: "Brian",
      brokerageName: null,
    });
    expect(mods["Listing-Agent.text"]).toBe("Brian");
    expect(mods["Listing-Agent-NWH.text"]).toBe("");
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

  it("writes LogoImage.source + MusicTrack.source when provided", () => {
    const mods = buildTemplateModifications({
      address: "1 Main, Punta Gorda FL",
      selectedPackage: "just_listed",
      agentName: "Brian",
      brokerageName: "Compass",
      logoUrl: "https://logos/co.png",
      musicUrl: "https://audio/track.mp3",
    });
    expect(mods["LogoImage.source"]).toBe("https://logos/co.png");
    expect(mods["MusicTrack.source"]).toBe("https://audio/track.mp3");
  });

  it("does not pollute output with logo/music keys when not provided", () => {
    const mods = buildTemplateModifications({
      address: "1 Main, Punta Gorda FL",
      selectedPackage: "just_listed",
      agentName: "Brian",
      brokerageName: "Compass",
    });
    expect(mods).not.toHaveProperty("LogoImage.source");
    expect(mods).not.toHaveProperty("MusicTrack.source");
  });
});
