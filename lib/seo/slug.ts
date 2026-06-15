export function makeListingSeoSlug(address: string | null | undefined, token: string | null | undefined): string {
  const normalizedAddress = String(address ?? "")
    .replace(/,\s*usa\s*$/i, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  const tokenSuffix = String(token ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  const base = normalizedAddress || "listing";
  return tokenSuffix ? `${base}-${tokenSuffix}` : base;
}
