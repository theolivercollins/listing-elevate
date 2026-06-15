import { describe, expect, it } from "vitest";
import {
  fetchListingSeoArtifactByPropertyId,
  fetchPublicListingSeoArtifactBySlug,
  listPublicListingSeoArtifacts,
} from "./repository";

function makeDb(preview: { kind: string; expires_at: string | null; revoked_at: string | null }) {
  const artifact = {
    id: "seo-1",
    property_id: "prop-1",
    preview_id: "preview-1",
    slug: "listing-slug",
    status: "generated",
    indexable: true,
    updated_at: "2026-06-14T12:00:00Z",
  };
  return {
    from(table: string) {
      if (table === "ai_seo_artifacts") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: artifact, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "property_previews") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "preview-1",
                  token: "token",
                  created_at: "2026-06-14T12:00:00Z",
                  ...preview,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

describe("fetchListingSeoArtifactByPropertyId", () => {
  it("downgrades effective indexability when the linked preview is revoked", async () => {
    const artifact = await fetchListingSeoArtifactByPropertyId(
      makeDb({ kind: "public", expires_at: null, revoked_at: "2026-06-15T12:00:00Z" }) as never,
      "prop-1",
    );

    expect(artifact?.indexable).toBe(false);
  });

  it("keeps effective indexability when the linked preview is active and public", async () => {
    const artifact = await fetchListingSeoArtifactByPropertyId(
      makeDb({ kind: "public", expires_at: null, revoked_at: null }) as never,
      "prop-1",
    );

    expect(artifact?.indexable).toBe(true);
  });

  it("returns null instead of throwing when the artifact table is not migrated yet", async () => {
    const db = {
      from(table: string) {
        if (table !== "ai_seo_artifacts") throw new Error(`unexpected table: ${table}`);
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: { code: "42P01", message: "relation ai_seo_artifacts does not exist" } }),
                }),
              }),
            }),
          }),
        };
      },
    };

    await expect(fetchListingSeoArtifactByPropertyId(db as never, "prop-1")).resolves.toBeNull();
  });
});

function makeFallbackDb() {
  const preview = {
    id: "preview-1",
    property_id: "prop-1",
    token: "P78rHGXUN3nrc9d4iy5l60vfFPyhQeVl",
    kind: "public",
    expires_at: null,
    revoked_at: null,
    created_at: "2026-06-14T12:00:00Z",
  };
  const property = {
    id: "prop-1",
    address: "5019 San Massimo Dr, Punta Gorda, FL 33950, USA",
    price: 725000,
    bedrooms: 3,
    bathrooms: 2,
    square_footage: 2140,
    listing_agent: "Avery Collins",
    brokerage: "Recasi Realty",
    horizontal_video_url: "https://cdn.example.com/h.mp4",
    vertical_video_url: null,
    client_id: null,
    created_at: "2026-06-01T12:00:00Z",
    updated_at: "2026-06-10T12:00:00Z",
  };
  return {
    from(table: string) {
      if (table === "ai_seo_artifacts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: { code: "42P01", message: "relation ai_seo_artifacts does not exist" } }),
                }),
                order: () => ({
                  limit: async () => ({ data: null, error: { code: "42P01", message: "relation ai_seo_artifacts does not exist" } }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "property_previews") {
        return {
          select: () => ({
            ilike: () => ({
              eq: () => ({
                order: () => ({
                  limit: async () => ({ data: [preview], error: null }),
                }),
              }),
            }),
            eq: () => ({
              order: () => ({
                limit: async () => ({ data: [preview], error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "properties") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: property, error: null }),
            }),
          }),
        };
      }
      if (table === "photos") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                order: () => ({
                  limit: async () => ({
                    data: [{ file_url: "https://cdn.example.com/kitchen.jpg", room_type: "kitchen", key_features: ["waterfall island"], selected: true, quality_score: 0.98 }],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "clients") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

describe("stateless fallback", () => {
  it("renders a public artifact from preview data when the artifact table is not migrated", async () => {
    const artifact = await fetchPublicListingSeoArtifactBySlug(
      makeFallbackDb() as never,
      "5019-san-massimo-dr-punta-gorda-fl-33950-p78rhgxu",
    );

    expect(artifact?.id).toBe("stateless:preview-1");
    expect(artifact?.slug).toBe("5019-san-massimo-dr-punta-gorda-fl-33950-p78rhgxu");
    expect(artifact?.generated_by).toBe("deterministic");
  });

  it("lists stateless public artifacts for sitemap and llms.txt when the artifact table is not migrated", async () => {
    const rows = await listPublicListingSeoArtifacts(makeFallbackDb() as never);

    expect(rows).toHaveLength(1);
    expect(rows[0].slug).toBe("5019-san-massimo-dr-punta-gorda-fl-33950-p78rhgxu");
  });
});
