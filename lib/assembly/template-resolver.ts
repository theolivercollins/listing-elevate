/**
 * Resolve which Creatomate template_id to use for a given property.
 *
 * Resolution priority:
 *   1. `properties.template_id` — explicit per-order override. Wins regardless
 *      of aspect ratio; caller is responsible for picking a template that
 *      matches their aspect.
 *   2. `CREATOMATE_TEMPLATE_ID_<PACKAGE>_<DURATION>[<_VERTICAL>]` — duration-
 *      and aspect-specific template (e.g. CREATOMATE_TEMPLATE_ID_JUST_LISTED_15
 *      for 16:9 / CREATOMATE_TEMPLATE_ID_JUST_LISTED_15_VERTICAL for 9:16).
 *      Each template is designed for one exact duration + one aspect; we
 *      never reuse a 15s horizontal template for a 30s order or a vertical
 *      slot.
 *   3. `CREATOMATE_TEMPLATE_ID_<PACKAGE>` — legacy un-suffixed variable.
 *      Only honored when `selectedDuration` is NOT set AND aspect is 16:9.
 *   4. `CREATOMATE_TEMPLATE_ID_DEFAULT` — fallback for any package.
 *      Honored only when `selectedDuration` is NOT set AND aspect is 16:9.
 *   5. `null` — caller should fall back to the code-generated RenderScript
 *      path, OR skip the render entirely (vertical path during the
 *      horizontal-only phase). Safety branch: when an order has a duration
 *      or vertical aspect but no matching template exists, return null
 *      instead of rendering at the wrong duration/aspect.
 */

const PACKAGE_ENV_PREFIX: Record<string, string> = {
  just_listed: "CREATOMATE_TEMPLATE_ID_JUST_LISTED",
  just_pended: "CREATOMATE_TEMPLATE_ID_JUST_PENDED",
  just_closed: "CREATOMATE_TEMPLATE_ID_JUST_CLOSED",
  life_cycle: "CREATOMATE_TEMPLATE_ID_LIFE_CYCLE",
};

const DEFAULT_ENV_VAR = "CREATOMATE_TEMPLATE_ID_DEFAULT";

export type TemplateAspectRatio = "16:9" | "9:16";

export interface TemplateResolutionContext {
  /** Optional per-property override stored on `properties.template_id`. */
  propertyTemplateId?: string | null;
  /** `properties.selected_package`. */
  selectedPackage?: string | null;
  /** `properties.selected_duration` in seconds (15, 30, 60). */
  selectedDuration?: number | null;
  /** Aspect ratio of the render. Defaults to "16:9" (horizontal). */
  aspectRatio?: TemplateAspectRatio;
}

function readEnv(name: string): string | null {
  const raw = process.env[name];
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Pure resolver. Reads from process.env at call time. See the priority list
 * in this module's header doc.
 */
export function resolveTemplateId(ctx: TemplateResolutionContext): string | null {
  if (ctx.propertyTemplateId && ctx.propertyTemplateId.trim().length > 0) {
    return ctx.propertyTemplateId.trim();
  }

  const aspect = ctx.aspectRatio ?? "16:9";
  const aspectSuffix = aspect === "9:16" ? "_VERTICAL" : "";
  const prefix = ctx.selectedPackage ? PACKAGE_ENV_PREFIX[ctx.selectedPackage] : null;

  if (prefix && ctx.selectedDuration) {
    const durationId = readEnv(`${prefix}_${ctx.selectedDuration}${aspectSuffix}`);
    if (durationId) return durationId;
    // Duration is set but no matching duration/aspect template exists.
    // For 16:9 we could fall back to code-gen; for 9:16 the caller should
    // skip the render entirely (we aren't offering vertical yet).
    return null;
  }

  // Aspect-specific legacy + default vars are unsupported (would force a
  // matrix of legacy variants). Vertical renders without a duration thus
  // always return null until a duration-suffixed vertical template exists.
  if (aspect === "9:16") {
    return null;
  }

  if (prefix) {
    const legacy = readEnv(prefix);
    if (legacy) return legacy;
  }

  const fallback = readEnv(DEFAULT_ENV_VAR);
  if (fallback) return fallback;

  return null;
}
