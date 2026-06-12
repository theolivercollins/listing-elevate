/**
 * TDD test for migration 087_preview_show_branding.sql
 *
 * Verifies the migration file:
 * 1. Exists at the correct path
 * 2. Adds the show_branding column to property_previews
 * 3. show_branding is boolean not null with default true
 * 4. Uses ADD COLUMN IF NOT EXISTS (idempotent)
 * 5. Includes a forensic down-migration comment
 */

import { readFileSync, existsSync } from 'fs';
import { describe, it, expect } from 'vitest';

const MIGRATION_PATH = 'supabase/migrations/087_preview_show_branding.sql';

// Resolve relative to repo root (vitest runs from cwd = repo root)
const sql = existsSync(MIGRATION_PATH) ? readFileSync(MIGRATION_PATH, 'utf-8') : null;

describe('087_preview_show_branding.sql — file existence', () => {
  it('migration file exists', () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });
});

describe('087_preview_show_branding.sql — property_previews show_branding column', () => {
  it('adds show_branding column with if not exists', () => {
    expect(sql ?? '').toMatch(/add\s+column\s+if\s+not\s+exists\s+show_branding/i);
  });

  it('show_branding column is boolean type', () => {
    expect(sql ?? '').toMatch(/add\s+column\s+if\s+not\s+exists\s+show_branding\s+boolean/i);
  });

  it('show_branding column is not null', () => {
    expect(sql ?? '').toMatch(/show_branding\s+boolean\s+not\s+null/i);
  });

  it('show_branding defaults to true', () => {
    expect(sql ?? '').toMatch(/show_branding\s+boolean\s+not\s+null\s+default\s+true/i);
  });

  it('targets property_previews table', () => {
    expect(sql ?? '').toMatch(/alter\s+table\s+property_previews/i);
  });
});

describe('087_preview_show_branding.sql — structural safety', () => {
  it('does not drop tables (forward-only)', () => {
    expect(sql ?? '').not.toMatch(/alter\s+table\s+property_previews\s+drop\s+column/i);
    expect(sql ?? '').not.toMatch(/drop\s+table/i);
    expect(sql ?? '').not.toMatch(/truncate/i);
  });

  it('contains down-migration SQL in a comment block', () => {
    // The forensic commit message requirement: rollback SQL in the file comment
    expect(sql ?? '').toMatch(/-- down\b|-- rollback|-- revert/i);
  });

  it('contains a header comment explaining the purpose', () => {
    // Should explain what the column is for and why it defaults to true
    expect(sql ?? '').toMatch(/per-link.*branding|branding.*flag|show.*brand/i);
  });
});
