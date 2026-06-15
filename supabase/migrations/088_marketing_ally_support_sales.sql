-- Public-site Ally support/sales chatbot.
-- Server-side only: Vercel functions use the service role. Do not expose these
-- tables to browser clients.

create table if not exists public.marketing_leads (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null unique,
  email text,
  name text,
  phone text,
  role text,
  intent text,
  source_url text,
  ip_hash text,
  user_agent text,
  conversation jsonb not null default '[]'::jsonb,
  total_messages integer not null default 0,
  total_cost_cents integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_leads_email_idx on public.marketing_leads (email);
create index if not exists marketing_leads_created_at_idx on public.marketing_leads (created_at desc);

create table if not exists public.marketing_chat_rate_limits (
  key text primary key,
  count integer not null default 0,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists marketing_chat_rate_limits_expires_at_idx
  on public.marketing_chat_rate_limits (expires_at);

create table if not exists public.marketing_ally_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id text,
  event_type text not null check (
    event_type in (
      'message_sent',
      'reply_returned',
      'chip_clicked',
      'cta_emitted',
      'lead_captured',
      'first_email_captured',
      'kill_switch_blocked',
      'rate_limited'
    )
  ),
  ip_hash text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists marketing_ally_events_conversation_id_idx
  on public.marketing_ally_events (conversation_id, created_at desc);
create index if not exists marketing_ally_events_created_at_idx
  on public.marketing_ally_events (created_at desc);

create table if not exists public.marketing_flags (
  id text primary key default 'singleton',
  kill_switch boolean not null default false,
  kill_reason text,
  daily_cap_cents integer not null default 2000,
  updated_at timestamptz not null default now(),
  constraint marketing_flags_singleton check (id = 'singleton')
);

insert into public.marketing_flags (id)
values ('singleton')
on conflict (id) do nothing;

create or replace function public.marketing_chat_rate_limit_bump(
  p_key text,
  p_expires_at timestamptz
)
returns integer
language plpgsql
as $$
declare
  next_count integer;
begin
  delete from public.marketing_chat_rate_limits
  where expires_at < now();

  insert into public.marketing_chat_rate_limits as buckets (key, count, expires_at, updated_at)
  values (p_key, 1, p_expires_at, now())
  on conflict (key) do update
    set count = buckets.count + 1,
        expires_at = greatest(buckets.expires_at, excluded.expires_at),
        updated_at = now()
  returning count into next_count;

  return next_count;
end;
$$;

alter table public.marketing_leads enable row level security;
alter table public.marketing_chat_rate_limits enable row level security;
alter table public.marketing_ally_events enable row level security;
alter table public.marketing_flags enable row level security;

revoke all on table public.marketing_leads from anon, authenticated;
revoke all on table public.marketing_chat_rate_limits from anon, authenticated;
revoke all on table public.marketing_ally_events from anon, authenticated;
revoke all on table public.marketing_flags from anon, authenticated;
revoke all on function public.marketing_chat_rate_limit_bump(text, timestamptz) from public, anon, authenticated;

grant all on table public.marketing_leads to service_role;
grant all on table public.marketing_chat_rate_limits to service_role;
grant all on table public.marketing_ally_events to service_role;
grant all on table public.marketing_flags to service_role;
grant execute on function public.marketing_chat_rate_limit_bump(text, timestamptz) to service_role;
