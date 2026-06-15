-- 088: Operator delivery photo-selection checkpoint.
-- Adds a pre-generation human gate so operators can replace/reorder Gemini's
-- selected photos before paid video provider renders start.
-- DO NOT apply to prod without Oliver's explicit approval (shared Supabase).

alter table photos
  add column if not exists photo_selection_rank integer;

alter table delivery_runs
  drop constraint if exists delivery_runs_stage_check;

alter table delivery_runs
  add constraint delivery_runs_stage_check
  check (stage in (
    'intake','scraping','photo_selection','generating','judging','checkpoint_a',
    'details','voiceover','music','assembling','checkpoint_b','delivered'
  ));

alter table ml_events
  drop constraint if exists ml_events_event_type_check;

alter table ml_events
  add constraint ml_events_event_type_check
  check (event_type in (
    'photo_selection','reorder','regenerate','variant_override','script_edit',
    'voice_choice','music_choice','rating','comment','details_edit',
    'music_feedback'
  ));

create or replace function public.approve_photo_selection(
  p_run_id uuid,
  p_photo_order uuid[],
  p_rejected jsonb default '[]'::jsonb,
  p_event_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property_id uuid;
  v_order_count integer;
  v_distinct_count integer;
  v_owned_count integer;
begin
  v_order_count := coalesce(array_length(p_photo_order, 1), 0);
  if v_order_count = 0 then
    raise exception 'photo_order must include at least one photo';
  end if;

  select count(distinct id)
    into v_distinct_count
  from unnest(p_photo_order) as ids(id);

  if v_distinct_count <> v_order_count then
    raise exception 'photo_order must not contain duplicate photo ids';
  end if;

  select property_id
    into v_property_id
  from delivery_runs
  where id = p_run_id
    and stage = 'photo_selection'
  for update;

  if v_property_id is null then
    raise exception 'photo selection is not available for this run';
  end if;

  select count(*)
    into v_owned_count
  from photos
  where property_id = v_property_id
    and id = any(p_photo_order);

  if v_owned_count <> v_order_count then
    raise exception 'photo_order contains photos outside this property';
  end if;

  with rejection_reasons as (
    select
      nullif(photo_id, '')::uuid as photo_id,
      nullif(trim(reason), '') as reason
    from jsonb_to_recordset(coalesce(p_rejected, '[]'::jsonb)) as r(photo_id text, reason text)
    where nullif(photo_id, '') is not null
  )
  update photos p
  set
    selected = false,
    photo_selection_rank = null,
    discard_reason = coalesce(rr.reason, p.discard_reason, 'Not selected')
  from rejection_reasons rr
  where p.property_id = v_property_id
    and p.id = rr.photo_id
    and not (p.id = any(p_photo_order));

  update photos p
  set
    selected = false,
    photo_selection_rank = null,
    discard_reason = coalesce(p.discard_reason, 'Not selected')
  where p.property_id = v_property_id
    and not (p.id = any(p_photo_order))
    and not exists (
      select 1
      from jsonb_to_recordset(coalesce(p_rejected, '[]'::jsonb)) as r(photo_id text, reason text)
      where nullif(r.photo_id, '')::uuid = p.id
    );

  update photos p
  set
    selected = true,
    photo_selection_rank = ordered.rank,
    discard_reason = null
  from unnest(p_photo_order) with ordinality as ordered(id, rank)
  where p.property_id = v_property_id
    and p.id = ordered.id;

  update properties
  set selected_photo_count = v_order_count
  where id = v_property_id;

  update delivery_runs
  set
    stage = 'generating',
    error = null,
    updated_at = now()
  where id = p_run_id
    and stage = 'photo_selection';

  insert into ml_events (run_id, event_type, payload)
  values (p_run_id, 'photo_selection', p_event_payload);

return jsonb_build_object('selected_photo_ids', to_jsonb(p_photo_order));
end;
$$;

revoke all on function public.approve_photo_selection(uuid, uuid[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.approve_photo_selection(uuid, uuid[], jsonb, jsonb) to service_role;
