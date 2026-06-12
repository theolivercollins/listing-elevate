import type { ClientRow, BrandKitVars } from '../types/operator-studio.js';
import { formatPhoneDisplay } from '../utils/phone.js';

/**
 * Per-client ", Realtor" display-name toggle (clients.realtor_suffix).
 * Single source of truth for the suffix string — used here for the brand-kit
 * agent_name and in lib/pipeline.ts for the buildTemplateModifications
 * agentName (Listing-Agent-Mid/Final + Text-Agent-Name keys).
 * `on` tolerates null/undefined so pre-migration `select('*')` rows (column
 * absent → undefined) behave as off. Stored agent_name stays clean; the
 * suffix is applied only at render-mapping time.
 */
export function applyRealtorSuffix(name: string | null, on: boolean | null | undefined): string | null {
  if (!on || !name) return name;
  return `${name}, Realtor`;
}

export function brandKitFromClient(c: ClientRow, ctx: { brokerage?: string | null }): BrandKitVars {
  return {
    logo_url: c.brand_logo_url,
    primary_hex: c.brand_primary_hex,
    secondary_hex: c.brand_secondary_hex,
    agent_name: applyRealtorSuffix(c.agent_name, c.realtor_suffix),
    agent_headshot_url: c.agent_headshot_url,
    brokerage: c.brokerage ?? ctx.brokerage ?? null,
    phone: formatPhoneDisplay(c.phone),
  };
}

// Each brand var feeds one or more template element keys. The `Brand.*` keys
// serve operator templates that declare explicit Brand.* variables; the second
// set (Text-* / Image-Headshot) feeds the "15 seconds - Just Listed" template
// (075d3024), whose elements aren't Brand-namespaced. Setting both is safe —
// Creatomate ignores keys for elements a template doesn't have. For a client
// listing these override the values buildTemplateModifications derived from the
// submitting operator (e.g. phone), so the CLIENT's agent details win.
const BRAND_KEY_MAP: Record<keyof BrandKitVars, string[]> = {
  logo_url: ['Brand.logo'],
  primary_hex: ['Brand.primary'],
  secondary_hex: ['Brand.secondary'],
  agent_name: ['Brand.agent_name', 'Text-Agent-Name.text'],
  agent_headshot_url: ['Brand.agent_headshot', 'Image-Headshot.source'],
  brokerage: ['Brand.brokerage', 'Text-Brokerage-Team.text'],
  phone: ['Brand.phone', 'Text-Phone-Number.text'],
};

export function mergeBrandVars<T extends Record<string, unknown>>(base: T, brand: BrandKitVars): T & Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(BRAND_KEY_MAP) as Array<keyof BrandKitVars>) {
    const v = brand[k];
    if (v != null) {
      for (const key of BRAND_KEY_MAP[k]) out[key] = v;
    }
  }
  return out as T & Record<string, unknown>;
}
