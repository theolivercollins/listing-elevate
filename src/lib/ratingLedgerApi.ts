import { supabase } from "@/lib/supabase";

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

export interface LedgerResponse {
  rows: LedgerRow[];
  total: number;
  counts: { legacy_lab: number; listings_lab: number; prod: number };
}

export interface LedgerParams {
  limit?: number;
  offset?: number;
  surface?: LedgerSurface | "all";
  sku?: string | null;
  minRating?: number | null;
  hasComment?: boolean | null;
  roomType?: string | null;
  cameraMovement?: string | null;
}

export async function fetchRatingLedger(params: LedgerParams = {}): Promise<LedgerResponse> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit ?? 50));
  qs.set("offset", String(params.offset ?? 0));
  if (params.surface && params.surface !== "all") qs.set("surface", params.surface);
  if (params.sku) qs.set("sku", params.sku);
  if (params.minRating != null) qs.set("min_rating", String(params.minRating));
  if (params.hasComment != null) qs.set("has_comment", String(params.hasComment));
  if (params.roomType) qs.set("room_type", params.roomType);
  if (params.cameraMovement) qs.set("camera_movement", params.cameraMovement);

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = {};
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

  const res = await fetch(`/api/admin/rating-ledger?${qs.toString()}`, { headers });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg = body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return body as LedgerResponse;
}
