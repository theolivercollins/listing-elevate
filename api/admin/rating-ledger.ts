import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../lib/auth.js";
import { getSupabase } from "../../lib/client.js";

// GET /api/admin/rating-ledger
//   ?limit=50&offset=0
//   &surface=legacy_lab|listings_lab|prod   (repeatable or comma-separated; default all)
//   &sku=kling-v2-6-pro                     (exact match on model_used / provider)
//   &min_rating=4                            (1..5)
//   &has_comment=true|false
//   &room_type=kitchen                       (from bucket-card click-to-filter)
//   &camera_movement=push_in                 (from bucket-card click-to-filter)
//
// Returns { rows: LedgerRow[], total: number, counts: { legacy_lab, listings_lab, prod } }.
// Pulls all rated rows across the three surfaces (bounded, ~hundreds), combines in memory,
// sorts rated_at DESC, slices by offset/limit. Pre-filter totals are returned in `counts`
// so the UI can show surface coverage even when a filter narrows the visible rows.

export type LedgerSurface = "legacy_lab" | "listings_lab" | "prod";

export interface LedgerRow {
  surface: LedgerSurface;
  rated_at: string;
  rating: number | null;
  rating_reasons: string[] | null;
  user_comment: string | null;
  source_image_url: string | null;
  clip_url: string | null;
  sku: string | null;
  provider: string | null;
  listing_name: string | null;
  scene_id: string | null;
  iteration_id: string;
  room_type: string | null;
  camera_movement: string | null;
  has_embedding: boolean;
  has_model_used: boolean;
  recipe_id: string | null;
}

const ALL_SURFACES: LedgerSurface[] = ["legacy_lab", "listings_lab", "prod"];

function parseSurfaces(raw: unknown): LedgerSurface[] {
  if (raw == null) return ALL_SURFACES;
  const values = Array.isArray(raw) ? raw : String(raw).split(",");
  const allowed = new Set<LedgerSurface>();
  for (const v of values) {
    const trimmed = String(v).trim();
    if (trimmed === "legacy_lab" || trimmed === "listings_lab" || trimmed === "prod") {
      allowed.add(trimmed);
    }
  }
  return allowed.size > 0 ? Array.from(allowed) : ALL_SURFACES;
}

function providerToSku(provider: string | null): string | null {
  if (!provider) return null;
  if (provider === "kling") return "kling-v2-native";
  return provider;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = getSupabase();

  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const surfaces = parseSurfaces(req.query.surface);
  const skuFilter = typeof req.query.sku === "string" && req.query.sku.trim() ? req.query.sku.trim() : null;
  const minRatingRaw = Number(req.query.min_rating);
  const minRating = Number.isFinite(minRatingRaw) && minRatingRaw >= 1 && minRatingRaw <= 5 ? minRatingRaw : null;
  const hasCommentRaw = req.query.has_comment;
  const hasComment = hasCommentRaw === "true" ? true : hasCommentRaw === "false" ? false : null;
  const roomTypeFilter = typeof req.query.room_type === "string" && req.query.room_type.trim()
    ? req.query.room_type.trim()
    : null;
  const cameraMovementFilter = typeof req.query.camera_movement === "string" && req.query.camera_movement.trim()
    ? req.query.camera_movement.trim()
    : null;

  try {
    const [legacyRows, listingsRows, prodRows, recipeRows] = await Promise.all([
      surfaces.includes("legacy_lab") ? fetchLegacyLab(supabase) : Promise.resolve([] as LedgerRow[]),
      surfaces.includes("listings_lab") ? fetchListingsLab(supabase) : Promise.resolve([] as LedgerRow[]),
      surfaces.includes("prod") ? fetchProd(supabase) : Promise.resolve([] as LedgerRow[]),
      fetchRecipeIndex(supabase),
    ]);

    for (const r of legacyRows) r.recipe_id = recipeRows.get(r.iteration_id) ?? null;
    for (const r of listingsRows) r.recipe_id = recipeRows.get(r.iteration_id) ?? null;

    const counts = {
      legacy_lab: legacyRows.length,
      listings_lab: listingsRows.length,
      prod: prodRows.length,
    };

    let combined: LedgerRow[] = [...legacyRows, ...listingsRows, ...prodRows];

    if (minRating !== null) combined = combined.filter((r) => typeof r.rating === "number" && r.rating >= minRating);
    if (hasComment === true) combined = combined.filter((r) => typeof r.user_comment === "string" && r.user_comment.trim().length > 0);
    if (hasComment === false) combined = combined.filter((r) => !(typeof r.user_comment === "string" && r.user_comment.trim().length > 0));
    if (skuFilter) combined = combined.filter((r) => r.sku === skuFilter);
    if (roomTypeFilter) combined = combined.filter((r) => r.room_type === roomTypeFilter);
    if (cameraMovementFilter) combined = combined.filter((r) => r.camera_movement === cameraMovementFilter);

    combined.sort((a, b) => (a.rated_at < b.rated_at ? 1 : a.rated_at > b.rated_at ? -1 : 0));

    const total = combined.length;
    const rows = combined.slice(offset, offset + limit);

    return res.status(200).json({ rows, total, counts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
}

async function fetchLegacyLab(supabase: ReturnType<typeof getSupabase>): Promise<LedgerRow[]> {
  const { data: iterations, error: iterErr } = await supabase
    .from("prompt_lab_iterations")
    .select(
      "id, session_id, rating, user_comment, tags, clip_url, provider, embedding, analysis_json, director_output_json, created_at",
    )
    .not("rating", "is", null);
  if (iterErr) throw iterErr;

  const sessionIds = Array.from(new Set((iterations ?? []).map((i) => i.session_id as string)));
  const sessionIndex = new Map<string, { image_url: string | null; label: string | null; batch_label: string | null }>();
  if (sessionIds.length > 0) {
    const { data: sessions, error: sessErr } = await supabase
      .from("prompt_lab_sessions")
      .select("id, image_url, label, batch_label")
      .in("id", sessionIds);
    if (sessErr) throw sessErr;
    for (const s of sessions ?? []) {
      sessionIndex.set(s.id as string, {
        image_url: (s.image_url as string | null) ?? null,
        label: (s.label as string | null) ?? null,
        batch_label: (s.batch_label as string | null) ?? null,
      });
    }
  }

  return (iterations ?? []).map((i): LedgerRow => {
    const session = sessionIndex.get(i.session_id as string);
    const provider = (i.provider as string | null) ?? null;
    const sku = providerToSku(provider);
    const listingName = session?.label ?? session?.batch_label ?? null;
    const analysis = (i.analysis_json ?? null) as { room_type?: string | null } | null;
    const director = (i.director_output_json ?? null) as { camera_movement?: string | null } | null;
    return {
      surface: "legacy_lab",
      rated_at: String(i.created_at),
      rating: (i.rating as number | null) ?? null,
      rating_reasons: Array.isArray(i.tags) ? (i.tags as string[]) : null,
      user_comment: (i.user_comment as string | null) ?? null,
      source_image_url: session?.image_url ?? null,
      clip_url: (i.clip_url as string | null) ?? null,
      sku,
      provider,
      listing_name: listingName,
      scene_id: null,
      iteration_id: i.id as string,
      room_type: analysis?.room_type ?? null,
      camera_movement: director?.camera_movement ?? null,
      has_embedding: i.embedding != null,
      has_model_used: false,
      recipe_id: null,
    };
  });
}

async function fetchListingsLab(supabase: ReturnType<typeof getSupabase>): Promise<LedgerRow[]> {
  const { data: iterations, error: iterErr } = await supabase
    .from("prompt_lab_listing_scene_iterations")
    .select("id, scene_id, rating, rating_reasons, user_comment, clip_url, model_used, embedding, created_at")
    .not("rating", "is", null);
  if (iterErr) throw iterErr;

  const sceneIds = Array.from(new Set((iterations ?? []).map((i) => i.scene_id as string)));
  const sceneIndex = new Map<
    string,
    { listing_id: string; photo_id: string; room_type: string | null; camera_movement: string | null }
  >();
  if (sceneIds.length > 0) {
    const { data: scenes, error: sceneErr } = await supabase
      .from("prompt_lab_listing_scenes")
      .select("id, listing_id, photo_id, room_type, camera_movement")
      .in("id", sceneIds);
    if (sceneErr) throw sceneErr;
    for (const s of scenes ?? []) {
      sceneIndex.set(s.id as string, {
        listing_id: s.listing_id as string,
        photo_id: s.photo_id as string,
        room_type: (s.room_type as string | null) ?? null,
        camera_movement: (s.camera_movement as string | null) ?? null,
      });
    }
  }

  const photoIds = Array.from(new Set(Array.from(sceneIndex.values()).map((s) => s.photo_id)));
  const photoIndex = new Map<string, string>();
  if (photoIds.length > 0) {
    const { data: photos, error: photoErr } = await supabase
      .from("prompt_lab_listing_photos")
      .select("id, image_url")
      .in("id", photoIds);
    if (photoErr) throw photoErr;
    for (const p of photos ?? []) photoIndex.set(p.id as string, (p.image_url as string) ?? "");
  }

  const listingIds = Array.from(new Set(Array.from(sceneIndex.values()).map((s) => s.listing_id)));
  const listingIndex = new Map<string, string>();
  if (listingIds.length > 0) {
    const { data: listings, error: listErr } = await supabase
      .from("prompt_lab_listings")
      .select("id, name")
      .in("id", listingIds);
    if (listErr) throw listErr;
    for (const l of listings ?? []) listingIndex.set(l.id as string, (l.name as string) ?? "");
  }

  return (iterations ?? []).map((i): LedgerRow => {
    const scene = sceneIndex.get(i.scene_id as string);
    const sourceImage = scene ? photoIndex.get(scene.photo_id) ?? null : null;
    const listingName = scene ? listingIndex.get(scene.listing_id) ?? null : null;
    const modelUsed = (i.model_used as string | null) ?? null;
    return {
      surface: "listings_lab",
      rated_at: String(i.created_at),
      rating: (i.rating as number | null) ?? null,
      rating_reasons: Array.isArray(i.rating_reasons) ? (i.rating_reasons as string[]) : null,
      user_comment: (i.user_comment as string | null) ?? null,
      source_image_url: sourceImage,
      clip_url: (i.clip_url as string | null) ?? null,
      sku: modelUsed,
      provider: modelUsed ? modelUsed.split("-")[0] : null,
      listing_name: listingName,
      scene_id: (i.scene_id as string | null) ?? null,
      iteration_id: i.id as string,
      room_type: scene?.room_type ?? null,
      camera_movement: scene?.camera_movement ?? null,
      has_embedding: i.embedding != null,
      has_model_used: modelUsed != null && modelUsed.length > 0,
      recipe_id: null,
    };
  });
}

async function fetchProd(supabase: ReturnType<typeof getSupabase>): Promise<LedgerRow[]> {
  const { data: ratings, error: ratErr } = await supabase
    .from("scene_ratings")
    .select(
      "id, scene_id, property_id, rating, comment, tags, created_at, updated_at, rated_snapshot_at, rated_prompt, rated_camera_movement, rated_room_type, rated_provider, rated_clip_url, rated_embedding",
    )
    .not("rating", "is", null);
  if (ratErr) throw ratErr;

  const sceneIds = Array.from(new Set((ratings ?? []).map((r) => r.scene_id).filter((v): v is string => typeof v === "string")));
  const sceneIndex = new Map<string, { photo_id: string | null; clip_url: string | null; provider: string | null; embedding: unknown }>();
  if (sceneIds.length > 0) {
    const { data: scenes, error: sceneErr } = await supabase
      .from("scenes")
      .select("id, photo_id, clip_url, provider, embedding")
      .in("id", sceneIds);
    if (sceneErr) throw sceneErr;
    for (const s of scenes ?? []) {
      sceneIndex.set(s.id as string, {
        photo_id: (s.photo_id as string | null) ?? null,
        clip_url: (s.clip_url as string | null) ?? null,
        provider: (s.provider as string | null) ?? null,
        embedding: s.embedding ?? null,
      });
    }
  }

  const photoIds = Array.from(
    new Set(
      Array.from(sceneIndex.values())
        .map((s) => s.photo_id)
        .filter((v): v is string => typeof v === "string"),
    ),
  );
  const photoIndex = new Map<string, string>();
  if (photoIds.length > 0) {
    const { data: photos, error: photoErr } = await supabase
      .from("photos")
      .select("id, file_url")
      .in("id", photoIds);
    if (photoErr) throw photoErr;
    for (const p of photos ?? []) photoIndex.set(p.id as string, (p.file_url as string) ?? "");
  }

  const propertyIds = Array.from(new Set((ratings ?? []).map((r) => r.property_id).filter((v): v is string => typeof v === "string")));
  const propertyIndex = new Map<string, string>();
  if (propertyIds.length > 0) {
    const { data: properties, error: propErr } = await supabase
      .from("properties")
      .select("id, address")
      .in("id", propertyIds);
    if (propErr) throw propErr;
    for (const p of properties ?? []) propertyIndex.set(p.id as string, (p.address as string) ?? "");
  }

  return (ratings ?? []).map((r): LedgerRow => {
    const scene = r.scene_id ? sceneIndex.get(r.scene_id as string) : undefined;
    const sourceImage = scene?.photo_id ? photoIndex.get(scene.photo_id) ?? null : null;
    const clipUrl = (r.rated_clip_url as string | null) ?? scene?.clip_url ?? null;
    const provider = (r.rated_provider as string | null) ?? scene?.provider ?? null;
    const sku = providerToSku(provider);
    const ratedAt = String(r.rated_snapshot_at ?? r.updated_at ?? r.created_at);
    const listingName = r.property_id ? propertyIndex.get(r.property_id as string) ?? null : null;
    const hasEmbedding = r.rated_embedding != null || scene?.embedding != null;
    return {
      surface: "prod",
      rated_at: ratedAt,
      rating: (r.rating as number | null) ?? null,
      rating_reasons: Array.isArray(r.tags) ? (r.tags as string[]) : null,
      user_comment: (r.comment as string | null) ?? null,
      source_image_url: sourceImage,
      clip_url: clipUrl,
      sku,
      provider,
      listing_name: listingName,
      scene_id: (r.scene_id as string | null) ?? null,
      iteration_id: r.id as string,
      room_type: (r.rated_room_type as string | null) ?? null,
      camera_movement: (r.rated_camera_movement as string | null) ?? null,
      has_embedding: hasEmbedding,
      has_model_used: false,
      recipe_id: null,
    };
  });
}

async function fetchRecipeIndex(supabase: ReturnType<typeof getSupabase>): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("prompt_lab_recipes")
    .select("id, source_iteration_id")
    .eq("status", "active");
  if (error) throw error;
  const index = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.source_iteration_id) index.set(row.source_iteration_id as string, row.id as string);
  }
  return index;
}
