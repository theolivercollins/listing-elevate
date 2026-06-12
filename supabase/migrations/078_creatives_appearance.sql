-- 078_creatives_appearance.sql
-- Per-creative appearance settings (Vimeo-style): player behaviour (autoplay/
-- loop/muted → Bunny iframe params) + presentation-page styling (accent colour,
-- hide title/description on /v/:token). Stored as a flexible JSON blob so we can
-- extend without per-field migrations.
alter table creatives
  add column if not exists appearance jsonb not null default '{}'::jsonb;

comment on column creatives.appearance is
  'Per-creative appearance: { autoplay, loop, muted, accentColor, hideTitle, hideDescription }.';
