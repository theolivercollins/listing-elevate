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
  brokerage: string | null;
  /** ", Realtor" display-name toggle. Applied at render-mapping time; stored agent_name stays clean. May be undefined on rows read before migration 081 — treat as false. */
  realtor_suffix: boolean;
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

  listing_agent?: string | null;
  brokerage?: string | null;

  video_type?: 'just_listed' | 'just_pended' | 'just_closed' | null;
  selected_package?: 'just_listed' | 'just_pended' | 'just_closed' | 'life_cycle' | null;
  selected_duration?: 15 | 30 | 60 | null;
  selected_orientation?: 'horizontal' | 'vertical' | 'both' | null;
  add_voiceover?: boolean;
  add_voice_clone?: boolean;
  add_custom_request?: boolean;
  custom_request_text?: string | null;
  days_on_market?: number | null;
  sold_price?: number | null;
  pipeline_mode?: 'v1' | 'v1.1' | null;
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
  phone: string | null;
};

export type DeliveryVideoType = 'just_listed' | 'just_pended' | 'just_closed';

export type ListingDetails = {
  price?: number | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  mls_description?: string | null;
  source?: 'scraped' | 'manual';
};

export type DeliveryRunRow = {
  id: string;
  property_id: string;
  client_id: string | null;
  video_type: DeliveryVideoType;
  duration_seconds: number | null;
  stage: string; // DeliveryStage — narrowed via lib/delivery/state.ts
  listing_details: ListingDetails;
  scene_order: string[] | null;
  voiceover_script: string | null;
  voiceover_voice_id: string | null;
  voiceover_audio_url: string | null;
  music_track_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type SceneVariantRow = {
  id: string;
  delivery_run_id: string;
  scene_id: string;
  variant: 'A' | 'B';
  provider: string | null;
  provider_task_id: string | null;
  clip_url: string | null;
  cost_cents: number | null;
  gemini_scores: Record<string, unknown> | null;
  winner: boolean;
  /** 'gemini' = real judged verdict; 'operator' = checkpoint-A flip;
   *  'default' = unjudged auto-win (degraded pair / judge failure — gemini_scores carries judge_error). */
  winner_source: 'gemini' | 'operator' | 'default' | null;
  degraded: boolean;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type MlEventType =
  | 'reorder' | 'regenerate' | 'variant_override' | 'script_edit'
  | 'voice_choice' | 'music_choice' | 'rating' | 'comment' | 'details_edit';

export type MlEventRow = {
  id: string;
  run_id: string;
  event_type: MlEventType;
  payload: Record<string, unknown>;
  created_at: string;
};
