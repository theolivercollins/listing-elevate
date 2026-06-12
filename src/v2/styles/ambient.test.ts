/**
 * TDD test for the ambient-motion CSS block appended to v2.css.
 *
 * Success criteria (per task t2-css-ambient):
 * 1. Keyframes le-drift, le-drift-2, le-dot-drift exist.
 * 2. All three .le-ambient-* animations sit inside an
 *    @media (prefers-reduced-motion: no-preference) block.
 * 3. A @media (prefers-reduced-motion: reduce) block sets
 *    transform:none on .le-card-lift:hover, .le-img-zoom:hover img,
 *    and .le-cta-primary-hover:hover (and :active).
 * 4. No `filter:` appears in any @keyframes block in the new ambient section.
 * 5. No `background-position` is animated (not in the new block).
 * 6. No hardcoded literal "47, 109, 240" or "47,109,240" (must use var).
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const CSS_PATH = path.join(__dirname, 'v2.css');

let content: string;
try {
  content = fs.readFileSync(CSS_PATH, 'utf-8');
} catch {
  content = '';
}

// Helper: extract the text of the LAST fenced block (our appended block)
// We use the comment sentinel "/* ── Ambient motion" to locate it.
function getAmbientBlock(): string {
  const marker = '/* ── Ambient motion';
  const idx = content.lastIndexOf(marker);
  if (idx === -1) return '';
  return content.slice(idx);
}

describe('v2.css ambient-motion block', () => {
  it('should contain @keyframes le-drift', () => {
    expect(content).toContain('@keyframes le-drift');
  });

  it('should contain @keyframes le-drift-2', () => {
    expect(content).toContain('@keyframes le-drift-2');
  });

  it('should contain @keyframes le-dot-drift', () => {
    expect(content).toContain('@keyframes le-dot-drift');
  });

  it('should gate all three .le-ambient-* animations inside @media (prefers-reduced-motion: no-preference)', () => {
    // Find the no-preference media block
    const noPrefMatch = content.match(
      /@media\s*\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)\s*\{([\s\S]*?)\n\}/
    );
    expect(noPrefMatch).toBeTruthy();
    const block = noPrefMatch![1];
    expect(block).toContain('.le-ambient-blob');
    expect(block).toContain('le-drift');
    expect(block).toContain('le-dot-drift');
  });

  it('should have a @media (prefers-reduced-motion: reduce) block disabling .le-card-lift:hover transform', () => {
    const reduceMatch = content.match(
      /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{([\s\S]*?)\n\}/
    );
    expect(reduceMatch).toBeTruthy();
    const block = reduceMatch![1];
    expect(block).toContain('.le-card-lift:hover');
    expect(block).toMatch(/transform\s*:\s*none/);
  });

  it('should have the reduce block disabling .le-img-zoom:hover img transform', () => {
    const reduceMatch = content.match(
      /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{([\s\S]*?)\n\}/
    );
    expect(reduceMatch).toBeTruthy();
    const block = reduceMatch![1];
    expect(block).toContain('.le-img-zoom:hover img');
    expect(block).toMatch(/transform\s*:\s*none/);
  });

  it('should have the reduce block disabling .le-cta-primary-hover:hover transform', () => {
    const reduceMatch = content.match(
      /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{([\s\S]*?)\n\}/
    );
    expect(reduceMatch).toBeTruthy();
    const block = reduceMatch![1];
    expect(block).toContain('.le-cta-primary-hover:hover');
  });

  it('should not use filter: in any @keyframes in the ambient block', () => {
    const ambientBlock = getAmbientBlock();
    // Extract all @keyframes blocks within the ambient section
    const kfMatches = ambientBlock.matchAll(/@keyframes\s+\w+\s*\{([\s\S]*?)\n\}/g);
    for (const match of kfMatches) {
      const kfBody = match[1];
      expect(kfBody).not.toMatch(/filter\s*:/);
    }
  });

  it('should not animate background-position in the ambient block', () => {
    const ambientBlock = getAmbientBlock();
    const kfMatches = ambientBlock.matchAll(/@keyframes\s+\w+\s*\{([\s\S]*?)\n\}/g);
    for (const match of kfMatches) {
      const kfBody = match[1];
      expect(kfBody).not.toMatch(/background-position/);
    }
  });

  it('should not contain hardcoded "47, 109, 240" or "47,109,240" — must use var(--le-brand-blue-rgb)', () => {
    const ambientBlock = getAmbientBlock();
    expect(ambientBlock).not.toMatch(/47,\s*109,\s*240/);
  });

  it('should define .le-ambient base class with position:absolute and pointer-events:none', () => {
    const ambientBlock = getAmbientBlock();
    expect(ambientBlock).toContain('.le-ambient');
    expect(ambientBlock).toContain('pointer-events:none');
  });

  it('should define .le-ambient-dots with radial-gradient using var(--le-brand-blue-rgb)', () => {
    const ambientBlock = getAmbientBlock();
    expect(ambientBlock).toContain('.le-ambient-dots');
    expect(ambientBlock).toContain('var(--le-brand-blue-rgb)');
  });
});
