/**
 * CRUD helpers for the drive_intake and drive_watch_state tables.
 *
 * Uses the service-role Supabase client from lib/db.ts — never creates its
 * own client. Mirrors the style of lib/db.ts (getSupabase() call per fn,
 * `.js` imports, error-throw pattern).
 */

import crypto from "node:crypto";
import { getSupabase } from "../db.js";
import type { RefineAction, RefineChatMessage } from "../telegram/refine-types.js";

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
  /**
   * FK to delivery_runs.id once this intake is routed through the operator
   * delivery pipeline (lib/drive/orchestrate.ts approveIntake — migration 101).
   * Optional (not required) so existing DriveIntake object literals elsewhere
   * in the codebase (lib/telegram/*, api/telegram/webhook.ts — owned by other
   * tasks) keep compiling without needing to list this column.
   */
  delivery_run_id?: string | null;
  /**
   * Last-seen delivery_runs.paused_reason for this intake (migration 101).
   * Lets pollResults (lib/drive/detect.ts) dedupe "paused for review" Telegram
   * notifications — only notify when the reason first appears or changes;
   * cleared back to null when the run resumes. Optional for the same
   * cross-file compatibility reason as delivery_run_id.
   */
  last_paused_reason?: string | null;
  /**
   * Telegram conversational-refine conversation history for this intake,
   * newest-last (migration 101). Capped to the last ~20 turns by
   * appendChatMessages. Optional for the same cross-file compatibility
   * reason as delivery_run_id.
   */
  chat_messages?: RefineChatMessage[];
  /**
   * Staged (not-yet-applied) refine plan awaiting operator confirmation via
   * the Telegram inline-keyboard apply/adjust/cancel callback (migration
   * 101). Set by stagePlan, read by getPendingPlan, cleared by
   * clearPendingPlan/consumePlan.
   */
  pending_plan?: StagedPlan | null;
  /**
   * Opaque id for `pending_plan`, echoed back via the "apply:<id>" /
   * "adjust:<id>" / "cancel:<id>" callback data. Single-use — see
   * pending_plan_consumed_at.
   */
  pending_plan_id?: string | null;
  /** When `pending_plan` was staged — drives the 1h staleness expiry in getPendingPlan. */
  pending_plan_created_at?: string | null;
  /** When `pending_plan` was applied. null = still pending. */
  pending_plan_consumed_at?: string | null;
}

/**
 * The shape persisted at drive_intake.pending_plan — the batched, validated
 * RefineAction[] a Telegram confirm/adjust/cancel callback resolves against.
 * Mirrors the subset of RefinePlan (lib/telegram/refine-types.ts) that needs
 * to survive a round trip to Postgres and back.
 */
export interface StagedPlan {
  actions: RefineAction[];
  summary: string;
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

/**
 * Case-insensitive substring search over drive_intake.address — resolves a
 * free-text listing name (e.g. "kinglet") to candidate Drive-intake rows for
 * the Telegram create-intent flow ("make a vid for <name>" — see
 * parseCreateIntent/handleCreateIntent, lib/telegram/refine-conversation.ts).
 *
 * Matches across EVERY status — deliberately not filtered here. A folder can
 * legitimately be found in any status (pre-seeded 'skipped', freshly
 * 'detected', mid-flight 'generating', already 'rendered', a prior 'error',
 * etc.), and what each status means for a create-intent request differs
 * (start it / already in flight / already done / retry-eligible). The
 * CALLER decides that — see handleCreateIntent's per-status branching — so
 * this stays a plain lookup, not a policy decision.
 *
 * `%`/`_` are escaped in `query` before building the ilike pattern (mirrors
 * api/admin/studio/videos/index.ts's existing convention) so a listing name
 * containing either character can't be misread as a SQL LIKE wildcard.
 * Ordered newest-first, capped at 5 — enough to disambiguate a handful of
 * near-duplicate addresses; more than that is a UX smell the operator should
 * resolve by typing a more specific query, not something worth paginating.
 */
export async function findIntakesByAddress(query: string): Promise<DriveIntake[]> {
  const escaped = query.replace(/[%_]/g, "\\$&");
  const { data, error } = await getSupabase()
    .from("drive_intake")
    .select()
    .ilike("address", `%${escaped}%`)
    .order("created_at", { ascending: false })
    .limit(5);
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
 * Link a drive_intake row to the operator delivery_runs row it was routed
 * through (set by approveIntake on the delivery-pipeline path — migration 101).
 */
export async function setDeliveryRunId(id: string, runId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("drive_intake")
    .update({
      delivery_run_id: runId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Record the last-seen delivery_runs.paused_reason for this intake, or clear
 * it with `reason: null` once the run resumes. Lets pollResults
 * (lib/drive/detect.ts) dedupe "paused for review" Telegram notifications.
 */
export async function setLastPausedReason(
  id: string,
  reason: string | null,
): Promise<void> {
  const { error } = await getSupabase()
    .from("drive_intake")
    .update({
      last_paused_reason: reason,
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

/**
 * Atomic stuck-ingesting reaper: transitions rows stuck in 'ingesting'
 * (updated_at older than staleMinutes minutes ago) back to 'awaiting_approval'.
 *
 * Only reaps pre-property rows (property_id IS NULL). Post-property rows that
 * are stuck — e.g. a crash AFTER createProperty but during photo upload — are
 * excluded from the reset because approveIntake would call createProperty a
 * second time, orphaning the first queued property. Those rows remain in
 * 'ingesting' and must be resolved via ops/manual intervention.
 *
 * The UPDATE … RETURNING * pattern is atomic at the DB level — only rows that
 * satisfy ALL conditions are touched. Returns the reaped rows so a cron can
 * notify the operator; returns [] when nothing was reaped.
 * Throws on DB error.
 */
export async function reapStuckIngesting(staleMinutes: number): Promise<DriveIntake[]> {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1_000).toISOString();
  const { data, error } = await getSupabase()
    .from("drive_intake")
    .update({
      status: "awaiting_approval" as DriveIntakeStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("status", "ingesting")
    .lt("updated_at", cutoff)
    .is("property_id", null)
    .select();
  if (error) throw error;
  return (data ?? []) as DriveIntake[];
}

/**
 * Atomic CAS claim for regeneration: transitions status → 'ingesting' only when
 * the row is in 'rendered', 'generating', or 'error' (states from which an
 * operator 🔁 tap is valid).
 *
 * Returns true if this caller won the race (exactly one row updated), false if
 * another concurrent tap already claimed it (row is already 'ingesting').
 * Throws on DB error.
 */
export async function claimForRegenerate(id: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from("drive_intake")
    .update({
      status: "ingesting" as DriveIntakeStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .in("status", ["rendered", "generating", "error"])
    .select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length === 1;
}

// ── Telegram conversational-refine state (migration 101) ────────────────────

/** Cap on persisted conversation turns — bounds the drive_intake row size and
 *  the prompt context fed to planRefinement on every turn. */
const MAX_CHAT_MESSAGES = 20;

/** How long a staged plan stays confirmable before getPendingPlan treats it
 *  as expired (the user must re-ask; the model may have gone stale). */
const PENDING_PLAN_TTL_MS = 60 * 60 * 1_000;

/**
 * Append `msgs` (typically one user turn + one assistant turn) to
 * chat_messages, capped to the last MAX_CHAT_MESSAGES entries. Read-then-write
 * (matches appendFeedback's style) — fine at this volume (one operator, a
 * handful of turns per conversation).
 */
export async function appendChatMessages(
  id: string,
  msgs: RefineChatMessage[],
): Promise<void> {
  const existing = await getIntake(id);
  const combined = [...(existing?.chat_messages ?? []), ...msgs].slice(-MAX_CHAT_MESSAGES);
  const { error } = await getSupabase()
    .from("drive_intake")
    .update({
      chat_messages: combined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

export async function getChatMessages(id: string): Promise<RefineChatMessage[]> {
  const existing = await getIntake(id);
  return existing?.chat_messages ?? [];
}

/**
 * Stage a batched refine plan awaiting operator confirmation: writes
 * pending_plan + a fresh opaque pending_plan_id + pending_plan_created_at,
 * and clears pending_plan_consumed_at (a fresh stage is always unconsumed,
 * even if it's replacing an older, still-pending plan). Returns the new
 * planId to embed in the Telegram inline-keyboard callback data.
 */
export async function stagePlan(
  id: string,
  plan: StagedPlan,
): Promise<string> {
  const planId = crypto.randomUUID();
  const { error } = await getSupabase()
    .from("drive_intake")
    .update({
      pending_plan: plan,
      pending_plan_id: planId,
      pending_plan_created_at: new Date().toISOString(),
      pending_plan_consumed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
  return planId;
}

/**
 * Read back a staged plan iff: the row's pending_plan_id matches `planId`,
 * it has not already been consumed, and it was staged within the last hour.
 * Returns null on any mismatch/expiry/absence — callers treat all of those
 * uniformly as "nothing to apply" (see lib/telegram/refine-conversation.ts).
 */
export async function getPendingPlan(
  id: string,
  planId: string,
): Promise<StagedPlan | null> {
  const intake = await getIntake(id);
  if (!intake) return null;
  if (!intake.pending_plan_id || intake.pending_plan_id !== planId) return null;
  if (intake.pending_plan_consumed_at) return null;
  if (!intake.pending_plan_created_at) return null;
  const ageMs = Date.now() - new Date(intake.pending_plan_created_at).getTime();
  if (ageMs > PENDING_PLAN_TTL_MS) return null;
  return intake.pending_plan ?? null;
}

/**
 * Resolve the drive_intake row a staged plan is bound to, directly from its
 * `planId` — the row where pending_plan_id = planId AND it hasn't been
 * consumed yet AND it was staged within the last hour (mirrors the exact
 * TTL/consumed-at logic in getPendingPlan above).
 *
 * FIX 3 (plan-binding race): handleApplyCallback/handleAdjustCallback/
 * handleCancelCallback (lib/telegram/refine-conversation.ts) used to resolve
 * their target intake via getActiveRefineIntake() — "whichever intake is
 * currently active" — and only THEN look up the plan on it. But the active
 * intake (ordered by created_at DESC over eligible rows) can change between
 * when a confirm card was sent and when the operator taps a button on it (a
 * newer listing entering the eligible set mid-conversation) — so a stale
 * "active" lookup could apply a plan to the WRONG listing's run. The planId
 * embedded in the callback data (`apply:<planId>` etc.) is already the
 * caller's unambiguous proof of which row this callback belongs to; this
 * function resolves straight from that planId instead of via "active" state.
 *
 * Returns null on any mismatch/expiry/absence — same "nothing to apply" /
 * "not pending" contract every caller of getPendingPlan already handles.
 */
export async function getIntakeByPendingPlanId(planId: string): Promise<DriveIntake | null> {
  const cutoff = new Date(Date.now() - PENDING_PLAN_TTL_MS).toISOString();
  const { data, error } = await getSupabase()
    .from("drive_intake")
    .select()
    .eq("pending_plan_id", planId)
    .is("pending_plan_consumed_at", null)
    .gt("pending_plan_created_at", cutoff)
    .maybeSingle();
  if (error) throw error;
  return (data as DriveIntake | null) ?? null;
}

/**
 * Atomic CAS claim on the staged plan: sets pending_plan_consumed_at only
 * where pending_plan_id=planId AND consumed_at IS NULL. Returns true iff this
 * caller won the race (exactly one row updated) — single-use, so a replayed
 * "apply:<planId>" callback (Telegram retry, or a double-tap) safely no-ops
 * for every caller after the first.
 */
export async function consumePlan(id: string, planId: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from("drive_intake")
    .update({
      pending_plan_consumed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("pending_plan_id", planId)
    .is("pending_plan_consumed_at", null)
    .select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length === 1;
}

/** Fully clear a staged plan (adjust/cancel) so a stale callback with the old
 *  planId can never match again — getPendingPlan/consumePlan both key off
 *  pending_plan_id, which this sets back to null. FIX 3: this is also how
 *  Adjust/Cancel clear the conversational accumulation coherently —
 *  accumulatePlan (below) stores the running, not-yet-committed action set
 *  in this SAME pending_plan column, so resetting it here discards a
 *  dangling accumulation exactly the same way it discards a stale staged
 *  plan. There is nothing separate to clear. */
export async function clearPendingPlan(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from("drive_intake")
    .update({
      pending_plan: null,
      pending_plan_id: null,
      pending_plan_created_at: null,
      pending_plan_consumed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

/**
 * FIX 3 (Plan B decision 9 — docs/specs/2026-07-01-telegram-conversational-
 * refine.md): persist the growing, NOT-YET-CONFIRMABLE set of pending
 * refine actions across turns for the "accumulate, then one confirm + one
 * render on an explicit commit" flow (see handleAccumulateOrCommit in
 * lib/telegram/refine-conversation.ts).
 *
 * Reuses the SAME pending_plan jsonb column stagePlan/getPendingPlan/
 * consumePlan/clearPendingPlan already manage, but deliberately does NOT
 * mint a pending_plan_id (nor touch pending_plan_created_at/consumed_at):
 * an accumulating plan has not been shown to the operator as a confirm card
 * yet, so it must never be reachable via an "apply:<id>"/"adjust:<id>"/
 * "cancel:<id>" callback — getPendingPlan/consumePlan both require an EXACT
 * pending_plan_id match, and leaving it null means neither can ever resolve
 * this row while it is still only accumulating. stagePlan is what promotes
 * an accumulation into a confirmable plan once the operator commits ("go") —
 * at that point it is staged (and thus becomes tappable) via the ordinary
 * stagePlan call, not this one.
 *
 * Also clears any PRE-EXISTING pending_plan_id/created_at/consumed_at: if an
 * earlier commit already staged a confirmable plan (a confirm card is still
 * showing) and the operator keeps chatting instead of tapping a button, this
 * accumulation supersedes it — that card's buttons must fail safe ("that's
 * already been applied" / "not pending anymore") rather than one day
 * silently applying a larger, different action set than what the card
 * displayed when it was shown.
 *
 * Callers are expected to have already MERGED `plan.actions`/`plan.summary`
 * with whatever was previously accumulated — handleAccumulateOrCommit
 * already holds the current DriveIntake row (from getActiveRefineIntake), so
 * no extra read-before-write is needed here, unlike appendChatMessages/
 * appendFeedback's read-then-write style.
 */
export async function accumulatePlan(id: string, plan: StagedPlan): Promise<void> {
  const { error } = await getSupabase()
    .from("drive_intake")
    .update({
      pending_plan: plan,
      pending_plan_id: null,
      pending_plan_created_at: null,
      pending_plan_consumed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

/**
 * The single "current conversation" the Telegram refine agent operates on:
 * the drive_intake row that has been routed through the operator delivery
 * pipeline (delivery_run_id set), is still in-flight or just delivered
 * (status 'generating' or 'rendered'), and was CREATED most recently.
 *
 * FIX 2 — ordered by created_at, NEVER updated_at: this feature's own
 * background writes (setStatus, setLastPausedReason, plan staging/
 * accumulation — see lib/telegram/refine-conversation.ts) bump updated_at on
 * essentially every turn, so ordering by updated_at let "the active
 * conversation" silently reorder mid-conversation the moment ANOTHER
 * eligible intake received any background write — a message could then
 * mutate the wrong listing. created_at is immutable once a row exists, so
 * the target intake stays pinned to the SAME listing for its whole
 * conversation lifetime.
 *
 * Single-operator design (see docs/specs/2026-07-01-telegram-conversational-
 * refine.md) — there is deliberately no per-conversation/per-chat selector;
 * with multiple concurrently-active listings this targets the newest-
 * created one. Explicit per-chat selection is a follow-up. Note this only
 * stabilizes which listing a NEW free-text turn resolves to BEFORE a plan is
 * staged — a staged plan is already bound to its own intake id (stagePlan/
 * getPendingPlan/consumePlan key off `id`, not this lookup), so apply/adjust/
 * cancel on an already-staged plan can't cross listings regardless.
 */
export async function getActiveRefineIntake(): Promise<DriveIntake | null> {
  const { data, error } = await getSupabase()
    .from("drive_intake")
    .select()
    .not("delivery_run_id", "is", null)
    .in("status", ["generating", "rendered"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as DriveIntake | null) ?? null;
}

// ── Telegram webhook idempotency (migration 101) ─────────────────────────────
// Dedupe ledger for telegram_processed_updates — see the migration's own
// docblock for why this must be a durable Postgres table rather than an
// in-memory cache (stateless serverless invocations, Telegram retries on
// timeout/non-2xx, and the handler's side effects are not safe to repeat).
//
// C1: this is a single ATOMIC CLAIM (insert-and-check), not a check-then-act
// pair. The old isUpdateProcessed() + markUpdateProcessed() two-step had a
// TOCTOU gap — two concurrent deliveries of the same update_id could both
// pass the "not yet processed" check before either finished its insert, and
// both would then dispatch (a double render, or a double Haiku-planner
// charge on a replayed free-text message). A single INSERT with the
// update_id primary key is the actual race-free gate: whichever caller's
// insert lands first wins; every other caller for the same update_id gets a
// 23505 unique-violation back, deterministically, no matter how concurrent
// the retries are.

/**
 * Atomically claim `updateId` in the dedupe ledger. Returns `true` iff THIS
 * call's insert is the one that landed (i.e. this caller should proceed to
 * dispatch). A 23505 unique-violation means a concurrent/duplicate delivery
 * already claimed it first — that IS the dedupe working as intended, not a
 * failure, so it resolves `false` rather than throwing. Any other
 * (genuinely unexpected) DB error still throws — never silently treated as
 * either outcome.
 */
export async function markUpdateProcessed(updateId: number): Promise<boolean> {
  const { error } = await getSupabase()
    .from("telegram_processed_updates")
    .insert({ update_id: updateId })
    .select();
  if (error) {
    if ((error as { code?: string }).code === "23505") return false;
    throw error;
  }
  return true;
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
