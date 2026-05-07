-- 049b_blog_match_image_rpc.sql
-- Server-side cosine match: returns the closest image (by embedding) excluding
-- ones used on a post within `recent_days` days. Service role only — invoked
-- by the image_match job handler.

create or replace function blog_match_image(
  q_embedding vector(768),
  q_site_id uuid,
  recent_days int default 14,
  n_limit int default 1
)
returns table (id uuid, distance float8)
language sql stable as $$
  select bi.id, bi.embedding <=> q_embedding as distance
  from blog_images bi
  where bi.active = true
    and bi.embedding is not null
    and (bi.site_id is null or bi.site_id = q_site_id)
    and (recent_days <= 0 or bi.id not in (
      select biu.image_id from blog_image_usages biu
      where biu.used_at > now() - make_interval(days => recent_days)
    ))
  order by bi.embedding <=> q_embedding
  limit n_limit;
$$;
