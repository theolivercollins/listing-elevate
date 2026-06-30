/**
 * Validates a candidate password for creation / change flows.
 *
 * Rules:
 *  - Minimum 10 characters
 *  - At least 2 of the 4 character classes: lowercase, uppercase, digit, symbol
 *
 * Returns a human-readable error string, or null when the password is valid.
 */
export function passwordIssue(pw: string): string | null {
  if (pw.length < 10) {
    return "Password must be at least 10 characters";
  }
  const classes = [
    /[a-z]/.test(pw),
    /[A-Z]/.test(pw),
    /[0-9]/.test(pw),
    /[^a-zA-Z0-9]/.test(pw),
  ].filter(Boolean).length;
  if (classes < 2) {
    return "Include at least two of: lowercase, uppercase, number, symbol";
  }
  return null;
}
