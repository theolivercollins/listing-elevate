-- 046: add sierra_section to clients (default "Featured" for Helgemo).
-- Used by the Stagehand publish flow to fill Sierra's required Section dropdown
-- when creating a new Content Page.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS sierra_section TEXT NOT NULL DEFAULT 'Featured';
