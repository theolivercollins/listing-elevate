/**
 * Tests for lib/gen2-v21/photo-source.ts
 *
 * Mocks the Supabase client used by getPhotosForV21Listing and verifies:
 *   1. Properties hit: returns rows from `photos` when property_id matches.
 *   2. Lab fallback: returns rows from `prompt_lab_listing_photos` when `photos` is empty.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Shared mock state ──────────────────────────────────────────────────────────

let mockPhotosRows: Array<{ id: string; file_url: string }> = [];
let mockLabRows: Array<{ id: string; image_url: string }> = [];
let photosError: { message: string } | null = null;
let labError: { message: string } | null = null;

function makeChain(rows: unknown[], error: { message: string } | null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    in: () => chain,
    then: (resolve: (res: { data: unknown; error: unknown }) => void) => {
      resolve({ data: error ? null : rows, error: error ?? null });
    },
  };
  return chain;
}

vi.mock("../db.js", () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table === "photos") return makeChain(mockPhotosRows, photosError);
      if (table === "prompt_lab_listing_photos") return makeChain(mockLabRows, labError);
      return makeChain([], null);
    },
  }),
}));

// Import AFTER the mock is set up
const { getPhotosForV21Listing } = await import("./photo-source.js");

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("getPhotosForV21Listing", () => {
  beforeEach(() => {
    mockPhotosRows = [];
    mockLabRows = [];
    photosError = null;
    labError = null;
  });

  it("returns property photos when photos table has rows", async () => {
    mockPhotosRows = [
      { id: "photo-1", file_url: "https://cdn.example.com/photo1.jpg" },
      { id: "photo-2", file_url: "https://cdn.example.com/photo2.jpg" },
    ];

    const result = await getPhotosForV21Listing("property-abc");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: "photo-1", url: "https://cdn.example.com/photo1.jpg" });
    expect(result[1]).toEqual({ id: "photo-2", url: "https://cdn.example.com/photo2.jpg" });
  });

  it("falls back to prompt_lab_listing_photos when photos is empty", async () => {
    mockPhotosRows = [];
    mockLabRows = [
      { id: "lab-photo-1", image_url: "https://storage.example.com/lab1.jpg" },
      { id: "lab-photo-2", image_url: "https://storage.example.com/lab2.jpg" },
      { id: "lab-photo-3", image_url: "https://storage.example.com/lab3.jpg" },
    ];

    const result = await getPhotosForV21Listing("434577b1-lab-listing");

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ id: "lab-photo-1", url: "https://storage.example.com/lab1.jpg" });
    expect(result[2]).toEqual({ id: "lab-photo-3", url: "https://storage.example.com/lab3.jpg" });
  });

  it("returns empty array when both sources are empty", async () => {
    mockPhotosRows = [];
    mockLabRows = [];

    const result = await getPhotosForV21Listing("unknown-listing-id");

    expect(result).toHaveLength(0);
  });

  it("falls back to lab source when photos query errors", async () => {
    photosError = { message: "relation does not exist" };
    mockLabRows = [{ id: "lab-x", image_url: "https://storage.example.com/x.jpg" }];

    const result = await getPhotosForV21Listing("lab-only-listing");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: "lab-x", url: "https://storage.example.com/x.jpg" });
  });
});
