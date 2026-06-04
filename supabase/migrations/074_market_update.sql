-- 074_market_update.sql
-- Market Update workflow: monthly per-region stat reports -> filled templates ->
-- blog/email drafts. Additive only: two new tables + seed rows. Touches no
-- existing table or data.
-- See docs/specs/2026-06-04-market-update-workflow-design.md.

-- Region config (seeded; extensible — add a row to support a new area).
create table if not exists mu_regions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references blog_sites(id),
  slug text not null,
  display_name text not null,
  strip_images boolean not null default false,
  emits_email boolean not null default false,
  sort_order int not null default 0,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists mu_regions_site_slug_idx on mu_regions(site_id, slug);

-- One row per monthly run.
create table if not exists market_update_runs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references blog_sites(id) on delete cascade,
  period_month int not null,          -- 1..12, the DATA month
  period_year int not null,
  status text not null default 'extracting'
    check (status in ('extracting','needs_review','ready','generated','failed')),
  blog_template_id uuid references blog_templates(id),
  email_template_id uuid references email_templates(id),
  region_results jsonb not null default '[]'::jsonb,
  created_post_ids uuid[] not null default '{}',
  created_email_ids uuid[] not null default '{}',
  cost_usd_cents int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists market_update_runs_site_idx
  on market_update_runs(site_id, period_year desc, period_month desc);

-- Seed the three target regions, scoped to the Sierra (Helgemo) site.
insert into mu_regions (site_id, slug, display_name, strip_images, emits_email, sort_order)
select s.id, v.slug, v.display_name, v.strip_images, v.emits_email, v.sort_order
from (select id from blog_sites where host_kind = 'sierra' limit 1) s
cross join (values
  ('charlotte_county', 'Charlotte County', false, true,  1),
  ('the_isles',        'The Isles',        true,  false, 2),
  ('deep_creek',       'Deep Creek',       true,  false, 3)
) as v(slug, display_name, strip_images, emits_email, sort_order)
where not exists (
  select 1 from mu_regions m
  where m.site_id = s.id and m.slug = v.slug
);

-- Seed a default Blog MU template (canonical tokens + FAQ markers + image marker).
insert into blog_templates (site_id, name, description, body_html, metadata)
select s.id,
  'Market Update — Blog (default)',
  'Default monthly market-update blog template. Uses canonical {{TOKEN}} placeholders. Edit freely; keep the token names.',
$HTML$<article style="font-family: Inter, Arial, sans-serif; color:#1f2933; max-width:760px; margin:0 auto; line-height:1.6;">
  <!-- MU:IMAGE hero -->
  <figure style="margin:0 0 24px;"><img src="{{REGION_NAME}}" alt="{{REGION_NAME}} market update" style="width:100%; border-radius:12px;"/></figure>
  <p style="text-transform:uppercase; letter-spacing:1px; font-size:12px; color:#6b7280; margin:0 0 4px;">Market Update · {{REPORT_MONTH}} {{REPORT_YEAR}}</p>
  <h1 style="font-size:30px; font-weight:700; margin:0 0 12px;">{{REGION_NAME}} Real Estate Market Update</h1>
  <p style="font-size:18px; color:#374151;">{{REGION_NAME}} was a <strong>{{MARKET_VERDICT}} market</strong> in {{REPORT_MONTH}} {{REPORT_YEAR}}.</p>

  <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin:24px 0;">
    <div style="background:#f8f9fa; padding:18px; border-radius:10px; text-align:center;">
      <div style="font-size:28px; font-weight:600;">{{FOR_SALE}}</div>
      <div style="font-size:11px; text-transform:uppercase; color:#6b7280;">For Sale</div>
      <div style="font-size:12px;">{{FOR_SALE_MOM}} MoM · {{FOR_SALE_YOY}} YoY</div>
    </div>
    <div style="background:#f8f9fa; padding:18px; border-radius:10px; text-align:center;">
      <div style="font-size:28px; font-weight:600;">{{SOLD}}</div>
      <div style="font-size:11px; text-transform:uppercase; color:#6b7280;">Sold</div>
      <div style="font-size:12px;">{{SOLD_MOM}} MoM · {{SOLD_YOY}} YoY</div>
    </div>
    <div style="background:#f8f9fa; padding:18px; border-radius:10px; text-align:center;">
      <div style="font-size:28px; font-weight:600;">{{PENDED}}</div>
      <div style="font-size:11px; text-transform:uppercase; color:#6b7280;">Pending</div>
      <div style="font-size:12px;">{{PENDED_MOM}} MoM · {{PENDED_YOY}} YoY</div>
    </div>
    <div style="background:#f8f9fa; padding:18px; border-radius:10px; text-align:center;">
      <div style="font-size:28px; font-weight:600;">{{DOM}}</div>
      <div style="font-size:11px; text-transform:uppercase; color:#6b7280;">Avg Days on Market</div>
      <div style="font-size:12px;">{{DOM_MOM}} MoM · {{DOM_YOY}} YoY</div>
    </div>
  </div>

  <h2 style="font-size:20px; border-bottom:2px solid #1f2933; padding-bottom:6px;">Pricing</h2>
  <ul style="font-size:16px;">
    <li><strong>Median Sold Price:</strong> {{MEDIAN_SOLD_PRICE}} ({{MEDIAN_SOLD_PRICE_MOM}} MoM, {{MEDIAN_SOLD_PRICE_YOY}} YoY)</li>
    <li><strong>Average Sold Price:</strong> {{AVG_SOLD_PRICE}} ({{AVG_SOLD_PRICE_MOM}} MoM, {{AVG_SOLD_PRICE_YOY}} YoY)</li>
    <li><strong>Average $/SqFt:</strong> {{AVG_PPSF}} ({{AVG_PPSF_MOM}} MoM, {{AVG_PPSF_YOY}} YoY)</li>
    <li><strong>Sold / Original List Price:</strong> {{SOLD_TO_LIST}} ({{SOLD_TO_LIST_YOY}} YoY)</li>
  </ul>

  <h2 style="font-size:20px; border-bottom:2px solid #1f2933; padding-bottom:6px;">Supply &amp; Demand</h2>
  <ul style="font-size:16px;">
    <li><strong>Months of Inventory (Closed):</strong> {{MOI_CLOSED}} — a {{MARKET_VERDICT}} market ({{MOI_CLOSED_YOY}} YoY)</li>
    <li><strong>Months of Inventory (Pended):</strong> {{MOI_PENDED}} ({{MOI_PENDED_YOY}} YoY)</li>
    <li><strong>Absorption Rate (Closed):</strong> {{ABSORPTION_CLOSED}} ({{ABSORPTION_CLOSED_YOY}} YoY)</li>
  </ul>

  <h2 style="font-size:20px; border-bottom:2px solid #1f2933; padding-bottom:6px;">Frequently Asked Questions</h2>
  <!-- MU:FAQ_START -->
  <h3>Is {{REGION_NAME}} a buyer's or seller's market right now?</h3>
  <p>As of {{REPORT_MONTH}} {{REPORT_YEAR}}, {{REGION_NAME}} is a {{MARKET_VERDICT}} market, with {{MOI_CLOSED}} months of inventory based on closed sales.</p>
  <h3>What is the median home price in {{REGION_NAME}}?</h3>
  <p>The median sold price was {{MEDIAN_SOLD_PRICE}} ({{MEDIAN_SOLD_PRICE_YOY}} year over year).</p>
  <h3>How fast are homes selling?</h3>
  <p>Homes averaged {{DOM}} days on market, with sellers receiving {{SOLD_TO_LIST}} of their original list price.</p>
  <!-- MU:FAQ_END -->
</article>$HTML$,
  jsonb_build_object('kind','market_update','mu_role','blog')
from (select id from blog_sites where host_kind = 'sierra' limit 1) s
where not exists (
  select 1 from blog_templates t
  where t.site_id = s.id and t.metadata->>'kind' = 'market_update' and t.metadata->>'mu_role' = 'blog'
);

-- Seed a default Email MU template (table-based, inline CSS, 600px, no FAQ block).
insert into email_templates (site_id, name, description, body_html, default_subject, metadata)
select s.id,
  'Market Update — Email (default)',
  'Default monthly market-update email template. Uses canonical {{TOKEN}} placeholders.',
$HTML$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7; padding:24px 0; font-family:Arial,Helvetica,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:12px; overflow:hidden;">
      <tr><td style="background:#0A2540; padding:24px 32px; color:#ffffff;">
        <p style="margin:0; font-size:12px; letter-spacing:1px; text-transform:uppercase; color:#9fb3c8;">Market Update · {{REPORT_MONTH}} {{REPORT_YEAR}}</p>
        <h1 style="margin:6px 0 0; font-size:24px;">{{REGION_NAME}} Market Update</h1>
      </td></tr>
      <tr><td style="padding:24px 32px; color:#1f2933; font-size:16px; line-height:1.6;">
        <p>{{REGION_NAME}} was a <strong>{{MARKET_VERDICT}} market</strong> in {{REPORT_MONTH}} {{REPORT_YEAR}}. Here are the numbers:</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
          <tr>
            <td style="padding:12px; background:#f8f9fa; border-radius:8px; text-align:center;" width="33%">
              <div style="font-size:22px; font-weight:bold;">{{SOLD}}</div><div style="font-size:11px; color:#6b7280;">SOLD</div>
            </td>
            <td width="8"></td>
            <td style="padding:12px; background:#f8f9fa; border-radius:8px; text-align:center;" width="33%">
              <div style="font-size:22px; font-weight:bold;">{{MEDIAN_SOLD_PRICE}}</div><div style="font-size:11px; color:#6b7280;">MEDIAN PRICE</div>
            </td>
            <td width="8"></td>
            <td style="padding:12px; background:#f8f9fa; border-radius:8px; text-align:center;" width="33%">
              <div style="font-size:22px; font-weight:bold;">{{DOM}}</div><div style="font-size:11px; color:#6b7280;">DAYS ON MKT</div>
            </td>
          </tr>
        </table>
        <p><strong>Inventory:</strong> {{FOR_SALE}} for sale ({{FOR_SALE_YOY}} YoY) · {{MOI_CLOSED}} months of supply.<br/>
           <strong>Sellers</strong> received {{SOLD_TO_LIST}} of original list price.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;">
          <tr><td bgcolor="#E97316" style="border-radius:8px;">
            <a href="{{CTA_URL}}" style="display:inline-block; padding:12px 28px; color:#ffffff; text-decoration:none; font-weight:bold;">See the full report</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:16px 32px; background:#f4f5f7; font-size:12px; color:#6b7280;">
        The Helgemo Team · <a href="{{UNSUBSCRIBE_URL}}" style="color:#6b7280;">Unsubscribe</a>
      </td></tr>
    </table>
  </td></tr>
</table>$HTML$,
  'Your Monthly Market Update',
  jsonb_build_object('kind','market_update','mu_role','email')
from (select id from blog_sites where host_kind = 'sierra' limit 1) s
where not exists (
  select 1 from email_templates t
  where t.site_id = s.id and t.metadata->>'kind' = 'market_update' and t.metadata->>'mu_role' = 'email'
);

notify pgrst, 'reload schema';
