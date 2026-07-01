/**
 * lib/telegram/refine-conversation.ts
 *
 * Orchestrates the Telegram conversational refine agent so
 * api/telegram/webhook.ts stays a thin router. Wires together:
 *   - refine-context.ts  (buildRefineContext / validateRefineActions)
 *   - refine-agent.ts    (planRefinement — the Haiku planner)
 *   - refine-execute.ts  (executeRefinement — the deterministic executor)
 *   - drive/intake-db.ts (conversation state: active intake, chat history,
 *                         staged plan, single-use consume)
 *
 * Two entry points, called directly from the webhook:
 *   handleRefineMessage(text)   — a plain-text Telegram message
 *   handleRefineCallback(data)  — an apply:/adjust:/cancel:<planId> tap
 *
 * CREATE-INTENT — handleRefineMessage's FIRST check, before any active-intake
 * resolution: a message like "make a vid for kinglet" names a listing to
 * START (not refine an already-active one), and the target folder is very
 * often sitting in drive_intake with status='skipped' (137 pre-existing Drive
 * folders were deliberately pre-seeded skipped so activation didn't spam 137
 * approval prompts) — a status getActiveRefineIntake never looks at. See
 * parseCreateIntent/handleCreateIntent below: a cheap deterministic (no LLM
 * call) matcher finds the folder by name and (re)sends the SAME approval
 * card settleAndPrompt uses (lib/drive/detect.ts's buildApprovalPromptText/
 * buildApprovalButtons), driven through the EXISTING, unchanged approve:/
 * skip: callback handlers in api/telegram/webhook.ts — this feature never
 * touches approveIntake, the planner, or the executor.
 *
 * FIX 3 (Plan B decision 9) — handleRefineMessage itself splits into two
 * flows depending on whether the run is genuinely paused (a real quality/
 * spend gate — never the internal 'refining' apply-lock sentinel below):
 *   - PAUSED: the operator is unblocking a stuck autopilot gate. Apply
 *     immediately (+ resume), exactly as this feature always has — waiting
 *     for a separate "go" would leave the stall unresolved. See
 *     handlePausedRunTurn (the pre-FIX-3 flow, preserved verbatim).
 *   - NOT PAUSED: changes ACCUMULATE across turns — no execution, no
 *     render — until the operator explicitly commits ("go" / "apply it" /
 *     "do it" / etc, detected by refine-agent.ts's RefinePlan.commit). A
 *     commit stages the WHOLE accumulated batch as ONE plan behind ONE
 *     confirm card, applying as ONE render. See handleAccumulateOrCommit.
 *     The accumulation lives in the same drive_intake.pending_plan column
 *     the confirm-card flow already used (see accumulatePlan's docblock,
 *     lib/drive/intake-db.ts, for exactly how the two states — accumulating
 *     vs. staged/confirmable — are told apart).
 *
 * Run mutual-exclusion against the auto-run cron sweep
 * (api/cron/auto-run-sweep.ts, which selects
 * `.eq('auto_run', true).is('paused_reason', null)`) is done by CAS-ing
 * delivery_runs.paused_reason to the sentinel 'refining' for the mutation
 * window only (Plan B decision 4 — docs/specs/2026-07-01-telegram-
 * conversational-refine.md). The dedicated resolving_at lease in
 * lib/delivery/auto-run.ts is a different, module-private primitive (not
 * exported, and lib/delivery/* is out of scope to modify here) built for a
 * different purpose (serializing the autopilot's OWN gate resolvers against
 * each other) — reusing 'paused_reason' instead needs no new lock table and
 * is exactly the mechanism refine-execute.ts's own docblock already assumes
 * the caller provides. See acquireRefiningLock/releaseRefiningLock below.
 *
 * Never awaits a render inline: executeRefinement's render path
 * (runAssembleStage) polls the Creatomate render TO COMPLETION synchronously
 * (see lib/delivery/assemble.ts's own docblock) — that can take minutes. The
 * needsConfirm/apply path therefore kicks applyPlan() and returns; completion
 * is reported by the EXISTING poller (pollResults in lib/drive/detect.ts)
 * once delivery_runs.stage flips, after we reset the intake back to
 * status='generating' — no second completion notifier is built here. Only
 * the non-confirm "pure state edit" path (set_voice/set_script/edit_details/
 * resume — never render-affecting, see refine-context.ts's
 * RENDER_AFFECTING_KINDS) awaits applyPlan() inline, since that path can
 * never trigger a render.
 */

import {
  getActiveRefineIntake,
  getIntakeByPendingPlanId,
  findIntakesByAddress,
  getChatMessages,
  appendChatMessages,
  stagePlan,
  getPendingPlan,
  consumePlan,
  clearPendingPlan,
  accumulatePlan,
  setStatus,
  setLastPausedReason,
  setTelegramMessageId,
  type DriveIntake,
} from '../drive/intake-db.js';
import { buildApprovalPromptText, buildApprovalButtons } from '../drive/detect.js';
import { countFinalImages } from '../drive/client.js';
import { getSupabase } from '../client.js';
import { getRun } from '../delivery/runs.js';
import { buildRefineContext, validateRefineActions } from './refine-context.js';
import { planRefinement } from './refine-agent.js';
import { executeRefinement } from './refine-execute.js';
import { sendMessage, editMessageText, escapeMarkdown } from './client.js';
import type { ExecuteResult, RefineAction, RefineChatMessage, RefineContext, RefinePlan } from './refine-types.js';

const LOG_PREFIX = '[refine-conversation]';

// ── Run mutual-exclusion (paused_reason='refining' CAS) ─────────────────────

/** Sentinel value — any non-null paused_reason already excludes a run from
 *  the auto-run-sweep's `.is('paused_reason', null)` filter; this specific
 *  string just makes the intent legible in logs/DB inspection. */
const REFINING_LOCK_REASON = 'refining';

/** Reclaim window for an abandoned lock (e.g. the Vercel function was killed
 *  mid-mutation) — mirrors auto-run.ts's own RESOLVE_LEASE_TTL_MS precedent
 *  for the identical class of problem (a lease that must never wedge a run
 *  forever). Self-contained here since lib/delivery/auto-run.ts's own lease
 *  helpers are module-private and out of scope to export. */
const REFINING_LOCK_TTL_MS = 10 * 60 * 1000;

/**
 * CAS-acquire the refine lock: flips delivery_runs.paused_reason from NULL
 * (or a stale 'refining' past the TTL) to 'refining'. Returns true iff this
 * call performed that flip (i.e. the run was NOT already paused for some
 * other, genuine reason going in) — callers use this to decide whether
 * releasing afterward is theirs to do (see applyPlan).
 */
async function acquireRefiningLock(runId: string): Promise<boolean> {
  const db = getSupabase();
  const staleBefore = new Date(Date.now() - REFINING_LOCK_TTL_MS).toISOString();
  const { data, error } = await db
    .from('delivery_runs')
    .update({ paused_reason: REFINING_LOCK_REASON, updated_at: new Date().toISOString() })
    .eq('id', runId)
    .or(`paused_reason.is.null,and(paused_reason.eq.${REFINING_LOCK_REASON},updated_at.lt.${staleBefore})`)
    .select('id');
  if (error) throw new Error(`acquireRefiningLock: ${error.message}`);
  return Array.isArray(data) && data.length === 1;
}

/** CAS-release: only clears paused_reason if it's still exactly 'refining'
 *  (never clobbers something else that changed it in the meantime). Best-
 *  effort — logs loudly on failure but never throws, matching auto-run.ts's
 *  own releaseResolveLease: a failed release must not mask the caller's own
 *  outcome, and the TTL above is the backstop against a permanently-stuck lock. */
async function releaseRefiningLock(runId: string): Promise<void> {
  try {
    const db = getSupabase();
    const { error } = await db
      .from('delivery_runs')
      .update({ paused_reason: null, updated_at: new Date().toISOString() })
      .eq('id', runId)
      .eq('paused_reason', REFINING_LOCK_REASON);
    if (error) console.error(`${LOG_PREFIX} releaseRefiningLock failed for ${runId}:`, error.message);
  } catch (e) {
    console.error(`${LOG_PREFIX} releaseRefiningLock threw for ${runId}:`, e);
  }
}

/**
 * Unconditional clear, used only when a run was ALREADY paused for a genuine
 * reason before this refine batch started (acquireRefiningLock returned
 * false — we never touched paused_reason going in) but the batch just drove
 * a successful re-render into 'assembling'. That pre-existing pause is not
 * ours to CAS against by value, yet it must be lifted or the auto-run-sweep's
 * resolveAssembling() would never be allowed to poll the just-submitted
 * render job to completion — a silently stuck run. See applyPlan.
 */
async function forceClearPausedReason(runId: string): Promise<void> {
  try {
    const db = getSupabase();
    const { error } = await db
      .from('delivery_runs')
      .update({ paused_reason: null, updated_at: new Date().toISOString() })
      .eq('id', runId);
    if (error) console.error(`${LOG_PREFIX} forceClearPausedReason failed for ${runId}:`, error.message);
  } catch (e) {
    console.error(`${LOG_PREFIX} forceClearPausedReason threw for ${runId}:`, e);
  }
}

// ── Wording overrides (task-specified phrasing) ──────────────────────────────

/**
 * executeRefinement's raw summary is accurate but a bit dry/misleading for
 * a few specific cases the conversational surface needs to phrase carefully:
 *   - regenerate_clip (P1-3) only SUBMITS a provider job (lands later via the
 *     poll cron) — never imply it's instant, and never claim an updated
 *     video is on the way (it isn't — regenerate_clip is no longer in
 *     RENDER_AFFECTING_KINDS, see refine-context.ts, so a regenerate-only
 *     batch never triggers a re-render using the still-stale old winner).
 *     A batch that is ENTIRELY regenerate_clip gets ONLY this honest note —
 *     no redundant terse "N of M change(s) applied" tail.
 *   - a render-affecting change saved at a too-early stage should read as
 *     "saved, applies later", not as a raw internal stage name.
 *   - BUG 1 fix: when the render submission itself failed (executeRefinement
 *     reports rerendering:false with the stable "the re-render did not
 *     start" marker — see refine-execute.ts's 3-way outcome split), say so
 *     plainly instead of falling through to the raw terse count — never
 *     implies a render is in flight when nothing was actually submitted.
 */
function humanizeExecuteSummary(result: ExecuteResult): string {
  const notes: string[] = [];

  const regeneratedClip = result.steps.some((s) => s.action === 'regenerate_clip' && s.ok);
  const regenerateClipOnlyBatch = result.steps.length > 0 && result.steps.every((s) => s.action === 'regenerate_clip');

  if (regeneratedClip) {
    notes.push("Regenerating that clip — takes a couple minutes. I'll let you know when it lands so you can review it.");
  }

  if (result.summary.includes('too early to render yet')) {
    notes.push("That change is saved — it'll apply once the video reaches the render stage.");
  } else if (result.summary.includes('the re-render did not start')) {
    // BUG 1 fix (refine-execute.ts) — the render submission itself threw
    // before any job existed (not a timeout — see that file's 3-way outcome
    // split). Never imply a re-render is in flight; state plainly that it
    // isn't, matching applyPlan's own honest lock/status handling for this
    // exact case (no status='generating', no paused_reason clear).
    notes.push("Applied your changes, but I couldn't start the re-render — I've logged it; try again.");
  } else if (result.rerendering) {
    notes.push("Re-rendering now — I'll send the updated video when it's ready.");
  } else if (!regenerateClipOnlyBatch) {
    notes.push(result.summary);
  }

  return notes.join(' ');
}

// ── applyPlan — the locked executor wrapper ─────────────────────────────────

/**
 * Apply a validated action batch to a delivery run under the refine lock,
 * then hand back to the poller/sweep appropriately:
 *   1. Acquire the refining lock (no-op against an already-paused run — see
 *      acquireRefiningLock's return contract).
 *   2. executeRefinement — re-validates against fresh state itself; never
 *      trust the caller's actions as still-current.
 *   3. On a successful re-render (or a successful regenerate_all restart),
 *      reset the intake to status='generating' so pollResults (lib/drive/
 *      detect.ts) re-arms and reports completion/pause on its own next tick
 *      — no second completion notifier is built here.
 *   4. Release whatever we hold: our own acquired lock always releases;
 *      a pre-existing genuine pause is force-cleared ONLY when this batch
 *      just pushed the run into 'assembling' (otherwise it's left untouched
 *      — not ours to lift).
 *
 * Returns a user-facing summary string; callers decide whether/when to
 * surface it (the immediate non-confirm path sends it directly; the
 * fire-and-forget apply-callback path only logs it — see file docblock).
 *
 * L2 — concurrent-apply serialization: acquireRefiningLock fails (returns
 * false) in two distinct situations that must be told apart with a fresh
 * read, since the CAS itself can't distinguish them:
 *   - the run is genuinely human-paused for some OTHER reason — that pause
 *     already excludes the auto-run sweep, so it's safe (and intentional,
 *     per the product design) to keep applying a conversational refine
 *     while paused.
 *   - ANOTHER refine apply currently holds paused_reason='refining' — i.e.
 *     this IS a concurrent apply. Executing here too would double-render
 *     and let two batches evade REFINE_CAPS independently. Refuse and ask
 *     the operator to wait instead.
 */
export async function applyPlan(
  intake: DriveIntake,
  runId: string,
  actions: RefineAction[],
): Promise<string> {
  const acquired = await acquireRefiningLock(runId);

  if (!acquired) {
    const current = await getRun(runId);
    if (current?.paused_reason === REFINING_LOCK_REASON) {
      return "I'm still applying your last change — give me a moment.";
    }
    // else: a genuine pre-existing pause (or the run vanished) — fall
    // through and proceed exactly as before this fix.
  }

  let result: ExecuteResult;
  try {
    result = await executeRefinement(runId, actions);
  } catch (err) {
    // executeRefinement itself never throws in normal operation (every
    // action + the render decision is individually caught) — but its very
    // first call, buildRefineContext, can (e.g. the run vanished between
    // planning and applying). Never leave the lock held on an unexpected
    // failure here.
    if (acquired) await releaseRefiningLock(runId);
    // L3 — never leak raw internal error text to Telegram; log loud
    // (diagnosable without re-running), tell the user something friendly.
    console.error(`${LOG_PREFIX} executeRefinement threw for run ${runId}:`, err);
    return "Hit a snag applying that — I've logged it; try again.";
  }

  const regenerateAllOk = result.steps.some((s) => s.action === 'regenerate_all' && s.ok);
  if (result.rerendering || regenerateAllOk) {
    await setStatus(intake.id, 'generating');
    await setLastPausedReason(intake.id, null);
  }

  if (acquired) {
    await releaseRefiningLock(runId);
  } else if (result.rerendering) {
    await forceClearPausedReason(runId);
  }
  // else: acquired=false && !rerendering -> a genuine pre-existing pause is
  // left exactly as-is; only an explicit `resume` action (handled inside
  // executeRefinement itself) or the original autopilot resolver may clear it.

  const summary = humanizeExecuteSummary(result);
  console.log(`${LOG_PREFIX} applyPlan run=${runId} intake=${intake.id}: ${summary}`, result.steps);
  return summary;
}

// ── create-intent — "make a vid for <name>" finds + resends the approval card ──

/**
 * Verb/noun/connector pattern for a create-video request. Anchored at the
 * START of the (trimmed) message — never matches a create-verb appearing
 * mid-sentence ("bump the price... and make it 4 beds" must never trigger
 * this).
 *
 * Conservative-by-construction: requires an explicit for/of/on connector
 * between the vid/video/reel/clip noun and the target, rather than trying to
 * classify the tail as "a name" vs. "an adjective". Every refine-style
 * message this must NOT match either has no connector at all ("make the
 * video more upbeat" — "video more upbeat" never contains for/of/on, so the
 * whole regex fails to match) or doesn't use this vocabulary in the first
 * place ("make the music happier" — "music" isn't vid/video/reel/clip;
 * "change the pics order" — "change" isn't a create verb). Every POSITIVE
 * case this feature needs to handle already phrases the target with
 * for/of/on ("make a vid FOR kinglet", "generate video OF bordeaux"), so
 * requiring the connector gives up no real coverage — only false positives
 * avoided.
 */
const CREATE_INTENT_RE =
  /^(?:make|create|generate|build|do)\s+(?:me\s+)?(?:a\s+|the\s+)?(?:vid|video|reel|clip)\s+(?:for|of|on)\s+(?<target>.+)$/i;

/** Conversational filler stripped from the extracted target — never part of
 *  a listing's actual name ("the kinglet HOUSE" -> "kinglet"). */
const CREATE_INTENT_FILLER_WORDS = new Set(['the', 'house', 'listing', 'property']);

function stripFillerWords(raw: string): string {
  return raw
    .replace(/[.,!?;:"'`]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !CREATE_INTENT_FILLER_WORDS.has(w.toLowerCase()))
    .join(' ')
    .trim();
}

/**
 * Cheap, deterministic (no LLM call) detector for a create-video request.
 * Run BEFORE active-intake resolution in handleRefineMessage so it can find
 * a Drive folder even when there is no active refine conversation yet — the
 * exact bug this feature fixes (an operator asking to create a video for a
 * listing that was never approved got "No active listing" instead of a
 * matching approval card).
 *
 * See CREATE_INTENT_RE's docblock for the conservative-match rationale.
 * Returns the extracted target with common filler words ("the", "house",
 * "listing", "property") and punctuation stripped, or null when the message
 * doesn't match at all, or the target is empty after stripping (e.g. "make a
 * video for the listing" alone names nothing specific).
 */
export function parseCreateIntent(text: string): string | null {
  const match = CREATE_INTENT_RE.exec(text.trim());
  const target = match?.groups?.target;
  if (!target) return null;
  const cleaned = stripFillerWords(target);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Resolve the photo count to show on a (re)sent approval card. Pre-seeded
 * rows (see the CREATE-INTENT file-header note on the 137 bulk-inserted
 * 'skipped' folders) were never counted and sit at photo_count=0, which
 * would misleadingly read as "empty folder" rather than "never counted".
 * Live-count via Drive when there's a final_folder_id to count; a Drive
 * hiccup here must never block the approval card itself from going out, so
 * any failure falls back to the stored (possibly 0) count.
 */
async function resolveApprovalPhotoCount(intake: DriveIntake): Promise<number> {
  if (intake.photo_count > 0 || !intake.final_folder_id) return intake.photo_count;
  try {
    return await countFinalImages(intake.final_folder_id);
  } catch (err) {
    console.error(`${LOG_PREFIX} countFinalImages failed for intake ${intake.id} (${intake.address}):`, err);
    return intake.photo_count;
  }
}

/**
 * Handle a detected create-intent ("make a vid for <query>"): resolve the
 * Drive folder by name and either (re)send the SAME approval card
 * settleAndPrompt would have sent — for every status that hasn't started a
 * generation yet ('skipped' | 'detected' | 'error' | 'awaiting_approval' |
 * 'approved'; claimForApproval, lib/drive/intake-db.ts, already treats
 * 'awaiting_approval'/'approved' as equivalent pre-ingestion states, so
 * folding 'approved' into the same bucket here is consistent, not a new
 * distinction invented for this feature) — or tell the operator honestly why
 * nothing new was started (already generating/ingesting, already rendered,
 * no match, or ambiguous). Never touches approveIntake, the planner, or the
 * executor — the approval card this sends is driven through the EXISTING
 * approve:/skip: callback handlers (api/telegram/webhook.ts), unchanged.
 */
async function handleCreateIntent(query: string): Promise<void> {
  let matches: DriveIntake[];
  try {
    matches = await findIntakesByAddress(query);
  } catch (err) {
    console.error(`${LOG_PREFIX} findIntakesByAddress failed for query "${query}":`, err);
    await sendMessage('Something went wrong looking that up — try again in a moment.');
    return;
  }

  if (matches.length === 0) {
    await sendMessage(
      `I couldn't find a Drive folder matching '${escapeMarkdown(query)}'. Folder names look like 'Kinglet Dr 1418'.`,
    );
    return;
  }

  if (matches.length > 1) {
    const list = matches.map((m, i) => `${i + 1}. ${escapeMarkdown(m.address)}`).join('\n');
    await sendMessage(`Found a few matches — which one?\n${list}`);
    return;
  }

  const match = matches[0];
  const safeAddress = escapeMarkdown(match.address);

  if (match.status === 'generating' || match.status === 'ingesting') {
    await sendMessage(`Already generating a video for ${safeAddress} — I'll ping you when it's ready.`);
    return;
  }

  if (match.status === 'rendered') {
    await sendMessage(
      `'${safeAddress}' already has a video — want changes? Just tell me what to refine. Or say 'regenerate ${safeAddress}' to start over.`,
    );
    return;
  }

  // Startable: 'skipped' | 'detected' | 'error' | 'awaiting_approval' | 'approved'.
  try {
    const photoCount = await resolveApprovalPhotoCount(match);
    const { messageId } = await sendMessage(
      buildApprovalPromptText(match.address, photoCount),
      { buttons: buildApprovalButtons(match.id) },
    );
    await setTelegramMessageIdSafe(match.id, messageId);
    await setStatus(match.id, 'awaiting_approval');
  } catch (err) {
    console.error(
      `${LOG_PREFIX} handleCreateIntent: sending approval card failed for intake ${match.id} (${match.address}):`,
      err,
    );
    await sendMessage("Found it, but hit a snag sending the approval card — I've logged it; try again.");
  }
}

// ── handleRefineMessage — free-text turn ─────────────────────────────────────

export async function handleRefineMessage(text: string): Promise<void> {
  const createQuery = parseCreateIntent(text);
  if (createQuery) {
    await handleCreateIntent(createQuery);
    return;
  }

  const intake = await getActiveRefineIntake();
  if (!intake || !intake.delivery_run_id) {
    await sendMessage('No active listing to work on right now — approve one first.');
    return;
  }
  const runId = intake.delivery_run_id;

  const run = await getRun(runId);
  if (!run) {
    console.error(`${LOG_PREFIX} handleRefineMessage: delivery_run_id ${runId} not found for intake ${intake.id}`);
    await sendMessage("I couldn't find the video run for that listing anymore — ping ops.");
    return;
  }

  let ctx: RefineContext;
  try {
    ctx = await buildRefineContext(runId);
  } catch (err) {
    console.error(`${LOG_PREFIX} buildRefineContext failed for run ${runId}:`, err);
    await sendMessage('Something went wrong reading the current state of that video — try again in a moment.');
    return;
  }

  const history = await getChatMessages(intake.id);

  let plan: RefinePlan;
  try {
    plan = await planRefinement(text, ctx, history);
  } catch (err) {
    console.error(`${LOG_PREFIX} planRefinement failed for run ${runId}:`, err);
    await sendMessage("Sorry — I hit an error working that out. Try again?");
    return;
  }

  const turn: RefineChatMessage[] = [
    { role: 'user', content: text },
    { role: 'assistant', content: plan.reply },
  ];
  await appendChatMessages(intake.id, turn);

  // FIX 3 (Plan B decision 9) — a genuinely paused run (a real quality/spend
  // gate — never the internal 'refining' apply-lock sentinel) means the
  // operator is UNBLOCKING a stuck autopilot, not piling up changes for
  // later: apply immediately (+ resume), exactly as before this fix — never
  // make a stall-resolving message wait for an explicit "go". Every other
  // turn goes through the accumulate-then-commit flow instead.
  const isGenuinelyPaused = ctx.paused_reason != null && ctx.paused_reason !== REFINING_LOCK_REASON;
  if (isGenuinelyPaused) {
    await handlePausedRunTurn(intake, runId, ctx, plan);
    return;
  }

  await handleAccumulateOrCommit(intake, plan);
}

/**
 * The pre-FIX-3 single-message stage/confirm-or-apply flow, preserved
 * verbatim for a genuinely-paused run: the operator's message is resolving a
 * stuck autopilot gate (e.g. supplying a missing price, or saying "go ahead"
 * to resume) and must take effect immediately — waiting for a separate "go"
 * would leave the pipeline stalled. M1 (injection defense forcing the
 * confirm card for a lone `resume` at a genuine gate) and M2 (the concrete
 * before→after echo for a silent inline edit) both still apply exactly as
 * before. Every non-paused turn instead goes through handleAccumulateOrCommit.
 */
async function handlePausedRunTurn(
  intake: DriveIntake,
  runId: string,
  ctx: RefineContext,
  plan: RefinePlan,
): Promise<void> {
  if (plan.actions.length === 0) {
    await sendMessage(escapeMarkdown(plan.reply));
    return;
  }

  // M1 — injection defense: a lone `resume` is neither money/time nor
  // render-affecting (see needsConfirmFor), so the planner alone can route
  // it inline. But the run is paused at a genuine human gate right now (the
  // caller only reaches this function when that's true), so an injected MLS
  // description could otherwise get the planner to emit `[resume]` and
  // silently release autopilot spend past that gate with no operator
  // confirmation. Force the confirm card whenever a resume is present here.
  const forcesConfirmForResume =
    plan.actions.some((a) => a.kind === 'resume') &&
    ctx.paused_reason != null &&
    ctx.paused_reason !== REFINING_LOCK_REASON;

  if (plan.needsConfirm || forcesConfirmForResume) {
    const planId = await stagePlan(intake.id, { actions: plan.actions, summary: plan.summary });
    const { messageId } = await sendMessage(
      `${escapeMarkdown(plan.reply)}\n\n_${escapeMarkdown(plan.summary)}_`,
      {
        buttons: [[
          { text: '✅ Apply & re-render', callbackData: `apply:${planId}` },
          { text: '✏️ Adjust', callbackData: `adjust:${planId}` },
          { text: '❌ Cancel', callbackData: `cancel:${planId}` },
        ]],
      },
    );
    await setTelegramMessageIdSafe(intake.id, messageId);
    return;
  }

  // Pure state edits (set_voice/set_script/edit_details/resume) — never
  // render-affecting or money/time-consuming (see needsConfirmFor), so this
  // is always fast: safe to await inline and report the real result.
  //
  // M2 — echo the CONCRETE before→after for a silent inline edit_details/
  // set_script so an injected tamper (e.g. price -> $1) is visible instead
  // of hiding behind a terse "N change(s) applied" count. Built from `ctx`
  // (captured BEFORE execution) + the actions about to be applied.
  const concreteChanges = describeInlineChanges(plan.actions, ctx);
  const summary = await applyPlan(intake, runId, plan.actions);
  const reply = concreteChanges.length > 0 ? `${concreteChanges.join('; ')} — ${summary}` : summary;
  await sendMessage(escapeMarkdown(reply));
}

// ── FIX 3 — accumulate → one confirm on commit ("go") ───────────────────────

/** Strip a single trailing period so consecutive running-summary fragments
 *  join without doubled punctuation ("Switch music.; Reorder scenes." ->
 *  "Switch music; Reorder scenes"). */
function stripTrailingPeriod(s: string): string {
  const t = s.trim();
  return t.endsWith('.') ? t.slice(0, -1) : t;
}

/** Extend the running per-turn summary the accumulate/commit flow shows the
 *  operator: each accumulating turn's plan.summary is appended to whatever
 *  was already accumulated, so the eventual confirm card — and the
 *  "Got it —" nudge sent on every turn in between — always describes the
 *  FULL running batch, never just the latest turn. */
function appendRunningSummary(prior: string | undefined, next: string): string {
  const cleanNext = stripTrailingPeriod(next);
  if (!cleanNext) return prior ?? '';
  return prior ? `${prior}; ${cleanNext}` : cleanNext;
}

/**
 * FIX 3 (Plan B decision 9) — the accumulate-then-commit flow for every
 * NON-paused turn: change requests pile up in the (not-yet-confirmable)
 * accumulation without executing anything; an explicit commit ("go") stages
 * the WHOLE accumulated batch as ONE plan and shows ONE confirm card, same
 * as the pre-FIX-3 single-message flow did for a single change.
 *
 * Chosen model (simplest clean, per the task): accumulate ALL actions — even
 * a cheap library set_music/set_voice DB write — and apply NOTHING until
 * commit. That keeps exactly one mutation path (stagePlan -> confirm card ->
 * applyPlan) for a non-paused run, with no separate "apply this bit now,
 * stage that bit for later" bookkeeping, and no risk of double-applying
 * something that was both executed inline AND folded into the batch.
 *
 * Validation: each turn's OWN new actions (`plan.actions`) already come out
 * of planRefinement pre-validated against a ctx built THIS turn — nothing
 * further is needed here. The accumulated set as a whole gets re-validated
 * again at apply time (handleApplyCallback, unchanged) and once more inside
 * executeRefinement itself, so anything that goes stale between an early
 * accumulate turn and the eventual Apply tap is still caught and reported,
 * exactly as it already was for a single-turn plan.
 *
 * Storage: see accumulatePlan's docblock (lib/drive/intake-db.ts) for how
 * the accumulation (pending_plan_id null) and a staged, confirmable plan
 * (pending_plan_id set) share the same drive_intake.pending_plan column
 * without being confused for one another.
 */
async function handleAccumulateOrCommit(intake: DriveIntake, plan: RefinePlan): Promise<void> {
  if (plan.actions.length === 0 && !plan.commit) {
    // Pure info/Q&A — nothing to accumulate or commit.
    await sendMessage(escapeMarkdown(plan.reply));
    return;
  }

  const priorActions = intake.pending_plan?.actions ?? [];
  const priorSummary = intake.pending_plan?.summary;
  const combinedActions = [...priorActions, ...plan.actions];
  // Only fold THIS turn's summary in when it actually proposed something new
  // — a bare "go" (nothing new this turn) shouldn't graft a boilerplate
  // non-description onto the running list.
  const combinedSummary = plan.actions.length > 0
    ? appendRunningSummary(priorSummary, plan.summary)
    : (priorSummary ?? '');

  if (!plan.commit) {
    await accumulatePlan(intake.id, { actions: combinedActions, summary: combinedSummary });
    await sendMessage(
      escapeMarkdown(`Got it — ${combinedSummary}. Anything else, or say 'go' to apply + render.`),
    );
    return;
  }

  // Commit ("go") — nothing accumulated across prior turns AND nothing new
  // proposed in this one either.
  if (combinedActions.length === 0) {
    await sendMessage('Nothing queued to apply — tell me what to change first.');
    return;
  }

  const finalSummary = combinedSummary || plan.summary;
  const planId = await stagePlan(intake.id, { actions: combinedActions, summary: finalSummary });
  const { messageId } = await sendMessage(
    escapeMarkdown(`Apply: ${finalSummary} + re-render?`),
    {
      buttons: [[
        { text: '✅ Apply & re-render', callbackData: `apply:${planId}` },
        { text: '✏️ Adjust', callbackData: `adjust:${planId}` },
        { text: '❌ Cancel', callbackData: `cancel:${planId}` },
      ]],
    },
  );
  await setTelegramMessageIdSafe(intake.id, messageId);
}

// ── M2 — concrete before→after echo for silent inline edits ────────────────

function formatFieldTransition(label: string, before: number | null | undefined, after: number): string {
  const beforeStr = before == null ? '—' : String(before);
  return `${label} ${beforeStr}→${after}`;
}

function describeConcreteChange(action: RefineAction, ctx: RefineContext): string | null {
  if (action.kind === 'edit_details') {
    const parts: string[] = [];
    if (action.price !== undefined) parts.push(`Set price to $${action.price.toLocaleString('en-US')}`);
    if (action.beds !== undefined) parts.push(formatFieldTransition('beds', ctx.listing_details.beds, action.beds));
    if (action.baths !== undefined) parts.push(formatFieldTransition('baths', ctx.listing_details.baths, action.baths));
    if (action.sqft !== undefined) parts.push(formatFieldTransition('sqft', ctx.listing_details.sqft, action.sqft));
    if (action.description !== undefined) parts.push('Updated the listing description');
    return parts.length > 0 ? parts.join(', ') : null;
  }
  if (action.kind === 'set_script') {
    return 'Updated the script';
  }
  return null;
}

function describeInlineChanges(actions: RefineAction[], ctx: RefineContext): string[] {
  const out: string[] = [];
  for (const action of actions) {
    const described = describeConcreteChange(action, ctx);
    if (described) out.push(described);
  }
  return out;
}

/** Best-effort: remember which message carries the confirm buttons so a
 *  later apply/cancel tap can strip them (reuses drive_intake.telegram_
 *  message_id — the original intake-approval prompt this column was named
 *  for is long resolved by the time a refine conversation is active, so
 *  repurposing it for "the most recent bot message with live buttons" needs
 *  no new migration). A failure here must never break the conversational
 *  turn that already succeeded. */
async function setTelegramMessageIdSafe(intakeId: string, messageId: number): Promise<void> {
  try {
    await setTelegramMessageId(intakeId, messageId);
  } catch (err) {
    console.error(`${LOG_PREFIX} setTelegramMessageId failed for intake ${intakeId}:`, err);
  }
}

// ── handleRefineCallback — apply:/adjust:/cancel:<planId> ───────────────────

/**
 * FIX 3 (plan-binding race) — resolve the intake a callback's planId is bound
 * to directly, via getIntakeByPendingPlanId, rather than via "whichever
 * intake is currently active" (getActiveRefineIntake). The active intake can
 * change between when a confirm card was sent and when the operator taps a
 * button on it (a newer listing entering the eligible set mid-conversation);
 * the planId embedded in the callback data is already unambiguous proof of
 * which row this callback targets, so resolve from THAT, never from "active"
 * state. Only the apply/adjust/cancel callback handlers use this — free-text
 * turns (handleRefineMessage) have no planId yet and correctly keep using
 * getActiveRefineIntake().
 */
async function resolveIntakeForPlan(planId: string): Promise<{ intake: DriveIntake; runId: string } | null> {
  const intake = await getIntakeByPendingPlanId(planId);
  if (!intake || !intake.delivery_run_id) return null;
  return { intake, runId: intake.delivery_run_id };
}

async function handleApplyCallback(planId: string): Promise<void> {
  const active = await resolveIntakeForPlan(planId);
  const staged = active ? await getPendingPlan(active.intake.id, planId) : null;
  const won = active && staged ? await consumePlan(active.intake.id, planId) : false;

  if (!active || !staged || !won) {
    await sendMessage("That's already been applied.");
    return;
  }
  const { intake, runId } = active;

  let ctx: RefineContext;
  try {
    ctx = await buildRefineContext(runId);
  } catch (err) {
    console.error(`${LOG_PREFIX} buildRefineContext failed on apply for run ${runId}:`, err);
    await sendMessage("Couldn't re-check the current state before applying — try again in a moment.");
    return;
  }

  const { actions, dropped } = validateRefineActions(staged.actions, ctx);
  if (dropped.length > 0) {
    await sendMessage(
      `Heads up — some of that plan is stale and won't be applied:\n${dropped
        .map((d) => `- ${escapeMarkdown(d.reason)}`)
        .join('\n')}`,
    );
  }

  if (intake.telegram_message_id !== null) {
    await editMessageText(intake.telegram_message_id, `${escapeMarkdown(staged.summary)}\n\n_Applying…_`, { buttons: [] }).catch(
      (err) => console.error(`${LOG_PREFIX} editMessageText (apply) failed:`, err),
    );
  }

  if (actions.length === 0) {
    await sendMessage('Nothing left to apply after re-checking the current state — no changes made.');
    return;
  }

  // Fast, user-facing ack first...
  await sendMessage("Applying — re-rendering now, I'll send the updated video when it's ready.");

  // ...then kick + return. executeRefinement's render path can block for
  // minutes (Creatomate poll) — never await that inline in the webhook
  // response; the poller (pollResults) reports the eventual outcome.
  applyPlan(intake, runId, actions).catch((err) => {
    console.error(`${LOG_PREFIX} applyPlan (background) failed for run ${runId}:`, err);
  });
}

async function handleAdjustCallback(planId: string): Promise<void> {
  const active = await resolveIntakeForPlan(planId);
  const staged = active ? await getPendingPlan(active.intake.id, planId) : null;
  if (!active || !staged) {
    await sendMessage("That plan isn't pending anymore.");
    return;
  }
  // FIX 3: clearPendingPlan resets the SAME drive_intake.pending_plan column
  // handleAccumulateOrCommit/accumulatePlan use for the running accumulation
  // (see accumulatePlan's docblock, lib/drive/intake-db.ts) — so "Adjust"
  // coherently discards the whole accumulated batch this staged plan was
  // built from, not just the confirm card. The operator is expected to
  // restate the request from scratch via a fresh free-text message next.
  await clearPendingPlan(active.intake.id);
  await sendMessage('Sure — tell me what to change.');
}

async function handleCancelCallback(planId: string): Promise<void> {
  const active = await resolveIntakeForPlan(planId);
  const staged = active ? await getPendingPlan(active.intake.id, planId) : null;
  if (!active || !staged) {
    await sendMessage("That plan isn't pending anymore.");
    return;
  }
  // FIX 3: same coherent clear as handleAdjustCallback above — Cancel drops
  // the whole accumulated batch this plan was staged from, not just the
  // confirm card (clearPendingPlan resets the shared pending_plan column).
  await clearPendingPlan(active.intake.id);

  if (active.intake.telegram_message_id !== null) {
    await editMessageText(active.intake.telegram_message_id, 'Cancelled.', { buttons: [] }).catch((err) =>
      console.error(`${LOG_PREFIX} editMessageText (cancel) failed:`, err),
    );
    return;
  }
  await sendMessage('Cancelled.');
}

export async function handleRefineCallback(data: string): Promise<void> {
  if (data.startsWith('apply:')) {
    await handleApplyCallback(data.slice('apply:'.length));
  } else if (data.startsWith('adjust:')) {
    await handleAdjustCallback(data.slice('adjust:'.length));
  } else if (data.startsWith('cancel:')) {
    await handleCancelCallback(data.slice('cancel:'.length));
  }
  // Unrecognized data — no-op; the webhook only routes here for a matching prefix.
}
