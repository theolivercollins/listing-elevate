import { supabase } from "@/lib/supabase";

export type BucketStatus = "WINNER" | "NO_WINNER" | "EMPTY";

export interface BucketSkuStat {
  sku: string;
  iter_count: number;
  rated_4plus_count: number;
  win_rate: number;
}

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

export interface BucketProgressResponse {
  buckets: BucketProgress[];
  generated_at: string;
  min_iterations_per_winner: number;
  min_win_rate: number;
}

export async function fetchBucketProgress(signal?: AbortSignal): Promise<BucketProgressResponse> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = {};
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

  const res = await fetch("/api/admin/bucket-progress", { headers, signal });
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
  return body as BucketProgressResponse;
}
