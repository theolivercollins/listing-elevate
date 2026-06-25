/**
 * CRUD helpers for the drive_intake and drive_watch_state tables.
 *
 * Uses the service-role Supabase client from lib/db.ts — never creates its
 * own client. Mirrors the style of lib/db.ts (getSupabase() call per fn,
 * `.js` imports, error-throw pattern).
 */

import { getSupabase } from "../db.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DriveIntakeStatus =
  | "detected"
  | "awaiting_approval"
  | "approved"
  | "skipped"
  | "ingesting"
  | "generating"
  | "rendered"
  | "error";

export interface DriveIntake {
  id: string;
  drive_folder_id: string;
  address: string;
  final_folder_id: string | null;
  photo_count: number;
  /** ISO timestamp of the last time photo_count changed. */
  last_count_change_at: string;
  status: DriveIntakeStatus;
  /** Telegram message ID of the approval prompt (bigint stored as JS number). */
  telegram_message_id: number | null;
  feedback_notes: string | null;
  property_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DriveWatchState {
  /** Always 'singleton'. */
  id: string;
  channel_id: string | null;
  resource_id: string | null;
  /** Epoch ms when the Drive push-notification channel expires. */
  expiration: number | null;
  start_page_token: string | null;
  updated_at: string;
}

// ── drive_intake ──────────────────────────────────────────────────────────────

/**
 * Insert a new drive_intake row, or update photo_count when it changes.
 *
 * Rules:
 *  - Insert with status='detected' when driveFolderId is unknown.
 *  - On existing row, if photoCount changed: update photo_count + last_count_change_at.
 *  - If unchanged: return existing row without any write.
 *  - Never touch status — the caller (or cron) advances it.
 *
 * Returns the current row after any write.
 */
export async function upsertDetectedFolder(input: {
  driveFolderId: string;
  address: string;
  finalFolderId: string | null;
  photoCount: number;
}): Promise<DriveIntake> {
  const supabase = getSupabase();

  const { data: existing, error: selectError } = await supabase
    .from("drive_intake")
    .select()
    .eq("drive_folder_id", input.driveFolderId)
    .maybeSingle();
  if (selectError) throw selectError;

  if (!existing) {
    // New folder — insert with detected status
    const { data, error } = await supabase
      .from("drive_intake")
      .insert({
        drive_folder_id: input.driveFolderId,
        address: input.address,
        final_folder_id: input.finalFolderId,
        photo_count: input.photoCount,
        last_count_change_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;
    return data as DriveIntake;
  }

  const existingRow = existing as DriveIntake;

  // Photo count unchanged — nothing to write
  if (existingRow.photo_count === input.photoCount) {
    return existingRow;
  }

  // Photo count changed — update count, timestamp, and final_folder_id.
  // Deliberately do NOT touch status: an already-approved/generating row must
  // not be downgraded.
  const { data, error } = await supabase
    .from("drive_intake")
    .update({
      photo_count: input.photoCount,
      last_count_change_at: new Date().toISOString(),
      final_folder_id: input.finalFolderId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existingRow.id)
    .select()
    .single();
  if (error) throw error;
  return data as DriveIntake;
}

export async function getIntake(id: string): Promise<DriveIntake | null> {
  const { data, error } = await getSupabase()
    .from("drive_intake")
    .select()
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as DriveIntake | null) ?? null;
}

export async function getIntakeByFolder(
  driveFolderId: string,
): Promise<DriveIntake | null> {
  const { data, error } = await getSupabase()
    .from("drive_intake")
    .select()
    .eq("drive_folder_id", driveFolderId)
    .maybeSingle();
  if (error) throw error;
  return (data as DriveIntake | null) ?? null;
}

/**
 * Return rows with status='detected', photo_count>0, and
 * last_count_change_at <= now()-settleMinutes (i.e., stable / settled).
 */
export async function getStableDetected(settleMinutes: number): Promise<DriveIntake[]> {
  const cutoff = new Date(Date.now() - settleMinutes * 60 * 1_000).toISOString();
  const { data, error } = await getSupabase()
    .from("drive_intake")
    .select()
    .eq("status", "detected")
    .gt("photo_count", 0)
    .lte("last_count_change_at", cutoff);
  if (error) throw error;
  return (data ?? []) as DriveIntake[];
}

export async function getByStatus(status: DriveIntakeStatus): Promise<DriveIntake[]> {
  const { data, error } = await getSupabase()
    .from("drive_intake")
    .select()
    .eq("status", status);
  if (error) throw error;
  return (data ?? []) as DriveIntake[];
}

export async function setStatus(
  id: string,
  status: DriveIntakeStatus,
  patch?: Partial<Omit<DriveIntake, "id" | "drive_folder_id" | "created_at">>,
): Promise<void> {
  const { error } = await getSupabase()
    .from("drive_intake")
    .update({
      status,
      updated_at: new Date().toISOString(),
      ...(patch ?? {}),
    })
    .eq("id", id);
  if (error) throw error;
}

export async function setTelegramMessageId(
  id: string,
  messageId: number,
): Promise<void> {
  const { error } = await getSupabase()
    .from("drive_intake")
    .update({
      telegram_message_id: messageId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

export async function setPropertyId(id: string, propertyId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("drive_intake")
    .update({
      property_id: propertyId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Append `notes` to feedback_notes (newline-separated).
 * Reads the existing row first then writes; best suited for low-frequency ops.
 */
export async function appendFeedback(id: string, notes: string): Promise<void> {
  const existing = await getIntake(id);
  const combined = existing?.feedback_notes
    ? `${existing.feedback_notes}\n${notes}`
    : notes;
  const { error } = await getSupabase()
    .from("drive_intake")
    .update({
      feedback_notes: combined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Atomic CAS claim: transitions status → 'ingesting' only when the row is
 * still in 'awaiting_approval' or 'approved'.
 *
 * Returns true if this caller won the race (exactly one row updated), false if
 * another caller already claimed it (no rows matched the status filter).
 * Throws on DB error.
 */
export async function claimForApproval(id: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from("drive_intake")
    .update({
      status: "ingesting" as DriveIntakeStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .in("status", ["awaiting_approval", "approved"])
    .select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length === 1;
}

// ── drive_watch_state ─────────────────────────────────────────────────────────

export async function getWatchState(): Promise<DriveWatchState | null> {
  const { data, error } = await getSupabase()
    .from("drive_watch_state")
    .select()
    .eq("id", "singleton")
    .maybeSingle();
  if (error) throw error;
  return (data as DriveWatchState | null) ?? null;
}

export async function upsertWatchState(
  patch: Partial<Omit<DriveWatchState, "id">>,
): Promise<void> {
  const { error } = await getSupabase()
    .from("drive_watch_state")
    .upsert({
      id: "singleton",
      ...patch,
      updated_at: new Date().toISOString(),
    });
  if (error) throw error;
}
