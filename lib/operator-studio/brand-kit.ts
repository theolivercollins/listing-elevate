import type { ClientRow, BrandKitVars } from '../types/operator-studio';

export function brandKitFromClient(c: ClientRow, ctx: { brokerage?: string | null }): BrandKitVars {
  return {
    logo_url: c.brand_logo_url,
    primary_hex: c.brand_primary_hex,
    secondary_hex: c.brand_secondary_hex,
    agent_name: c.agent_name,
    agent_headshot_url: c.agent_headshot_url,
    brokerage: ctx.brokerage ?? null,
  };
}

const BRAND_KEY_MAP: Record<keyof BrandKitVars, string> = {
  logo_url: 'Brand.logo',
  primary_hex: 'Brand.primary',
  secondary_hex: 'Brand.secondary',
  agent_name: 'Brand.agent_name',
  agent_headshot_url: 'Brand.agent_headshot',
  brokerage: 'Brand.brokerage',
};

export function mergeBrandVars<T extends Record<string, unknown>>(base: T, brand: BrandKitVars): T & Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(BRAND_KEY_MAP) as Array<keyof BrandKitVars>) {
    const v = brand[k];
    if (v != null) out[BRAND_KEY_MAP[k]] = v;
  }
  return out as T & Record<string, unknown>;
}
