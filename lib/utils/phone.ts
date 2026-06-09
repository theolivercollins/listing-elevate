/**
 * Pure phone helpers for client records.
 * Storage convention: clients.phone is saved digits-only (10 digits for US).
 * Display convention: "(941) 205-9011" — used in the client editor, Command
 * Center, and the Creatomate Brand.phone / Text-Phone-Number modifications.
 */

/** Digits only; drops a leading US "1" from 11-digit numbers. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

/** "(941) 205-9011" for 10-digit numbers; non-10-digit input returned as-is. */
export function formatPhoneDisplay(input: string | null | undefined): string | null {
  if (!input) return null;
  const d = normalizePhone(input);
  if (d.length !== 10) return input;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Progressive mask for text inputs: "(9" → "(941) 2" → "(941) 205-9011". */
export function formatAsYouType(input: string): string {
  const d = normalizePhone(input).slice(0, 10);
  if (d.length === 0) return '';
  if (d.length < 4) return `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
