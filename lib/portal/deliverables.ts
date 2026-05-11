import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

export function generateReviewToken(): string {
  // 32 bytes → 64 hex chars. URL-safe by construction.
  return randomBytes(32).toString("hex");
}

export interface CreateDeliverableInput {
  orderId: string;
  title: string;
}

export async function createDeliverable(
  supabase: SupabaseClient,
  input: CreateDeliverableInput,
): Promise<{ id: string; review_token: string }> {
  const review_token = generateReviewToken();
  const { data, error } = await supabase
    .from("portal_deliverables")
    .insert({ order_id: input.orderId, title: input.title, review_token })
    .select("id, review_token")
    .single();
  if (error || !data) throw new Error(`createDeliverable failed: ${error?.message ?? "no data"}`);
  return data;
}

export interface CreateVersionInput {
  deliverableId: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadNote?: string;
  uploadedBy: string;
}

export async function createVersionRow(
  supabase: SupabaseClient,
  input: CreateVersionInput,
  storagePath: string,
): Promise<{ id: string; version: number }> {
  // Determine the next version number for this deliverable.
  const { data: latest } = await supabase
    .from("portal_deliverable_versions")
    .select("version")
    .eq("deliverable_id", input.deliverableId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (latest?.version ?? 0) + 1;

  const { data, error } = await supabase
    .from("portal_deliverable_versions")
    .insert({
      deliverable_id: input.deliverableId,
      version: nextVersion,
      file_name: input.fileName,
      file_size_bytes: input.fileSizeBytes,
      mime_type: input.mimeType,
      upload_note: input.uploadNote ?? null,
      uploaded_by: input.uploadedBy,
      storage_path: storagePath,
      upload_status: "pending",
    })
    .select("id, version")
    .single();
  if (error || !data) throw new Error(`createVersionRow failed: ${error?.message ?? "no data"}`);
  return data;
}

export async function markVersionUploaded(
  supabase: SupabaseClient,
  versionId: string,
): Promise<void> {
  const { error } = await supabase
    .from("portal_deliverable_versions")
    .update({ upload_status: "uploaded" })
    .eq("id", versionId);
  if (error) throw new Error(`markVersionUploaded failed: ${error.message}`);
}

export async function getLatestUploadedVersion(
  supabase: SupabaseClient,
  deliverableId: string,
): Promise<{ id: string; version: number; storage_path: string; file_name: string } | null> {
  const { data, error } = await supabase
    .from("portal_deliverable_versions")
    .select("id, version, storage_path, file_name")
    .eq("deliverable_id", deliverableId)
    .eq("upload_status", "uploaded")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLatestUploadedVersion failed: ${error.message}`);
  return data;
}
