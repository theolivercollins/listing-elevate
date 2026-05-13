/**
 * Feature flags read from Vite env. All flags are conservative-default OFF.
 * Add a flag by: (1) declaring its env var here, (2) documenting it in .env.example,
 * (3) reading it via the helper below — never inline `import.meta.env` elsewhere.
 */

export function isDashboardV3Enabled(): boolean {
  const raw = import.meta.env.VITE_LE_DASHBOARD_V3;
  if (typeof raw !== "string") return false;
  // Trim + lowercase: defensive against trailing newlines if the env var was
  // ever set via `echo "true" | vercel env add ...` (which appends \n).
  return raw.trim().toLowerCase() === "true";
}
