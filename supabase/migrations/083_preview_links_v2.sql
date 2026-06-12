-- 083_preview_links_v2.sql
-- Per docs/specs/2026-06-11-preview-links-v2-design.md §1 (Data model, additive only)
--
-- Changes:
--   property_previews  +5 columns:
--     kind             text CHECK('client','public') DEFAULT 'client'
--     allow_download   boolean DEFAULT true
--     allow_approve    boolean DEFAULT true
--     allow_revision   boolean DEFAULT true
--     approved_at      timestamptz (null — no default)
--
--   property_revision_notes.source CHECK extended to include 'client_approval'
--   (old: operator|client_preview  →  new: operator|client_preview|client_approval)
--   Done via DROP + re-ADD of the auto-named constraint so existing rows are
--   preserved and the forward-only migration remains idempotent when re-run
--   on a branch that already has the column but not the constraint.
--
-- DDL defaults keep existing rows valid (client, all-on, no approval).
-- Kind-based creation defaults for NEW links live in app code (createPreviewLink()),
-- NOT in DDL — this migration does not encode that business logic.
--
-- Down-migration (rollback):
--   ALTER TABLE property_previews
--     DROP COLUMN IF EXISTS approved_at,
--     DROP COLUMN IF EXISTS allow_revision,
--     DROP COLUMN IF EXISTS allow_approve,
--     DROP COLUMN IF EXISTS allow_download,
--     DROP COLUMN IF EXISTS kind;
--
--   ALTER TABLE property_revision_notes
--     DROP CONSTRAINT IF EXISTS property_revision_notes_source_check,
--     ADD CONSTRAINT property_revision_notes_source_check
--       CHECK (source IN ('operator','client_preview'));
--
-- Back-compat posture:
--   GET read path (fetchByToken / preview page) — safe pre-migration: missing columns
--     cause fetchPreviewMeta to return null → all capabilities default all-on in reads.
--   POST approve write path — NOT safe pre-migration: stampApproval references
--     approved_at (42703) and insertPreviewNote would violate the un-extended CHECK.
--     The approve route now returns 503 when result.preview is null so clients get a
--     retryable error instead of a 500 crash during the deploy-before-migrate window.
--   Rollout order: apply this migration BEFORE the Share-dialog UI goes live on prod.
--
-- Applied: preview/branch only until Oliver gives explicit go on prod.

-- ─── property_previews ──────────────────────────────────────────────────────

alter table property_previews
  add column if not exists kind          text        not null default 'client'
                                         check (kind in ('client', 'public')),
  add column if not exists allow_download boolean    not null default true,
  add column if not exists allow_approve  boolean    not null default true,
  add column if not exists allow_revision boolean    not null default true,
  add column if not exists approved_at   timestamptz;

-- ─── property_revision_notes — extend source CHECK ──────────────────────────
-- Auto-generated constraint name from migration 062 inline CHECK on source col.

do $$ begin
  -- Drop old constraint only if it still has the old 2-value vocabulary.
  -- Guard: if it already includes client_approval (re-run), skip the drop.
  if exists (
    select 1 from pg_constraint
    where conrelid = 'property_revision_notes'::regclass
      and conname  = 'property_revision_notes_source_check'
      and pg_get_constraintdef(oid) not like '%client_approval%'
  ) then
    alter table property_revision_notes
      drop constraint property_revision_notes_source_check;
  end if;
end $$;

-- Add constraint with full vocabulary (idempotent: IF NOT EXISTS not available
-- for ADD CONSTRAINT, but the DO block above ensures we only reach here when it
-- is absent or was just dropped).
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'property_revision_notes'::regclass
      and conname  = 'property_revision_notes_source_check'
  ) then
    alter table property_revision_notes
      add constraint property_revision_notes_source_check
        check (source in ('operator', 'client_preview', 'client_approval'));
  end if;
end $$;
