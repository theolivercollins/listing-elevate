-- 056_operator_studio.sql
-- Operator Studio Phase 1: clients + preview tokens + revision notes
-- Per docs/specs/2026-05-15-operator-studio-design.md (v2)
-- Playbooks table intentionally deferred to Phase 2.

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_email text,
  phone text,
  monthly_rate_cents integer,
  notes text,
  brand_logo_url text,
  brand_primary_hex text,
  brand_secondary_hex text,
  agent_name text,
  agent_headshot_url text,
  voice_id text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists property_previews (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  token text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  viewed_count integer not null default 0,
  last_viewed_at timestamptz
);
create unique index if not exists idx_property_previews_token on property_previews(token);
create index if not exists idx_property_previews_property on property_previews(property_id);

create table if not exists property_revision_notes (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  source text not null check (source in ('operator','client_preview')),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_property_revision_notes_property on property_revision_notes(property_id, created_at desc);

alter table properties
  add column if not exists order_mode text not null default 'customer' check (order_mode in ('customer','operator')),
  add column if not exists client_id uuid references clients(id) on delete set null,
  add column if not exists ingest_source text check (ingest_source in ('manual','zillow','redfin','sierra','mls','drive_link')),
  add column if not exists ingest_source_url text;

create index if not exists idx_properties_order_mode_client on properties(order_mode, client_id) where order_mode = 'operator';

-- No policies on the three operator_studio tables below: access is service-role only.
-- JWT-authenticated clients are deny-all by design. The /preview/:token public route reads
-- via the service role inside the API handler (see api/preview/[token].ts) — not via PostgREST.
alter table clients enable row level security;
alter table property_previews enable row level security;
alter table property_revision_notes enable row level security;

create or replace function increment_preview_view(p_token text) returns void as $$
  update property_previews
    set viewed_count = viewed_count + 1,
        last_viewed_at = now()
    where token = p_token;
$$ language sql;
