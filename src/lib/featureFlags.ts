/**
 * Feature flags read from Vite env. All flags are conservative-default OFF.
 * Add a flag by: (1) declaring its env var here, (2) documenting it in .env.example,
 * (3) reading it via the helper below — never inline `import.meta.env` elsewhere.
 */

export function isDashboardV3Enabled(): boolean {
  return import.meta.env.VITE_LE_DASHBOARD_V3 === "true";
}
