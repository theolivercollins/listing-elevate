import type { Property, Photo, Scene, PipelineLog, DailyStat, CostEvent, SceneRating, LearningData, PromptRevision } from './types';
import { supabase } from './supabase';

const API_BASE = '';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${text || res.statusText}`);
  }
  // Handle 204 No Content
  if (res.status === 204) return undefined as T;
  return res.json();
}

// authedFetch — drop-in replacement for fetch() that attaches the Supabase
// Bearer token. Returns the raw Response so callers can decide on res.ok
// handling (used by /api/admin/studio/* pages that need that pattern).
export async function authedFetch(path: string, options?: RequestInit): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

export async function fetchProperties(params?: {
  page?: number; limit?: number; status?: string; search?: string;
}): Promise<{ properties: Property[]; total: number; page: number; totalPages: number }> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set('page', String(params.page));
  if (params?.limit) sp.set('limit', String(params.limit));
  if (params?.status) sp.set('status', params.status);
  if (params?.search) sp.set('search', params.search);
  const qs = sp.toString();
  return apiFetch(`/api/properties${qs ? `?${qs}` : ''}`);
}

export async function fetchProperty(id: string): Promise<Property & { photos: Photo[]; scenes: (Scene & { rating: SceneRating | null })[]; costEvents: CostEvent[] }> {
  return apiFetch(`/api/properties/${id}`);
}

export async function rateScene(
  sceneId: string,
  rating: number,
  comment: string | null,
  tags: string[] | null,
): Promise<SceneRating> {
  return apiFetch(`/api/scenes/${sceneId}/rate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating, comment, tags }),
  });
}

export async function fetchLearningData(): Promise<LearningData> {
  return apiFetch(`/api/admin/learning`);
}

export async function fetchPromptRevisions(): Promise<{ prompts: Array<{ prompt_name: string; revisions: PromptRevision[] }> }> {
  return apiFetch(`/api/admin/prompt-revisions`);
}

export async function fetchPropertyStatus(id: string): Promise<{
  id: string; address: string; status: string; currentStage: number; totalStages: number;
  clipsCompleted: number; clipsTotal: number; horizontalVideoUrl: string | null;
  verticalVideoUrl: string | null; createdAt: string; processingTimeMs: number | null;
}> {
  return apiFetch(`/api/properties/${id}/status`);
}

const SUPABASE_URL = 'https://vrhmaeywqsohlztoouxu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyaG1hZXl3cXNvaGx6dG9vdXh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NDIxOTIsImV4cCI6MjA5MTQxODE5Mn0.GaiexH5L24zAoLgvjOUiixbHdnQW8kUMXXbyjnM8cM4';

export async function generateVoiceoverPreview(data: {
  voiceId: string;
  durationSec: number;
  /** Full chain: Compass scrape + script gen + TTS. Required if neither script nor description is provided. */
  compassUrl?: string;
  /** When set, skips Compass scrape + Claude script and only re-runs TTS. */
  script?: string;
  /** When set, skips Compass scrape and passes description directly to Claude script gen + TTS. */
  description?: string;
}): Promise<{ audioUrl: string; script: string; voice: { id: string; name: string } }> {
  return apiFetch('/api/voiceover/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function createProperty(
  data: {
    address: string; price: number; bedrooms: number; bathrooms: number;
    listing_agent: string; brokerage: string; photos: File[];
    selectedPackage?: string | null;
    selectedDuration?: string | null;
    selectedOrientation?: string | null;
    addVoiceover?: boolean;
    addVoiceClone?: boolean;
    addCustomRequest?: boolean;
    customRequestText?: string;
    daysOnMarket?: string;
    soldPrice?: string;
    /** Preview MP3 URL from /api/voiceover/preview — persisted to property on create. */
    voiceoverPreviewUrl?: string;
    pipelineMode?: 'v1' | 'v1.1';
  },
  onProgress?: (uploaded: number, total: number) => void,
): Promise<{
  property: { id: string; status: string };
  /** Stripe Checkout URL — absent when the order was bypassed (owner test). */
  checkoutUrl?: string;
  /** True when the server skipped Stripe (owner allowlist). Client should jump straight to /upload/success. */
  bypassed?: boolean;
  photoCount: number;
}> {
  const tempId = crypto.randomUUID();
  const total = data.photos.length;
  let uploaded = 0;
  const errors: string[] = [];

  // Upload directly to Supabase Storage REST API (no JS client wrapper)
  const BATCH_SIZE = 5;
  const uploadedPaths: string[] = [];

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = data.photos.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (file, j) => {
        const fileName = `${Date.now()}_${i + j}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        const storagePath = `${tempId}/raw/${fileName}`;
        try {
          const res = await fetch(
            `${SUPABASE_URL}/storage/v1/object/property-photos/${storagePath}`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': file.type || 'image/jpeg',
                'x-upsert': 'true',
              },
              body: file,
            }
          );
          uploaded++;
          onProgress?.(uploaded, total);
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            const msg = `${res.status} ${text}`;
            console.error(`Upload failed for ${file.name}: ${msg}`);
            errors.push(`${file.name}: ${msg}`);
            return null;
          }
          return storagePath;
        } catch (err) {
          uploaded++;
          onProgress?.(uploaded, total);
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Network error uploading ${file.name}: ${msg}`);
          errors.push(`${file.name}: ${msg}`);
          return null;
        }
      })
    );
    uploadedPaths.push(...results.filter((p): p is string => p !== null));
  }

  if (uploadedPaths.length === 0) {
    throw new Error(
      `All ${total} photo uploads failed.\n\nFirst error: ${errors[0] || 'unknown'}\n\nCheck browser console (F12) for details.`
    );
  }

  if (uploadedPaths.length < total) {
    console.warn(`Only ${uploadedPaths.length}/${total} photos uploaded successfully`);
  }

  // API call is instant — just sends paths + metadata.
  // Returns { property, checkoutUrl } — client should redirect to checkoutUrl.
  // The pipeline fires from the Stripe webhook (checkout.session.completed),
  // NOT from here.
  const result = await apiFetch<{
    property: { id: string; status: string };
    checkoutUrl?: string;
    bypassed?: boolean;
    photoCount: number;
  }>('/api/properties', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: data.address,
      price: data.price,
      bedrooms: data.bedrooms,
      bathrooms: data.bathrooms,
      listing_agent: data.listing_agent,
      brokerage: data.brokerage,
      tempId,
      photoPaths: uploadedPaths,
      selectedPackage: data.selectedPackage ?? null,
      selectedDuration: data.selectedDuration ?? null,
      selectedOrientation: data.selectedOrientation ?? null,
      addVoiceover: data.addVoiceover ?? false,
      addVoiceClone: data.addVoiceClone ?? false,
      addCustomRequest: data.addCustomRequest ?? false,
      customRequestText: data.customRequestText ?? null,
      daysOnMarket: data.daysOnMarket ?? null,
      soldPrice: data.soldPrice ?? null,
      voiceoverPreviewUrl: data.voiceoverPreviewUrl ?? null,
      pipeline_mode: data.pipelineMode ?? 'v1',
    }),
  });

  // Pipeline fires from webhook — do NOT call triggerPipeline here.
  return result;
}

export async function createPropertyFromDrive(data: {
  address: string; price: number; bedrooms: number; bathrooms: number;
  listing_agent: string; brokerage: string; driveLink: string;
}): Promise<{
  property: { id: string; status: string };
  checkoutUrl?: string;
  bypassed?: boolean;
  photoCount: number;
}> {
  const result = await apiFetch<{
    property: { id: string; status: string };
    checkoutUrl?: string;
    bypassed?: boolean;
    photoCount: number;
  }>('/api/properties', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: data.address,
      price: data.price,
      bedrooms: data.bedrooms,
      bathrooms: data.bathrooms,
      listing_agent: data.listing_agent,
      brokerage: data.brokerage,
      driveLink: data.driveLink,
    }),
  });

  // Pipeline fires from webhook — do NOT call triggerPipeline here.
  return result;
}

/**
 * Re-create a Stripe Checkout Session for a pending_payment property.
 * Call this when the user cancelled and wants to retry payment.
 */
export async function resumeCheckout(propertyId: string): Promise<{ checkoutUrl: string }> {
  return apiFetch(`/api/properties/${propertyId}/resume-checkout`, { method: 'POST' });
}

// Fire-and-forget: triggers the pipeline in a separate 300s function.
// The rerun reset endpoint deliberately doesn't launch the pipeline itself,
// so the client kicks it off here once the reset returns.
function triggerPipeline(propertyId: string) {
  fetch(`/api/pipeline/${propertyId}`, { method: 'POST' }).catch(() => {});
}

export async function rerunProperty(id: string): Promise<void> {
  await apiFetch(`/api/properties/${id}/rerun`, { method: 'POST' });
  triggerPipeline(id);
}

export async function archiveProperty(id: string): Promise<void> {
  await apiFetch(`/api/properties/${id}/archive`, { method: 'POST' });
}

export async function updatePropertyStatus(id: string, status: string): Promise<void> {
  await apiFetch(`/api/properties/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

export async function fetchLogs(params?: {
  page?: number; limit?: number; stage?: string; level?: string; property_id?: string;
}): Promise<{ logs: (PipelineLog & { properties?: { address: string } })[]; total: number; page: number; totalPages: number }> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set('page', String(params.page));
  if (params?.limit) sp.set('limit', String(params.limit));
  if (params?.stage) sp.set('stage', params.stage);
  if (params?.level) sp.set('level', params.level);
  if (params?.property_id) sp.set('property_id', params.property_id);
  const qs = sp.toString();
  return apiFetch(`/api/logs${qs ? `?${qs}` : ''}`);
}

export async function fetchStatsOverview(): Promise<{
  completedToday: number; submittedToday: number; inPipeline: number; needsReview: number;
  avgProcessingMs: number; totalCostTodayCents: number; totalCostThisWeekCents: number;
  avgCostPerVideoCents: number; successRate: number;
  costBreakdown?: {
    byProvider: Array<{ provider: string; cents: number; events: number }>;
    byScope: Array<{ scope: string; cents: number; events: number }>;
    byStage: Array<{ stage: string; cents: number; events: number }>;
  };
}> {
  return apiFetch('/api/stats/overview');
}

export async function fetchDailyStats(days?: number): Promise<{ stats: DailyStat[] }> {
  const qs = days ? `?days=${days}` : '';
  return apiFetch(`/api/stats/daily${qs}`);
}

export interface CostBucket { events: number; cents: number; }
export interface CostBreakdownRow {
  key: string;
  today: CostBucket;
  week: CostBucket;
  month: CostBucket;
}
export interface CostBreakdown {
  byProvider: CostBreakdownRow[];
  byModel: CostBreakdownRow[];
  byScope: CostBreakdownRow[];
  byStage: CostBreakdownRow[];
}

export async function fetchCostBreakdown(): Promise<CostBreakdown> {
  return apiFetch('/api/stats/cost-breakdown');
}

export async function approveScene(id: string): Promise<void> {
  return apiFetch(`/api/scenes/${id}/approve`, { method: 'POST' });
}

export async function retryScene(
  id: string,
  prompt: string,
  options?: { provider?: 'runway' | 'kling'; camera_movement?: string },
): Promise<{ ok: boolean; provider?: string; jobId?: string; willRetryViaCron?: boolean; message?: string }> {
  return apiFetch(`/api/scenes/${id}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, ...(options ?? {}) }),
  });
}

export async function resubmitScene(
  id: string,
  options?: {
    prompt?: string;
    provider?: 'runway' | 'kling';
    camera_movement?: string;
    duration_seconds?: number;
  },
): Promise<{ ok: boolean; provider?: string; jobId?: string; willRetryViaCron?: boolean; message?: string }> {
  return apiFetch(`/api/scenes/${id}/resubmit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options ?? {}),
  });
}

export async function skipScene(id: string): Promise<void> {
  return apiFetch(`/api/scenes/${id}/skip`, { method: 'POST' });
}

export async function fetchSystemPrompts(): Promise<{ analysis: string; director: string; qc: string }> {
  return apiFetch('/api/admin/prompts');
}

export interface ModelHealthRow {
  provider: string;
  calls_24h: number;
  failures_24h: number;
  p50_ms: number | null;
  p95_ms: number | null;
  last_at: string | null;
}

export interface ModelHealthResponse {
  rows: ModelHealthRow[];
  generated_at: string;
}

export async function fetchModelHealth(): Promise<ModelHealthResponse> {
  return apiFetch('/api/admin/model-health');
}

export interface MlsScrapeResult {
  address: string | null;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  agent: string | null;
  description: string | null;
}

export async function scrapeMls(url: string): Promise<MlsScrapeResult> {
  return apiFetch('/api/properties/scrape-mls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

export interface MlsLookupResult {
  source: 'redfin' | 'realtor';
  address: string;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  agent: string | null;
  description: string | null;
  listingUrl: string | null;
}

/**
 * Look up MLS listing details by address.
 * Tries Redfin first, falls back to Realtor.com.
 * Throws (with hint message) if both sources fail.
 */
export async function lookupMls(address: string): Promise<MlsLookupResult> {
  return apiFetch('/api/properties/lookup-mls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  });
}

// ─── Admin: invite teammate ──────────────────────────────────────
export async function inviteUser(email: string): Promise<{ ok: boolean; userId: string | null }> {
  return apiFetch('/api/admin/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

// ─── v1.1: per-property Seedance push-in toggle ─────────────────
export async function updatePropertyPipelineMode(
  id: string,
  pipeline_mode: 'v1' | 'v1.1',
): Promise<Property> {
  return apiFetch(`/api/properties/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pipeline_mode }),
  });
}
