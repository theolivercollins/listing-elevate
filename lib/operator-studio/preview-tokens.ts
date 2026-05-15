import { randomBytes } from 'node:crypto';

export function generatePreviewToken(): string {
  // 24 random bytes → 32 chars of base64url, no padding.
  return randomBytes(24).toString('base64url').slice(0, 32);
}

export function isWellFormedToken(t: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(t);
}
