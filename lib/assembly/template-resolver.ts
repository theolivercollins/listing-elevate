/**
 * Resolve which Creatomate template_id to use for a given property.
 *
 * Resolution priority:
 *   1. `properties.template_id` — explicit override on the order. Wins.
 *   2. CREATOMATE_TEMPLATE_ID_<PACKAGE> env var — one per package tier.
 *   3. CREATOMATE_TEMPLATE_ID_DEFAULT env var — fallback.
 *   4. null — caller should fall back to code-generated RenderScript (the
 *      buildCreatomateTimeline path) or skip assembly entirely.
 */

const ENV_VAR_BY_PACKAGE: Record<string, string> = {
  just_listed: "CREATOMATE_TEMPLATE_ID_JUST_LISTED",
  just_pended: "CREATOMATE_TEMPLATE_ID_JUST_PENDED",
  just_closed: "CREATOMATE_TEMPLATE_ID_JUST_CLOSED",
  life_cycle: "CREATOMATE_TEMPLATE_ID_LIFE_CYCLE",
};

const DEFAULT_ENV_VAR = "CREATOMATE_TEMPLATE_ID_DEFAULT";

export interface TemplateResolutionContext {
  /** Optional per-property override stored on `properties.template_id`. */
  propertyTemplateId?: string | null;
  /** `properties.selected_package`. */
  selectedPackage?: string | null;
}

/**
 * Pure resolver. Returns the template ID or null if no template is configured
 * for this property's package and no override is set. Reads from process.env
 * — safe to call at runtime.
 */
export function resolveTemplateId(ctx: TemplateResolutionContext): string | null {
  if (ctx.propertyTemplateId && ctx.propertyTemplateId.trim().length > 0) {
    return ctx.propertyTemplateId.trim();
  }

  if (ctx.selectedPackage && ENV_VAR_BY_PACKAGE[ctx.selectedPackage]) {
    const envVar = ENV_VAR_BY_PACKAGE[ctx.selectedPackage];
    const id = process.env[envVar];
    if (id && id.trim().length > 0) return id.trim();
  }

  const fallback = process.env[DEFAULT_ENV_VAR];
  if (fallback && fallback.trim().length > 0) return fallback.trim();

  return null;
}
