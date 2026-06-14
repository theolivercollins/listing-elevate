// Pure client-safe token-coverage validator for Market Update templates.
// Called during in-page template upload (before createTemplate/createEmailTemplate)
// to give immediate feedback on unknown/missing tokens.
//
// No Node/server imports: fill.ts, types.ts are pure — this file stays the same.
// Both are safe to bundle into the client chunk.

import { tokensInTemplate } from "./fill.js";
import { allTokenNames, META_TOKENS, PASSTHROUGH_TOKENS } from "./types.js";

export interface TemplateValidationResult {
  /**
   * Blocking errors: unknown tokens (would survive fill as visible literals) or
   * zero tokens found (almost certainly the wrong file).
   * Non-empty means the upload should be rejected.
   */
  errors: string[];
  /**
   * Non-blocking warnings: canonical tokens that are absent from the template.
   * The upload may proceed; the user is informed which data fields won't appear.
   */
  warnings: string[];
}

/**
 * Validate token coverage for an MU HTML template before upload.
 *
 * @param html   The raw template HTML (from file.text()).
 * @param _role  'blog' | 'email' — reserved for future per-role vocab divergence;
 *               today both roles share the same canonical vocabulary.
 */
export function validateTemplateTokens(
  html: string,
  _role: "blog" | "email",
): TemplateValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const found = tokensInTemplate(html);

  // ── Zero-token guard ──────────────────────────────────────────────────────
  // A template with no {{TOKEN}} placeholders at all is almost certainly the
  // wrong file (e.g. a final rendered post rather than the template).
  // Passthrough-only templates count as having tokens — they're intentional.
  if (found.length === 0) {
    errors.push("No {{TOKEN}} placeholders found in this file — are you sure this is the right template?");
    return { errors, warnings };
  }

  // ── Unknown-token check (blocking) ───────────────────────────────────────
  const vocab = new Set(allTokenNames());
  const unknown = found.filter((name) => !vocab.has(name) && !PASSTHROUGH_TOKENS.has(name));
  if (unknown.length > 0) {
    errors.push(
      `Unknown token${unknown.length === 1 ? "" : "s"} — these will appear as raw text in published drafts: ` +
        unknown.map((t) => `{{${t}}}`).join(", "),
    );
  }

  // ── Passthrough-only guard (blocking) ────────────────────────────────────
  // A template that contains tokens but NONE of them are "per-region" (i.e.
  // every token is a passthrough like {{HEADLINE}} or {{UNSUBSCRIBE_URL}})
  // will produce byte-identical output for every region — the exact "3 identical
  // posts" incident class. Reject it before any drafts are written.
  //
  // A per-region token is any canonical token that is NOT in PASSTHROUGH_TOKENS:
  // that is, any META_TOKEN (REGION_NAME, REPORT_MONTH, …) or any metric token.
  const perRegionVocab = new Set(allTokenNames()); // already excludes passthroughs
  const hasPerRegionToken = found.some((name) => perRegionVocab.has(name));
  if (!hasPerRegionToken) {
    // Surface a representative pair of per-region tokens so the message is actionable.
    const examples = ([...META_TOKENS] as string[]).slice(0, 2).map((t) => `{{${t}}}`).join(", ");
    errors.push(
      `Template has no per-region tokens (e.g. ${examples}) — every region would render identical content.`,
    );
  }

  // ── Missing canonical tokens (non-blocking warnings) ─────────────────────
  // Flag canonical tokens that are absent so Oliver knows which data fields
  // won't be represented in this template.
  const foundSet = new Set(found);
  const missing = allTokenNames().filter((name) => !foundSet.has(name));
  for (const name of missing) {
    warnings.push(`${name} — canonical token not used in this template`);
  }

  return { errors, warnings };
}
