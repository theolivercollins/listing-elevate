import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('src/v2/styles/tokens.css', () => {
  it('should contain the --le-brand-blue-rgb token in the :root block', () => {
    const tokensPath = path.join(__dirname, 'tokens.css');
    const content = fs.readFileSync(tokensPath, 'utf-8');

    // Extract the :root block
    const rootBlockMatch = content.match(/:root\s*\{([^}]+)\}/);
    expect(rootBlockMatch).toBeTruthy();

    const rootBlock = rootBlockMatch![1];

    // Check that the token exists with the exact value.
    // Shifted to the navy family (#1E4A8C = 30,74,140) for brand cohesion.
    expect(rootBlock).toContain('--le-brand-blue-rgb: 30, 74, 140;');
  });

  it('should not have --le-brand-blue-rgb in the .dark block', () => {
    const tokensPath = path.join(__dirname, 'tokens.css');
    const content = fs.readFileSync(tokensPath, 'utf-8');

    // Extract the .dark block
    const darkBlockMatch = content.match(/\.dark,\s*\[data-theme="dark"\]\s*\{([^}]+)\}/);

    if (darkBlockMatch) {
      const darkBlock = darkBlockMatch[1];
      // --le-brand-blue-rgb should NOT be in the dark block
      expect(darkBlock).not.toContain('--le-brand-blue-rgb');
    }
  });
});
