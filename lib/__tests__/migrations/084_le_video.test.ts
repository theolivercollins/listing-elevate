/**
 * TDD test for migration 084_le_video.sql
 *
 * Verifies the migration file:
 * 1. Exists at the correct path
 * 2. Adds exactly the 2 columns specified in the spec (label, revoked_at) to property_previews
 * 3. label column is text with no default (null)
 * 4. revoked_at column is timestamptz with no default (null)
 * 5. Creates preview_view_events table with correct schema
 * 6. preview_view_events has event CHECK constraint with exactly 6 values
 * 7. preview_view_events has orientation CHECK constraint with 'horizontal' and 'vertical'
 * 8. Creates both indexes (by preview_id desc, by session_id)
 * 9. Uses IF NOT EXISTS (idempotent)
 * 10. Contains down-migration SQL in a comment block
 */

import { readFileSync, existsSync } from 'fs';
import { describe, it, expect } from 'vitest';

const MIGRATION_PATH = 'supabase/migrations/084_le_video.sql';

// Resolve relative to repo root (vitest runs from cwd = repo root)
const sql = existsSync(MIGRATION_PATH)
  ? readFileSync(MIGRATION_PATH, 'utf-8')
  : null;

describe('084_le_video.sql — file existence', () => {
  it('migration file exists', () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });
});

describe('084_le_video.sql — property_previews columns', () => {
  it('adds label column with if not exists', () => {
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+label/i);
  });

  it('label column is text type', () => {
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+label\s+text/i);
  });

  it('label has no default (null by default)', () => {
    const labelLine = sql?.match(/add\s+column\s+if\s+not\s+exists\s+label\s+[^,;]+/i)?.[0] ?? '';
    expect(labelLine).not.toMatch(/default\s+\S/i);
  });

  it('adds revoked_at column with if not exists', () => {
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+revoked_at/i);
  });

  it('revoked_at column is timestamptz type', () => {
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+revoked_at\s+timestamptz/i);
  });

  it('revoked_at has no default (null by default)', () => {
    const revokedLine = sql?.match(/add\s+column\s+if\s+not\s+exists\s+revoked_at\s+[^;]+/i)?.[0] ?? '';
    expect(revokedLine).not.toMatch(/default\s+\S/i);
  });
});

describe('084_le_video.sql — preview_view_events table', () => {
  it('creates preview_view_events table with if not exists', () => {
    expect(sql).toMatch(/create\s+table\s+if\s+not\s+exists\s+preview_view_events/i);
  });

  it('id column is uuid primary key with default gen_random_uuid()', () => {
    expect(sql).toMatch(/id\s+uuid\s+primary\s+key\s+default\s+gen_random_uuid/i);
  });

  it('preview_id references property_previews(id) with on delete cascade', () => {
    expect(sql).toMatch(/preview_id\s+uuid\s+not\s+null\s+references\s+property_previews\(id\)\s+on\s+delete\s+cascade/i);
  });

  it('session_id is text not null', () => {
    expect(sql).toMatch(/session_id\s+text\s+not\s+null/i);
  });

  it('event column is text not null with CHECK constraint', () => {
    expect(sql).toMatch(/event\s+text\s+not\s+null\s+check/i);
  });

  it('event CHECK includes all 6 values: view, play, progress_25, progress_50, progress_75, complete', () => {
    expect(sql).toMatch(/'view'/);
    expect(sql).toMatch(/'play'/);
    expect(sql).toMatch(/'progress_25'/);
    expect(sql).toMatch(/'progress_50'/);
    expect(sql).toMatch(/'progress_75'/);
    expect(sql).toMatch(/'complete'/);
  });

  it('position_seconds column is numeric (optional)', () => {
    expect(sql).toMatch(/position_seconds\s+numeric/i);
  });

  it('orientation column is text with CHECK constraint', () => {
    expect(sql).toMatch(/orientation\s+text\s+check/i);
  });

  it("orientation CHECK includes 'horizontal' and 'vertical'", () => {
    expect(sql).toMatch(/'horizontal'/);
    expect(sql).toMatch(/'vertical'/);
  });

  it('referrer column is text (optional)', () => {
    expect(sql).toMatch(/referrer\s+text/i);
  });

  it('user_agent column is text (optional)', () => {
    expect(sql).toMatch(/user_agent\s+text/i);
  });

  it('created_at column is timestamptz not null with default now()', () => {
    expect(sql).toMatch(/created_at\s+timestamptz\s+not\s+null\s+default\s+now\(\)/i);
  });
});

describe('084_le_video.sql — indexes', () => {
  it('creates idx_preview_events_preview on (preview_id, created_at desc)', () => {
    expect(sql).toMatch(/create\s+index\s+if\s+not\s+exists\s+idx_preview_events_preview\s+on\s+preview_view_events\s*\(\s*preview_id\s*,\s*created_at\s+desc\s*\)/i);
  });

  it('creates idx_preview_events_session on (preview_id, session_id)', () => {
    expect(sql).toMatch(/create\s+index\s+if\s+not\s+exists\s+idx_preview_events_session\s+on\s+preview_view_events\s*\(\s*preview_id\s*,\s*session_id\s*\)/i);
  });
});

describe('084_le_video.sql — structural safety', () => {
  it('targets property_previews for the new columns', () => {
    expect(sql).toMatch(/alter\s+table\s+property_previews/i);
  });

  it('is forward-only: no DROP TABLE or TRUNCATE statements (outside comments)', () => {
    // Remove SQL comments to check only actual executable SQL
    const sqlWithoutComments = sql?.replace(/--[^\n]*\n/g, '').replace(/\/\*[\s\S]*?\*\//g, '') ?? '';
    const dropTableMatch = sqlWithoutComments.match(/drop\s+table/i);
    const truncateMatch = sqlWithoutComments.match(/truncate/i);
    expect(dropTableMatch).toBeFalsy();
    expect(truncateMatch).toBeFalsy();
  });

  it('uses IF NOT EXISTS on table and indexes (idempotent)', () => {
    expect(sql).toMatch(/create\s+table\s+if\s+not\s+exists/i);
    expect(sql).toMatch(/create\s+index\s+if\s+not\s+exists/i);
  });

  it('contains down-migration SQL in a comment block', () => {
    // The forensic header requirement: rollback SQL in the file comment
    expect(sql).toMatch(/-- down\b|-- rollback|-- revert/i);
    expect(sql).toMatch(/drop\s+table\s+if\s+exists\s+preview_view_events/i);
    expect(sql).toMatch(/drop\s+column\s+if\s+exists\s+label/i);
    expect(sql).toMatch(/drop\s+column\s+if\s+exists\s+revoked_at/i);
  });
});

describe('084_le_video.sql — RLS', () => {
  it('enables row level security on preview_view_events (deny-all backstop, matches 062 pattern)', () => {
    // Strip comments so we only match executable SQL, not comment text
    const executableSql = sql?.replace(/--[^\n]*\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '') ?? '';
    expect(executableSql).toMatch(/alter\s+table\s+preview_view_events\s+enable\s+row\s+level\s+security\s*;/i);
  });
});

describe('084_le_video.sql — spec compliance', () => {
  it('references docs/specs/2026-06-11-le-video-design.md in header comment', () => {
    expect(sql).toMatch(/2026-06-11-le-video-design/i);
  });

  it('documents back-compat posture in header comment', () => {
    expect(sql).toMatch(/back-?compat/i);
  });

  it('documents that events endpoint handles insert errors with 204', () => {
    expect(sql).toMatch(/204/);
  });
});
