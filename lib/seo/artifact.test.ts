import { describe, expect, it } from "vitest";
import { buildListingSeoArtifact, buildListingSeoMarkdown, buildListingSeoSchema } from "./artifact.js";
import { makeListingSeoSlug } from "./slug.js";
import type { ListingSeoSource } from "./types.js";

const source: ListingSeoSource = {
  property: {
    id: "prop-1",
    address: "5019 San Massimo Dr, Punta Gorda, FL 33950, USA",
    price: 725000,
    bedrooms: 3,
    bathrooms: 2,
    square_footage: 2140,
    listing_agent: "Avery Collins",
    brokerage: "Recasi Realty",
    horizontal_video_url: "https://cdn.example.com/5019-horizontal.mp4",
    vertical_video_url: "https://cdn.example.com/5019-vertical.mp4",
    created_at: "2026-06-01T12:00:00Z",
    updated_at: "2026-06-10T12:00:00Z",
  },
  preview: {
    id: "preview-1",
    token: "P78rHGXUN3nrc9d4iy5l60vfFPyhQeVl",
    kind: "public",
    expires_at: null,
    revoked_at: null,
    created_at: "2026-06-10T12:00:00Z",
  },
  client: {
    name: "Helgemo Team",
    agent_name: "Avery Collins",
    brokerage: "Recasi Realty",
    brand_logo_url: "https://cdn.example.com/logo.png",
    agent_headshot_url: "https://cdn.example.com/agent.jpg",
  },
  hero_photo_url: "https://cdn.example.com/5019-hero.jpg",
  photos: [
    {
      file_url: "https://cdn.example.com/kitchen.jpg",
      room_type: "kitchen",
      key_features: ["waterfall island", "open dining"],
      selected: true,
      quality_score: 0.98,
    },
    {
      file_url: "https://cdn.example.com/lanai.jpg",
      room_type: "lanai",
      key_features: ["screened pool", "water view"],
      selected: true,
      quality_score: 0.94,
    },
  ],
  canonical_url: "https://listingelevate.com/listings/5019-san-massimo-dr-punta-gorda-fl-33950-p78rhgxu",
  base_url: "https://listingelevate.com",
};

describe("listing SEO artifact", () => {
  it("builds stable listing slugs from address and preview token", () => {
    expect(makeListingSeoSlug(source.property.address, source.preview.token)).toBe(
      "5019-san-massimo-dr-punta-gorda-fl-33950-p78rhgxu",
    );
  });

  it("builds a deterministic artifact with facts, highlights, FAQ, and fingerprint", () => {
    const artifact = buildListingSeoArtifact(source);

    expect(artifact.slug).toBe("5019-san-massimo-dr-punta-gorda-fl-33950-p78rhgxu");
    expect(artifact.title).toBe("5019 San Massimo Dr | Punta Gorda Listing Film");
    expect(artifact.meta_description).toContain("3 bed");
    expect(artifact.meta_description).toContain("2 bath");
    expect(artifact.highlights).toEqual([
      "3 bedrooms",
      "2 bathrooms",
      "2,140 sq ft",
      "$725,000",
      "waterfall island",
      "screened pool",
    ]);
    expect(artifact.faqs).toEqual([
      {
        question: "Where is 5019 San Massimo Dr located?",
        answer: "5019 San Massimo Dr is in Punta Gorda, FL 33950.",
      },
      {
        question: "Who is the listing agent for 5019 San Massimo Dr?",
        answer: "Avery Collins represents this listing with Recasi Realty.",
      },
      {
        question: "Is there a listing video for 5019 San Massimo Dr?",
        answer: "Yes. The Listing Elevate film highlights spaces including kitchen and lanai.",
      },
    ]);
    expect(artifact.source_fingerprint).toMatch(/^[a-f0-9]{16}$/);
  });

  it("builds aligned schema graph and LLM markdown", () => {
    const artifact = buildListingSeoArtifact(source);
    const schema = buildListingSeoSchema(source, artifact);
    const markdown = buildListingSeoMarkdown(source, artifact);

    expect(schema["@context"]).toBe("https://schema.org");
    expect(schema["@graph"].map((node) => node["@type"])).toEqual([
      "RealEstateListing",
      "House",
      "Offer",
      "VideoObject",
      "FAQPage",
    ]);
    expect(markdown).toContain("# 5019 San Massimo Dr");
    expect(markdown).toContain("- Price: $725,000");
    expect(markdown).toContain("- waterfall island");
    expect(markdown).toContain("## Q&A");
    expect(markdown).not.toMatch(/<script/i);
  });
});
