-- bl_comm_0448 — "LoadBoot Weekly": one weekly email engine, three role versions (26 Sep 2026, owner decision)
--
-- Why: three separate weekly emails were about to exist — the carrier account digest (0259-0265, Mon 13:00,
-- off), the public newsletter (0447, Tue 14:00, off) and nothing at all for dispatchers. A carrier who also
-- subscribed to the newsletter would have got two emails in two days. Amazon/Uber send ONE weekly: a fixed
-- premium layout with each person's own data in it. That is what this is.
--
-- What it does
--   1. app_private.weekly_content — the content pool: dispatch tips (carrier / dispatcher), compliance
--      reminders and "worth reading" articles. draft → approved → retired. The Tuesday article Routine
--      adds drafts (docs/seo-audit-2026-10/ARTICLES.md §6); the owner approves in CC → Newsletter.
--      The 8 + 8 texts hard-coded in 0447 are the seed, plus dispatcher tips and six site guides.
--   2. app_private.weekly_issues — one row per ISO week per audience (carrier / dispatcher / public).
--      Monday 12:00 UTC (lb-weekly-build) picks this week's tip, reminder and article (least used first,
--      shared across the three versions so the pool is not burned 3x) and snapshots the rates.
--      status draft → approved (owner, or automatic when comm.weekly_approval = 'auto') → sent.
--   3. Rendering: app_private.weekly_render(audience, content, ctx). Per-recipient data
--      (carrier: app_private.carrier_weekly_summary + equipment + expiries; dispatcher: their carriers,
--      bookings, fleet; public: none) goes into a card layout — stat tiles, rates for THEIR equipment with
--      week-over-week arrows (app_private.rate_history), alerts, tip, reminder, article, CTA. The layout
--      skeleton lives in comm_templates (weekly.carrier / weekly.dispatcher / newsletter.weekly) as
--      tokens, so CC → Templates can still edit the copy. No dark bands or logos in the body: the
--      delivery-worker shell (v16) owns the branding and strips any it finds.
--   4. Sending: app_private.weekly_send_run() — Tuesday 14:00 UTC (the existing lb-newsletter-weekly job,
--      re-pointed). Only an APPROVED issue goes out. Master switch stays comm.newsletter_enabled
--      ("Weekly send" in CC). Every send is sys_email → email_gate (unsubscribes, "fewer emails", suppressions).
--      app_private.weekly_sends records each recipient once per issue: "Send now" then the cron cannot
--      double-send; a subscriber confirmed on Wednesday still gets that week's issue on the next run.
--      Registered carriers/dispatchers who also subscribed to the newsletter get ONLY their role version.
--   5. Staff alerts (staff_internal, to lc_alert_email): weekly.drafts_ready on Monday when approval is
--      manual; weekly.unapproved on Tuesday if nothing was approved (nothing went out).
--   6. Retired: cron carrier_weekly_digest (unscheduled; carrier_weekly_digest_run now returns retired=true),
--      catalog carrier_weekly_summary → replaced_by weekly.carrier. newsletter_weekly_run() and
--      cc_newsletter_preview() now delegate to the new engine so the 0447 CC screen keeps working.
--   7. CC RPCs (authenticated only; view = unsub_can_view, manage = can_manage_comms):
--      cc_weekly_overview, cc_weekly_preview, cc_weekly_issue_set, cc_weekly_content_list,
--      cc_weekly_content_set, cc_weekly_settings_set.
--
-- Anon surface: unchanged (35 staging / 36 prod). Every new public function is revoked from public, anon.
-- Docs: claude/WEEKLY-0448.md
-- Staging got this as bl_comm_0448_loadboot_weekly + bl_comm_0448b_recount (the used_count fix); prod applies this file as one.

-- ---------------------------------------------------------------- 1. content pool
create table if not exists app_private.weekly_content (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('tip_carrier','tip_dispatcher','compliance','article')),
  title         text,
  body          text not null,
  url           text,
  status        text not null default 'draft' check (status in ('draft','approved','retired')),
  source        text not null default 'owner' check (source in ('seed','owner','routine')),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  approved_by   uuid,
  approved_at   timestamptz,
  retired_at    timestamptz,
  used_count    int not null default 0,
  last_used_at  timestamptz,
  note          text
);
create index if not exists weekly_content_pick_idx on app_private.weekly_content (kind, status, used_count, last_used_at);
alter table app_private.weekly_content enable row level security;
revoke all on app_private.weekly_content from public, anon, authenticated;

-- seed: the texts 0447 hard-coded (carrier tips + compliance), dispatcher tips, six site guides
insert into app_private.weekly_content (kind, body, status, source, approved_at)
select 'tip_carrier', x, 'approved', 'seed', now() from unnest(array[
  'Before you accept a load, add deadhead miles to the loaded miles and divide the rate by the total. A $2.80/mi load with 180 empty miles behind it is not a $2.80 load.',
  'Ask the broker two questions on every call: "Is this load ready now?" and "What is the detention policy?" The answers tell you more about the lane than the rate does.',
  'Book your Friday load on Wednesday. Thursday afternoon is when brokers panic and rates move — but the good freight is already gone.',
  'Keep one photo set per stop: BOL, seal, trailer, odometer. A POD dispute is won or lost on what you photographed at the dock, not on what you remember.',
  'A reload out of a dead market is worth accepting slightly under rate if the next leg is strong. Price the round trip, not the leg.',
  'Send the rate confirmation back within 15 minutes of agreeing. Brokers double-book the slow responders first.',
  'Check the broker''s credit before the second load, not after the first invoice ages 45 days. Free credit checks exist — use them every time.',
  'When the dispatcher quotes "all-in", ask what the fuel surcharge portion is. It changes how the rate compares week to week.']) x
where not exists (select 1 from app_private.weekly_content where source = 'seed' and kind = 'tip_carrier');

insert into app_private.weekly_content (kind, body, status, source, approved_at)
select 'compliance', x, 'approved', 'seed', now() from unnest(array[
  'Your UCR registration renews every calendar year. If you have not filed for the coming year by December, you are operating out of compliance on January 1.',
  'Form 2290 (HVUT) is due by the end of August for the July–June tax period. Keep the stamped Schedule 1 in the truck — you need it to renew plates.',
  'Check your MCS-150 update date. Biennial updates are required even if nothing changed; a lapse can deactivate your USDOT number.',
  'Insurance certificates expire quietly. Put the cargo and liability renewal dates in your calendar 30 days early, and send the new COI to every broker you run for.',
  'IFTA quarterly returns are due the last day of April, July, October and January. Late filing means penalties AND interest, even with zero tax owed.',
  'A driver''s medical certificate must be on file with the state DMV, not just in the cab. An expired med card on a CDL means the CDL downgrades.',
  'BOC-3 process agents must cover every state you run in. If you added lanes this year, check the filing still does.',
  'Annual inspection stickers: the DOT inspection is valid 12 months from the inspection date, not the calendar year. Check the date on the sticker, not the year.']) x
where not exists (select 1 from app_private.weekly_content where source = 'seed' and kind = 'compliance');

insert into app_private.weekly_content (kind, body, status, source, approved_at)
select 'tip_dispatcher', x, 'approved', 'seed', now() from unnest(array[
  'Post every truck by 7 am local time, with a real available date. A truck posted at noon competes with freight that was already covered at 9.',
  'Quote the carrier''s floor rate to yourself before you call the broker. If you do not know the number the driver will say no to, you are negotiating for the broker.',
  'Confirm the reload before the driver is empty. The strongest hour to sell a truck is while it is still under load and a broker can see it moving.',
  'One message per stop: appointment time, contact, and what the receiver needs. A driver who has to call you from the gate is a driver who is late.',
  'When a broker goes quiet after "let me check", send the truck to two more brokers. Silence is a no you have not been told yet.',
  'Keep a per-carrier note of what they will not haul (no hazmat, no NYC, no team). Sending a load they will refuse costs you the broker''s next call.',
  'End every day by pushing each truck''s available date forward. A stale posting is invisible to the boards and to LoadBoot matching.',
  'Check the broker''s credit and days-to-pay before you book. A great rate from a 60-day payer is a cash-flow problem you created.']) x
where not exists (select 1 from app_private.weekly_content where source = 'seed' and kind = 'tip_dispatcher');

insert into app_private.weekly_content (kind, title, body, url, status, source, approved_at)
select 'article', t, b, u, 'approved', 'seed', now() from (values
  ('How to Read a Rate Confirmation Before You Sign', 'The eight lines on a rate con that cost carriers money — detention, TONU, layover, and the accessorials brokers leave blank on purpose.', '/how-to-read-a-rate-confirmation.html'),
  ('Do New-Authority Carriers Need a Dispatcher?', 'What the first 90 days under a new MC actually look like, which brokers will run you, and when paying 5–10% is the cheaper choice.', '/do-new-authority-carriers-need-a-dispatcher.html'),
  ('Truck Dispatcher vs Freight Broker: Costs & Who You Need', 'Two jobs that get confused every week — who works for whom, what each one is paid, and which one you actually need.', '/truck-dispatcher-vs-freight-broker.html'),
  ('Truck Dispatcher Cost 2026: 5–10% of Gross Explained', 'What a dispatcher costs per week on a typical dry van, what you should get for it, and the fee structures to walk away from.', '/how-much-does-a-truck-dispatcher-cost.html'),
  ('Owner-Operator Dispatch Service: The Complete Guide', 'How dispatch works end to end for a one-truck operation — posting, negotiation, paperwork, and getting paid without a factoring surprise.', '/owner-operator-dispatch-service-guide.html'),
  ('Truck Driver Per Diem 2026: The Deduction Most Owner-Operators Never Claim', 'The IRS per diem rule for 2026, the real math on 200 nights out, and how to keep proof of the days without a single meal receipt.', '/truck-driver-per-diem-2026.html')
) v(t, b, u)
where not exists (select 1 from app_private.weekly_content where source = 'seed' and kind = 'article');

-- ---------------------------------------------------------------- 2. issues + per-recipient sends
create table if not exists app_private.weekly_issues (
  id             uuid primary key default gen_random_uuid(),
  week           text not null,                       -- ISO week, e.g. 2026-W40
  audience       text not null check (audience in ('carrier','dispatcher','public')),
  status         text not null default 'draft' check (status in ('draft','approved','sent','skipped')),
  content        jsonb not null default '{}'::jsonb,  -- {tip, compliance, article, rates, as_of, week_label}
  built_at       timestamptz not null default now(),
  approved_by    uuid,
  approved_at    timestamptz,
  sent_at        timestamptz,
  sent_count     int not null default 0,
  refused_count  int not null default 0,
  note           text,
  unique (week, audience)
);
alter table app_private.weekly_issues enable row level security;
revoke all on app_private.weekly_issues from public, anon, authenticated;

create table if not exists app_private.weekly_sends (
  issue_id   uuid not null references app_private.weekly_issues(id) on delete cascade,
  email      text not null,
  user_id    uuid,
  org_id     uuid,
  allowed    boolean not null default true,
  gate       text,
  sent_at    timestamptz not null default now(),
  primary key (issue_id, email)
);
alter table app_private.weekly_sends enable row level security;
revoke all on app_private.weekly_sends from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. settings
insert into app_private.system_setting_defs (key, value_type, description, validation, sensitivity, required_permission, default_value, environment)
values ('comm.weekly_approval', 'string',
        'LoadBoot Weekly approval: "manual" = the owner previews and approves each week''s issues in CC → Newsletter before Tuesday; "auto" = Monday''s build is approved at once. Manual for the first weeks.',
        '{}'::jsonb, 'internal', 'settings.manage', '"manual"'::jsonb, 'all')
on conflict (key) do nothing;
insert into app_private.system_settings (key, value)
select 'comm.weekly_approval', '"manual"'::jsonb
where not exists (select 1 from app_private.system_settings where key = 'comm.weekly_approval');
update app_private.system_setting_defs
   set description = 'Master switch for LoadBoot Weekly (carrier, dispatcher and public newsletter versions). Tuesdays 14:00 UTC to approved issues only. Off until the owner turns it on (CC → Newsletter).'
 where key = 'comm.newsletter_enabled';
update app_private.system_setting_defs
   set description = 'RETIRED 26 Sep 2026 (bl_comm_0448): the carrier weekly summary is now the carrier version of LoadBoot Weekly (comm.newsletter_enabled).'
 where key = 'comm.weekly_summary_enabled';

-- ---------------------------------------------------------------- 4. helpers
create or replace function app_private.weekly_week(p_date date default current_date)
returns text language sql immutable as $$ select to_char(p_date, 'IYYY-"W"IW') $$;

create or replace function app_private.weekly_week_label(p_date date default current_date)
returns text language sql immutable as $$ select 'Week of ' || to_char(date_trunc('week', p_date)::date, 'Mon DD') $$;

create or replace function app_private.wk_esc(t text)
returns text language sql immutable as $$
  select replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') $$;

create or replace function app_private.wk_money(n numeric)
returns text language sql immutable as $$
  select case when n is null then '—' when abs(n) >= 1000 then '$' || to_char(round(n), 'FM999,999,999') else '$' || to_char(n, 'FM999,990.00') end $$;

-- rates with week-over-week: current public benchmarks + the previous publish from rate_history
create or replace function app_private.weekly_rates()
returns jsonb language sql stable security definer set search_path to 'app_private, public' as $$
  with cur as (
    select r.equipment, r.carrier_rpm, r.low, r.high, r.as_of
      from jsonb_to_recordset(coalesce(public.get_public_market_rates(), '[]'::jsonb))
        as r(equipment text, carrier_rpm numeric, low numeric, high numeric, as_of date)
  ), prev as (
    select distinct on (h.equipment) h.equipment, h.rpm, h.as_of
      from app_private.rate_history h join cur c on c.equipment = h.equipment
     where h.as_of < c.as_of
     order by h.equipment, h.as_of desc
  ), ord(equipment, o) as (values ('Dry Van',1),('Reefer',2),('Flatbed',3),('Step Deck',4),('Power Only',5),('Hotshot',6),('Box Truck',7),('Conestoga',8))
  select coalesce(jsonb_agg(jsonb_build_object(
           'equipment', c.equipment, 'rpm', c.carrier_rpm, 'low', c.low, 'high', c.high, 'as_of', c.as_of,
           'prev', p.rpm, 'prev_as_of', p.as_of,
           'delta_pct', case when p.rpm is null or p.rpm = 0 then null else round((c.carrier_rpm - p.rpm) / p.rpm * 100, 1) end)
         order by coalesce(o.o, 99), c.equipment), '[]'::jsonb)
    from cur c left join prev p on p.equipment = c.equipment left join ord o on o.equipment = c.equipment;
$$;
revoke all on function app_private.weekly_rates() from public, anon, authenticated;

create or replace function app_private.wk_delta(p_delta numeric)
returns text language sql immutable as $$
  select case when p_delta is null then '<span style="color:#94a3b8;font-size:12.5px">new</span>'
              when p_delta > 0.2 then '<span style="color:#15803d;font-weight:700;font-size:13px">&#9650; ' || to_char(p_delta, 'FM990.0') || '%</span>'
              when p_delta < -0.2 then '<span style="color:#b91c1c;font-weight:700;font-size:13px">&#9660; ' || to_char(abs(p_delta), 'FM990.0') || '%</span>'
              else '<span style="color:#64748b;font-size:12.5px">&#8212; flat</span>' end $$;

-- "Dry Van $3.03/mi ▲ 1.2%" — plain text for subjects
create or replace function app_private.wk_lead(p_rates jsonb, p_equipment text[] default null)
returns text language plpgsql immutable as $$
declare r jsonb;
begin
  select x into r from jsonb_array_elements(coalesce(p_rates, '[]'::jsonb)) x
   where p_equipment is null or array_length(p_equipment, 1) is null or (x->>'equipment') = any(p_equipment)
   order by (case when p_equipment is not null and (x->>'equipment') = any(p_equipment) then 0 else 1 end) limit 1;
  if r is null then select x into r from jsonb_array_elements(coalesce(p_rates, '[]'::jsonb)) x limit 1; end if;
  if r is null then return 'this week''s rates'; end if;
  return (r->>'equipment') || ' $' || to_char((r->>'rpm')::numeric, 'FM990.00') || '/mi'
      || case when (r->>'delta_pct') is null then ''
              when (r->>'delta_pct')::numeric > 0.2 then ' ▲ ' || to_char((r->>'delta_pct')::numeric, 'FM990.0') || '%'
              when (r->>'delta_pct')::numeric < -0.2 then ' ▼ ' || to_char(abs((r->>'delta_pct')::numeric), 'FM990.0') || '%'
              else ' (flat)' end;
end $$;

-- ---------------------------------------------------------------- 5. HTML blocks (light cards only — the worker shell owns the dark branding)
create or replace function app_private.wk_hero(p_eyebrow text, p_title text, p_sub text)
returns text language sql immutable as $$
  select '<p style="margin:0 0 8px;font-size:11.5px;font-weight:800;letter-spacing:.14em;color:#FC5305;text-transform:uppercase">' || p_eyebrow || '</p>'
      || '<h1 style="margin:0 0 8px;font-size:26px;line-height:1.2;color:#10223B;font-weight:800">' || p_title || '</h1>'
      || '<p style="margin:0 0 22px;color:#64748b;font-size:14.5px;line-height:1.6">' || p_sub || '</p>' $$;

create or replace function app_private.wk_section(p_title text, p_sub text default null)
returns text language sql immutable as $$
  select '<p style="margin:26px 0 2px;font-size:17px;font-weight:800;color:#10223B">' || p_title || '</p>'
      || coalesce('<p style="margin:0 0 10px;color:#64748b;font-size:13px">' || p_sub || '</p>', '<div style="height:8px"></div>') $$;

-- tiles: [{label, value, sub, tone}] — two per row, stack on phones (worker's .lb-2col rule)
create or replace function app_private.wk_tiles(p jsonb)
returns text language plpgsql immutable as $$
declare h text := ''; t jsonb; i int := 0; n int := jsonb_array_length(coalesce(p, '[]'::jsonb)); v_sub_color text;
begin
  if n = 0 then return ''; end if;
  h := '<table role="presentation" class="lb-2col" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 10px;margin:0 0 4px"><tbody>';
  for t in select * from jsonb_array_elements(p) loop
    if i % 2 = 0 then h := h || '<tr>'; end if;
    v_sub_color := case t->>'tone' when 'bad' then '#b91c1c' when 'good' then '#15803d' else '#475569' end;
    h := h || '<td width="50%" style="vertical-align:top;padding:0 ' || case when i % 2 = 0 then '5px 0 0' else '0 0 5px' end || '">'
        || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#eef2f8;border-radius:12px;padding:16px 18px">'
        || '<div style="font-size:26px;font-weight:800;color:#10223B;line-height:1.1">' || coalesce(t->>'value', '0') || '</div>'
        || '<div style="font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin-top:7px">' || coalesce(t->>'label', '') || '</div>'
        || coalesce('<div style="font-size:12.5px;color:' || v_sub_color || ';margin-top:3px">' || nullif(t->>'sub', '') || '</div>', '')
        || '</td></tr></table></td>';
    i := i + 1;
    if i % 2 = 0 then h := h || '</tr>'; end if;
  end loop;
  if i % 2 = 1 then h := h || '<td width="50%"></td></tr>'; end if;
  return h || '</tbody></table>';
end $$;

create or replace function app_private.wk_card(p_label text, p_html text, p_tone text default 'info')
returns text language sql immutable as $$
  select '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px"><tr><td style="background:'
      || case p_tone when 'warn' then '#FEF3C7' when 'bad' then '#FEE2E2' when 'good' then '#DCFCE7' else '#eef2f8' end
      || ';border-radius:12px;padding:16px 18px">'
      || '<div style="font-size:11.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:'
      || case p_tone when 'warn' then '#92400E' when 'bad' then '#991B1B' when 'good' then '#166534' else '#0883F7' end
      || ';margin-bottom:6px">' || p_label || '</div>'
      || '<div style="font-size:15px;line-height:1.65;color:#0f172a">' || p_html || '</div></td></tr></table>' $$;

create or replace function app_private.wk_btn(p_label text, p_url text, p_secondary_label text default null, p_secondary_url text default null)
returns text language sql immutable as $$
  select '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 6px"><tr><td style="background:#0883F7;border-radius:10px">'
      || '<a class="lb-btn" href="' || p_url || '" style="display:inline-block;padding:13px 22px;color:#ffffff;font-weight:800;text-decoration:none;font-size:15px"><span style="color:#ffffff">' || p_label || ' &rarr;</span></a></td>'
      || coalesce('<td style="padding-left:16px"><a href="' || p_secondary_url || '" style="color:#0883F7;font-weight:700;text-decoration:none;font-size:14px">' || p_secondary_label || ' &rarr;</a></td>', '')
      || '</tr></table>' $$;

-- rates table, optionally filtered to the recipient's equipment (falls back to all when nothing matches)
create or replace function app_private.wk_rates(p_rates jsonb, p_equipment text[] default null)
returns text language plpgsql immutable as $$
declare h text := ''; r jsonb; v_any boolean := false;
begin
  if p_equipment is not null and array_length(p_equipment, 1) > 0 then
    select true into v_any from jsonb_array_elements(coalesce(p_rates, '[]'::jsonb)) x where (x->>'equipment') = any(p_equipment) limit 1;
  end if;
  for r in select x from jsonb_array_elements(coalesce(p_rates, '[]'::jsonb)) x
            where not coalesce(v_any, false) or (x->>'equipment') = any(p_equipment) loop
    h := h || '<tr>'
      || '<td style="padding:11px 0;border-top:1px solid #e8eef6;font-weight:700;color:#10223B;font-size:15px">' || app_private.wk_esc(r->>'equipment') || '</td>'
      || '<td align="right" style="padding:11px 0 11px 8px;border-top:1px solid #e8eef6;white-space:nowrap"><span style="font-size:17px;font-weight:800;color:#10223B">$' || to_char((r->>'rpm')::numeric, 'FM990.00') || '</span><span style="color:#64748b;font-size:12.5px">/mi</span></td>'
      || '<td align="right" style="padding:11px 0 11px 10px;border-top:1px solid #e8eef6;white-space:nowrap">' || app_private.wk_delta((r->>'delta_pct')::numeric) || '</td>'
      || '<td align="right" style="padding:11px 0 11px 10px;border-top:1px solid #e8eef6;color:#64748b;font-size:12.5px;white-space:nowrap">$' || to_char((r->>'low')::numeric, 'FM990.00') || ' – $' || to_char((r->>'high')::numeric, 'FM990.00') || '</td>'
      || '</tr>';
  end loop;
  if h = '' then return '<p style="color:#64748b">Rates are being refreshed — see the live table on the site.</p>'; end if;
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">'
      || '<tr><th align="left" style="padding:0 0 6px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;font-weight:700">Equipment</th>'
      || '<th align="right" style="padding:0 0 6px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;font-weight:700">Carrier rate</th>'
      || '<th align="right" style="padding:0 0 6px 10px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;font-weight:700">vs last</th>'
      || '<th align="right" style="padding:0 0 6px 10px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;font-weight:700">Range</th></tr>'
      || h || '</table>';
end $$;

create or replace function app_private.wk_article(p jsonb, p_site text)
returns text language sql immutable as $$
  select case when p is null or p->>'title' is null then '' else
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px"><tr><td style="border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px">'
    || '<div style="font-size:11.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#FC5305;margin-bottom:6px">Worth reading</div>'
    || '<a href="' || p_site || coalesce(p->>'url', '/blog.html') || '" style="font-size:16.5px;font-weight:800;color:#10223B;text-decoration:none;line-height:1.35">' || app_private.wk_esc(p->>'title') || '</a>'
    || '<p style="margin:6px 0 10px;color:#475569;font-size:14px;line-height:1.6">' || app_private.wk_esc(p->>'body') || '</p>'
    || '<a href="' || p_site || coalesce(p->>'url', '/blog.html') || '" style="color:#0883F7;font-weight:700;text-decoration:none;font-size:14px">Read it &rarr;</a>'
    || '</td></tr></table>' end $$;

-- ---------------------------------------------------------------- 6. content kit for a week (pick; the build marks used)
create or replace function app_private.weekly_pick(p_kind text, p_exclude uuid[] default '{}')
returns jsonb language sql stable security definer set search_path to 'app_private, public' as $$
  select jsonb_build_object('id', c.id, 'title', c.title, 'body', c.body, 'url', c.url)
    from app_private.weekly_content c
   where c.kind = p_kind and c.status = 'approved' and not (c.id = any(coalesce(p_exclude, '{}')))
   order by c.used_count, c.last_used_at nulls first, c.created_at
   limit 1
$$;
revoke all on function app_private.weekly_pick(text, uuid[]) from public, anon, authenticated;

-- The kit for a week: rates snapshot + tip/compliance/article. Shared parts are reused from any issue
-- already built for that week (so the three versions carry the same reminder and article).
create or replace function app_private.weekly_kit(p_week text, p_audience text)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare v_existing jsonb; v_tip jsonb; v_comp jsonb; v_art jsonb; v_rates jsonb; v_asof text;
begin
  select content into v_existing from app_private.weekly_issues
   where week = p_week and audience <> p_audience and content ? 'compliance' order by built_at desc limit 1;
  v_rates := app_private.weekly_rates();
  v_asof := coalesce((v_rates->0->>'as_of')::date::text, current_date::text);
  v_comp := coalesce(v_existing->'compliance', app_private.weekly_pick('compliance'));
  v_art  := coalesce(v_existing->'article', app_private.weekly_pick('article'));
  if p_audience = 'dispatcher' then
    v_tip := app_private.weekly_pick('tip_dispatcher');
  else
    select content->'tip' into v_tip from app_private.weekly_issues
     where week = p_week and audience in ('carrier','public') and audience <> p_audience and content ? 'tip' limit 1;
    v_tip := coalesce(v_tip, app_private.weekly_pick('tip_carrier'));
  end if;
  return jsonb_build_object('week', p_week, 'week_label', app_private.weekly_week_label(),
    'as_of', to_char(v_asof::date, 'DD Mon YYYY'), 'rates', v_rates,
    'tip', v_tip, 'compliance', v_comp, 'article', v_art);
end $$;
revoke all on function app_private.weekly_kit(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 7. recipient context
create or replace function app_private.weekly_ctx_carrier(p_org uuid, p_user uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare s jsonb; v_name text; v_first text; v_eq text[];
begin
  s := app_private.carrier_weekly_summary(p_org);
  select coalesce(nullif(btrim(pf.contact_name), ''), nullif(btrim(pf.legal_owner_name), '')) into v_name
    from public.profiles pf where pf.id = coalesce(p_user, (select owner_user_id from public.organizations where id = p_org));
  v_first := nullif(split_part(coalesce(v_name, ''), ' ', 1), '');
  begin v_eq := app_private.disp_carrier_equipment(p_org); exception when others then v_eq := '{}'; end;
  return coalesce(s, '{}'::jsonb) || jsonb_build_object('org_id', p_org, 'first_name', v_first,
           'org_name', coalesce(s->>'name', (select name from public.organizations where id = p_org)),
           'equipment', to_jsonb(coalesce(v_eq, '{}'::text[])));
end $$;
revoke all on function app_private.weekly_ctx_carrier(uuid, uuid) from public, anon, authenticated;

create or replace function app_private.weekly_ctx_dispatcher(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare v_name text; v_first text; v_carriers jsonb; v_eq text[]; a record; s jsonb; v_del int := 0; v_miles numeric := 0; v_unposted int := 0; v_exp int := 0;
begin
  select coalesce(nullif(btrim(dp.full_name), ''), nullif(btrim(pf.contact_name), '')) into v_name
    from app_private.dispatcher_profiles dp left join public.profiles pf on pf.id = dp.user_id where dp.user_id = p_user;
  v_first := nullif(split_part(coalesce(v_name, ''), ' ', 1), '');
  v_carriers := '[]'::jsonb; v_eq := '{}';
  for a in select da.carrier_org_id, o.name from app_private.dispatcher_assignments da join public.organizations o on o.id = da.carrier_org_id
            where da.dispatcher_user_id = p_user and da.status = 'active' order by o.name loop
    s := app_private.carrier_weekly_summary(a.carrier_org_id);
    v_del := v_del + coalesce((s->>'delivered')::int, 0);
    v_miles := v_miles + coalesce((s->>'miles')::numeric, 0);
    if coalesce((s->>'posting_active')::int, 0) = 0 then v_unposted := v_unposted + 1; end if;
    v_exp := v_exp + jsonb_array_length(coalesce(s->'expiring', '[]'::jsonb));
    begin v_eq := v_eq || app_private.disp_carrier_equipment(a.carrier_org_id); exception when others then null; end;
    v_carriers := v_carriers || jsonb_build_object('name', a.name, 'offers', coalesce((s->>'offers')::int, 0),
      'delivered', coalesce((s->>'delivered')::int, 0), 'in_progress', coalesce((s->>'in_progress')::int, 0),
      'expiring', jsonb_array_length(coalesce(s->'expiring', '[]'::jsonb)), 'posted', coalesce((s->>'posting_active')::int, 0) > 0);
  end loop;
  return jsonb_build_object('user_id', p_user, 'first_name', v_first, 'name', v_name,
    'carriers', v_carriers, 'n_carriers', jsonb_array_length(v_carriers),
    'bookings', (select count(*) from app_private.dispatcher_bookings b where b.dispatcher_user_id = p_user
                   and b.created_at > now() - interval '7 days' and coalesce(b.status, '') not in ('cancelled','canceled','rejected')),
    'gross', (select coalesce(sum(b.gross), 0) from app_private.dispatcher_bookings b where b.dispatcher_user_id = p_user
                   and b.created_at > now() - interval '7 days' and coalesce(b.status, '') not in ('cancelled','canceled','rejected')),
    'delivered', v_del, 'miles', v_miles, 'unposted', v_unposted, 'expiring', v_exp,
    'equipment', to_jsonb((select coalesce(array_agg(distinct e), '{}'::text[]) from unnest(v_eq) e)));
end $$;
revoke all on function app_private.weekly_ctx_dispatcher(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 8. render
create or replace function app_private.weekly_render(p_audience text, p_content jsonb, p_ctx jsonb, out o_subject text, out o_html text)
language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare
  v_site text := app_private.newsletter_site_url();
  v_key text := case p_audience when 'carrier' then 'weekly.carrier' when 'dispatcher' then 'weekly.dispatcher' else 'newsletter.weekly' end;
  v_eq text[] := (select coalesce(array_agg(x), '{}'::text[]) from jsonb_array_elements_text(coalesce(p_ctx->'equipment', '[]'::jsonb)) x);
  v_rates jsonb := coalesce(p_content->'rates', '[]'::jsonb);
  v_first text := nullif(p_ctx->>'first_name', '');
  v_eyebrow text := 'LoadBoot Weekly &middot; ' || coalesce(p_content->>'week_label', app_private.weekly_week_label());
  v_range text := to_char(current_date - 7, 'Mon DD') || ' &ndash; ' || to_char(current_date, 'Mon DD');
  v_vars jsonb; hero text; your_week text := ''; alerts text := ''; rates text; tip text; comp text; art text; cta text; note text; tiles jsonb; e jsonb; miss text; c jsonb; rows text := '';
  v_quiet boolean; t record;
begin
  -- shared blocks
  rates := app_private.wk_section(case when array_length(v_eq, 1) > 0 then 'Rates for your equipment' else 'Rates this week' end,
             'National benchmarks per loaded mile, as of ' || coalesce(p_content->>'as_of', '') || ', vs. the previous publish.')
        || app_private.wk_rates(v_rates, v_eq)
        || '<p style="margin:10px 0 0"><a href="' || v_site || '/market-rates.html" style="color:#0883F7;font-weight:700;text-decoration:none;font-size:14px">All lanes &amp; equipment &rarr;</a></p>';
  tip := case when p_content->'tip' is null then '' else app_private.wk_section('One thing to do this week')
        || app_private.wk_card(case when p_audience = 'dispatcher' then 'Dispatcher tip' else 'Dispatch tip' end, app_private.wk_esc(p_content->'tip'->>'body'), 'info') end;
  comp := case when p_content->'compliance' is null then '' else app_private.wk_card('Compliance reminder', app_private.wk_esc(p_content->'compliance'->>'body'), 'warn') end;
  art := app_private.wk_article(p_content->'article', v_site);

  if p_audience = 'carrier' then
    v_quiet := coalesce((p_ctx->>'offers')::int, 0) = 0 and coalesce((p_ctx->>'delivered')::int, 0) = 0
           and coalesce((p_ctx->>'in_progress')::int, 0) = 0 and coalesce((p_ctx->>'invoiced')::numeric, 0) = 0;
    hero := app_private.wk_hero(v_eyebrow,
              coalesce('Your week, ' || app_private.wk_esc(v_first), 'Your week on LoadBoot'),
              v_range || ' &middot; what moved on your account, what ' || case when array_length(v_eq, 1) > 0 then app_private.wk_esc(v_eq[1]) || ' is' else 'your lanes are' end || ' paying, and one thing to do before Friday.');
    if not v_quiet then
      tiles := jsonb_build_array(
        jsonb_build_object('label', 'Loads offered', 'value', coalesce(p_ctx->>'offers', '0'),
          'sub', case when coalesce((p_ctx->>'offers_expired')::int, 0) > 0 then (p_ctx->>'offers_expired') || ' expired unanswered' else coalesce(p_ctx->>'offers_won', '0') || ' booked' end,
          'tone', case when coalesce((p_ctx->>'offers_expired')::int, 0) > 0 then 'bad' else 'good' end),
        jsonb_build_object('label', 'Delivered', 'value', coalesce(p_ctx->>'delivered', '0'),
          'sub', case when coalesce((p_ctx->>'miles')::numeric, 0) > 0 then to_char(round((p_ctx->>'miles')::numeric), 'FM999,999') || ' miles run' else '' end),
        jsonb_build_object('label', 'Invoiced', 'value', app_private.wk_money(coalesce((p_ctx->>'invoiced')::numeric, 0)),
          'sub', case when coalesce((p_ctx->>'unpaid')::numeric, 0) > 0 then app_private.wk_money((p_ctx->>'unpaid')::numeric) || ' awaiting payment' else 'nothing outstanding' end,
          'tone', case when coalesce((p_ctx->>'unpaid')::numeric, 0) > 0 then 'bad' else 'good' end),
        jsonb_build_object('label', 'Trips in progress', 'value', coalesce(p_ctx->>'in_progress', '0'),
          'sub', case when coalesce((p_ctx->>'posting_active')::int, 0) > 0 then 'truck posted' else 'truck not posted' end,
          'tone', case when coalesce((p_ctx->>'posting_active')::int, 0) > 0 then 'good' else 'bad' end));
      your_week := app_private.wk_section('Your week') || app_private.wk_tiles(tiles);
    else
      your_week := app_private.wk_section('Your week')
        || app_private.wk_card('Quiet week', 'Nothing moved on your account since ' || to_char(current_date - 7, 'Mon DD') || '. '
           || case when coalesce((p_ctx->>'posting_active')::int, 0) = 0 then 'Your truck is not posted &mdash; posted trucks get matched first.' else 'Your truck is posted; the offers below tell you what the market is paying right now.' end, 'info');
    end if;
    if jsonb_array_length(coalesce(p_ctx->'expiring', '[]'::jsonb)) > 0 then
      rows := '';
      for e in select * from jsonb_array_elements(p_ctx->'expiring') loop
        rows := rows || '<div style="margin:2px 0">' || app_private.wk_esc(e->>'what') || ' &mdash; <b>' || to_char((e->>'due')::date, 'Mon DD') || '</b></div>';
      end loop;
      alerts := alerts || app_private.wk_card('Expiring in the next 30 days', rows, 'warn');
    end if;
    if not v_quiet and coalesce((p_ctx->>'posting_active')::int, 0) = 0 then
      alerts := alerts || app_private.wk_card('Truck not posted', 'Post your truck with a real available date &mdash; matching and brokers see posted trucks first.', 'info');
    elsif coalesce((p_ctx->>'posting_stale')::int, 0) > 0 then
      alerts := alerts || app_private.wk_card('Posting runs out soon', 'Your truck posting ends in the next couple of days. Push the dates forward to keep getting matches.', 'info');
    end if;
    if jsonb_array_length(coalesce(p_ctx->'onboarding_missing', '[]'::jsonb)) > 0 then
      miss := (select string_agg(app_private.wk_esc(x), ', ') from jsonb_array_elements_text(p_ctx->'onboarding_missing') x);
      alerts := alerts || app_private.wk_card('Still needed before you can book', miss, 'bad');
    end if;
    if alerts <> '' then alerts := app_private.wk_section('Needs your attention') || alerts; end if;
    cta := app_private.wk_btn('Open your dashboard', v_site || '/app/carrier/#dashboard', 'Post your truck', v_site || '/app/carrier/#availability');
    note := '<p style="margin:22px 0 0;color:#64748b;font-size:13px;line-height:1.6">Want these loads dispatched for you? {{contact_inline}}</p>'
         || '<p style="margin:10px 0 0;color:#94a3b8;font-size:12px;line-height:1.6">You get LoadBoot Weekly because weekly summaries are on for your account. Change that any time in Account &rarr; Notifications, or with the link below.</p>';

  elsif p_audience = 'dispatcher' then
    hero := app_private.wk_hero(v_eyebrow,
              coalesce('Your fleet this week, ' || app_private.wk_esc(v_first), 'Your fleet this week'),
              v_range || ' &middot; ' || coalesce(p_ctx->>'n_carriers', '0') || ' carrier' || case when coalesce((p_ctx->>'n_carriers')::int, 0) = 1 then '' else 's' end
              || ' &middot; what moved, what their equipment is paying, and one thing to tighten up.');
    tiles := jsonb_build_array(
      jsonb_build_object('label', 'Carriers', 'value', coalesce(p_ctx->>'n_carriers', '0'),
        'sub', case when coalesce((p_ctx->>'unposted')::int, 0) > 0 then (p_ctx->>'unposted') || ' with no truck posted' else 'every truck posted' end,
        'tone', case when coalesce((p_ctx->>'unposted')::int, 0) > 0 then 'bad' else 'good' end),
      jsonb_build_object('label', 'Bookings this week', 'value', coalesce(p_ctx->>'bookings', '0'),
        'sub', case when coalesce((p_ctx->>'gross')::numeric, 0) > 0 then app_private.wk_money((p_ctx->>'gross')::numeric) || ' gross' else '' end),
      jsonb_build_object('label', 'Delivered', 'value', coalesce(p_ctx->>'delivered', '0'),
        'sub', case when coalesce((p_ctx->>'miles')::numeric, 0) > 0 then to_char(round((p_ctx->>'miles')::numeric), 'FM999,999') || ' miles across the fleet' else '' end),
      jsonb_build_object('label', 'Expiring soon', 'value', coalesce(p_ctx->>'expiring', '0'),
        'sub', case when coalesce((p_ctx->>'expiring')::int, 0) > 0 then 'documents in the next 30 days' else 'nothing in the next 30 days' end,
        'tone', case when coalesce((p_ctx->>'expiring')::int, 0) > 0 then 'bad' else 'good' end));
    your_week := app_private.wk_section('Your fleet') || app_private.wk_tiles(tiles);
    if jsonb_array_length(coalesce(p_ctx->'carriers', '[]'::jsonb)) > 0 then
      rows := '';
      for c in select * from jsonb_array_elements(p_ctx->'carriers') loop
        rows := rows || '<tr><td style="padding:9px 0;border-top:1px solid #e8eef6;font-weight:700;color:#10223B">' || app_private.wk_esc(c->>'name') || '</td>'
          || '<td align="right" style="padding:9px 0 9px 8px;border-top:1px solid #e8eef6">' || (c->>'offers') || '</td>'
          || '<td align="right" style="padding:9px 0 9px 8px;border-top:1px solid #e8eef6">' || (c->>'delivered') || '</td>'
          || '<td align="right" style="padding:9px 0 9px 8px;border-top:1px solid #e8eef6">' || (c->>'in_progress') || '</td>'
          || '<td align="right" style="padding:9px 0 9px 8px;border-top:1px solid #e8eef6;font-size:12.5px;white-space:nowrap">'
          || case when not (c->>'posted')::boolean then '<span style="color:#b91c1c;font-weight:700">not posted</span>' else '<span style="color:#15803d">posted</span>' end
          || case when (c->>'expiring')::int > 0 then ' &middot; <span style="color:#92400E;font-weight:700">' || (c->>'expiring') || ' expiring</span>' else '' end
          || '</td></tr>';
      end loop;
      alerts := app_private.wk_section('By carrier')
        || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">'
        || '<tr><th align="left" style="padding:0 0 6px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;font-weight:700">Carrier</th>'
        || '<th align="right" style="padding:0 0 6px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;font-weight:700">Offered</th>'
        || '<th align="right" style="padding:0 0 6px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;font-weight:700">Delivered</th>'
        || '<th align="right" style="padding:0 0 6px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;font-weight:700">Live</th>'
        || '<th align="right" style="padding:0 0 6px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;font-weight:700">Status</th></tr>'
        || rows || '</table>';
    else
      alerts := app_private.wk_card('No carriers assigned yet', 'When a carrier is assigned to you, their week shows up here: offers, deliveries, trucks not posted and documents about to expire.', 'info');
    end if;
    cta := app_private.wk_btn('Open your workspace', v_site || '/app/agent/#dashboard');
    note := '<p style="margin:22px 0 0;color:#64748b;font-size:13px;line-height:1.6">Questions about a carrier or a booking? {{contact_inline}}</p>'
         || '<p style="margin:10px 0 0;color:#94a3b8;font-size:12px;line-height:1.6">You get LoadBoot Weekly because you dispatch on LoadBoot. Turn weekly summaries off any time in your account settings, or with the link below.</p>';

  else -- public
    hero := app_private.wk_hero(v_eyebrow, 'This week in trucking',
              'Rates by equipment with the week-over-week move, one dispatch tip, one compliance reminder. Two minutes, every Tuesday.');
    cta := app_private.wk_btn('See all lanes &amp; equipment', v_site || '/market-rates.html', 'Cost-per-mile calculator', v_site || '/cost-per-mile-calculator.html');
    note := '<p style="margin:22px 0 0;color:#64748b;font-size:13px;line-height:1.6">Want these loads dispatched for you? {{contact_inline}}</p>'
         || '<p style="margin:10px 0 0;color:#94a3b8;font-size:12px;line-height:1.6">You asked for this at loadboot.com and confirmed by email. Unsubscribe any time with the link below.</p>';
  end if;

  v_vars := jsonb_build_object('hero', hero, 'your_week', your_week, 'alerts', alerts, 'rates', rates, 'tip', tip, 'compliance', comp,
    'article', art, 'cta', cta, 'note', note, 'site', v_site,
    'first_name', coalesce(v_first, 'there'), 'week_label', coalesce(p_content->>'week_label', ''), 'as_of', coalesce(p_content->>'as_of', ''),
    'lead_rate', app_private.wk_lead(v_rates, v_eq),
    'n_carriers', coalesce(p_ctx->>'n_carriers', '0'), 'carriers_word', case when coalesce((p_ctx->>'n_carriers')::int, 0) = 1 then 'carrier' else 'carriers' end, 'n_bookings', coalesce(p_ctx->>'bookings', '0'),
    'n_offers', coalesce(p_ctx->>'offers', '0'), 'n_delivered', coalesce(p_ctx->>'delivered', '0'));
  select f.o_subject, f.o_html into t from app_private.newsletter_fill(v_key, v_vars) f;
  o_subject := t.o_subject; o_html := t.o_html;
end $$;
revoke all on function app_private.weekly_render(text, jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- 9. templates + catalog (layout skeletons; CC → Templates can edit)
with t(key,name,subject,body,class,grp,audience,purpose,cadence) as (values
  ('weekly.carrier', 'LoadBoot Weekly — carrier',
   'Your week on LoadBoot · {{lead_rate}}',
   '{{hero}}{{your_week}}{{alerts}}{{rates}}{{tip}}{{compliance}}{{article}}{{cta}}{{note}}',
   'O', 'digests', 'carrier',
   'The carrier version of LoadBoot Weekly: their account week (offers, deliveries, invoices, expiries), rates for their equipment with week-over-week, one tip, one compliance reminder, one article. Replaces carrier_weekly_summary. Fired by app_private.weekly_send_run (cron lb-newsletter-weekly, Tuesdays 14:00 UTC) for the approved issue of the week.',
   'Tuesdays 14:00 UTC, one per week'),
  ('weekly.dispatcher', 'LoadBoot Weekly — dispatcher',
   'Your fleet this week · {{n_carriers}} {{carriers_word}} · {{lead_rate}}',
   '{{hero}}{{your_week}}{{alerts}}{{rates}}{{tip}}{{compliance}}{{article}}{{cta}}{{note}}',
   'O', 'digests', 'dispatcher',
   'The dispatcher version of LoadBoot Weekly: their carriers'' week, bookings, trucks not posted, expiring documents, rates for the fleet''s equipment, one dispatcher tip, one compliance reminder, one article. Fired by app_private.weekly_send_run (Tuesdays 14:00 UTC).',
   'Tuesdays 14:00 UTC, one per week'),
  ('newsletter.weekly', 'LoadBoot Weekly — newsletter',
   '{{lead_rate}} this week + one tip you can use today',
   '{{hero}}{{rates}}{{tip}}{{compliance}}{{article}}{{cta}}{{note}}',
   'M', 'newsletter', 'any',
   'The public version of LoadBoot Weekly for confirmed newsletter subscribers who are not registered carriers or dispatchers (those get their role version). Rates by equipment with week-over-week, one tip, one compliance reminder, one article. Fired by app_private.weekly_send_run (Tuesdays 14:00 UTC).',
   'Tuesdays 14:00 UTC, one per week'),
  ('weekly.drafts_ready', 'LoadBoot Weekly — drafts ready (staff)',
   'LoadBoot Weekly {{week_label}}: preview and approve before Tuesday',
   '<p style="font-size:17px;font-weight:800;color:#10223B;margin:0 0 10px">This week''s issues are built.</p>'
   '<p>Carrier, dispatcher and newsletter versions are drafted with this week''s rates, tip, reminder and article. Nothing goes out until each one is approved.</p>'
   '<p><a href="{{site}}/app/command-center/#/newsletter" style="color:#0883F7;font-weight:800">Open CC &rarr; Newsletter</a> to preview each version as a real recipient would see it, swap a tip or article, and approve. The send runs Tuesday 14:00 UTC.</p>',
   'S', 'staff_internal', 'staff',
   'Staff alert on Monday when comm.weekly_approval = manual: the drafts are ready to preview and approve. Fired by app_private.weekly_issue_build (cron lb-weekly-build).',
   'Mondays 12:00 UTC while approval is manual'),
  ('weekly.unapproved', 'LoadBoot Weekly — nothing approved (staff)',
   'LoadBoot Weekly {{week_label}}: nothing was approved, nothing went out',
   '<p style="font-size:17px;font-weight:800;color:#10223B;margin:0 0 10px">The Tuesday send found no approved issue.</p>'
   '<p>Unapproved: {{missing}}. Recipients got nothing this week. Approve in <a href="{{site}}/app/command-center/#/newsletter" style="color:#0883F7;font-weight:800">CC &rarr; Newsletter</a> and press "Send now", or leave it for next week.</p>',
   'S', 'staff_internal', 'staff',
   'Staff alert on Tuesday when the send ran with the master switch on and at least one audience had no approved issue. Fired by app_private.weekly_send_run.',
   'Tuesdays 14:00 UTC, only when something is unapproved')
),
ins_tpl as (
  insert into app_private.comm_templates(key,name,channel,subject,body,active,category,status)
  select key,name,'email',subject,body,true,case when class in ('M','P') then 'marketing' else 'transactional' end,'live' from t
  on conflict (key) do update set name=excluded.name, subject=excluded.subject, body=excluded.body, active=true)
insert into app_private.email_catalog(key,name,purpose,class,audience_role,trigger_type,trigger_source,cadence,cap_note,stop_condition,preference_group,unsub_allowed,status,cc_deep_link,discovered_in)
select key,name,purpose,class,audience,'cron','app_private.weekly_send_run',cadence,'one per address per ISO week (app_private.weekly_sends)',
       case when grp = 'staff_internal' then 'never (staff)' when grp = 'newsletter' then 'unsubscribe (newsletter group), or the address becomes a registered carrier/dispatcher' else 'weekly summaries off, unsubscribe (digests group), org no longer active' end,
       grp, grp <> 'staff_internal', 'live', '#/newsletter', array['code'] from t
on conflict (key) do update set name=excluded.name, purpose=excluded.purpose, class=excluded.class, trigger_type=excluded.trigger_type,
  trigger_source=excluded.trigger_source, cadence=excluded.cadence, cap_note=excluded.cap_note, stop_condition=excluded.stop_condition,
  preference_group=excluded.preference_group, unsub_allowed=excluded.unsub_allowed, status='live', cc_deep_link=excluded.cc_deep_link;

update app_private.email_catalog
   set status = 'retired', replaced_by = 'weekly.carrier',
       owner_note = coalesce(owner_note || ' ', '') || 'Retired 26 Sep 2026 (bl_comm_0448): merged into LoadBoot Weekly (weekly.carrier). Cron carrier_weekly_digest unscheduled.'
 where key = 'carrier_weekly_summary';

-- ---------------------------------------------------------------- 10. build (Monday) + send (Tuesday)
-- used_count / last_used_at are derived from the issues (distinct weeks that carried the item), never incremented
-- by hand: the three versions share a reminder and an article, and a rebuild must not burn the pool twice.
create or replace function app_private.weekly_content_recount()
returns void language sql security definer set search_path to 'app_private, public' as $$
  update app_private.weekly_content c
     set used_count = u.n, last_used_at = u.last_at
    from (select c2.id,
                 (select count(distinct i.week) from app_private.weekly_issues i
                   where i.content->'tip'->>'id' = c2.id::text or i.content->'compliance'->>'id' = c2.id::text or i.content->'article'->>'id' = c2.id::text) n,
                 (select max(i.built_at) from app_private.weekly_issues i
                   where i.content->'tip'->>'id' = c2.id::text or i.content->'compliance'->>'id' = c2.id::text or i.content->'article'->>'id' = c2.id::text) last_at
            from app_private.weekly_content c2) u
   where u.id = c.id and (c.used_count <> u.n or c.last_used_at is distinct from u.last_at);
$$;
revoke all on function app_private.weekly_content_recount() from public, anon, authenticated;

create or replace function app_private.weekly_issue_build(p_week text default null, p_audience text default null, p_force boolean default false, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_wk text := coalesce(p_week, app_private.weekly_week()); a text; iss record; kit jsonb; v_auto boolean; v_out jsonb := '[]'::jsonb; v_built int := 0; t record; v_site text;
begin
  v_auto := coalesce((select s.value #>> '{}' from app_private.system_settings s where s.key = 'comm.weekly_approval'), 'manual') = 'auto';
  foreach a in array (case when p_audience is null then array['carrier','dispatcher','public'] else array[p_audience] end) loop
    select * into iss from app_private.weekly_issues where week = v_wk and audience = a;
    if iss.id is not null and iss.status = 'sent' then
      v_out := v_out || jsonb_build_object('audience', a, 'skipped', 'already sent'); continue;
    end if;
    if iss.id is not null and iss.status = 'approved' and not p_force then
      v_out := v_out || jsonb_build_object('audience', a, 'skipped', 'approved — pass force to rebuild'); continue;
    end if;
    if iss.id is not null and iss.status = 'draft' and not p_force then
      v_out := v_out || jsonb_build_object('audience', a, 'skipped', 'draft exists'); continue;
    end if;
    kit := app_private.weekly_kit(v_wk, a);
    insert into app_private.weekly_issues (week, audience, status, content, built_at, approved_by, approved_at, note)
    values (v_wk, a, case when v_auto then 'approved' else 'draft' end, kit, now(), null, case when v_auto then now() else null end,
            case when v_auto then 'auto-approved (comm.weekly_approval = auto)' else null end)
    on conflict (week, audience) do update set status = excluded.status, content = excluded.content, built_at = now(),
      approved_by = null, approved_at = excluded.approved_at, note = excluded.note;
    v_built := v_built + 1;
    v_out := v_out || jsonb_build_object('audience', a, 'built', true, 'status', case when v_auto then 'approved' else 'draft' end);
  end loop;
  if v_built > 0 then
    perform app_private.weekly_content_recount();
    perform app_private.log_audit('weekly.built', 'weekly', v_wk, null,
      'LoadBoot Weekly ' || v_wk || ': ' || v_built || ' issue(s) built' || case when v_auto then ' and auto-approved' else ' as drafts' end,
      jsonb_build_object('actor', p_actor, 'result', v_out, 'force', p_force), null);
    if not v_auto and p_actor is null then   -- the cron built drafts: tell the owner
      v_site := app_private.newsletter_site_url();
      select f.o_subject, f.o_html into t from app_private.newsletter_fill('weekly.drafts_ready',
        jsonb_build_object('week_label', app_private.weekly_week_label(), 'site', v_site)) f;
      perform app_private.sys_email(app_private.lc_alert_email(), 'weekly.drafts_ready', t.o_subject, t.o_html, null, 'wk:drafts:' || v_wk);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'week', v_wk, 'auto', v_auto, 'results', v_out);
end $$;
revoke all on function app_private.weekly_issue_build(text, text, boolean, uuid) from public, anon, authenticated;

-- who gets which version (the gate is still the authority at send time; this only avoids filing obvious refusals)
create or replace function app_private.weekly_recipients(p_audience text)
returns table (email text, user_id uuid, org_id uuid, display text)
language plpgsql stable security definer set search_path to 'app_private, public' as $$
begin
  if p_audience = 'carrier' then
    return query
      select distinct on (lower(u.email)) lower(u.email)::text, m.user_id, o.id, o.name::text
        from public.organizations o
        join public.organization_memberships m on m.org_id = o.id and m.status = 'active'
        join auth.users u on u.id = m.user_id
        left join app_private.comm_preferences cp on cp.user_id = m.user_id
       where o.kind = 'carrier' and o.status = 'active' and not coalesce(o.is_demo, false) and u.email is not null
         and coalesce(cp.weekly_summaries, true) and not coalesce(cp.unsubscribed_all, false)
       order by lower(u.email), (m.user_id = o.owner_user_id) desc, o.created_at;
  elsif p_audience = 'dispatcher' then
    return query
      select lower(u.email)::text, dp.user_id, null::uuid, coalesce(dp.full_name, u.email)::text
        from app_private.dispatcher_profiles dp
        join auth.users u on u.id = dp.user_id
        left join app_private.comm_preferences cp on cp.user_id = dp.user_id
       where dp.status in ('active','verified','trial') and dp.blocked_at is null and u.email is not null
         and coalesce(cp.weekly_summaries, true) and not coalesce(cp.unsubscribed_all, false);
  else
    return query
      select n.email::text, null::uuid, null::uuid, n.email::text
        from app_private.newsletter_subscribers n
       where n.status = 'confirmed'
         and n.email not in (select r.email from app_private.weekly_recipients('carrier') r)
         and n.email not in (select r.email from app_private.weekly_recipients('dispatcher') r);
  end if;
end $$;
revoke all on function app_private.weekly_recipients(text) from public, anon, authenticated;

create or replace function app_private.weekly_send_run(p_audience text default null, p_limit integer default 5000, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_wk text := app_private.weekly_week(); a text; iss record; r record; t record; v_ctx jsonb; v_gate jsonb; v_allowed boolean;
        v_n int; v_ref int; v_key text; v_out jsonb := '[]'::jsonb; v_missing text[] := '{}'; v_site text;
begin
  if coalesce((select s.value #>> '{}' from app_private.system_settings s where s.key = 'comm.newsletter_enabled'), 'false') <> 'true' then
    return jsonb_build_object('ok', true, 'disabled', true, 'week', v_wk);
  end if;
  foreach a in array (case when p_audience is null then array['carrier','dispatcher','public'] else array[p_audience] end) loop
    select * into iss from app_private.weekly_issues where week = v_wk and audience = a;
    if iss.id is null or iss.status not in ('approved','sent') then
      v_missing := v_missing || a;
      v_out := v_out || jsonb_build_object('audience', a, 'skipped', coalesce(iss.status, 'not built')); continue;
    end if;
    v_key := case a when 'carrier' then 'weekly.carrier' when 'dispatcher' then 'weekly.dispatcher' else 'newsletter.weekly' end;
    v_n := 0; v_ref := 0;
    for r in select * from app_private.weekly_recipients(a) rc
              where not exists (select 1 from app_private.weekly_sends ws where ws.issue_id = iss.id and ws.email = rc.email)
              limit greatest(coalesce(p_limit, 5000), 1) loop
      v_ctx := case a when 'carrier' then app_private.weekly_ctx_carrier(r.org_id, r.user_id)
                      when 'dispatcher' then app_private.weekly_ctx_dispatcher(r.user_id) else '{}'::jsonb end;
      select f.o_subject, f.o_html into t from app_private.weekly_render(a, iss.content, v_ctx) f;
      v_gate := app_private.email_gate(v_key, r.email, r.user_id);
      v_allowed := coalesce((v_gate->>'allowed')::boolean, true);
      perform app_private.sys_email(r.email, v_key, t.o_subject, t.o_html, null, 'wk:' || v_wk || ':' || a || ':' || r.email);
      insert into app_private.weekly_sends (issue_id, email, user_id, org_id, allowed, gate)
      values (iss.id, r.email, r.user_id, r.org_id, v_allowed, v_gate->>'code') on conflict do nothing;
      if v_allowed then v_n := v_n + 1; else v_ref := v_ref + 1; end if;
      if a = 'public' and v_allowed then
        update app_private.newsletter_subscribers set last_digest_at = now(), digests_sent = digests_sent + 1, updated_at = now() where email = r.email;
      end if;
    end loop;
    update app_private.weekly_issues set status = 'sent', sent_at = coalesce(sent_at, now()),
           sent_count = sent_count + v_n, refused_count = refused_count + v_ref where id = iss.id;
    perform app_private.log_audit('weekly.sent', 'weekly', v_wk || ':' || a, null,
      'LoadBoot Weekly ' || v_wk || ' (' || a || '): ' || v_n || ' queued, ' || v_ref || ' refused by the gate',
      jsonb_build_object('actor', p_actor, 'issue', iss.id), null);
    v_out := v_out || jsonb_build_object('audience', a, 'queued', v_n, 'refused', v_ref);
  end loop;
  if array_length(v_missing, 1) > 0 and p_actor is null and p_audience is null then   -- the cron found nothing approved
    v_site := app_private.newsletter_site_url();
    select f.o_subject, f.o_html into t from app_private.newsletter_fill('weekly.unapproved',
      jsonb_build_object('week_label', app_private.weekly_week_label(), 'site', v_site, 'missing', array_to_string(v_missing, ', '))) f;
    perform app_private.sys_email(app_private.lc_alert_email(), 'weekly.unapproved', t.o_subject, t.o_html, null, 'wk:unapproved:' || v_wk);
  end if;
  return jsonb_build_object('ok', true, 'week', v_wk, 'results', v_out);
end $$;
revoke all on function app_private.weekly_send_run(text, integer, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 11. retire the old paths, keep the old entry points working
create or replace function app_private.carrier_weekly_digest_run()
returns jsonb language sql security definer set search_path to 'app_private, public' as $$
  select jsonb_build_object('ok', true, 'retired', true, 'replaced_by', 'app_private.weekly_send_run (bl_comm_0448)');
$$;
create or replace function app_private.newsletter_weekly_run(p_limit integer default 5000)
returns jsonb language sql security definer set search_path to 'app_private, public' as $$
  select app_private.weekly_send_run('public', p_limit, null);
$$;
revoke all on function app_private.newsletter_weekly_run(integer) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('carrier_weekly_digest', 'lb-newsletter-weekly', 'lb-weekly-build');
select cron.schedule('lb-weekly-build', '0 12 * * 1', $$select app_private.weekly_issue_build();$$);
select cron.schedule('lb-newsletter-weekly', '0 14 * * 2', $$select app_private.weekly_send_run();$$);

-- ---------------------------------------------------------------- 12. Command Center RPCs (authenticated only)
create or replace function public.cc_weekly_overview()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare v_wk text := app_private.weekly_week();
begin
  if not app_private.unsub_can_view() then raise exception 'not authorized' using errcode = '42501'; end if;
  return jsonb_build_object(
    'week', v_wk, 'week_label', app_private.weekly_week_label(),
    'enabled', coalesce((select v.value #>> '{}' from app_private.system_settings v where v.key = 'comm.newsletter_enabled'), 'false') = 'true',
    'approval', coalesce((select v.value #>> '{}' from app_private.system_settings v where v.key = 'comm.weekly_approval'), 'manual'),
    'next_build', (select j.schedule from cron.job j where j.jobname = 'lb-weekly-build'),
    'next_send', (select j.schedule from cron.job j where j.jobname = 'lb-newsletter-weekly'),
    'as_of', (select value->>'as_of' from jsonb_array_elements(app_private.weekly_rates()) limit 1),
    'issues', (select jsonb_agg(jsonb_build_object('audience', a.aud,
                 'status', coalesce(i.status, 'not built'), 'id', i.id, 'built_at', i.built_at, 'approved_at', i.approved_at, 'sent_at', i.sent_at,
                 'sent_count', coalesce(i.sent_count, 0), 'refused_count', coalesce(i.refused_count, 0), 'note', i.note,
                 'tip', i.content->'tip', 'compliance', i.content->'compliance', 'article', i.content->'article', 'rates_as_of', i.content->>'as_of',
                 'recipients', (select count(*) from app_private.weekly_recipients(a.aud)),
                 'already_sent', (select count(*) from app_private.weekly_sends ws where ws.issue_id = i.id))
               order by a.o)
               from (values ('carrier', 1), ('dispatcher', 2), ('public', 3)) a(aud, o)
               left join app_private.weekly_issues i on i.week = v_wk and i.audience = a.aud),
    'pool', (select coalesce(jsonb_agg(jsonb_build_object('kind', k.kind,
               'approved', (select count(*) from app_private.weekly_content c where c.kind = k.kind and c.status = 'approved'),
               'draft', (select count(*) from app_private.weekly_content c where c.kind = k.kind and c.status = 'draft'),
               'retired', (select count(*) from app_private.weekly_content c where c.kind = k.kind and c.status = 'retired')) order by k.o), '[]'::jsonb)
             from (values ('tip_carrier', 1), ('tip_dispatcher', 2), ('compliance', 3), ('article', 4)) k(kind, o)),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('week', i.week, 'audience', i.audience, 'status', i.status, 'sent_at', i.sent_at,
                  'sent_count', i.sent_count, 'refused_count', i.refused_count) order by i.week desc, i.audience), '[]'::jsonb)
                from (select * from app_private.weekly_issues where week <> v_wk order by week desc, audience limit 12) i));
end $$;
revoke all on function public.cc_weekly_overview() from public, anon;
grant execute on function public.cc_weekly_overview() to authenticated;

-- Preview one version as a real recipient would get it. p_sample = a carrier org id / a dispatcher user id;
-- default: the most active one. No real recipient at all → a labelled demo context (nothing is sent either way).
create or replace function public.cc_weekly_preview(p_audience text, p_sample text default null)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare v_wk text := app_private.weekly_week(); v_content jsonb; v_ctx jsonb; v_id uuid; v_label text; v_demo boolean := false; t record; v_samples jsonb := '[]'::jsonb;
begin
  if not app_private.unsub_can_view() then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_audience not in ('carrier','dispatcher','public') then raise exception 'unknown audience %', p_audience; end if;
  select content into v_content from app_private.weekly_issues where week = v_wk and audience = p_audience;
  if v_content is null then v_content := app_private.weekly_kit(v_wk, p_audience); end if;

  if p_audience = 'carrier' then
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.name) order by o.name), '[]'::jsonb) into v_samples
      from (select distinct r.org_id from app_private.weekly_recipients('carrier') r) x join public.organizations o on o.id = x.org_id;
    if p_sample is not null then
      v_id := p_sample::uuid;
    else
      select x.org_id into v_id from (select distinct r.org_id from app_private.weekly_recipients('carrier') r) x
       order by (select count(*) from app_private.load_offers lo where lo.carrier_id = x.org_id and lo.sent_at > now() - interval '7 days') desc,
                (select count(*) from app_private.trips tr where tr.carrier_id = x.org_id) desc limit 1;
    end if;
    if v_id is not null then
      v_ctx := app_private.weekly_ctx_carrier(v_id, (select r.user_id from app_private.weekly_recipients('carrier') r where r.org_id = v_id limit 1));
      v_label := v_ctx->>'org_name';
    else
      v_demo := true; v_label := 'Sample Carrier LLC (demo data — no active carrier to preview)';
      v_ctx := jsonb_build_object('first_name', 'Sam', 'org_name', 'Sample Carrier LLC', 'offers', 7, 'offers_won', 2, 'offers_expired', 1, 'delivered', 3, 'miles', 2140,
        'in_progress', 1, 'invoiced', 6420, 'unpaid', 2100, 'posting_active', 1, 'posting_stale', 0, 'onboarding_stage', 'active', 'onboarding_missing', '[]'::jsonb,
        'expiring', jsonb_build_array(jsonb_build_object('what', 'Insurance (COI)', 'due', (current_date + 12)::text)), 'equipment', jsonb_build_array('Dry Van', 'Reefer'));
    end if;
  elsif p_audience = 'dispatcher' then
    select coalesce(jsonb_agg(jsonb_build_object('id', r.user_id, 'label', r.display) order by r.display), '[]'::jsonb) into v_samples from app_private.weekly_recipients('dispatcher') r;
    if p_sample is not null then
      v_id := p_sample::uuid;
    else
      select r.user_id into v_id from app_private.weekly_recipients('dispatcher') r
       order by (select count(*) from app_private.dispatcher_assignments da where da.dispatcher_user_id = r.user_id and da.status = 'active') desc limit 1;
    end if;
    if v_id is not null then
      v_ctx := app_private.weekly_ctx_dispatcher(v_id); v_label := coalesce(v_ctx->>'name', v_id::text);
    else
      v_demo := true; v_label := 'Sample dispatcher (demo data — no active dispatcher to preview)';
      v_ctx := jsonb_build_object('first_name', 'Ali', 'name', 'Ali Sample', 'n_carriers', 3, 'bookings', 9, 'gross', 24850, 'delivered', 8, 'miles', 6120, 'unposted', 1, 'expiring', 2,
        'equipment', jsonb_build_array('Dry Van', 'Flatbed'),
        'carriers', jsonb_build_array(
          jsonb_build_object('name', 'Sample Carrier LLC', 'offers', 6, 'delivered', 3, 'in_progress', 1, 'expiring', 1, 'posted', true),
          jsonb_build_object('name', 'Blue Ridge Freight', 'offers', 4, 'delivered', 3, 'in_progress', 2, 'expiring', 1, 'posted', true),
          jsonb_build_object('name', 'Lone Star Haulers', 'offers', 2, 'delivered', 2, 'in_progress', 0, 'expiring', 0, 'posted', false)));
    end if;
  else
    v_ctx := '{}'::jsonb; v_label := 'a confirmed newsletter subscriber';
  end if;

  select f.o_subject, f.o_html into t from app_private.weekly_render(p_audience, v_content, v_ctx) f;
  return jsonb_build_object('audience', p_audience, 'week', v_wk,
    'subject', app_private.contact_expand(t.o_subject, true), 'html', app_private.contact_expand(t.o_html, false),
    'sample', jsonb_build_object('id', v_id, 'label', v_label, 'demo', v_demo), 'samples', v_samples,
    'issue_exists', exists (select 1 from app_private.weekly_issues where week = v_wk and audience = p_audience),
    'content', v_content - 'rates');
end $$;
revoke all on function public.cc_weekly_preview(text, text) from public, anon;
grant execute on function public.cc_weekly_preview(text, text) to authenticated;

-- build / approve / unapprove / skip / send_now / swap (a slot: tip | compliance | article → content id)
create or replace function public.cc_weekly_issue_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_wk text := app_private.weekly_week(); v_action text := p->>'action'; v_aud text := nullif(p->>'audience', 'all'); iss record; c record; v_slot text; v_kind text;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_action = 'build' then
    return app_private.weekly_issue_build(v_wk, v_aud, coalesce((p->>'force')::boolean, false), auth.uid());
  elsif v_action in ('approve','unapprove','skip') then
    if v_aud is null then raise exception 'audience required'; end if;
    select * into iss from app_private.weekly_issues where week = v_wk and audience = v_aud;
    if iss.id is null then return jsonb_build_object('ok', false, 'error', 'not built yet'); end if;
    if iss.status = 'sent' then return jsonb_build_object('ok', false, 'error', 'already sent'); end if;
    update app_private.weekly_issues
       set status = case v_action when 'approve' then 'approved' when 'unapprove' then 'draft' else 'skipped' end,
           approved_by = case v_action when 'approve' then auth.uid() else null end,
           approved_at = case v_action when 'approve' then now() else null end,
           note = case v_action when 'skip' then coalesce(p->>'note', 'skipped by staff') else null end
     where id = iss.id;
    perform app_private.log_audit('weekly.' || v_action, 'weekly', v_wk || ':' || v_aud, null,
      'LoadBoot Weekly ' || v_wk || ' (' || v_aud || ') ' || v_action || 'd', jsonb_build_object('actor', auth.uid(), 'issue', iss.id), null);
    return jsonb_build_object('ok', true, 'status', case v_action when 'approve' then 'approved' when 'unapprove' then 'draft' else 'skipped' end);
  elsif v_action = 'send_now' then
    if coalesce((select v.value #>> '{}' from app_private.system_settings v where v.key = 'comm.newsletter_enabled'), 'false') <> 'true' then
      return jsonb_build_object('ok', false, 'error', 'switch the weekly send on first');
    end if;
    return app_private.weekly_send_run(v_aud, coalesce((p->>'limit')::int, 5000), auth.uid());
  elsif v_action = 'swap' then
    if v_aud is null then raise exception 'audience required'; end if;
    v_slot := p->>'slot';
    if v_slot not in ('tip','compliance','article') then raise exception 'slot must be tip, compliance or article'; end if;
    select * into iss from app_private.weekly_issues where week = v_wk and audience = v_aud;
    if iss.id is null or iss.status = 'sent' then return jsonb_build_object('ok', false, 'error', coalesce('issue is ' || iss.status, 'not built yet')); end if;
    select * into c from app_private.weekly_content where id = (p->>'content_id')::uuid;
    if c.id is null then return jsonb_build_object('ok', false, 'error', 'no such content'); end if;
    v_kind := case v_slot when 'tip' then (case when v_aud = 'dispatcher' then 'tip_dispatcher' else 'tip_carrier' end) else v_slot end;
    if c.kind <> v_kind then return jsonb_build_object('ok', false, 'error', 'that is a ' || c.kind || ', the slot needs a ' || v_kind); end if;
    update app_private.weekly_issues
       set content = content || jsonb_build_object(v_slot, jsonb_build_object('id', c.id, 'title', c.title, 'body', c.body, 'url', c.url))
     where id = iss.id;
    perform app_private.weekly_content_recount();
    perform app_private.log_audit('weekly.swap', 'weekly', v_wk || ':' || v_aud, null,
      'LoadBoot Weekly ' || v_wk || ' (' || v_aud || '): ' || v_slot || ' swapped', jsonb_build_object('actor', auth.uid(), 'content', c.id), null);
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'unknown action %', v_action;
end $$;
revoke all on function public.cc_weekly_issue_set(jsonb) from public, anon;
grant execute on function public.cc_weekly_issue_set(jsonb) to authenticated;

create or replace function public.cc_weekly_content_list(p_kind text default null, p_status text default null)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
begin
  if not app_private.unsub_can_view() then raise exception 'not authorized' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'title', c.title, 'body', c.body, 'url', c.url, 'status', c.status,
            'source', c.source, 'created_at', c.created_at, 'approved_at', c.approved_at, 'used_count', c.used_count, 'last_used_at', c.last_used_at, 'note', c.note)
            order by (c.status = 'draft') desc, c.kind, c.used_count, c.created_at desc), '[]'::jsonb)
          from app_private.weekly_content c
         where (p_kind is null or c.kind = p_kind) and (p_status is null or c.status = p_status));
end $$;
revoke all on function public.cc_weekly_content_list(text, text) from public, anon;
grant execute on function public.cc_weekly_content_list(text, text) to authenticated;

-- add / edit / approve / retire / delete (drafts only). The Routine also adds through this (as a staff session) or by insert.
create or replace function public.cc_weekly_content_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_action text := p->>'action'; v_id uuid := (p->>'id')::uuid; c record;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_action = 'add' then
    if (p->>'kind') not in ('tip_carrier','tip_dispatcher','compliance','article') then raise exception 'kind must be tip_carrier, tip_dispatcher, compliance or article'; end if;
    if length(btrim(coalesce(p->>'body', ''))) < 20 then raise exception 'body is too short'; end if;
    if (p->>'kind') = 'article' and (nullif(btrim(p->>'title'), '') is null or nullif(btrim(p->>'url'), '') is null) then raise exception 'an article needs a title and a url'; end if;
    insert into app_private.weekly_content (kind, title, body, url, status, source, created_by, approved_by, approved_at, note)
    values (p->>'kind', nullif(btrim(p->>'title'), ''), btrim(p->>'body'), nullif(btrim(p->>'url'), ''),
            case when coalesce((p->>'approve')::boolean, false) then 'approved' else 'draft' end, coalesce(p->>'source', 'owner'), auth.uid(),
            case when coalesce((p->>'approve')::boolean, false) then auth.uid() end, case when coalesce((p->>'approve')::boolean, false) then now() end, p->>'note')
    returning * into c;
    return jsonb_build_object('ok', true, 'id', c.id, 'status', c.status);
  end if;
  select * into c from app_private.weekly_content where id = v_id;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'no such content'); end if;
  if v_action = 'edit' then
    update app_private.weekly_content set title = coalesce(nullif(btrim(p->>'title'), ''), title), body = coalesce(nullif(btrim(p->>'body'), ''), body),
           url = coalesce(nullif(btrim(p->>'url'), ''), url), note = coalesce(p->>'note', note) where id = v_id;
  elsif v_action = 'approve' then
    update app_private.weekly_content set status = 'approved', approved_by = auth.uid(), approved_at = now(), retired_at = null where id = v_id;
  elsif v_action = 'retire' then
    update app_private.weekly_content set status = 'retired', retired_at = now() where id = v_id;
  elsif v_action = 'delete' then
    if c.status <> 'draft' then return jsonb_build_object('ok', false, 'error', 'only a draft can be deleted — retire it instead'); end if;
    delete from app_private.weekly_content where id = v_id;
  else
    raise exception 'unknown action %', v_action;
  end if;
  perform app_private.log_audit('weekly.content.' || v_action, 'weekly_content', v_id::text, null,
    'LoadBoot Weekly content (' || c.kind || ') ' || v_action || ': ' || left(coalesce(c.title, c.body), 80), jsonb_build_object('actor', auth.uid()), null);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.cc_weekly_content_set(jsonb) from public, anon;
grant execute on function public.cc_weekly_content_set(jsonb) to authenticated;

create or replace function public.cc_weekly_settings_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_out jsonb := '{}'::jsonb;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode = '42501'; end if;
  if p ? 'enabled' then
    insert into app_private.system_settings (key, value) values ('comm.newsletter_enabled', to_jsonb(coalesce((p->>'enabled')::boolean, false)))
    on conflict (key) do update set value = excluded.value;
    perform app_private.log_audit('weekly.settings', 'weekly', 'enabled', null, 'LoadBoot Weekly ' || case when coalesce((p->>'enabled')::boolean, false) then 'enabled' else 'disabled' end, jsonb_build_object('actor', auth.uid()), null);
    v_out := v_out || jsonb_build_object('enabled', coalesce((p->>'enabled')::boolean, false));
  end if;
  if p ? 'approval' then
    if (p->>'approval') not in ('manual','auto') then raise exception 'approval must be manual or auto'; end if;
    insert into app_private.system_settings (key, value) values ('comm.weekly_approval', to_jsonb(p->>'approval'))
    on conflict (key) do update set value = excluded.value;
    perform app_private.log_audit('weekly.settings', 'weekly', 'approval', null, 'LoadBoot Weekly approval: ' || (p->>'approval'), jsonb_build_object('actor', auth.uid()), null);
    v_out := v_out || jsonb_build_object('approval', p->>'approval');
  end if;
  return v_out;
end $$;
revoke all on function public.cc_weekly_settings_set(jsonb) from public, anon;
grant execute on function public.cc_weekly_settings_set(jsonb) to authenticated;

-- the 0447 preview button now shows the public version of the new engine
create or replace function public.cc_newsletter_preview()
returns jsonb language sql stable security definer set search_path to 'app_private, public' as $$
  select public.cc_weekly_preview('public', null);
$$;
revoke all on function public.cc_newsletter_preview() from public, anon;
grant execute on function public.cc_newsletter_preview() to authenticated;
