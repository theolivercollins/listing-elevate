-- supabase/migrations/057_marketing_ally.sql
-- Homepage Ally — public concierge chat tables.
-- See docs/specs/2026-05-15-homepage-ally-design.md §6 for full data model.

-- 1. marketing_leads — also doubles as the transient thread store.
create table marketing_leads (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique,
  email text,
  name text,
  phone text,
  role text,
  intent text,
  conversation jsonb not null default '[]'::jsonb,
  source_url text,
  ip_hash text,
  user_agent text,
  utm jsonb,
  total_messages int not null default 0,
  total_cost_cents int not null default 0,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index marketing_leads_email_idx on marketing_leads (email) where email is not null;
create index marketing_leads_created_idx on marketing_leads (created_at desc);
create index marketing_leads_status_idx on marketing_leads (status);
create index marketing_leads_updated_idx on marketing_leads (updated_at);

alter table marketing_leads enable row level security;
-- No policies → only service-role API access.

-- 2. marketing_chat_rate_limits — token-bucket rows for per-IP & per-session caps.
create table marketing_chat_rate_limits (
  bucket_key text primary key,
  count int not null default 0,
  window_start timestamptz not null default now(),
  expires_at timestamptz not null
);

create index marketing_chat_rate_limits_expires_idx on marketing_chat_rate_limits (expires_at);

alter table marketing_chat_rate_limits enable row level security;
-- No policies → only service-role API access.

-- 3. updated_at trigger for marketing_leads
create or replace function marketing_leads_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger marketing_leads_set_updated_at_trg
before update on marketing_leads
for each row execute function marketing_leads_set_updated_at();
