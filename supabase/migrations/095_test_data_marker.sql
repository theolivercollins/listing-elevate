-- Tag rows created in non-prod (dev/preview) environments so they can be
-- filtered out of live operator views + cost reconciliation, and bulk-cleaned.
-- Shared DB across all envs (cost decision) makes this necessary once
-- LE_ALLOW_NONPROD_WRITES is enabled on Preview.
alter table properties   add column if not exists is_test boolean not null default false;
alter table cost_events  add column if not exists is_test boolean not null default false;

comment on column properties.is_test  is 'True when the property was created on a non-prod (dev/preview) deploy. Excluded from live operator dashboard + reconciliation.';
comment on column cost_events.is_test  is 'True when the cost event was recorded on a non-prod deploy. Excluded from cost reconciliation so test spend never pollutes real margin numbers.';

create index if not exists idx_properties_is_test  on properties(is_test)  where is_test = true;
create index if not exists idx_cost_events_is_test on cost_events(is_test) where is_test = true;
