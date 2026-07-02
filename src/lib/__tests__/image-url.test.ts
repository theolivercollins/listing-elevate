import { describe, it, expect } from "vitest";
import { photoUrl, photoThumb, photoGrid, bunnyPosterUrl } from "../image-url";

// Real project ref (vrhmaeywqsohlztoouxu) — verified working transform on the
// property-photos bucket: 1046 KB original -> 17 KB at
// ?width=400&quality=70&resize=contain (HTTP 200).
const PUBLIC_URL =
  "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-photos/123/photo1.jpg";
const RENDER_BASE =
  "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/render/image/public/property-photos/123/photo1.jpg";

describe("photoUrl — passthrough cases", () => {
  it("returns an empty string unchanged", () => {
    expect(photoUrl("")).toBe("");
  });

  it("returns null/undefined unchanged (nullable DB fields at runtime)", () => {
    expect(photoUrl(null as unknown as string)).toBe(null);
    expect(photoUrl(undefined as unknown as string)).toBe(undefined);
  });

  it("returns a blob: URL unchanged", () => {
    const blob = "blob:http://localhost:8080/9f1c1e2a-1234-4a5b-9c6d-abcde1234567";
    expect(photoUrl(blob)).toBe(blob);
  });

  it("returns a data: URL unchanged", () => {
    const data = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    expect(photoUrl(data)).toBe(data);
  });

  it("returns an already-transformed /render/image/ URL unchanged (idempotent)", () => {
    const rendered = `${RENDER_BASE}?width=400&quality=70&resize=contain`;
    expect(photoUrl(rendered)).toBe(rendered);
    // Calling it again through a preset must also be a no-op.
    expect(photoThumb(rendered)).toBe(rendered);
  });

  it("returns a non-Supabase URL unchanged", () => {
    const external = "https://cdn.example.com/photos/house.jpg";
    expect(photoUrl(external)).toBe(external);
  });
});

describe("photoUrl — rewrite for Supabase public-object URLs", () => {
  it("rewrites /object/public/ -> /render/image/public/ with default quality/resize", () => {
    const result = photoUrl(PUBLIC_URL, { width: 400 });
    expect(result).toBe(`${RENDER_BASE}?width=400&quality=70&resize=contain`);
  });

  it("omits width/height from the query when not provided", () => {
    const result = photoUrl(PUBLIC_URL);
    expect(result).toBe(`${RENDER_BASE}?quality=70&resize=contain`);
    expect(result).not.toContain("width=");
    expect(result).not.toContain("height=");
  });

  it("includes height and a custom resize mode when given", () => {
    const result = photoUrl(PUBLIC_URL, { width: 800, height: 600, quality: 85, resize: "cover" });
    expect(result).toBe(`${RENDER_BASE}?width=800&height=600&quality=85&resize=cover`);
  });
});

describe("photoThumb / photoGrid presets", () => {
  it("photoThumb applies width=400&quality=70&resize=contain", () => {
    expect(photoThumb(PUBLIC_URL)).toBe(`${RENDER_BASE}?width=400&quality=70&resize=contain`);
  });

  it("photoGrid applies width=600&quality=75&resize=contain", () => {
    expect(photoGrid(PUBLIC_URL)).toBe(`${RENDER_BASE}?width=600&quality=75&resize=contain`);
  });

  it("presets pass through non-Supabase URLs unchanged, same as photoUrl", () => {
    const external = "https://cdn.example.com/photos/house.jpg";
    expect(photoThumb(external)).toBe(external);
    expect(photoGrid(external)).toBe(external);
  });
});

describe("bunnyPosterUrl — host-checked poster derivation", () => {
  const BUNNY_MP4 =
    "https://vz-abc123.b-cdn.net/6f0e1d2c-3b4a-5c6d-7e8f-90a1b2c3d4e5/play_720p.mp4";
  const BUNNY_THUMB =
    "https://vz-abc123.b-cdn.net/6f0e1d2c-3b4a-5c6d-7e8f-90a1b2c3d4e5/thumbnail.jpg";

  it("swaps the final segment for thumbnail.jpg on a Bunny play_*.mp4 URL", () => {
    expect(bunnyPosterUrl(BUNNY_MP4)).toBe(BUNNY_THUMB);
  });

  it("returns null for a NON-Bunny host, even with a play_*.mp4 shape (the bug the host check fixes)", () => {
    expect(
      bunnyPosterUrl("https://cdn.example.com/6f0e1d2c/play_720p.mp4"),
    ).toBe(null);
  });

  it("returns null for nullish input", () => {
    expect(bunnyPosterUrl(null)).toBe(null);
    expect(bunnyPosterUrl(undefined)).toBe(null);
    expect(bunnyPosterUrl("")).toBe(null);
  });

  it("returns null for a Bunny URL without a <guid>/<segment> shape", () => {
    expect(bunnyPosterUrl("https://vz-abc123.b-cdn.net/play_720p.mp4")).toBe(null);
  });

  it("returns null for a malformed URL", () => {
    expect(bunnyPosterUrl("not a url")).toBe(null);
  });

  it("preserves a query string (e.g. a Bunny auth token) on the derived thumbnail", () => {
    expect(bunnyPosterUrl(`${BUNNY_MP4}?token=abc123&expires=99`)).toBe(
      `${BUNNY_THUMB}?token=abc123&expires=99`,
    );
  });

  it("rejects a look-alike host that only ends in the suffix without the dot boundary", () => {
    expect(
      bunnyPosterUrl("https://evilb-cdn.net/6f0e1d2c/play_720p.mp4"),
    ).toBe(null);
  });
});
