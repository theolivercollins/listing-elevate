/**
 * TDD test for migration 086_le_video_library.sql
 *
 * Verifies the migration file:
 * 1. Exists at the correct path
 * 2. Creates video_folders table with:
 *    - id uuid pk, name text not null, position integer not null default 0
 *    - created_at and updated_at timestamptz not null defaults
 * 3. Creates video_library_meta table with:
 *    - property_id uuid pk references properties(id) on delete cascade
 *    - folder_id uuid references video_folders(id) on delete set null
 *    - archived_at, library_deleted_at, updated_at (timestamptz, updated_at not null)
 * 4. Creates two indexes on video_library_meta:
 *    - idx_video_library_meta_folder on (folder_id)
 *    - idx_video_library_meta_archived on (archived_at) where archived_at is not null
 * 5. Enables RLS on both tables (no policies)
 * 6. Uses CREATE TABLE IF NOT EXISTS (idempotent)
 * 7. Contains down-migration SQL in a comment block
 */

import { readFileSync, existsSync } from 'fs';
import { describe, it, expect } from 'vitest';

const MIGRATION_PATH = 'supabase/migrations/086_le_video_library.sql';

// Resolve relative to repo root (vitest runs from cwd = repo root)
const sql = existsSync(MIGRATION_PATH)
  ? readFileSync(MIGRATION_PATH, 'utf-8')
  : null;

describe('086_le_video_library.sql — file existence', () => {
  it('migration file exists', () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });
});

describe('086_le_video_library.sql — video_folders table', () => {
  it('creates video_folders table with CREATE TABLE IF NOT EXISTS', () => {
    expect(sql).toMatch(/create\s+table\s+if\s+not\s+exists\s+video_folders/i);
  });

  it('video_folders.id is uuid primary key with default gen_random_uuid()', () => {
    expect(sql).toMatch(/id\s+uuid\s+primary\s+key\s+default\s+gen_random_uuid/i);
  });

  it('video_folders.name is text not null', () => {
    expect(sql).toMatch(/name\s+text\s+not\s+null/i);
  });

  it('video_folders.position is integer not null default 0', () => {
    expect(sql).toMatch(/position\s+integer\s+not\s+null\s+default\s+0/i);
  });

  it('video_folders.created_at is timestamptz not null default now()', () => {
    expect(sql).toMatch(/created_at\s+timestamptz\s+not\s+null\s+default\s+now\(\)/i);
  });

  it('video_folders.updated_at is timestamptz not null default now()', () => {
    expect(sql).toMatch(/updated_at\s+timestamptz\s+not\s+null\s+default\s+now\(\)/i);
  });
});

describe('086_le_video_library.sql — video_library_meta table', () => {
  it('creates video_library_meta table with CREATE TABLE IF NOT EXISTS', () => {
    expect(sql).toMatch(/create\s+table\s+if\s+not\s+exists\s+video_library_meta/i);
  });

  it('video_library_meta.property_id is uuid primary key with FK to properties(id) on delete cascade', () => {
    expect(sql).toMatch(/property_id\s+uuid\s+primary\s+key\s+references\s+properties\(id\)\s+on\s+delete\s+cascade/i);
  });

  it('video_library_meta.folder_id is uuid FK to video_folders(id) on delete set null', () => {
    expect(sql).toMatch(/folder_id\s+uuid\s+references\s+video_folders\(id\)\s+on\s+delete\s+set\s+null/i);
  });

  it('video_library_meta.archived_at is timestamptz', () => {
    expect(sql).toMatch(/archived_at\s+timestamptz/i);
  });

  it('video_library_meta.library_deleted_at is timestamptz', () => {
    expect(sql).toMatch(/library_deleted_at\s+timestamptz/i);
  });

  it('video_library_meta.updated_at is timestamptz not null default now()', () => {
    expect(sql).toMatch(/updated_at\s+timestamptz\s+not\s+null\s+default\s+now\(\)/i);
  });
});

describe('086_le_video_library.sql — video_library_meta indexes', () => {
  it('creates idx_video_library_meta_folder index on folder_id', () => {
    expect(sql).toMatch(/create\s+index\s+if\s+not\s+exists\s+idx_video_library_meta_folder\s+on\s+video_library_meta\(folder_id\)/i);
  });

  it('creates idx_video_library_meta_archived index on archived_at where archived_at is not null', () => {
    expect(sql).toMatch(/create\s+index\s+if\s+not\s+exists\s+idx_video_library_meta_archived\s+on\s+video_library_meta\(archived_at\)\s+where\s+archived_at\s+is\s+not\s+null/i);
  });
});

describe('086_le_video_library.sql — RLS', () => {
  it('enables RLS on video_folders', () => {
    expect(sql).toMatch(/alter\s+table\s+video_folders\s+enable\s+row\s+level\s+security/i);
  });

  it('enables RLS on video_library_meta', () => {
    expect(sql).toMatch(/alter\s+table\s+video_library_meta\s+enable\s+row\s+level\s+security/i);
  });

  it('does not create any RLS policies (deny-all by default)', () => {
    expect(sql).not.toMatch(/create\s+policy/i);
  });
});

describe('086_le_video_library.sql — structural safety', () => {
  it('does not contain DROP TABLE or TRUNCATE in active SQL (comments excluded)', () => {
    // Remove comment lines for this check; drop statements in rollback comments are OK
    const activeSQL = sql
      ?.split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n') ?? '';
    expect(activeSQL).not.toMatch(/drop\s+table/i);
    expect(activeSQL).not.toMatch(/truncate/i);
  });

  it('contains down-migration SQL in a comment block', () => {
    expect(sql).toMatch(/-- down|-- rollback|-- revert/i);
  });

  it('references the correct migration number (086)', () => {
    expect(sql).toMatch(/086_le_video_library/i);
  });
});
