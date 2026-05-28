/**
 * shotstack-concat.test.ts
 *
 * Unit tests for buildShotstackConcatTimeline — the plain clip-concatenation
 * timeline used by the Prompt Lab "Create Video" assembly path. It must:
 *   - place clips sequentially with start/length = "auto"
 *   - put all clips on a single track (no overlay track → no text)
 *   - emit no title/music assets
 *   - honor the requested aspect ratio
 */

import { describe, it, expect } from "vitest";
import { buildShotstackConcatTimeline } from "../shotstack.js";

const CLIPS = [
  "https://cdn.example.com/a.mp4",
  "https://cdn.example.com/b.mp4",
  "https://cdn.example.com/c.mp4",
];

describe("buildShotstackConcatTimeline", () => {
  it("creates a single track containing one video clip per URL, in order", () => {
    const payload = buildShotstackConcatTimeline(CLIPS);
    expect(payload.timeline.tracks).toHaveLength(1);

    const clips = payload.timeline.tracks[0].clips;
    expect(clips).toHaveLength(3);
    expect(clips.map((c) => (c.asset as { src: string }).src)).toEqual(CLIPS);
  });

  it("uses start='auto' and length='auto' so Shotstack sequences the clips", () => {
    const payload = buildShotstackConcatTimeline(CLIPS);
    for (const clip of payload.timeline.tracks[0].clips) {
      expect(clip.start).toBe("auto");
      expect(clip.length).toBe("auto");
    }
  });

  it("emits only video assets (no title/html overlays, no music)", () => {
    const payload = buildShotstackConcatTimeline(CLIPS);
    const allClips = payload.timeline.tracks.flatMap((t) => t.clips);
    expect(allClips.every((c) => (c.asset as { type: string }).type === "video")).toBe(true);
  });

  it("defaults to 16:9 and 1080 mp4 output", () => {
    const payload = buildShotstackConcatTimeline(CLIPS);
    expect(payload.output.aspectRatio).toBe("16:9");
    expect(payload.output.format).toBe("mp4");
    expect(payload.output.resolution).toBe("1080");
  });

  it("honors a 9:16 aspect ratio", () => {
    const payload = buildShotstackConcatTimeline(CLIPS, "9:16");
    expect(payload.output.aspectRatio).toBe("9:16");
  });

  it("throws on an empty clip list", () => {
    expect(() => buildShotstackConcatTimeline([])).toThrow(/empty/i);
  });
});
