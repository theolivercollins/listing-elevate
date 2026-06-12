import { describe, it, expect } from "vitest";
import { buildCreatomateTimeline } from "../creatomate.js";
import type { AssembleVideoParams } from "../shotstack.js";

function baseParams(extra: Partial<AssembleVideoParams> = {}): AssembleVideoParams {
  return {
    clips: [
      { url: "https://cdn/a.mp4", durationSeconds: 5 },
      { url: "https://cdn/b.mp4", durationSeconds: 5 },
    ],
    overlays: {
      address: "42 Maple Street",
      price: "$750,000",
      details: "4 BD | 3 BA",
      agent: "Jane Doe",
      brokerage: "Acme Realty",
    },
    aspectRatio: "16:9",
    ...extra,
  };
}

describe("buildCreatomateTimeline audio tracks", () => {
  it("emits a voiceover audio element on track 6 at full volume", () => {
    const script = buildCreatomateTimeline(
      baseParams({ voiceover: { url: "https://cdn/vo.mp3" } }),
    );
    const audio = script.elements.filter((e) => e.type === "audio");
    const vo = audio.find((e) => e.track === 6);
    expect(vo).toBeDefined();
    expect(vo?.source).toBe("https://cdn/vo.mp3");
    expect(vo?.volume).toBe("100%");
  });

  it("ducks music to track 5 and keeps voiceover above it", () => {
    const script = buildCreatomateTimeline(
      baseParams({
        music: { url: "https://cdn/music.mp3" },
        voiceover: { url: "https://cdn/vo.mp3" },
      }),
    );
    const music = script.elements.find((e) => e.type === "audio" && e.track === 5);
    const vo = script.elements.find((e) => e.type === "audio" && e.track === 6);
    expect(music?.source).toBe("https://cdn/music.mp3");
    expect(music?.volume).toBe("18%");
    expect(vo?.source).toBe("https://cdn/vo.mp3");
  });

  it("omits the voiceover element when no narration is supplied", () => {
    const script = buildCreatomateTimeline(baseParams());
    expect(script.elements.some((e) => e.type === "audio" && e.track === 6)).toBe(false);
  });

  it("omits frame_rate so output follows the source clips' fps (no 24->30 resample)", () => {
    // 2026-06-11 assembly-quality diagnosis: AI source clips are 24fps;
    // Creatomate's default (no frame_rate) is the highest input fps.
    const script = buildCreatomateTimeline(baseParams());
    expect("frame_rate" in script).toBe(false);
  });
});
