/**
 * Resolve brokerage branding (logo + colors) for a property's assembled
 * video. Pulls from `user_profiles` via `properties.submitted_by`, falls
 * back to the property's free-text `brokerage` field when no profile
 * exists.
 *
 * Returns null for missing pieces so the timeline builder can decide
 * whether to render an overlay element or skip it. Never throws.
 */

import { getSupabase } from "../db.js";

const DEFAULT_PRIMARY = "#10b981"; // emerald — same default as user_profiles seed
const DEFAULT_SECONDARY = "#ffffff";

export interface PropertyBranding {
  brokerageName: string | null;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  /** Agent contact phone (user_profiles.phone), or null when unset. */
  phone: string | null;
}

interface ColorsBlob {
  primary?: unknown;
  secondary?: unknown;
}

function pickColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  // Accept #rgb / #rrggbb only. Strip leading/trailing whitespace.
  const trimmed = value.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) return trimmed;
  return fallback;
}

/**
 * Resolve branding for a property. Falls back gracefully on every layer:
 *  1. user_profile via properties.submitted_by — logo + colors + brokerage
 *  2. properties.brokerage text — brokerage name only
 *  3. Hardcoded defaults — emerald + white
 */
export async function fetchPropertyBranding(
  propertyId: string,
): Promise<PropertyBranding> {
  const supabase = getSupabase();

  const { data: prop } = await supabase
    .from("properties")
    .select("submitted_by, brokerage")
    .eq("id", propertyId)
    .maybeSingle();

  const fallbackBrokerage = (prop?.brokerage as string | null) ?? null;

  if (!prop?.submitted_by) {
    return {
      brokerageName: fallbackBrokerage,
      logoUrl: null,
      primaryColor: DEFAULT_PRIMARY,
      secondaryColor: DEFAULT_SECONDARY,
      phone: null,
    };
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("brokerage, logo_url, colors, phone")
    .eq("user_id", prop.submitted_by)
    .maybeSingle();

  if (!profile) {
    return {
      brokerageName: fallbackBrokerage,
      logoUrl: null,
      primaryColor: DEFAULT_PRIMARY,
      secondaryColor: DEFAULT_SECONDARY,
      phone: null,
    };
  }

  const colors = (profile.colors as ColorsBlob | null) ?? {};
  return {
    brokerageName:
      (profile.brokerage as string | null) ?? fallbackBrokerage,
    logoUrl: (profile.logo_url as string | null) ?? null,
    primaryColor: pickColor(colors.primary, DEFAULT_PRIMARY),
    secondaryColor: pickColor(colors.secondary, DEFAULT_SECONDARY),
    phone: (profile.phone as string | null) ?? null,
  };
}
