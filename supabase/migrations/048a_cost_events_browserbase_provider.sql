-- 048a_cost_events_browserbase_provider.sql
-- Phase 1 smoke surfaced that cost_events.provider is gated by a CHECK
-- constraint, and the existing allowlist didn't include browserbase / apify /
-- gemini. Drop and recreate the constraint with the blog-engine providers
-- added. Also matches the trigger function in 048 which writes new.cost_cents
-- (the existing real column name) into blog_posts.cost_usd_cents.

alter table cost_events drop constraint if exists cost_events_provider_check;

alter table cost_events add constraint cost_events_provider_check
  check (provider = any (array[
    'anthropic', 'runway', 'kling', 'luma', 'shotstack',
    'openai', 'atlas', 'google', 'higgsfield',
    'browserbase', 'apify', 'gemini'
  ]));
