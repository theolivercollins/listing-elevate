-- 049_blog_phase_2.sql
-- Phase 2 schema: Supabase Storage bucket for blog images + DB trigger that
-- auto-enqueues an image_match job whenever a post enters 'draft_ready'.

insert into storage.buckets (id, name, public)
  values ('blog-images', 'blog-images', true)
  on conflict (id) do nothing;

create policy if not exists "blog-images service role write"
  on storage.objects for all
  to service_role
  using (bucket_id = 'blog-images')
  with check (bucket_id = 'blog-images');

create or replace function blog_posts_enqueue_image_match()
returns trigger language plpgsql as $$
begin
  if new.state = 'draft_ready'
     and (old.state is null or old.state <> 'draft_ready') then
    insert into blog_jobs (post_id, site_id, kind, payload)
      values (new.id, new.site_id, 'image_match', '{}'::jsonb);
  end if;
  return new;
end;
$$;

create trigger blog_posts_after_draft_ready_trg
  after insert or update of state on blog_posts
  for each row execute function blog_posts_enqueue_image_match();
