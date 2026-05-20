// Shared number / currency formatters. Single source of truth so the whole
// app renders amounts with commas the same way.

const numberFmt = new Intl.NumberFormat('en-US');
const usdFmtNoFraction = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const usdFmtTwoFraction = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Comma-formatted integer. `null`/`undefined` → empty string. */
export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return numberFmt.format(n);
}

/** Comma-formatted USD whole dollars. e.g. 2400000 → "$2,400,000". */
export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return usdFmtNoFraction.format(n);
}

/** Cents → "$X,XXX.XX". e.g. 12350 → "$123.50". */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '';
  return usdFmtTwoFraction.format(cents / 100);
}

/**
 * Strip every non-digit char from a string. Used by money inputs so that a
 * user typing "2,400,000" stores 2400000 (commas applied on the way out).
 */
export function digitsOnly(s: string): string {
  return s.replace(/[^\d]/g, '');
}

/**
 * Round-trip a money/number input: take raw digits, return a comma-formatted
 * display string. Empty / non-digit → ''.
 */
export function formatNumericInput(raw: string): string {
  const digits = digitsOnly(raw);
  if (!digits) return '';
  return numberFmt.format(Number(digits));
}
