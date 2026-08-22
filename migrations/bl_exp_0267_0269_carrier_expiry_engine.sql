-- =====================================================================================
-- bl_exp_0267_0269 — carrier expiry tracking + reminders
-- Applied 2026-08-22 to STAGING (snslhvmkjusozgjelghi) then PROD (rwscphuhpjoudvljvmdk) as:
--   bl_exp_0267_carrier_expiry_engine
--   bl_exp_0268_carrier_expiry_reminders (+0268b force flag)
--   bl_exp_0269_expiry_board_triggers_cron
--
-- WHY: app_private.cron_compliance_scan already found expiring documents every morning,
-- but its automation rule action is `create_task` — a STAFF task. The carrier was never
-- told. cron_packet_revalidation does email carriers, but it reads org_onboarding_items,
-- which had 0 verified carrier rows (it was built for the broker packet). So in practice
-- no carrier has ever been warned before a COI / authority / CDL / medical / inspection
-- lapsed. This is the carrier-facing half. cron_compliance_scan is left untouched, so
-- staff tasks keep working and nothing is created twice.
--
-- SAFETY RAILS (deliberate):
--   · kill switch  app_private.system_settings 'comm.expiry_reminders_enabled'
--   · send window  13:00–22:00 UTC only (≈ US working hours); p_force bypasses for tests
--   · dedupe       one row per (org, item, subject, due_date, stage) — a step never repeats
--   · grouping     one email per carrier per run listing every item, not one per item
--   · daily cap    max 2 expiry emails to one carrier per calendar day
--   · stale guard  never chases something that lapsed more than 14 days ago
--   · dry run      carrier_expiry_notify_run(org, true) shows exactly what would go out
--   · triggers wrapped in exception handlers — a reminder can never block a document save
--
-- NOT gated on comm_preferences.unsubscribed_all: this is a compliance notice about the
-- carrier's own account (same class as load offers and document decisions), not marketing.
-- app_private.sys_email still honours hard suppressions (bounce/complaint).
-- =====================================================================================

create table if not exists app_private.expiry_notices (
  id          bigserial primary key,
  org_id      uuid not null,
  item_key    text not null,
  subject_id  text not null default '',
  due_date    date not null,
  stage       text not null check (stage in ('d30','d14','d7','d1','expired')),
  label       text,
  channel     text not null default 'email',
  notified_at timestamptz not null default now()
);
create unique index if not exists expiry_notices_uniq
  on app_private.expiry_notices(org_id, item_key, subject_id, due_date, stage, channel);
create index if not exists expiry_notices_org_idx on app_private.expiry_notices(org_id, notified_at desc);

-- ------------------------------------------------------------------ unified view
-- One place that knows every dated thing a carrier can let lapse.
create or replace function app_private.carrier_expiry_items(p_org uuid default null)
returns table(org_id uuid, org_name text, item_key text, subject_id text, label text,
              due_date date, days_left int, severity text, source text)
language sql stable security definer
set search_path to 'app_private, public' as $$
  with orgs as (
    select o.id, o.name from public.organizations o
     where o.kind='carrier' and coalesce(o.status,'') not in ('archived','closed')
       and not coalesce((to_jsonb(o)->>'is_demo')::boolean, false)
       and (p_org is null or o.id = p_org)
  ),
  raw as (
    -- compliance requirements that carry a date
    select o.id, o.name, cc.requirement_key as item_key, ''::text as subject_id,
           case cc.requirement_key
             when 'insurance_coi'      then 'Certificate of Insurance'
             when 'mc_authority'       then 'Operating authority (MC/DOT)'
             when 'w9'                 then 'W-9 tax form'
             when 'dispatch_agreement' then 'Dispatch agreement'
             when 'bank_verification'  then 'Bank verification'
             else initcap(replace(cc.requirement_key,'_',' ')) end as label,
           cc.expiry_date as due_date, 'legal'::text as severity, 'compliance'::text as source
      from orgs o join app_private.carrier_compliance cc on cc.carrier_id = o.id
     where cc.status = 'valid' and cc.expiry_date is not null

    union all
    -- the insurance policy itself, only when no dated compliance row already covers it
    select o.id, o.name, 'coi_policy', '', 'Insurance policy', cv.expiry_date, 'legal', 'coi_coverage'
      from orgs o join app_private.coi_coverage cv on cv.org_id = o.id
     where cv.expiry_date is not null
       and not exists (select 1 from app_private.carrier_compliance cc2
                        where cc2.carrier_id = o.id and cc2.requirement_key = 'insurance_coi'
                          and cc2.status = 'valid' and cc2.expiry_date is not null)

    union all
    select o.id, o.name, 'driver_cdl', d.id::text, d.name || ' — CDL', d.license_exp, 'legal', 'driver'
      from orgs o join app_private.fleet_drivers d on d.carrier_id = o.id
     where coalesce(d.status,'active') = 'active' and d.license_exp is not null

    union all
    select o.id, o.name, 'driver_medical', d.id::text, d.name || ' — medical card', d.medical_exp, 'legal', 'driver'
      from orgs o join app_private.fleet_drivers d on d.carrier_id = o.id
     where coalesce(d.status,'active') = 'active' and d.medical_exp is not null

    union all
    select o.id, o.name, 'truck_inspection', t.id::text,
           'Unit ' || coalesce(t.unit_no,'?') || ' — annual inspection', t.inspection_exp, 'required', 'truck'
      from orgs o join app_private.fleet_trucks t on t.carrier_id = o.id
     where coalesce(t.status,'active') <> 'inactive' and t.inspection_exp is not null
  )
  select id, name, item_key, subject_id, label, due_date,
         (due_date - current_date)::int as days_left, severity, source
  from raw
  order by due_date, name;
$$;

create or replace function app_private.expiry_stage(p_days int)
returns text language sql immutable as $$
  select case
    when p_days is null then null
    when p_days < 0  then 'expired'
    when p_days <= 1  then 'd1'
    when p_days <= 7  then 'd7'
    when p_days <= 14 then 'd14'
    when p_days <= 30 then 'd30'
    else null end;
$$;

-- ------------------------------------------------------------------ the email
insert into app_private.system_setting_defs(key, value_type, description, sensitivity, required_permission, default_value, environment)
values ('comm.expiry_reminders_enabled','boolean','Email carriers before a COI / authority / CDL / medical card / inspection lapses.','internal','settings.manage','true'::jsonb,'all')
on conflict (key) do nothing;
insert into app_private.system_settings(key, value)
values ('comm.expiry_reminders_enabled', 'true'::jsonb) on conflict (key) do nothing;

create or replace function app_private.expiry_email_html(p_org_name text, p_items jsonb)
returns text language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare h text; e jsonb; rows text := ''; d int; colour text; when_txt text;
begin
  for e in select * from jsonb_array_elements(p_items) loop
    d := (e->>'days_left')::int;
    colour := case when d < 0 then '#b91c1c' when d <= 7 then '#c2410c' else '#92400e' end;
    when_txt := case when d < 0 then 'expired ' || abs(d) || ' day' || case when abs(d)=1 then '' else 's' end || ' ago'
                     when d = 0 then 'expires today'
                     when d = 1 then 'expires tomorrow'
                     else 'expires in ' || d || ' days' end;
    rows := rows
      || '<tr><td style="padding:10px 0;border-top:1px solid #e2e8f0">'
      || '<div style="font-weight:700;color:#10223B">' || (e->>'label') || '</div>'
      || '<div style="font-size:13px;color:' || colour || ';font-weight:600">' || when_txt || ' · ' || (e->>'due_date') || '</div>'
      || '</td></tr>';
  end loop;

  h := '<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.06em;color:#F97316;text-transform:uppercase">Action needed</p>'
    || '<h2 style="margin:0 0 10px;color:#10223B">Paperwork about to lapse</h2>'
    || '<p style="margin:0 0 4px;color:#475569">' || coalesce(p_org_name,'') || '</p>'
    || '<p style="margin:0 0 14px;color:#475569;font-size:14px">Once any of these lapses we have to stop dispatching you until it is back in place. Sending the renewal early keeps your truck moving.</p>'
    || '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:15px">' || rows || '</table>'
    || '<p style="margin:22px 0"><a href="https://loadboot.com/app/carrier/#documents" style="background:#0883F7;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Upload the renewal</a></p>'
    || '<p style="margin:16px 0 0;color:#64748b;font-size:13px">Insurance renewals are easiest straight from your agent — ask them to send the new certificate to LoadBoot LLC as certificate holder.</p>'
    || '<p style="margin:14px 0 0;color:#94a3b8;font-size:12px">This is a compliance notice about your carrier account, not a marketing email.</p>';
  return h;
end $$;

create or replace function app_private.carrier_expiry_notify_run(p_org uuid default null, p_dry boolean default false, p_force boolean default false)
returns jsonb language plpgsql security definer
set search_path to 'app_private, public' as $$
declare
  org_row record; usr record;
  v_items jsonb; v_worst int; v_subject text; v_html text;
  v_sent int := 0; v_orgs int := 0; v_queued jsonb := '[]'::jsonb; v_in_window boolean;
  v_today_emails int;
begin
  if coalesce((select s.value #>> '{}' from app_private.system_settings s
                where s.key='comm.expiry_reminders_enabled'), 'true') <> 'true' then
    return jsonb_build_object('ok', true, 'disabled', true);
  end if;

  v_in_window := p_force or (extract(hour from now() at time zone 'UTC') between 13 and 22);

  for org_row in
    select distinct i.org_id, i.org_name
      from app_private.carrier_expiry_items(p_org) i
     where app_private.expiry_stage(i.days_left) is not null
       and i.days_left >= -14
  loop
    select jsonb_agg(jsonb_build_object(
             'item_key', x.item_key, 'subject_id', x.subject_id, 'label', x.label,
             'due_date', x.due_date, 'days_left', x.days_left, 'stage', x.stage) order by x.days_left)
         , min(x.days_left)
      into v_items, v_worst
      from (
        select i.*, app_private.expiry_stage(i.days_left) stage
          from app_private.carrier_expiry_items(org_row.org_id) i
         where app_private.expiry_stage(i.days_left) is not null
           and i.days_left >= -14
           and not exists (
             select 1 from app_private.expiry_notices n
              where n.org_id = i.org_id and n.item_key = i.item_key
                and n.subject_id = i.subject_id and n.due_date = i.due_date
                and n.stage = app_private.expiry_stage(i.days_left) and n.channel = 'email')
      ) x;

    if v_items is null then continue; end if;
    v_orgs := v_orgs + 1;
    v_queued := v_queued || jsonb_build_object('org', org_row.org_name, 'items', v_items);
    if p_dry then continue; end if;

    select count(*) into v_today_emails from app_private.expiry_notices n
     where n.org_id = org_row.org_id and n.channel='email' and n.notified_at::date = current_date;
    if v_today_emails >= 2 then continue; end if;
    if not v_in_window then continue; end if;

    v_subject := case
      when v_worst < 0 then 'Expired: paperwork needed to keep dispatching you'
      when v_worst = 0 then 'Expires today — renewal needed'
      when v_worst = 1 then 'Expires tomorrow — renewal needed'
      when jsonb_array_length(v_items) > 1 then jsonb_array_length(v_items) || ' documents expiring in ' || v_worst || ' days'
      else (v_items->0->>'label') || ' expires in ' || v_worst || ' days' end;
    v_html := app_private.expiry_email_html(org_row.org_name, v_items);

    for usr in
      select distinct u.email
        from public.organization_memberships m
        join auth.users u on u.id = m.user_id
       where m.org_id = org_row.org_id and m.status = 'active' and u.email is not null
    loop
      perform app_private.sys_email(usr.email, 'compliance.expiring',
        v_subject || ' — LoadBoot', v_html, null,
        'exp:' || org_row.org_id::text || ':' || md5(v_items::text) || ':' || lower(usr.email));
      v_sent := v_sent + 1;
    end loop;

    insert into app_private.notifications(recipient_role, recipient_user, channel, template_key, payload, status, sent_at)
    select 'carrier', m.user_id, 'in_app', 'compliance.expiring',
           jsonb_build_object('title', v_subject, 'body',
             (select string_agg(e->>'label', ', ') from jsonb_array_elements(v_items) e),
             'tone', case when v_worst <= 7 then 'urgent' else 'info' end,
             'url', '/app/carrier/#documents'),
           'sent', now()
      from public.organization_memberships m
     where m.org_id = org_row.org_id and m.status='active';

    insert into app_private.expiry_notices(org_id, item_key, subject_id, due_date, stage, label, channel)
    select org_row.org_id, e->>'item_key', coalesce(e->>'subject_id',''), (e->>'due_date')::date,
           e->>'stage', e->>'label', 'email'
      from jsonb_array_elements(v_items) e
    on conflict do nothing;
  end loop;

  return jsonb_build_object('ok', true, 'dry_run', p_dry, 'carriers', v_orgs,
                            'emails', v_sent, 'in_send_window', v_in_window,
                            'detail', case when p_dry then v_queued else '[]'::jsonb end);
end $$;

-- ------------------------------------------------------------------ read surfaces
create or replace function public.cc_expiry_board(p_days int default 90)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare v jsonb;
begin
  if not (public.has_global_permission('compliance.view') or public.has_global_permission('carriers.view')
          or public.has_global_permission('dispatch.manage')) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  select jsonb_build_object(
    'as_of', now(),
    'window_days', greatest(1, coalesce(p_days, 90)),
    'expired',  count(*) filter (where i.days_left < 0),
    'due_7',    count(*) filter (where i.days_left between 0 and 7),
    'due_30',   count(*) filter (where i.days_left between 8 and 30),
    'items', coalesce(jsonb_agg(jsonb_build_object(
        'org_id', i.org_id, 'carrier', i.org_name, 'item_key', i.item_key,
        'label', i.label, 'due_date', i.due_date, 'days_left', i.days_left,
        'severity', i.severity, 'source', i.source,
        'last_reminded', (select max(n.notified_at) from app_private.expiry_notices n
                           where n.org_id=i.org_id and n.item_key=i.item_key
                             and n.subject_id=i.subject_id and n.due_date=i.due_date),
        'reminders_sent', (select count(*) from app_private.expiry_notices n
                            where n.org_id=i.org_id and n.item_key=i.item_key
                              and n.subject_id=i.subject_id and n.due_date=i.due_date)
      ) order by i.days_left), '[]'::jsonb)
  ) into v
  from app_private.carrier_expiry_items(null) i
  where i.days_left <= greatest(1, coalesce(p_days, 90));
  return v;
end $$;

create or replace function public.cc_carrier_expiries(p_org uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare v jsonb;
begin
  if not (public.has_global_permission('compliance.view') or public.has_global_permission('carriers.view')
          or public.has_global_permission('dispatch.manage')) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'item_key', i.item_key, 'label', i.label, 'due_date', i.due_date,
      'days_left', i.days_left, 'severity', i.severity, 'source', i.source,
      'reminders_sent', (select count(*) from app_private.expiry_notices n
                          where n.org_id=i.org_id and n.item_key=i.item_key
                            and n.subject_id=i.subject_id and n.due_date=i.due_date),
      'last_reminded', (select max(n.notified_at) from app_private.expiry_notices n
                          where n.org_id=i.org_id and n.item_key=i.item_key
                            and n.subject_id=i.subject_id and n.due_date=i.due_date)
    ) order by i.days_left), '[]'::jsonb)
  into v from app_private.carrier_expiry_items(p_org) i;
  return v;
end $$;

create or replace function public.cc_pocket_expiries()
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare v_org uuid; v jsonb;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'label', i.label, 'due_date', i.due_date, 'days_left', i.days_left, 'severity', i.severity
    ) order by i.days_left), '[]'::jsonb)
  into v from app_private.carrier_expiry_items(v_org) i where i.days_left <= 120;
  return v;
end $$;

-- ------------------------------------------------------------------ real time
-- the moment a date is written or changed, re-evaluate that carrier
create or replace function app_private.expiry_touch_trg()
returns trigger language plpgsql security definer
set search_path to 'app_private, public' as $$
declare v_org uuid;
begin
  begin
    v_org := case tg_table_name
               when 'carrier_compliance' then new.carrier_id
               when 'coi_coverage'       then new.org_id
               when 'fleet_drivers'      then new.carrier_id
               when 'fleet_trucks'       then new.carrier_id end;
    if v_org is not null then
      perform app_private.carrier_expiry_notify_run(v_org, false, false);
    end if;
  exception when others then null;   -- a reminder must never block a document save
  end;
  return new;
end $$;

drop trigger if exists trg_expiry_compliance on app_private.carrier_compliance;
create trigger trg_expiry_compliance after insert or update of expiry_date, status
  on app_private.carrier_compliance for each row execute function app_private.expiry_touch_trg();

drop trigger if exists trg_expiry_coi on app_private.coi_coverage;
create trigger trg_expiry_coi after insert or update of expiry_date
  on app_private.coi_coverage for each row execute function app_private.expiry_touch_trg();

drop trigger if exists trg_expiry_driver on app_private.fleet_drivers;
create trigger trg_expiry_driver after insert or update of license_exp, medical_exp, status
  on app_private.fleet_drivers for each row execute function app_private.expiry_touch_trg();

drop trigger if exists trg_expiry_truck on app_private.fleet_trucks;
create trigger trg_expiry_truck after insert or update of inspection_exp, status
  on app_private.fleet_trucks for each row execute function app_private.expiry_touch_trg();

select cron.unschedule('lb-expiry-reminders') where exists (select 1 from cron.job where jobname='lb-expiry-reminders');
select cron.schedule('lb-expiry-reminders', '0 */2 * * *', $cron$select app_private.carrier_expiry_notify_run();$cron$);

revoke all on app_private.expiry_notices from public, anon, authenticated;
revoke all on function app_private.carrier_expiry_items(uuid) from public, anon;
revoke all on function app_private.expiry_stage(int) from public, anon;
revoke all on function app_private.expiry_email_html(text, jsonb) from public, anon;
revoke all on function app_private.carrier_expiry_notify_run(uuid, boolean, boolean) from public, anon;
revoke all on function public.cc_expiry_board(int) from public, anon;
revoke all on function public.cc_carrier_expiries(uuid) from public, anon;
revoke all on function public.cc_pocket_expiries() from public, anon;
grant execute on function public.cc_expiry_board(int) to authenticated;
grant execute on function public.cc_carrier_expiries(uuid) to authenticated;
grant execute on function public.cc_pocket_expiries() to authenticated;

do $a$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace nsp on nsp.oid=p.pronamespace
   where nsp.nspname='public' and p.proname in ('cc_expiry_board','cc_carrier_expiries','cc_pocket_expiries')
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if n > 0 then raise exception 'anon can execute % new expiry rpc(s)', n; end if;
end $a$;
