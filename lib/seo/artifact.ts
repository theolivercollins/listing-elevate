import { makeListingSeoSlug } from "./slug.js";
import type {
  ListingSeoArtifact,
  ListingSeoFaq,
  ListingSeoSchemaGraph,
  ListingSeoSource,
} from "./types.js";

const PROMPT_VERSION = "ai-seo-v1";

interface AddressParts {
  street: string;
  locality: string;
  region: string;
  postalCode: string;
  localityLine: string;
}

function clean(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function parseAddress(address: string): AddressParts {
  const withoutUsa = clean(address).replace(/,\s*USA$/i, "");
  const parts = withoutUsa.split(",").map((part) => part.trim()).filter(Boolean);
  const street = parts[0] ?? withoutUsa;
  const city = parts[1] ?? "";
  const stateZip = parts[2] ?? "";
  const stateZipMatch = /^([A-Za-z]{2})\s+(.+)$/.exec(stateZip);
  const region = stateZipMatch?.[1] ?? "";
  const postalCode = stateZipMatch?.[2] ?? "";
  const localityLine = [city, [region, postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return {
    street,
    locality: city,
    region,
    postalCode,
    localityLine,
  };
}

function formatUsd(value: number | null | undefined): string | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function formatNumber(value: number | null | undefined): string | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.round(value).toLocaleString("en-US");
}

function plural(value: number | null | undefined, singular: string, pluralLabel = `${singular}s`): string | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  const label = value === 1 ? singular : pluralLabel;
  return `${value.toLocaleString("en-US")} ${label}`;
}

function finishSentence(text: string): string {
  const body = clean(text)
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([.!?]){2,}$/g, "$1")
    .replace(/[.,;:]+$/g, "")
    .replace(/\b(?:and|or|with|including)\s*$/i, "")
    .replace(/[.,;:]+$/g, "")
    .trim();
  if (!body) return "";
  return /[.!?]$/.test(body) ? body : `${body}.`;
}

function trimSentence(text: string, maxLength: number): string {
  const compact = clean(text);
  if (compact.length <= maxLength) return finishSentence(compact);
  const truncated = compact.slice(0, maxLength - 1);
  const lastSpace = truncated.lastIndexOf(" ");
  return finishSentence(truncated.slice(0, lastSpace > 80 ? lastSpace : truncated.length));
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = clean(raw);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function roomLabel(roomType: string | null | undefined): string | null {
  const value = clean(roomType);
  if (!value) return null;
  return value.replace(/_/g, " ");
}

function collectFeatureHighlights(source: ListingSeoSource): string[] {
  const selected = [...source.photos].sort((a, b) => {
    const selectedDelta = Number(Boolean(b.selected)) - Number(Boolean(a.selected));
    if (selectedDelta !== 0) return selectedDelta;
    return (b.quality_score ?? 0) - (a.quality_score ?? 0);
  });
  return uniqueStrings(selected.flatMap((photo) => photo.key_features ?? [])).slice(0, 6);
}

function collectPrimaryFeatureHighlights(source: ListingSeoSource): string[] {
  const selected = [...source.photos].sort((a, b) => {
    const selectedDelta = Number(Boolean(b.selected)) - Number(Boolean(a.selected));
    if (selectedDelta !== 0) return selectedDelta;
    return (b.quality_score ?? 0) - (a.quality_score ?? 0);
  });
  return uniqueStrings(selected.map((photo) => photo.key_features?.[0])).slice(0, 4);
}

function listingAgent(source: ListingSeoSource): string | null {
  return clean(source.client?.agent_name) || clean(source.property.listing_agent) || null;
}

function brokerage(source: ListingSeoSource): string | null {
  return clean(source.client?.brokerage) || clean(source.property.brokerage) || null;
}

function activePublicPreview(source: ListingSeoSource): boolean {
  if (source.preview.kind !== "public") return false;
  if (source.preview.revoked_at) return false;
  if (source.preview.expires_at && new Date(source.preview.expires_at) < new Date()) return false;
  return true;
}

function fingerprint(source: ListingSeoSource): string {
  const body = JSON.stringify({
    property: source.property,
    preview: source.preview,
    client: source.client,
    hero_photo_url: source.hero_photo_url,
    photos: source.photos,
    canonical_url: source.canonical_url,
  });
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < body.length; i++) {
    h ^= BigInt(body.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

function buildHighlights(source: ListingSeoSource): string[] {
  const facts = [
    plural(source.property.bedrooms, "bedroom"),
    plural(source.property.bathrooms, "bathroom"),
    source.property.square_footage != null ? `${formatNumber(source.property.square_footage)} sq ft` : null,
    formatUsd(source.property.price),
  ];
  return [...uniqueStrings(facts), ...collectPrimaryFeatureHighlights(source)].slice(0, 8);
}

function buildFaqs(source: ListingSeoSource, address: AddressParts): ListingSeoFaq[] {
  const agent = listingAgent(source);
  const broker = brokerage(source);
  const rooms = uniqueStrings(source.photos.map((photo) => roomLabel(photo.room_type))).slice(0, 3);
  const hasVideo = Boolean(source.property.horizontal_video_url || source.property.vertical_video_url);
  const faqs: ListingSeoFaq[] = [];

  if (address.localityLine) {
    faqs.push({
      question: `Where is ${address.street} located?`,
      answer: `${address.street} is in ${address.localityLine}.`,
    });
  }
  if (agent || broker) {
    faqs.push({
      question: `Who is the listing agent for ${address.street}?`,
      answer: agent && broker
        ? `${agent} represents this listing with ${broker}.`
        : agent
          ? `${agent} represents this listing.`
          : `${broker} represents this listing.`,
    });
  }
  faqs.push({
    question: `Is there a listing video for ${address.street}?`,
    answer: hasVideo
      ? `Yes. The Listing Elevate film highlights spaces including ${rooms.length > 0 ? rooms.join(" and ") : "the property"}.`
      : "A Listing Elevate film has not been attached to this public page yet.",
  });
  return faqs;
}

export function buildListingSeoSchema(source: ListingSeoSource, artifact: ListingSeoArtifact): ListingSeoSchemaGraph {
  const address = parseAddress(source.property.address);
  const agent = listingAgent(source);
  const broker = brokerage(source);
  const price = source.property.price;
  const imageUrls = uniqueStrings([source.hero_photo_url, ...source.photos.map((photo) => photo.file_url)]);
  const primaryVideoUrl = source.property.horizontal_video_url ?? source.property.vertical_video_url;
  const datePublished = source.preview.created_at ?? source.property.created_at ?? undefined;
  const dateModified = source.property.updated_at ?? source.preview.created_at ?? undefined;
  const homeId = `${source.canonical_url}#home`;
  const listingId = `${source.canonical_url}#listing`;
  const offerId = `${source.canonical_url}#offer`;
  const videoId = `${source.canonical_url}#video`;
  const faqId = `${source.canonical_url}#faq`;

  const graph = [
    {
      "@type": "RealEstateListing",
      "@id": listingId,
      url: source.canonical_url,
      name: artifact.title,
      headline: artifact.title,
      description: artifact.summary,
      datePublished,
      dateModified,
      image: imageUrls,
      contentLocation: { "@id": homeId },
      mainEntity: { "@id": homeId },
      offers: { "@id": offerId },
      associatedMedia: primaryVideoUrl ? [{ "@id": videoId }] : undefined,
      provider: broker || agent ? { "@type": "RealEstateAgent", name: agent ?? broker, worksFor: broker } : undefined,
    },
    {
      "@type": "House",
      "@id": homeId,
      name: address.street,
      description: artifact.long_description,
      address: {
        "@type": "PostalAddress",
        streetAddress: address.street,
        addressLocality: address.locality || undefined,
        addressRegion: address.region || undefined,
        postalCode: address.postalCode || undefined,
        addressCountry: "US",
      },
      numberOfBedrooms: source.property.bedrooms ?? undefined,
      numberOfBathroomsTotal: source.property.bathrooms ?? undefined,
      floorSize: source.property.square_footage != null
        ? { "@type": "QuantitativeValue", value: source.property.square_footage, unitCode: "FTK" }
        : undefined,
      amenityFeature: collectFeatureHighlights(source).map((feature) => ({
        "@type": "LocationFeatureSpecification",
        name: feature,
        value: true,
      })),
      image: imageUrls,
    },
    {
      "@type": "Offer",
      "@id": offerId,
      url: source.canonical_url,
      price: price ?? undefined,
      priceCurrency: price != null ? "USD" : undefined,
      availability: "https://schema.org/InStock",
      itemOffered: { "@id": homeId },
    },
    {
      "@type": "VideoObject",
      "@id": videoId,
      name: `${address.street} listing film`,
      description: artifact.summary,
      thumbnailUrl: imageUrls.length > 0 ? imageUrls : undefined,
      uploadDate: datePublished,
      contentUrl: primaryVideoUrl ?? undefined,
      embedUrl: `${source.base_url}/preview/${source.preview.token}`,
    },
    {
      "@type": "FAQPage",
      "@id": faqId,
      mainEntity: artifact.faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.answer,
        },
      })),
    },
  ].map((node) => {
    const cleanNode: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (value !== undefined && !(Array.isArray(value) && value.length === 0)) cleanNode[key] = value;
    }
    return cleanNode as { "@type": string };
  });

  return { "@context": "https://schema.org", "@graph": graph };
}

export function buildListingSeoMarkdown(source: ListingSeoSource, artifact: ListingSeoArtifact): string {
  const address = parseAddress(source.property.address);
  const agent = listingAgent(source);
  const broker = brokerage(source);
  const lines: string[] = [
    `# ${address.street}`,
    "",
    artifact.summary,
    "",
    "## Listing Facts",
    `- Address: ${source.property.address.replace(/,\s*USA$/i, "")}`,
  ];
  const price = formatUsd(source.property.price);
  if (price) lines.push(`- Price: ${price}`);
  const beds = plural(source.property.bedrooms, "bedroom");
  if (beds) lines.push(`- Bedrooms: ${beds}`);
  const baths = plural(source.property.bathrooms, "bathroom");
  if (baths) lines.push(`- Bathrooms: ${baths}`);
  if (source.property.square_footage != null) lines.push(`- Interior: ${formatNumber(source.property.square_footage)} sq ft`);
  if (agent) lines.push(`- Listing agent: ${agent}`);
  if (broker) lines.push(`- Brokerage: ${broker}`);
  lines.push("", "## Highlights");
  for (const highlight of artifact.highlights) lines.push(`- ${highlight}`);
  lines.push("", "## Media");
  lines.push(`- Canonical page: ${source.canonical_url}`);
  lines.push(`- Preview page: ${source.base_url}/preview/${source.preview.token}`);
  if (source.property.horizontal_video_url) lines.push(`- Horizontal listing film: ${source.property.horizontal_video_url}`);
  if (source.property.vertical_video_url) lines.push(`- Vertical listing film: ${source.property.vertical_video_url}`);
  if (source.hero_photo_url) lines.push(`- Primary image: ${source.hero_photo_url}`);
  lines.push("", "## Q&A");
  for (const faq of artifact.faqs) {
    lines.push(`### ${faq.question}`);
    lines.push(faq.answer);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function buildListingSeoArtifact(source: ListingSeoSource): ListingSeoArtifact {
  const address = parseAddress(source.property.address);
  const slug = makeListingSeoSlug(source.property.address, source.preview.token);
  const price = formatUsd(source.property.price);
  const facts = uniqueStrings([
    plural(source.property.bedrooms, "bed"),
    plural(source.property.bathrooms, "bath"),
    source.property.square_footage != null ? `${formatNumber(source.property.square_footage)} sq ft` : null,
    price,
  ]);
  const features = collectFeatureHighlights(source);
  const title = `${address.street} | ${address.locality ? `${address.locality} ` : ""}Listing Film`;
  const representedBy = [listingAgent(source), brokerage(source)].filter(Boolean).join(" with ");
  const summary = trimSentence(
    [
      `${address.street}${address.localityLine ? ` in ${address.localityLine}` : ""}`,
      facts.length ? `features ${facts.join(", ")}` : "",
      features.length ? `with highlights including ${features.slice(0, 3).join(", ")}` : "",
      representedBy ? `represented by ${representedBy}` : "",
    ].filter(Boolean).join(" "),
    220,
  );
  const metaDescription = trimSentence(
    [
      `${address.street}${address.locality ? ` in ${address.locality}` : ""}`,
      facts.join(", "),
      features.length ? `Highlights include ${features.slice(0, 2).join(" and ")}` : "",
    ].filter(Boolean).join(". "),
    155,
  );
  const longDescription = trimSentence(
    `${summary.replace(/[.!?]+$/g, "")}. Watch the Listing Elevate film, review the property highlights, and use the structured listing details for tour planning or market research.`,
    520,
  );
  const faqs = buildFaqs(source, address);
  const baseArtifact: ListingSeoArtifact = {
    slug,
    status: "generated",
    indexable: activePublicPreview(source),
    title,
    meta_description: metaDescription,
    summary,
    long_description: longDescription,
    highlights: buildHighlights(source),
    faqs,
    schema_json: { "@context": "https://schema.org", "@graph": [] },
    llms_markdown: "",
    source_fingerprint: fingerprint(source),
    generated_by: "deterministic",
    model: null,
    prompt_version: PROMPT_VERSION,
    cost_cents: 0,
    error: null,
  };
  const schema = buildListingSeoSchema(source, baseArtifact);
  const markdown = buildListingSeoMarkdown(source, { ...baseArtifact, schema_json: schema });
  return { ...baseArtifact, schema_json: schema, llms_markdown: markdown };
}
