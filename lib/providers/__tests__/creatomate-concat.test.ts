/**
 * creatomate-concat.test.ts
 *
 * buildCreatomateConcatScript is the Prompt Lab "Create Video" assembly
 * builder. It must concatenate clips with no overlays/music, relying on
 * Creatomate auto-timing (sequential on a shared track, source-length per
 * clip, null composition duration → auto-fit).
 */

import { describe, it, expect } from "vitest";
import { buildCreatomateConcatScript } from "../creatomate.js";

const CLIPS = [
  "https://cdn.example.com/a.mp4",
  "https://cdn.example.com/b.mp4",
  "https://cdn.example.com/c.mp4",
];

describe("buildCreatomateConcatScript", () => {
  it("creates one video element per clip on a shared track, in order", () => {
    const s = buildCreatomateConcatScript(CLIPS);
    expect(s.elements).toHaveLength(3);
    expect(s.elements.map((e) => e.source)).toEqual(CLIPS);
    expect(s.elements.every((e) => e.type === "video")).toBe(true);
    expect(new Set(s.elements.map((e) => e.track))).toEqual(new Set([1]));
  });

  it("omits per-clip time and duration so clips auto-sequence at source length", () => {
    const s = buildCreatomateConcatScript(CLIPS);
    for (const e of s.elements) {
      expect(e.time).toBeUndefined();
      expect(e.duration).toBeUndefined();
    }
  });

  it("sets composition duration to null (auto-fit) and mp4 output", () => {
    const s = buildCreatomateConcatScript(CLIPS);
    expect(s.duration).toBeNull();
    expect(s.output_format).toBe("mp4");
  });

  it("emits no text/audio/image elements (no overlays, no music)", () => {
    const s = buildCreatomateConcatScript(CLIPS);
    const hasOverlayOrAudio = s.elements.some(
      (e) => e.type === "text" || e.type === "audio" || e.type === "image",
    );
    expect(hasOverlayOrAudio).toBe(false);
  });

  it("defaults to 1920x1080 and supports 9:16", () => {
    expect(buildCreatomateConcatScript(CLIPS)).toMatchObject({ width: 1920, height: 1080 });
    expect(buildCreatomateConcatScript(CLIPS, "9:16")).toMatchObject({ width: 1080, height: 1920 });
  });

  it("throws on an empty clip list", () => {
    expect(() => buildCreatomateConcatScript([])).toThrow(/empty/i);
  });

  it("emits no audio by default (backward compatible)", () => {
    const s = buildCreatomateConcatScript(CLIPS);
    expect(s.elements.some((e) => e.type === "audio")).toBe(false);
  });

  it("omits frame_rate so output follows the source clips' fps (no 24->30 resample)", () => {
    // 2026-06-11 assembly-quality diagnosis: AI source clips are 24fps;
    // Creatomate's default (no frame_rate) is the highest input fps.
    const s = buildCreatomateConcatScript(CLIPS);
    expect("frame_rate" in s).toBe(false);
  });
});

describe("buildCreatomateConcatScript audio (WI-2)", () => {
  it("adds a ducked music track on track 5 when music is supplied", () => {
    const s = buildCreatomateConcatScript(CLIPS, "16:9", {
      music: { url: "https://cdn/music.mp3" },
    });
    const music = s.elements.find((e) => e.type === "audio" && e.track === 5);
    expect(music?.source).toBe("https://cdn/music.mp3");
    expect(music?.volume).toBe("18%");
    expect(music?.duration).toBeUndefined(); // untrimmed when no totalDurationSeconds
  });

  it("trims the music to totalDurationSeconds when provided", () => {
    const s = buildCreatomateConcatScript(CLIPS, "16:9", {
      music: { url: "https://cdn/music.mp3" },
      totalDurationSeconds: 25,
    });
    const music = s.elements.find((e) => e.type === "audio" && e.track === 5);
    expect(music?.duration).toBe(25);
  });

  it("adds a full-volume voiceover on track 6 above the music", () => {
    const s = buildCreatomateConcatScript(CLIPS, "16:9", {
      music: { url: "https://cdn/m.mp3" },
      voiceover: { url: "https://cdn/vo.mp3" },
    });
    const vo = s.elements.find((e) => e.type === "audio" && e.track === 6);
    expect(vo?.source).toBe("https://cdn/vo.mp3");
    expect(vo?.volume).toBe("100%");
  });
});
