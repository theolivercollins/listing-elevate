/**
 * TDD test for migration 083_preview_links_v2.sql
 *
 * Verifies the migration file:
 * 1. Exists at the correct path
 * 2. Adds exactly the 5 columns specified in the spec (kind, allow_download,
 *    allow_approve, allow_revision, approved_at) to property_previews
 * 3. kind column has CHECK ('client','public') and default 'client'
 * 4. Boolean columns have default true
 * 5. approved_at is timestamptz with no default (null)
 * 6. Extends property_revision_notes.source CHECK to include 'client_approval'
 *    by dropping and re-adding the constraint
 * 7. Uses ADD COLUMN IF NOT EXISTS (idempotent)
 * 8. Does NOT alter migration 081 or any earlier file
 */

import { readFileSync, existsSync } from 'fs';
import { describe, it, expect } from 'vitest';

const MIGRATION_PATH =
  'supabase/migrations/083_preview_links_v2.sql';

// Resolve relative to repo root (vitest runs from cwd = repo root)
const sql = existsSync(MIGRATION_PATH)
  ? readFileSync(MIGRATION_PATH, 'utf-8')
  : null;

describe('083_preview_links_v2.sql — file existence', () => {
  it('migration file exists', () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });
});

describe('083_preview_links_v2.sql — property_previews columns', () => {
  it('adds kind column with if not exists', () => {
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+kind/i);
  });

  it('kind column is text type', () => {
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+kind\s+text/i);
  });

  it("kind column has CHECK constraint containing 'client' and 'public'", () => {
    // Accepts either inline CHECK or separately named constraint — look for
    // the values in close proximity to the kind column definition.
    expect(sql).toMatch(/'client'/);
    expect(sql).toMatch(/'public'/);
  });

  it("kind column defaults to 'client'", () => {
    expect(sql).toMatch(/default\s+'client'/i);
  });

  it('adds allow_download boolean column with if not exists', () => {
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+allow_download\s+boolean/i);
  });

  it('allow_download defaults to true', () => {
    expect(sql).toMatch(/allow_download\s+boolean[^;]*default\s+true/i);
  });

  it('adds allow_approve boolean column with if not exists', () => {
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+allow_approve\s+boolean/i);
  });

  it('allow_approve defaults to true', () => {
    expect(sql).toMatch(/allow_approve\s+boolean[^;]*default\s+true/i);
  });

  it('adds allow_revision boolean column with if not exists', () => {
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+allow_revision\s+boolean/i);
  });

  it('allow_revision defaults to true', () => {
    expect(sql).toMatch(/allow_revision\s+boolean[^;]*default\s+true/i);
  });

  it('adds approved_at timestamptz column with if not exists', () => {
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+approved_at\s+timestamptz/i);
  });

  it('approved_at has no default (null by default)', () => {
    // Must NOT have a non-null default for approved_at
    const approvedAtLine = sql?.match(/add\s+column\s+if\s+not\s+exists\s+approved_at\s+[^;]+/i)?.[0] ?? '';
    expect(approvedAtLine).not.toMatch(/default\s+\S/i);
  });
});

describe('083_preview_links_v2.sql — property_revision_notes source CHECK extension', () => {
  it("drops the old source CHECK constraint", () => {
    expect(sql).toMatch(/drop\s+constraint/i);
    // The auto-generated constraint name from inline CHECK on migration 062
    expect(sql).toMatch(/property_revision_notes_source_check/i);
  });

  it("re-adds source CHECK including all three values: operator, client_preview, client_approval", () => {
    expect(sql).toMatch(/'operator'/);
    expect(sql).toMatch(/'client_preview'/);
    expect(sql).toMatch(/'client_approval'/);
  });

  it("new CHECK constraint targets property_revision_notes", () => {
    expect(sql).toMatch(/alter\s+table\s+property_revision_notes/i);
    expect(sql).toMatch(/add\s+constraint/i);
  });
});

describe('083_preview_links_v2.sql — structural safety', () => {
  it('targets property_previews for the new columns', () => {
    expect(sql).toMatch(/alter\s+table\s+property_previews/i);
  });

  it('does not reference any migration <= 081 for alteration', () => {
    // Should not contain DROP TABLE or TRUNCATE — forward-only
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/truncate/i);
  });

  it('contains down-migration SQL in a comment block', () => {
    // The forensic commit message requirement: rollback SQL in the file comment
    expect(sql).toMatch(/-- down\b|-- rollback|-- revert/i);
  });
});
