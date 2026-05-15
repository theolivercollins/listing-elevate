import { describe, it, expect } from 'vitest';
import { generatePreviewToken, isWellFormedToken } from '../preview-tokens';

describe('preview tokens', () => {
  it('generates a 32-char URL-safe token', () => {
    const t = generatePreviewToken();
    expect(t).toHaveLength(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('produces distinct tokens across 1000 invocations', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) tokens.add(generatePreviewToken());
    expect(tokens.size).toBe(1000);
  });

  it('isWellFormedToken accepts a generated token and rejects garbage', () => {
    expect(isWellFormedToken(generatePreviewToken())).toBe(true);
    expect(isWellFormedToken('short')).toBe(false);
    expect(isWellFormedToken('!'.repeat(32))).toBe(false);
  });
});
