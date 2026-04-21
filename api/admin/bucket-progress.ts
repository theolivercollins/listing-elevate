import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../lib/auth.js";
import { getSupabase } from "../../lib/client.js";
import { ATLAS_MODELS } from "../../lib/providers/atlas.js";

// GET /api/admin/bucket-progress
//
// Returns per-bucket progress for the 5 quota-high (room × movement) buckets
// defined in BUCKETS. Used by the RatingLedger top strip so Oliver can see
// live fill-state as he rates the D-grid clips in the Lab.
//
// Winner rule (mirrors scripts/build-router-table.ts):
//   n_iter >= 3 on a single SKU AND >= 80% of those rated >= 4*.
//   Tiebreak: higher avg_rating, then cheaper priceCentsPerClip.
//
// SKU-level signal only exists on Phase 2.8 listing iterations (`model_used`).
// Legacy Lab + prod scene_ratings contribute to total_iter + total_rated_4plus
// (so the card shows the true bucket volume) but cannot populate sku_breakdown.

export interface BucketSkuStat {
  sku: string;
  iter_count: number;
  rated_4plus_count: number;
  win_rate: number;
}

export type BucketStatus = "WINNER" | "NO_WINNER" | "EMPTY";

export interface BucketProgress {
  bucket_id: string;
  room_type: string;
  camera_movement: string;
  label: string;
  total_iter: number;
  total_rated_4plus: number;
  sku_breakdown: BucketSkuStat[];
  winner: { sku: string; win_rate: number } | null;
  status: BucketStatus;
}

interface BucketDef {
  bucket_id: string;
  room_type: string;
  camera_movement: string;
  label: string;
}

// The 5 quota-high buckets. Single source of truth — UI reads from the
// endpoint, never duplicates this list.
export const BUCKETS: BucketDef[] = [
  { bucket_id: "kitchen_push_in", room_type: "kitchen", camera_movement: "push_in", label: "kitchen × push_in" },
  { bucket_id: "living_room_push_in", room_type: "living_room", camera_movement: "push_in", label: "living_room × push_in" },
  { bucket_id: "master_bedroom_push_in", room_type: "master_bedroom", camera_movement: "push_in", label: "master_bedroom × push_in" },
  { bucket_id: "exterior_front_push_in", room_type: "exterior_front", camera_movement: "push_in", label: "exterior_front × push_in" },
  { bucket_id: "aerial_drone_push_in", room_type: "aerial", camera_movement: "drone_push_in", label: "aerial × drone_push_in" },
];

const MIN_ITERATIONS = 3;
const MIN_WIN_RATE = 0.8;
const NATIVE_KLING_PRICE_CENTS = 0;

interface Observation {
  room_type: string;
  camera_movement: string;
  sku: string | null;
  rating: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = getSupabase();

  try {
    const [phase28, legacy, prod] = await Promise.all([
      fetchPhase28(supabase),
      fetchLegacyLab(supabase),
      fetchProd(supabase),
    ]);
    const all = [...phase28, ...legacy, ...prod];

    const buckets: BucketProgress[] = BUCKETS.map((def) => buildBucket(def, all));

    return res.status(200).json({
      buckets,
      generated_at: new Date().toISOString(),
      min_iterations_per_winner: MIN_ITERATIONS,
      min_win_rate: MIN_WIN_RATE,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
}

function buildBucket(def: BucketDef, observations: Observation[]): BucketProgress {
  const inBucket = observations.filter(
    (o) => o.room_type === def.room_type && o.camera_movement === def.camera_movement,
  );

  const total_iter = inBucket.length;
  const total_rated_4plus = inBucket.filter((o) => o.rating >= 4).length;

  const bySku = new Map<string, number[]>();
  for (const o of inBucket) {
    if (!o.sku) continue;
    const arr = bySku.get(o.sku) ?? [];
    arr.push(o.rating);
    bySku.set(o.sku, arr);
  }

  const sku_breakdown: BucketSkuStat[] = [];
  for (const [sku, ratings] of bySku) {
    const iter_count = ratings.length;
    const rated_4plus_count = ratings.filter((r) => r >= 4).length;
    sku_breakdown.push({
      sku,
      iter_count,
      rated_4plus_count,
      win_rate: iter_count > 0 ? rated_4plus_count / iter_count : 0,
    });
  }
  sku_breakdown.sort((a, b) => b.iter_count - a.iter_count);

  const winner = pickWinner(sku_breakdown, bySku);

  let status: BucketStatus;
  if (winner) status = "WINNER";
  else if (total_iter === 0) status = "EMPTY";
  else status = "NO_WINNER";

  return {
    bucket_id: def.bucket_id,
    room_type: def.room_type,
    camera_movement: def.camera_movement,
    label: def.label,
    total_iter,
    total_rated_4plus,
    sku_breakdown,
    winner: winner ? { sku: winner.sku, win_rate: winner.win_rate } : null,
    status,
  };
}

function pickWinner(
  breakdown: BucketSkuStat[],
  bySku: Map<string, number[]>,
): BucketSkuStat | null {
  const qualified = breakdown.filter(
    (b) => b.iter_count >= MIN_ITERATIONS && b.win_rate >= MIN_WIN_RATE && skuIsRouterEligible(b.sku),
  );
  if (qualified.length === 0) return null;
  qualified.sort((a, b) => {
    const avgA = avgRating(bySku.get(a.sku) ?? []);
    const avgB = avgRating(bySku.get(b.sku) ?? []);
    if (avgB !== avgA) return avgB - avgA;
    return skuPriceCents(a.sku) - skuPriceCents(b.sku);
  });
  return qualified[0];
}

function avgRating(ratings: number[]): number {
  if (ratings.length === 0) return 0;
  return ratings.reduce((a, r) => a + r, 0) / ratings.length;
}

function skuIsRouterEligible(sku: string): boolean {
  if (sku === "kling-v2-native") return true;
  if (sku === "runway-gen4-turbo") return true;
  return Object.prototype.hasOwnProperty.call(ATLAS_MODELS, sku);
}

function skuPriceCents(sku: string): number {
  if (sku === "kling-v2-native") return NATIVE_KLING_PRICE_CENTS;
  const atlas = (ATLAS_MODELS as Record<string, { priceCentsPerClip?: number }>)[sku];
  if (atlas && typeof atlas.priceCentsPerClip === "number") return atlas.priceCentsPerClip;
  return Number.MAX_SAFE_INTEGER;
}

async function fetchPhase28(supabase: ReturnType<typeof getSupabase>): Promise<Observation[]> {
  const { data: iters, error: iterErr } = await supabase
    .from("prompt_lab_listing_scene_iterations")
    .select("rating, model_used, scene_id")
    .not("rating", "is", null);
  if (iterErr) throw iterErr;
  const rows = iters ?? [];
  const sceneIds = Array.from(new Set(rows.map((r) => r.scene_id as string)));
  if (sceneIds.length === 0) return [];

  const { data: scenes, error: sceneErr } = await supabase
    .from("prompt_lab_listing_scenes")
    .select("id, room_type, camera_movement")
    .in("id", sceneIds);
  if (sceneErr) throw sceneErr;
  const sceneIndex = new Map<string, { room: string; movement: string }>();
  for (const s of scenes ?? []) {
    sceneIndex.set(s.id as string, {
      room: String(s.room_type ?? ""),
      movement: String(s.camera_movement ?? ""),
    });
  }

  const out: Observation[] = [];
  for (const r of rows) {
    const scene = sceneIndex.get(r.scene_id as string);
    if (!scene || !scene.room || !scene.movement) continue;
    const sku = (r.model_used as string | null) ?? null;
    out.push({
      room_type: scene.room,
      camera_movement: scene.movement,
      sku,
      rating: r.rating as number,
    });
  }
  return out;
}

async function fetchLegacyLab(supabase: ReturnType<typeof getSupabase>): Promise<Observation[]> {
  const { data, error } = await supabase
    .from("prompt_lab_iterations")
    .select("rating, provider, analysis_json, director_output_json")
    .not("rating", "is", null);
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    rating: number;
    provider: string | null;
    analysis_json: { room_type?: string | null } | null;
    director_output_json: { camera_movement?: string | null } | null;
  }>;
  const out: Observation[] = [];
  for (const r of rows) {
    const room = r.analysis_json?.room_type;
    const movement = r.director_output_json?.camera_movement;
    if (!room || !movement) continue;
    out.push({
      room_type: room,
      camera_movement: movement,
      sku: null, // legacy Lab only records provider, not SKU
      rating: r.rating,
    });
  }
  return out;
}

async function fetchProd(supabase: ReturnType<typeof getSupabase>): Promise<Observation[]> {
  const { data, error } = await supabase
    .from("scene_ratings")
    .select("rating, rated_room_type, rated_camera_movement, rated_provider")
    .not("rating", "is", null);
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    rating: number;
    rated_room_type: string | null;
    rated_camera_movement: string | null;
    rated_provider: string | null;
  }>;
  const out: Observation[] = [];
  for (const r of rows) {
    if (!r.rated_room_type || !r.rated_camera_movement) continue;
    out.push({
      room_type: r.rated_room_type,
      camera_movement: r.rated_camera_movement,
      sku: null, // prod scene_ratings only records provider, not SKU
      rating: r.rating,
    });
  }
  return out;
}
