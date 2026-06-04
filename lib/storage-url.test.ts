import { describe, it, expect } from "vitest";
import { ensureAbsolutePhotoUrl } from "./storage-url.js";

describe("ensureAbsolutePhotoUrl", () => {
  const pub = (path: string) =>
    `https://x.supabase.co/storage/v1/object/public/property-photos/${path}`;

  it("passes absolute http(s) URLs through unchanged", () => {
    const url = "https://x.supabase.co/storage/v1/object/public/property-photos/a/raw/p.jpg";
    expect(ensureAbsolutePhotoUrl(url, pub)).toBe(url);
    expect(ensureAbsolutePhotoUrl("http://example.com/a.jpg", pub)).toBe("http://example.com/a.jpg");
  });

  it("converts a bare storage path to a public URL (the 8bd86c4f bug)", () => {
    expect(ensureAbsolutePhotoUrl("ae22add0/raw/p.jpg", pub)).toBe(pub("ae22add0/raw/p.jpg"));
  });

  it("strips a leading slash and an accidental bucket prefix before resolving", () => {
    expect(ensureAbsolutePhotoUrl("/ae22add0/raw/p.jpg", pub)).toBe(pub("ae22add0/raw/p.jpg"));
    expect(ensureAbsolutePhotoUrl("property-photos/ae22add0/raw/p.jpg", pub)).toBe(
      pub("ae22add0/raw/p.jpg"),
    );
  });

  it("returns empty/falsy input unchanged (no spurious URL)", () => {
    expect(ensureAbsolutePhotoUrl("", pub)).toBe("");
  });
});
