export interface ListingSeoPropertySource {
  id: string;
  address: string;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_footage: number | null;
  listing_agent: string | null;
  brokerage: string | null;
  horizontal_video_url: string | null;
  vertical_video_url: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ListingSeoPreviewSource {
  id: string;
  token: string;
  kind: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string | null;
}

export interface ListingSeoClientSource {
  name: string | null;
  agent_name: string | null;
  brokerage: string | null;
  brand_logo_url: string | null;
  agent_headshot_url: string | null;
}

export interface ListingSeoPhotoSource {
  file_url: string | null;
  room_type: string | null;
  key_features: string[] | null;
  selected: boolean | null;
  quality_score: number | null;
}

export interface ListingSeoSource {
  property: ListingSeoPropertySource;
  preview: ListingSeoPreviewSource;
  client: ListingSeoClientSource | null;
  hero_photo_url: string | null;
  photos: ListingSeoPhotoSource[];
  canonical_url: string;
  base_url: string;
}

export interface ListingSeoFaq {
  question: string;
  answer: string;
}

export interface ListingSeoArtifact {
  slug: string;
  status: "generated" | "failed";
  indexable: boolean;
  title: string;
  meta_description: string;
  summary: string;
  long_description: string;
  highlights: string[];
  faqs: ListingSeoFaq[];
  schema_json: ListingSeoSchemaGraph;
  llms_markdown: string;
  source_fingerprint: string;
  generated_by: "deterministic" | "anthropic";
  model: string | null;
  prompt_version: string;
  cost_cents: number;
  error: string | null;
}

export type ListingSeoSchemaNode = Record<string, unknown> & {
  "@type": string;
};

export interface ListingSeoSchemaGraph {
  "@context": "https://schema.org";
  "@graph": ListingSeoSchemaNode[];
}

export interface ListingSeoArtifactRow {
  id: string;
  property_id: string;
  preview_id: string;
  slug: string;
  status: "generated" | "failed";
  indexable: boolean;
  title: string;
  meta_description: string;
  summary: string;
  long_description: string;
  highlights: string[];
  faqs: ListingSeoFaq[];
  schema_json: ListingSeoSchemaGraph;
  llms_markdown: string;
  source_fingerprint: string;
  generated_by: string;
  model: string | null;
  prompt_version: string;
  cost_cents: number;
  error: string | null;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
}
