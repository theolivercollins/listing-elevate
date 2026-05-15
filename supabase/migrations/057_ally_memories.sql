-- 057_ally_memories.sql
-- Persistent notes Ally has been told to remember by a user. Scoped per
-- blog_sites row so each customer site has its own memory. Soft-delete via
-- active=false so we can audit "what did Ally know and when" later.

create table if not exists ally_memories (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references blog_sites(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  active boolean not null default true
);

create index if not exists ally_memories_site_active_idx
  on ally_memories(site_id, active, created_at desc);

notify pgrst, 'reload schema';
