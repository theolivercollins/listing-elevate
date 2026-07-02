/**
 * Shared "turn a caught value into a readable string" helper.
 *
 * Extracted from a narrower local copy in lib/telegram/refine-execute.ts
 * (`err instanceof Error ? err.message : String(err)`), which is exactly the
 * 2026-07-02 live-incident bug: Supabase throws/returns plain objects —
 * `{code, details, hint, message}` — not Error instances. `String(err)` on a
 * plain object always produces the literal "[object Object]", which then
 * lands verbatim in Telegram messages and DB columns (drive_intake's
 * approveIntake catch logged + sent + persisted "[object Object]"; see
 * lib/drive/orchestrate.ts). This version keeps the Error/string fast paths
 * byte-for-byte identical to the old local copy and upgrades the fallback for
 * everything else (objects, numbers, null/undefined) to a JSON rendering so
 * the real `.message` (plus code/details/hint) text is always readable, with
 * a circular-safe last resort.
 *
 * Callers that hand the result to a Markdown-mode Telegram message must still
 * run it through escapeMarkdown (lib/telegram/client.ts) — this helper only
 * guarantees a readable string, not one that's safe to interpolate raw into
 * Markdown/HTML.
 */
export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    const json = JSON.stringify(err);
    // JSON.stringify returns `undefined` (not a thrown error) for a handful of
    // inputs it can't represent — e.g. a bare `undefined` or a function —
    // fall back to String() for those.
    if (json !== undefined) return json;
  } catch {
    // Circular references throw a TypeError from JSON.stringify — fall
    // through to the guaranteed-safe String() below rather than propagate.
  }
  return String(err);
}
