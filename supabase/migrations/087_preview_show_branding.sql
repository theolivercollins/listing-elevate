-- 087_preview_show_branding.sql
-- Per docs/specs/2026-06-12-le-video-links-settings-design.md §1
--
-- Changes:
--   property_previews  +1 column:
--     show_branding    boolean NOT NULL DEFAULT true
--
-- Per-link "show the agent's branding" flag. Default true preserves today's
-- behavior (brand row renders). Operator sets false for a clean/unbranded link.
-- The branding flag is honored by:
--   - api/preview/[token].ts GET payload (include in response, fallback true pre-087)
--   - PreviewPage.tsx (render pd-brand-row only when show_branding is true)
--   - api/admin/studio/properties/[id]/preview-links/[previewId].ts PATCH
--     (add show_branding to the capability whitelist for RETURNING)
--
-- Down-migration (rollback):
--   ALTER TABLE property_previews
--     DROP COLUMN IF EXISTS show_branding;
--

-- ─── property_previews ──────────────────────────────────────────────────────

alter table property_previews
  add column if not exists show_branding boolean not null default true;
