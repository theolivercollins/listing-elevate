// lib/types/operator-studio.ts

export type ClientRow = {
  id: string;
  name: string;
  contact_email: string | null;
  phone: string | null;
  monthly_rate_cents: number | null;
  notes: string | null;
  brand_logo_url: string | null;
  brand_primary_hex: string | null;
  brand_secondary_hex: string | null;
  agent_name: string | null;
  agent_headshot_url: string | null;
  voice_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ClientInput = Partial<Omit<ClientRow, 'id' | 'created_at' | 'updated_at' | 'archived_at'>> & {
  name: string;
};

export type IngestSource = 'manual' | 'zillow' | 'redfin' | 'sierra' | 'mls' | 'drive_link';

export type ManualIngestInput = {
  client_id: string | null;
  address: string;
  bedrooms: number | null;
  bathrooms: number | null;
  square_footage: number | null;
  price: number | null;
  photo_storage_paths: string[];
  director_notes: string | null;
};

export type RevisionNoteRow = {
  id: string;
  property_id: string;
  source: 'operator' | 'client_preview';
  body: string;
  created_at: string;
};

export type PropertyPreviewRow = {
  id: string;
  property_id: string;
  token: string;
  created_at: string;
  expires_at: string | null;
  viewed_count: number;
  last_viewed_at: string | null;
};

export type InvoiceLineItem = {
  property_id: string;
  address: string;
  delivered_at: string | null;
  raw_cost_cents: number;
};

export type InvoiceSummary = {
  client_id: string;
  client_name: string;
  from: string;
  to: string;
  videos_delivered: number;
  raw_cost_cents: number;
  contracted_rate_cents: number | null;
  line_items: InvoiceLineItem[];
};

export type BrandKitVars = {
  logo_url: string | null;
  primary_hex: string | null;
  secondary_hex: string | null;
  agent_name: string | null;
  agent_headshot_url: string | null;
  brokerage: string | null;
};
