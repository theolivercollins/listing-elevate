import type { SupabaseClient } from "@supabase/supabase-js";
import { toPublicPhotoUrl } from "../operator-studio/ingest.js";
import { makeListingSeoSlug } from "./slug.js";
import type {
  ListingSeoArtifact,
  ListingSeoArtifactRow,
  ListingSeoClientSource,
  ListingSeoPhotoSource,
  ListingSeoPreviewSource,
  ListingSeoPropertySource,
  ListingSeoSource,
} from "./types.js";

type Db = SupabaseClient;
type ListingSeoPreviewRow = ListingSeoPreviewSource & { property_id: string };

export function defaultSeoBaseUrl(): string {
  return (process.env.LE_PUBLIC_BASE_URL ?? "https://listingelevate.com").replace(/\/+$/, "");
}

export function isAiSeoArtifactsMissingError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: string } | null)?.message ?? error ?? "");
  return code === "42P01" || /ai_seo_artifacts|relation .* does not exist/i.test(message);
}

function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return /\.(mp4|webm|mov)(\?|$)/.test(lower) || lower.includes("/property-videos/");
}

function normalizePhotoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const absolute = toPublicPhotoUrl(url);
  return isVideoUrl(absolute) ? null : absolute;
}

export function isPreviewIndexable(preview: Pick<ListingSeoPreviewSource, "kind" | "expires_at" | "revoked_at">): boolean {
  if (preview.kind !== "public") return false;
  if (preview.revoked_at) return false;
  if (preview.expires_at && new Date(preview.expires_at) < new Date()) return false;
  return true;
}

async function fetchProperty(db: Db, propertyId: string): Promise<(ListingSeoPropertySource & { client_id?: string | null }) | null> {
  const columnsWithSqft =
    "id, address, price, bedrooms, bathrooms, square_footage, listing_agent, brokerage, horizontal_video_url, vertical_video_url, client_id, created_at, updated_at";
  const columnsFallback =
    "id, address, price, bedrooms, bathrooms, listing_agent, brokerage, horizontal_video_url, vertical_video_url, client_id, created_at, updated_at";

  const primary = await db.from("properties").select(columnsWithSqft).eq("id", propertyId).maybeSingle();
  if (!primary.error) return primary.data as (ListingSeoPropertySource & { client_id?: string | null }) | null;
  if ((primary.error as { code?: string }).code !== "42703") {
    throw new Error(`fetchListingSeoSource property: ${primary.error.message}`);
  }

  const fallback = await db.from("properties").select(columnsFallback).eq("id", propertyId).maybeSingle();
  if (fallback.error) throw new Error(`fetchListingSeoSource property fallback: ${fallback.error.message}`);
  if (!fallback.data) return null;
  return { ...(fallback.data as ListingSeoPropertySource & { client_id?: string | null }), square_footage: null };
}

async function fetchPublicPreview(db: Db, propertyId: string): Promise<ListingSeoPreviewSource | null> {
  const { data, error } = await db
    .from("property_previews")
    .select("id, token, kind, expires_at, revoked_at, created_at")
    .eq("property_id", propertyId)
    .eq("kind", "public")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(`fetchListingSeoSource preview: ${error.message}`);
  return ((data ?? []) as ListingSeoPreviewSource[]).find(isPreviewIndexable) ?? null;
}

async function fetchPreviewByTokenPrefix(db: Db, tokenPrefix: string): Promise<ListingSeoPreviewRow[]> {
  const { data, error } = await db
    .from("property_previews")
    .select("id, property_id, token, kind, expires_at, revoked_at, created_at")
    .ilike("token", `${tokenPrefix}%`)
    .eq("kind", "public")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(`fetchPreviewByTokenPrefix: ${error.message}`);
  return (data ?? []) as ListingSeoPreviewRow[];
}

async function fetchClient(db: Db, clientId: string | null | undefined): Promise<ListingSeoClientSource | null> {
  if (!clientId) return null;
  const { data, error } = await db
    .from("clients")
    .select("name, agent_name, brokerage, brand_logo_url, agent_headshot_url")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(`fetchListingSeoSource client: ${error.message}`);
  return (data as ListingSeoClientSource | null) ?? null;
}

async function fetchPhotos(db: Db, propertyId: string): Promise<ListingSeoPhotoSource[]> {
  const { data, error } = await db
    .from("photos")
    .select("file_url, room_type, key_features, selected, quality_score")
    .eq("property_id", propertyId)
    .order("selected", { ascending: false })
    .order("quality_score", { ascending: false })
    .limit(12);
  if (error) throw new Error(`fetchListingSeoSource photos: ${error.message}`);
  return ((data ?? []) as ListingSeoPhotoSource[]).map((photo) => ({
    ...photo,
    file_url: normalizePhotoUrl(photo.file_url),
  }));
}

export async function fetchListingSeoSource(db: Db, propertyId: string, baseUrl = defaultSeoBaseUrl()): Promise<ListingSeoSource | null> {
  const property = await fetchProperty(db, propertyId);
  if (!property) return null;
  const preview = await fetchPublicPreview(db, propertyId);
  if (!preview) return null;
  return fetchListingSeoSourceFromPreview(db, property, preview, baseUrl);
}

async function fetchListingSeoSourceFromPreview(
  db: Db,
  property: ListingSeoPropertySource & { client_id?: string | null },
  preview: ListingSeoPreviewSource,
  baseUrl = defaultSeoBaseUrl(),
): Promise<ListingSeoSource> {
  const [client, photos] = await Promise.all([
    fetchClient(db, property.client_id),
    fetchPhotos(db, property.id),
  ]);
  const hero_photo_url = photos.find((photo) => photo.selected && photo.file_url)?.file_url
    ?? photos.find((photo) => photo.file_url)?.file_url
    ?? null;
  const slug = makeListingSeoSlug(property.address, preview.token);
  return {
    property,
    preview,
    client,
    hero_photo_url,
    photos,
    canonical_url: `${baseUrl}/listings/${slug}`,
    base_url: baseUrl,
  };
}

export async function fetchListingSeoSourceBySlug(db: Db, slug: string, baseUrl = defaultSeoBaseUrl()): Promise<ListingSeoSource | null> {
  const tokenPrefix = slug.split("-").pop()?.replace(/[^a-z0-9]/gi, "") ?? "";
  if (tokenPrefix.length < 6) return null;
  const previews = await fetchPreviewByTokenPrefix(db, tokenPrefix);
  for (const preview of previews) {
    if (!isPreviewIndexable(preview)) continue;
    const property = await fetchProperty(db, preview.property_id);
    if (!property) continue;
    const source = await fetchListingSeoSourceFromPreview(db, property, preview, baseUrl);
    if (source.canonical_url.endsWith(`/listings/${slug}`)) return source;
  }
  return null;
}

export function serializeArtifactPayload(source: ListingSeoSource, artifact: ListingSeoArtifact) {
  return {
    property_id: source.property.id,
    preview_id: source.preview.id,
    slug: artifact.slug,
    status: artifact.status,
    indexable: artifact.indexable,
    title: artifact.title,
    meta_description: artifact.meta_description,
    summary: artifact.summary,
    long_description: artifact.long_description,
    highlights: artifact.highlights,
    faqs: artifact.faqs,
    schema_json: artifact.schema_json,
    llms_markdown: artifact.llms_markdown,
    source_fingerprint: artifact.source_fingerprint,
    generated_by: artifact.generated_by,
    model: artifact.model,
    prompt_version: artifact.prompt_version,
    cost_cents: artifact.cost_cents,
    error: artifact.error,
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function toArtifactRow(source: ListingSeoSource, artifact: ListingSeoArtifact, persisted: Partial<ListingSeoArtifactRow> = {}): ListingSeoArtifactRow {
  const now = new Date().toISOString();
  return {
    id: persisted.id ?? `stateless:${source.preview.id}`,
    property_id: source.property.id,
    preview_id: source.preview.id,
    slug: artifact.slug,
    status: artifact.status,
    indexable: artifact.indexable,
    title: artifact.title,
    meta_description: artifact.meta_description,
    summary: artifact.summary,
    long_description: artifact.long_description,
    highlights: artifact.highlights,
    faqs: artifact.faqs,
    schema_json: artifact.schema_json,
    llms_markdown: artifact.llms_markdown,
    source_fingerprint: artifact.source_fingerprint,
    generated_by: artifact.generated_by,
    model: artifact.model,
    prompt_version: artifact.prompt_version,
    cost_cents: artifact.cost_cents,
    error: artifact.error,
    generated_at: persisted.generated_at ?? now,
    created_at: persisted.created_at ?? now,
    updated_at: persisted.updated_at ?? now,
  };
}

export function materializeListingSeoArtifactRow(source: ListingSeoSource, artifact: ListingSeoArtifact): ListingSeoArtifactRow {
  return toArtifactRow(source, artifact);
}

export async function canStoreListingSeoArtifacts(db: Db): Promise<boolean> {
  const { error } = await db
    .from("ai_seo_artifacts")
    .select("id")
    .limit(1);
  if (!error) return true;
  if (isAiSeoArtifactsMissingError(error)) return false;
  throw new Error(`canStoreListingSeoArtifacts: ${error.message}`);
}

export async function upsertListingSeoArtifact(db: Db, source: ListingSeoSource, artifact: ListingSeoArtifact): Promise<ListingSeoArtifactRow> {
  const payload = serializeArtifactPayload(source, artifact);
  const { data, error } = await db
    .from("ai_seo_artifacts")
    .upsert(payload, { onConflict: "preview_id" })
    .select("*")
    .single();
  if (error) throw new Error(`upsertListingSeoArtifact: ${error.message}`);
  return data as ListingSeoArtifactRow;
}

export async function fetchListingSeoArtifactByPropertyId(db: Db, propertyId: string): Promise<ListingSeoArtifactRow | null> {
  const { data, error } = await db
    .from("ai_seo_artifacts")
    .select("*")
    .eq("property_id", propertyId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isAiSeoArtifactsMissingError(error)) return null;
    throw new Error(`fetchListingSeoArtifactByPropertyId: ${error.message}`);
  }
  const artifact = (data as ListingSeoArtifactRow | null) ?? null;
  if (!artifact) return null;
  const preview = await fetchPreviewById(db, artifact.preview_id);
  return {
    ...artifact,
    indexable: artifact.indexable && Boolean(preview && isPreviewIndexable(preview)),
  };
}

async function fetchPreviewById(db: Db, previewId: string): Promise<ListingSeoPreviewSource | null> {
  const { data, error } = await db
    .from("property_previews")
    .select("id, token, kind, expires_at, revoked_at, created_at")
    .eq("id", previewId)
    .maybeSingle();
  if (error) throw new Error(`fetchPreviewById: ${error.message}`);
  return (data as ListingSeoPreviewSource | null) ?? null;
}

export async function fetchPublicListingSeoArtifactBySlug(db: Db, slug: string): Promise<ListingSeoArtifactRow | null> {
  const { data, error } = await db
    .from("ai_seo_artifacts")
    .select("*")
    .eq("slug", slug)
    .eq("status", "generated")
    .eq("indexable", true)
    .maybeSingle();
  if (error) {
    if (!isAiSeoArtifactsMissingError(error)) {
      throw new Error(`fetchPublicListingSeoArtifactBySlug: ${error.message}`);
    }
    const source = await fetchListingSeoSourceBySlug(db, slug);
    if (!source) return null;
    const { buildListingSeoArtifact } = await import("./artifact.js");
    return toArtifactRow(source, buildListingSeoArtifact(source));
  }
  const artifact = data as ListingSeoArtifactRow | null;
  if (!artifact) return null;
  const preview = await fetchPreviewById(db, artifact.preview_id);
  if (!preview || !isPreviewIndexable(preview)) return null;
  return artifact;
}

export async function listPublicListingSeoArtifacts(db: Db, limit = 500): Promise<ListingSeoArtifactRow[]> {
  const { data, error } = await db
    .from("ai_seo_artifacts")
    .select("*")
    .eq("status", "generated")
    .eq("indexable", true)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (!isAiSeoArtifactsMissingError(error)) throw new Error(`listPublicListingSeoArtifacts: ${error.message}`);
    return listStatelessPublicListingSeoArtifacts(db, limit);
  }
  const rows = (data ?? []) as ListingSeoArtifactRow[];
  const filtered: ListingSeoArtifactRow[] = [];
  for (const row of rows) {
    const preview = await fetchPreviewById(db, row.preview_id);
    if (preview && isPreviewIndexable(preview)) filtered.push(row);
  }
  return filtered;
}

async function listStatelessPublicListingSeoArtifacts(db: Db, limit: number): Promise<ListingSeoArtifactRow[]> {
  const { data, error } = await db
    .from("property_previews")
    .select("id, property_id, token, kind, expires_at, revoked_at, created_at")
    .eq("kind", "public")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listStatelessPublicListingSeoArtifacts: ${error.message}`);

  const { buildListingSeoArtifact } = await import("./artifact.js");
  const rows: ListingSeoArtifactRow[] = [];
  for (const preview of (data ?? []) as ListingSeoPreviewRow[]) {
    if (!isPreviewIndexable(preview)) continue;
    const property = await fetchProperty(db, preview.property_id);
    if (!property) continue;
    const source = await fetchListingSeoSourceFromPreview(db, property, preview);
    rows.push(toArtifactRow(source, buildListingSeoArtifact(source)));
  }
  return rows;
}
