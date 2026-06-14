/**
 * scripts/bunny-rehost-backfill.test.ts
 *
 * Tests for the backfill script's isProviderUrl helper and Supabase query
 * column usage.
 *
 * Critical regression guard: the scenes table has NO updated_at column
 * (verified live against prod vrhmaeywqsohlztoouxu). The backfill MUST query
 * scenes on submitted_at — using updated_at causes PostgREST 42703 and
 * process.exit(1) before any row is backfilled.
 *
 * These tests verify:
 *   1. isProviderUrl correctly identifies provider vs CDN/storage URLs
 *   2. The Supabase scenes query selects submitted_at (not updated_at)
 *   3. The Supabase scenes query filters on submitted_at (not updated_at)
 *   4. The Supabase scene_variants query uses updated_at (which DOES exist)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isProviderUrl } from "./bunny-rehost-backfill.js";

// ---------------------------------------------------------------------------
// isProviderUrl
// ---------------------------------------------------------------------------

describe("isProviderUrl", () => {
  beforeEach(() => {
    process.env.BUNNY_STREAM_CDN_HOSTNAME = "vz-01cb8232-b48.b-cdn.net";
  });

  afterEach(() => {
    delete process.env.BUNNY_STREAM_CDN_HOSTNAME;
  });

  it("returns true for a Kling signed URL (klingai.com)", () => {
    expect(
      isProviderUrl("https://klingai.com/api/works/abc123/video?sig=xxx"),
    ).toBe(true);
  });

  it("returns true for an Atlas/Aliyun URL (aliyuncs.com)", () => {
    expect(
      isProviderUrl(
        "https://klingai-public.oss-cn-beijing.aliyuncs.com/video.mp4",
      ),
    ).toBe(true);
  });

  it("returns false for a Bunny CDN URL matching BUNNY_STREAM_CDN_HOSTNAME", () => {
    expect(
      isProviderUrl(
        "https://vz-01cb8232-b48.b-cdn.net/some-guid/play_1080p.mp4",
      ),
    ).toBe(false);
  });

  it("returns false for a Supabase Storage URL (.supabase.co)", () => {
    expect(
      isProviderUrl(
        "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/clips/video.mp4",
      ),
    ).toBe(false);
  });

  it("returns false for a Supabase legacy URL (.supabase.in)", () => {
    expect(
      isProviderUrl(
        "https://vrhmaeywqsohlztoouxu.supabase.in/storage/v1/object/public/clips/video.mp4",
      ),
    ).toBe(false);
  });

  it("returns false for a malformed URL (no throw)", () => {
    expect(() => isProviderUrl("not-a-url")).not.toThrow();
    expect(isProviderUrl("not-a-url")).toBe(false);
  });

  it("returns false for an empty string (no throw)", () => {
    expect(isProviderUrl("")).toBe(false);
  });

  it("returns true when BUNNY_STREAM_CDN_HOSTNAME is unset (no CDN hostname to match)", () => {
    delete process.env.BUNNY_STREAM_CDN_HOSTNAME;
    // Without a configured CDN hostname, cannot exclude any b-cdn.net URL
    // — all URLs are considered provider URLs (conservative / safe for backfill)
    expect(
      isProviderUrl(
        "https://vz-01cb8232-b48.b-cdn.net/some-guid/play_1080p.mp4",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Supabase query column guard
//
// The scenes table has no updated_at column (PostgREST 42703 if used).
// We mock the supabase-js chain and assert that:
//   - scenes queries use submitted_at in both select() and gte()
//   - scene_variants queries use updated_at (it DOES have that column)
// ---------------------------------------------------------------------------

describe("Supabase query column guard", () => {
  it("scenes query selects submitted_at, not updated_at", async () => {
    // Read the compiled source to verify the correct column name is referenced.
    // This is a static verification: we grep the TypeScript source for the
    // scenes .select() and .gte() calls and assert the column used.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const __filename = fileURLToPath(import.meta.url);
    const src = readFileSync(
      join(dirname(__filename), "bunny-rehost-backfill.ts"),
      "utf8",
    );

    // The scenes .select() must include submitted_at, NOT updated_at
    const scenesSelectMatch = src.match(
      /\.from\("scenes"\)[\s\S]*?\.select\("([^"]+)"\)/,
    );
    expect(scenesSelectMatch, "scenes .select() call not found").toBeTruthy();
    const scenesSelectCols = scenesSelectMatch![1];
    expect(
      scenesSelectCols,
      `scenes .select() must include submitted_at — got: "${scenesSelectCols}"`,
    ).toContain("submitted_at");
    expect(
      scenesSelectCols,
      `scenes .select() must NOT include updated_at (column does not exist on prod scenes table)`,
    ).not.toContain("updated_at");

    // The scenes .gte() must filter on submitted_at, NOT updated_at
    const scenesGteMatch = src.match(
      /\.from\("scenes"\)[\s\S]*?\.gte\("([^"]+)"/,
    );
    expect(scenesGteMatch, "scenes .gte() call not found").toBeTruthy();
    const scenesGteCol = scenesGteMatch![1];
    expect(
      scenesGteCol,
      `scenes .gte() must use submitted_at — got: "${scenesGteCol}"`,
    ).toBe("submitted_at");
  });

  it("scene_variants query selects updated_at (column exists on that table)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const __filename = fileURLToPath(import.meta.url);
    const src = readFileSync(
      join(dirname(__filename), "bunny-rehost-backfill.ts"),
      "utf8",
    );

    // scene_variants DOES have updated_at — make sure we still use it there
    const variantsSelectMatch = src.match(
      /\.from\("scene_variants"\)[\s\S]*?\.select\("([^"]+)"\)/,
    );
    expect(variantsSelectMatch, "scene_variants .select() call not found").toBeTruthy();
    const variantsSelectCols = variantsSelectMatch![1];
    expect(
      variantsSelectCols,
      `scene_variants .select() must include updated_at — got: "${variantsSelectCols}"`,
    ).toContain("updated_at");

    const variantsGteMatch = src.match(
      /\.from\("scene_variants"\)[\s\S]*?\.gte\("([^"]+)"/,
    );
    expect(variantsGteMatch, "scene_variants .gte() call not found").toBeTruthy();
    const variantsGteCol = variantsGteMatch![1];
    expect(
      variantsGteCol,
      `scene_variants .gte() must use updated_at — got: "${variantsGteCol}"`,
    ).toBe("updated_at");
  });
});
