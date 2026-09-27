-- bl_disp_0484 — 27 Sep 2026. Trial dispatcher daily report (owner ask, preview approved same day).
--
-- Every working morning at 8 AM Eastern, each dispatcher with status 'trial' (not blocked, today inside
-- trial_start..trial_end) gets ONE e-mail covering the previous working day (Monday covers Fri..Sun):
--   countdown · brokers / carrier / driver touches · e-mails sent & received · loads booked ·
--   what is still pending with each assigned carrier · cumulative trial scorecard · 3 moves · tip ·
--   help + feedback buttons (deep links into the workspace: #trial/help, #trial/feedback, #trial/mood/<m>).
-- A zero-activity day turns the e-mail red and alerts staff (dispatcher.trial.alert).
--
-- Numbers come only from LoadBoot systems: dialer_calls (LoadBoot line), dmail_messages (LoadBoot mailbox),
-- dispatcher_messages (carrier thread), dispatcher_bookings. Call classification: number on a driver of an
-- assigned carrier → driver; carrier on the call or the carrier owner's phone → carrier; everything else → broker.
--
-- Catalog (§6): dispatcher.trial.daily (O, account_critical, unsub not allowed — owner decision 27 Sep 2026:
-- it is the dispatcher's trial record) and dispatcher.trial.alert (S, staff_internal).
-- Anon surface (§4): public.disp_trial_feedback is authenticated-only; anon + public revoked explicitly.
-- Readiness list: app_private.disp_carrier_ready(org) is the v_ready block of public.carrier_dispatcher_desk()
-- (bl_disp_0409, verified identical on prod 27 Sep 2026) with v_org → p_org. Keep the two in step.
-- APPLIED: staging + prod 27 Sep 2026 (as 0484a/b/c; first sends Mon 28 Sep 8 AM ET).

-- ───────────────────────── tables ─────────────────────────
create table if not exists app_private.disp_trial_daily (
  id                 uuid primary key default gen_random_uuid(),
  dispatcher_user_id uuid not null,
  report_date        date not null,
  trial_day          int  not null,
  trial_days         int  not null,
  tone               text not null,
  subject            text,
  stats              jsonb not null default '{}'::jsonb,
  sent_to            text,
  sent_at            timestamptz not null default now(),
  unique (dispatcher_user_id, report_date)
);
create table if not exists app_private.disp_trial_feedback (
  id                 uuid primary key default gen_random_uuid(),
  dispatcher_user_id uuid not null,
  kind               text not null check (kind in ('help','feedback','mood')),
  mood               text check (mood in ('smooth','mixed','stuck')),
  note               text,
  report_date        date,
  created_at         timestamptz not null default now(),
  handled_at         timestamptz,
  handled_by         uuid
);
create index if not exists disp_trial_feedback_user on app_private.disp_trial_feedback (dispatcher_user_id, created_at desc);
alter table app_private.disp_trial_daily    enable row level security;
alter table app_private.disp_trial_feedback enable row level security;

-- ───────────────────────── small helpers ─────────────────────────
create or replace function app_private.disp_trial_wd(p_from date, p_to date) returns int
language sql immutable set search_path to 'app_private', 'public' as $$
  select count(*)::int from generate_series(p_from, p_to, interval '1 day') g where extract(isodow from g) < 6
$$;

create or replace function app_private.disp_ph10(p text) returns text
language sql immutable set search_path to 'app_private', 'public' as $$
  select nullif(right(regexp_replace(coalesce(p,''), '\D', '', 'g'), 10), '')
$$;

-- The carrier's readiness list (same rows the carrier sees on its Dispatcher tab).
create or replace function app_private.disp_carrier_ready(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path to 'app_private', 'public' as $fn$
declare v_ready jsonb;
begin
  v_ready := (
    with docs as (select type, status from public.documents where carrier_id = (select owner_user_id from public.organizations where id = p_org)),
         trucks as (select t.id, t.unit_no, t.equipment, t.home_time, av.updated_at av_at, av.driver_name av_driver, av.status av_status, av.empty_location
                    from app_private.fleet_trucks t left join app_private.truck_availability av on av.truck_id = t.id
                    where t.carrier_id = p_org and coalesce(t.status,'active') not in ('inactive','retired')),
         drv as (select count(*) n from app_private.fleet_drivers d where d.carrier_id = p_org and coalesce(d.status,'active') <> 'inactive'),
         pr as (select * from public.profiles where id = (select owner_user_id from public.organizations where id = p_org)),
         pf as (select * from app_private.carrier_dispatch_prefs where carrier_id = p_org),
         no_driver as (select string_agg('Unit ' || coalesce(unit_no,'?'), ', ' order by unit_no) s, count(*) n from trucks where coalesce(av_driver,'') = ''),
         stale as (select string_agg('Unit ' || coalesce(unit_no,'?'), ', ' order by unit_no) s, count(*) n from trucks where av_at is null or av_at <= now() - interval '24 hours')
    select jsonb_build_array(
      jsonb_build_object('key','trucks','label','Post at least one truck','done', exists (select 1 from trucks),'blocker', true,
        'detail', case when exists (select 1 from trucks) then (select count(*)::text || ' truck(s) on file' from trucks) else 'No truck on file' end),
      jsonb_build_object('key','driver','label','Add a driver to every truck','done', exists (select 1 from trucks) and (select n from no_driver) = 0,'blocker', true,
        'detail', case when not exists (select 1 from trucks) then 'Post a truck first' when (select n from drv) = 0 then 'No driver on file' when (select n from no_driver) > 0 then (select s from no_driver) || ' — no driver set' else 'Every truck has a driver' end),
      jsonb_build_object('key','availability','label','Post today''s availability','done', exists (select 1 from trucks) and (select n from stale) = 0,'blocker', true,
        'detail', case when not exists (select 1 from trucks) then 'Post a truck first' when (select n from stale) > 0 then (select s from stale) || ' — not updated in 24 h' else 'All trucks updated today' end),
      jsonb_build_object('key','authority','label','Operating authority (MC/DOT) on file','done', exists (select 1 from docs where type='authority' and status='approved'),'blocker', true,
        'detail', case when exists (select 1 from docs where type='authority' and status='approved') then 'Approved' when exists (select 1 from docs where type='authority' and status='pending') then 'Uploaded — LoadBoot is reviewing it' when exists (select 1 from docs where type='authority' and status='rejected') then 'Rejected — needs a corrected copy' else 'Not uploaded' end),
      jsonb_build_object('key','insurance','label','Certificate of insurance (COI)','done', exists (select 1 from docs where type='insurance' and status='approved'),'blocker', true,
        'detail', case when exists (select 1 from docs where type='insurance' and status='approved') then 'Approved' when exists (select 1 from docs where type='insurance' and status='pending') then 'Uploaded — LoadBoot is reviewing it' when exists (select 1 from docs where type='insurance' and status='rejected') then 'Rejected — needs a corrected copy' else 'Not uploaded' end),
      jsonb_build_object('key','w9','label','W-9','done', exists (select 1 from docs where type='w9' and status='approved'),'blocker', true,
        'detail', case when exists (select 1 from docs where type='w9' and status='approved') then 'Approved' when exists (select 1 from docs where type='w9' and status='pending') then 'Submitted — LoadBoot is reviewing it' else 'Not signed' end),
      jsonb_build_object('key','agreement','label','Dispatch agreement signed','done', exists (select 1 from app_private.dispatch_agreement_signatures g where g.carrier_id = p_org),'blocker', true,
        'detail', case when exists (select 1 from app_private.dispatch_agreement_signatures g where g.carrier_id = p_org) then 'Signed' else 'Not signed' end),
      jsonb_build_object('key','floor','label','Rate floor ($/mi or minimum total)','done', exists (select 1 from pf where coalesce(min_rpm,0) > 0 or coalesce(min_total_rate,0) > 0),'blocker', false,
        'detail', coalesce((select case when coalesce(min_rpm,0) > 0 then '$' || min_rpm::text || '/mi' when coalesce(min_total_rate,0) > 0 then '$' || min_total_rate::text || ' minimum' end from pf), 'Not set — ask before every load')),
      jsonb_build_object('key','lanes','label','Home base + preferred lanes','done', exists (select 1 from pf where coalesce(home_base,'') <> '' or coalesce(array_length(preferred_lanes,1),0) > 0) or exists (select 1 from pr where coalesce(home_base,'') <> ''),'blocker', false,
        'detail', coalesce((select nullif(home_base,'') from pf), (select nullif(home_base,'') from pr), 'Not set')),
      jsonb_build_object('key','hometime','label','Home-time rule','done', exists (select 1 from pf where coalesce(home_time,'') <> '') or exists (select 1 from trucks where coalesce(home_time,'') <> ''),'blocker', false,
        'detail', coalesce((select nullif(home_time,'') from pf), (select nullif(home_time,'') from trucks where coalesce(home_time,'') <> '' limit 1), 'Not set')),
      jsonb_build_object('key','phone','label','Owner phone on the profile','done', exists (select 1 from pr where coalesce(phone,'') <> ''),'blocker', true,
        'detail', coalesce((select nullif(phone,'') from pr), 'Not set'))
    )
  );
  return v_ready;
end $fn$;

-- ───────────────────────── the numbers ─────────────────────────
-- p_from/p_to = the report window; p_since = trial start (cumulative scorecard runs p_since..p_to).
create or replace function app_private.disp_trial_stats(p_user uuid, p_from timestamptz, p_to timestamptz, p_since timestamptz)
returns jsonb language plpgsql stable security definer set search_path to 'app_private', 'public' as $fn$
declare
  v_orgs uuid[]; v_drv text[]; v_car text[]; v_acct uuid[]; v_carmail text[];
  w jsonb; cu jsonb; v_loads jsonb; v_pending jsonb; v_trucks int;
begin
  select coalesce(array_agg(distinct carrier_org_id), '{}') into v_orgs
    from app_private.dispatcher_assignments where dispatcher_user_id = p_user and status in ('active','paused');
  select coalesce(array_agg(distinct app_private.disp_ph10(phone)) filter (where app_private.disp_ph10(phone) is not null), '{}') into v_drv
    from app_private.fleet_drivers where carrier_id = any(v_orgs);
  select coalesce(array_agg(distinct app_private.disp_ph10(p.phone)) filter (where app_private.disp_ph10(p.phone) is not null), '{}'),
         coalesce(array_agg(distinct lower(u.email)) filter (where u.email is not null), '{}')
    into v_car, v_carmail
    from public.organizations o join public.profiles p on p.id = o.owner_user_id left join auth.users u on u.id = o.owner_user_id
   where o.id = any(v_orgs);
  select coalesce(array_agg(id), '{}') into v_acct from app_private.dmail_accounts where assigned_to = p_user;
  select count(*)::int into v_trucks from app_private.fleet_trucks
   where carrier_id = any(v_orgs) and coalesce(status,'active') not in ('inactive','retired');

  -- window: touches
  with c as (
    select c.*, app_private.disp_ph10(c.counterparty) ph from app_private.dialer_calls c
     where c.dispatcher_user_id = p_user and c.started_at >= p_from and c.started_at < p_to),
  k as (
    select c.*, case when c.ph = any(v_drv) then 'driver'
                     when c.carrier_org_id is not null or c.ph = any(v_car) then 'carrier' else 'broker' end kind,
           coalesce(lower(nullif(bc.broker,'')), lower(nullif(bk.broker,'')), lower(nullif(bp.broker,'')), c.ph, c.counterparty) bkey
      from c
      left join app_private.broker_contacts bc on bc.id = c.broker_contact_id
      left join app_private.dispatcher_bookings bk on bk.id = c.booking_id
      left join lateral (select b.broker from app_private.broker_contacts b
                          where b.dispatcher_user_id = p_user and app_private.disp_ph10(b.phone) = c.ph limit 1) bp on true),
  m as (
    select mm.folder, lower(a.addr) addr
      from app_private.dmail_messages mm
      cross join lateral (
        select x->>'email' addr from jsonb_array_elements(case when mm.folder = 'sent' and jsonb_typeof(mm.to_addrs) = 'array' then mm.to_addrs else '[]'::jsonb end) x
        union all select mm.from_email where mm.folder = 'inbox') a
     where mm.account_id = any(v_acct) and mm.folder in ('sent','inbox') and mm.msg_date >= p_from and mm.msg_date < p_to
       and a.addr is not null),
  mb as (
    select coalesce(lower(nullif(b.broker,'')), m.addr) bkey from m
      left join lateral (select broker from app_private.broker_contacts where dispatcher_user_id = p_user and lower(email) = m.addr limit 1) b on true
     where m.addr not like '%@loadboot.com' and m.addr not like '%.loadboot.com' and not (m.addr = any(v_carmail))),
  bk as (select distinct bkey from k where kind = 'broker' and bkey is not null
         union select bkey from mb where bkey is not null)
  select jsonb_build_object(
    'brokers', (select count(*) from bk),
    'broker_calls', (select count(*) from k where kind = 'broker'),
    'carrier', (select count(*) from k where kind = 'carrier')
             + (select count(*) from app_private.dispatcher_messages dm join app_private.dispatcher_assignments a on a.id = dm.assignment_id
                 where a.dispatcher_user_id = p_user and dm.sender_role in ('dispatcher','carrier') and dm.created_at >= p_from and dm.created_at < p_to),
    'driver', (select count(*) from k where kind = 'driver'),
    'sent', (select count(*) from app_private.dmail_messages where account_id = any(v_acct) and folder = 'sent' and msg_date >= p_from and msg_date < p_to),
    'received', (select count(*) from app_private.dmail_messages where account_id = any(v_acct) and folder = 'inbox' and msg_date >= p_from and msg_date < p_to)
  ) into w;

  select coalesce(jsonb_agg(jsonb_build_object('lane', b.origin || ' → ' || b.destination, 'broker', b.broker, 'miles', b.miles,
            'gross', b.gross, 'status', b.status) order by b.created_at), '[]'::jsonb)
    into v_loads
    from app_private.dispatcher_bookings b
   where b.dispatcher_user_id = p_user and b.created_at >= p_from and b.created_at < p_to and b.status not in ('cancelled','rejected');

  -- cumulative scorecard since trial start
  with b as (select * from app_private.dispatcher_bookings
              where dispatcher_user_id = p_user and created_at >= p_since and created_at < p_to),
       ok as (select * from b where status not in ('cancelled','rejected'))
  select jsonb_build_object(
    'loads', (select count(*) from ok),
    'gross', (select coalesce(sum(gross),0) from ok),
    'miles', (select coalesce(sum(miles),0) from ok where miles > 0),
    'gross_mi', (select coalesce(sum(gross),0) from ok where miles > 0),
    'above_floor', (select count(*) from ok where not below_min),
    'rc', (select count(*) from ok where rc_received_at is not null or rc_doc_path is not null),
    'check_calls', (select count(*) from app_private.dialer_calls c where c.dispatcher_user_id = p_user and c.booking_id in (select id from ok)),
    'deadhead', (select coalesce(sum(deadhead),0) from ok where deadhead is not null and miles > 0),
    'dh_miles', (select coalesce(sum(miles),0) from ok where deadhead is not null and miles > 0),
    'cancels', (select count(*) from b where status = 'cancelled'),
    'trucks', v_trucks
  ) into cu;

  -- pending with each carrier
  select coalesce(jsonb_agg(jsonb_build_object('assignment_id', a.id, 'carrier', o.name,
            'items', (select coalesce(jsonb_agg(jsonb_build_object('key', r->>'key', 'label', r->>'label', 'detail', r->>'detail', 'blocker', (r->>'blocker')::boolean)), '[]'::jsonb)
                        from jsonb_array_elements(app_private.disp_carrier_ready(a.carrier_org_id)) r where not (r->>'done')::boolean))
          order by a.assigned_at), '[]'::jsonb)
    into v_pending
    from app_private.dispatcher_assignments a join public.organizations o on o.id = a.carrier_org_id
   where a.dispatcher_user_id = p_user and a.status in ('active','paused');

  return jsonb_build_object('window', w, 'loads', v_loads, 'cum', cu, 'pending', v_pending, 'carriers', cardinality(v_orgs));
end $fn$;

-- ───────────────────────── e-mail pieces ─────────────────────────
create or replace function app_private.disp_tdr_f() returns text language sql immutable as $$ select 'font-family:''Segoe UI'',Helvetica,Arial,sans-serif;'::text $$;

create or replace function app_private.disp_tdr_section(p_title text, p_right text, p_body text) returns text
language sql immutable set search_path to 'app_private', 'public' as $$
  select '<tr><td style="padding:22px 28px 0"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>'
    || '<td style="' || app_private.disp_tdr_f() || 'font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#10223B">' || p_title || '</td>'
    || '<td style="' || app_private.disp_tdr_f() || 'font-size:12px;color:#5c6f8f;text-align:right">' || coalesce(p_right,'') || '</td></tr></table>'
    || '<div style="height:1px;background:#e3e9f2;margin:8px 0 12px;font-size:0;line-height:0">&nbsp;</div>' || p_body || '</td></tr>'
$$;

create or replace function app_private.disp_tdr_kpi(p_label text, p_val text, p_sub text) returns text
language sql immutable set search_path to 'app_private', 'public' as $$
  select '<td style="width:33.33%;padding:6px;vertical-align:top"><div style="border:1px solid #e3e9f2;border-radius:10px;padding:12px 12px 10px;background:#ffffff">'
    || '<div style="' || app_private.disp_tdr_f() || 'font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#5c6f8f">' || p_label || '</div>'
    || '<div style="' || app_private.disp_tdr_f() || 'font-size:26px;font-weight:700;color:#10223B;line-height:1.2;margin-top:4px">' || p_val || '</div>'
    || '<div style="' || app_private.disp_tdr_f() || 'font-size:12px;color:#5c6f8f">' || coalesce(p_sub,'&nbsp;') || '</div></div></td>'
$$;

create or replace function app_private.disp_tdr_btn(p_label text, p_url text, p_bg text, p_fg text, p_border text) returns text
language sql immutable set search_path to 'app_private', 'public' as $$
  select '<a href="' || p_url || '" style="display:inline-block;' || app_private.disp_tdr_f() || 'font-size:14px;font-weight:600;text-decoration:none;padding:11px 18px;border-radius:8px;background:'
    || p_bg || ';color:' || p_fg || ';border:1px solid ' || coalesce(p_border, p_bg) || ';margin:4px 6px 4px 0"><span style="color:' || p_fg || '!important">' || p_label || '</span></a>'
$$;

create or replace function app_private.disp_tdr_score(p_label text, p_val text, p_pct numeric, p_state text) returns text
language sql immutable set search_path to 'app_private', 'public' as $$
  select '<tr><td style="' || app_private.disp_tdr_f() || 'font-size:14px;color:#10223B;padding:7px 0;width:44%">' || p_label || '</td>'
    || '<td style="padding:7px 10px;width:26%"><div style="height:6px;background:#edf1f7;border-radius:3px"><div style="height:6px;width:'
    || greatest(4, least(100, round(coalesce(p_pct,0))))::int || '%;background:' || c.col || ';border-radius:3px"></div></div></td>'
    || '<td style="' || app_private.disp_tdr_f() || 'font-size:13px;color:#10223B;text-align:right;white-space:nowrap;padding:7px 0">' || p_val
    || ' <span style="color:' || c.col || ';font-weight:600">&middot; ' || c.lbl || '</span></td></tr>'
  from (select case p_state when 'ok' then '#0f8a5c' when 'behind' then '#b86e00' when 'none' then '#94a3b8' else '#c7321f' end col,
               case p_state when 'ok' then 'On track' when 'behind' then 'Behind' when 'none' then 'No loads yet' else 'Missed' end lbl) c
$$;

-- ───────────────────────── build one e-mail (no side effects) ─────────────────────────
create or replace function app_private.disp_trial_daily_build(p_user uuid, p_date date)
returns jsonb language plpgsql stable security definer set search_path to 'app_private', 'public' as $fn$
declare
  d record; F text := app_private.disp_tdr_f();
  v_days int; v_day int; v_left int; v_prev date; v_from timestamptz; v_to timestamptz; v_since timestamptz;
  s jsonb; w jsonb; cu jsonb; v_kick boolean; v_final boolean; v_tone text; v_zero boolean;
  v_first text; v_first_raw text; v_when text; v_when_short text; v_subj text; v_verdict text; v_intro text; v_warn text;
  v_html text; v_text text; v_segs text := ''; i int; v_body text; v_moves text[] := '{}'; v_m text;
  v_nloads int; v_gross numeric; v_target int; v_ti int; v_tips text[][]; p jsonb; it jsonb; v_npend int := 0;
  v_ws text := 'https://loadboot.com/app/agent/#dashboard'; v_app text := 'https://loadboot.com/app/agent/#';
  v_toneA text; v_toneB text; v_date_lbl text; v_end_lbl text;
begin
  select dp.*, u.email into d from app_private.dispatcher_profiles dp join auth.users u on u.id = dp.user_id where dp.user_id = p_user;
  if d.user_id is null then return jsonb_build_object('skip', true, 'reason', 'no dispatcher'); end if;
  if d.trial_start is null or d.trial_end is null then return jsonb_build_object('skip', true, 'reason', 'no trial window'); end if;
  if extract(isodow from p_date) > 5 then return jsonb_build_object('skip', true, 'reason', 'weekend'); end if;

  v_days  := greatest(1, app_private.disp_trial_wd(d.trial_start, d.trial_end));
  v_day   := greatest(1, app_private.disp_trial_wd(d.trial_start, p_date));
  v_left  := greatest(0, app_private.disp_trial_wd(p_date, d.trial_end));
  v_final := p_date >= d.trial_end;
  v_prev  := (select max(g)::date from generate_series(p_date - 7, p_date - 1, interval '1 day') g where extract(isodow from g) < 6);
  v_kick  := p_date <= d.trial_start or v_prev < d.trial_start;
  v_since := d.trial_start::timestamp at time zone 'America/New_York';
  v_from  := v_prev::timestamp at time zone 'America/New_York';
  v_to    := p_date::timestamp at time zone 'America/New_York';
  v_when  := case when p_date - v_prev > 1 then 'since ' || to_char(v_prev, 'FMDay') else 'yesterday' end;
  v_first_raw := coalesce(nullif(split_part(btrim(coalesce(d.full_name,'')), ' ', 1), ''), 'there');
  v_when_short := case when p_date - v_prev > 1 then to_char(v_prev, 'FMDay') else 'yesterday' end;
  if v_first_raw <> 'there' and (v_first_raw = upper(v_first_raw) or v_first_raw = lower(v_first_raw)) then v_first_raw := initcap(v_first_raw); end if;
  v_first := app_private.disp_esc(v_first_raw);
  v_date_lbl := to_char(p_date, 'Dy FMDD Mon');
  v_end_lbl  := to_char(d.trial_end, 'Dy FMDD Mon');

  s  := app_private.disp_trial_stats(p_user, case when v_kick then v_to else v_from end, v_to, v_since);
  w  := s->'window'; cu := s->'cum';
  v_zero := not v_kick and coalesce((w->>'brokers')::int,0) + coalesce((w->>'carrier')::int,0) + coalesce((w->>'driver')::int,0)
            + coalesce((w->>'sent')::int,0) + coalesce((w->>'received')::int,0) + jsonb_array_length(s->'loads') = 0;
  v_nloads := (cu->>'loads')::int; v_gross := (cu->>'gross')::numeric;
  v_target := ceil(3.0 * greatest(1, (cu->>'trucks')::int) * v_days / 5.0);

  v_tone := case when v_zero then 'bad' when v_kick or v_final then 'info'
                 when coalesce((w->>'brokers')::int,0) < 5 and jsonb_array_length(s->'loads') = 0 then 'warn' else 'good' end;
  select a, b into v_toneA, v_toneB from (values ('info','#0883F7','#eaf3fe'),('good','#0f8a5c','#e8f6ef'),('warn','#b86e00','#fff4e2'),('bad','#c7321f','#fdecea')) t(k,a,b) where k = v_tone;

  -- subject: the real number, every time
  v_subj := case
    when v_kick then 'Day 1 of ' || v_days || ' · Your LoadBoot trial starts today, ' || v_first_raw
    when v_final then 'Final day · ' || v_nloads || ' load' || case when v_nloads = 1 then '' else 's' end || ', $' || to_char(v_gross, 'FM999,999,990') || ' booked. What closes your trial'
    when v_zero then 'Day ' || v_day || ' of ' || v_days || ' · No activity ' || v_when || '. ' || v_left || ' working days left'
    when v_tone = 'warn' then 'Day ' || v_day || ' of ' || v_days || ' · Quiet day: ' || (w->>'brokers') || ' broker' || case when (w->>'brokers')::int = 1 then '' else 's' end || '. ' || v_left || ' working days left'
    when jsonb_array_length(s->'loads') > 0 then 'Day ' || v_day || ' of ' || v_days || ' · ' || jsonb_array_length(s->'loads') || ' load' || case when jsonb_array_length(s->'loads') = 1 then '' else 's' end
         || ' booked ' || v_when || ', $' || to_char((select sum((x->>'gross')::numeric) from jsonb_array_elements(s->'loads') x), 'FM999,999,990') || '. ' || v_left || ' days left'
    else 'Day ' || v_day || ' of ' || v_days || ' · ' || (w->>'brokers') || ' brokers reached ' || v_when || '. ' || v_left || ' working days left' end;

  v_verdict := case v_tone when 'bad' then 'No activity ' || v_when when 'warn' then 'Quiet day' when 'good' then 'Solid day'
                 else case when v_kick then 'Your trial starts today' else 'Final day' end end;
  v_intro := case
    when v_kick then 'Welcome to day 1. From tomorrow, this e-mail arrives every working morning at 8:00 AM Eastern with your last 24 hours: who you reached, what you booked, what is still waiting on the carrier, and how your trial is pacing. Here is what a good trial looks like, and your first three moves.'
    when v_final then 'This is your last trial report. Below is ' || v_when || ', your full scorecard, and the three things that close the trial well. LoadBoot will reach out with the decision after today.'
    else 'Here is your activity ' || v_when || ', and how your trial is pacing.' end;
  v_warn := case
    when v_zero then '<b style="color:' || v_toneA || '">We need to hear from you today.</b> We saw no calls, no e-mails and no carrier messages from you ' || v_when || '. That is now on your trial record. If you were sick or something went wrong, tap <b>I need help</b> below and tell us today. We would rather know.'
    when v_tone = 'warn' then '<b style="color:' || v_toneA || '">Heads up.</b> Your activity ' || v_when || ' was well under pace: ' || (w->>'brokers') || ' broker touch' || case when (w->>'brokers')::int = 1 then '' else 'es' end || ' against a target of 15 a day, and no load booked. If something got in the way, tap <b>I need help</b> below and tell us.' end;

  -- countdown band
  for i in 1..least(v_days, 20) loop
    v_segs := v_segs || '<td style="padding:0 2px"><div style="height:6px;border-radius:3px;font-size:0;line-height:0;background:'
      || case when i < v_day then '#ffffff' when i = v_day then '#FC5305' else '#3a4a63' end || '">&nbsp;</div></td>';
  end loop;

  v_html := '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef1f5;margin:0"><tr><td align="center" style="padding:24px 10px">'
    || '<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e9f2">'
    || '<tr><td style="background:#10223B;padding:20px 28px 18px">'
    || '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>'
    || '<td style="vertical-align:middle"><a href="https://loadboot.com" style="text-decoration:none"><img src="https://loadboot.com/email-logo-white-2x.png" width="150" alt="LoadBoot" style="display:block;border:0;max-width:150px;height:auto"></a></td>'
    || '<td style="' || F || 'font-size:12px;color:#9fb3d1;text-align:right;vertical-align:middle">Dispatch &middot; Trial report<br>' || v_date_lbl || '</td></tr></table>'
    || '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:18px"><tr>'
    || '<td style="vertical-align:bottom"><div style="' || F || 'font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#9fb3d1">Day ' || v_day || ' of ' || v_days || '</div>'
    || '<div style="' || F || 'font-size:40px;font-weight:700;color:#ffffff;line-height:1.1">' || case when v_final then 'Last day' else v_left::text end || '</div>'
    || '<div style="' || F || 'font-size:13px;color:#c9d6ea">' || case when v_final then 'trial ends today, 6:00 PM ET' else 'working days left, today included &middot; ends ' || v_end_lbl || ', 6:00 PM ET' end || '</div></td>'
    || '<td style="vertical-align:bottom;text-align:right;' || F || 'font-size:12px;color:#c9d6ea">Loads so far<br><span style="font-size:22px;font-weight:700;color:#ffffff">' || v_nloads
    || '</span><span style="color:#9fb3d1"> / ' || v_target || ' target</span></td></tr></table>'
    || '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:14px"><tr>' || v_segs || '</tr></table>'
    || '</td></tr>'
    || '<tr><td style="padding:24px 28px 0">'
    || '<span style="display:inline-block;' || F || 'font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;background:' || v_toneB || ';color:' || v_toneA || '">' || v_verdict || '</span>'
    || '<p style="' || F || 'font-size:16px;color:#10223B;margin:14px 0 6px">Good morning ' || v_first || ',</p>'
    || '<p style="' || F || 'font-size:15px;line-height:1.6;color:#334155;margin:0">' || v_intro || '</p>'
    || coalesce('<div style="margin-top:14px;border:1px solid ' || v_toneA || ';background:' || v_toneB || ';border-radius:10px;padding:12px 14px;' || F || 'font-size:14px;line-height:1.55;color:#10223B">' || v_warn || '</div>', '')
    || '</td></tr>';

  if v_kick then
    v_html := v_html || app_private.disp_tdr_section('What a good trial looks like', null,
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">'
      || (select string_agg('<tr><td style="padding:6px 0;' || F || 'font-size:14px;color:#10223B;font-weight:600;width:52%;vertical-align:top">' || a || '</td><td style="padding:6px 0;' || F || 'font-size:13px;color:#5c6f8f">' || b || '</td></tr>', '' order by n)
          from (values (1,'15+ brokers reached a day','calls and e-mails from your workspace'),
                       (2,'3+ loads a week per truck', v_target || ' loads across ' || greatest(1,(cu->>'trucks')::int) || ' truck' || case when greatest(1,(cu->>'trucks')::int) = 1 then '' else 's' end || ' in ' || v_days || ' working days'),
                       (3,'At or above the carrier''s floor','no load under the floor without the carrier''s yes'),
                       (4,'2 check calls on every load','pickup and midway, before the broker asks'),
                       (5,'100% rate confirmations uploaded','same day as the booking'),
                       (6,'Deadhead 15% or less, zero cancels','plan the reload before delivery')) t(n,a,b))
      || '</table>');
  else
    v_html := v_html || app_private.disp_tdr_section('Your activity ' || v_when, case when p_date - v_prev > 1 then to_char(v_prev, 'FMDay FMDD Mon') || ' to Sunday' end,
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>'
      || app_private.disp_tdr_kpi('Brokers', w->>'brokers', case when (w->>'brokers')::int >= 15 then 'target 15' else '<span style="color:#b86e00">target 15</span>' end)
      || app_private.disp_tdr_kpi('Carrier', w->>'carrier', 'calls + messages')
      || app_private.disp_tdr_kpi('Drivers', w->>'driver', 'calls') || '</tr><tr>'
      || app_private.disp_tdr_kpi('E-mails sent', w->>'sent', null)
      || app_private.disp_tdr_kpi('Received', w->>'received', null)
      || app_private.disp_tdr_kpi('Loads booked', jsonb_array_length(s->'loads')::text,
           case when jsonb_array_length(s->'loads') > 0 then '$' || to_char((select sum((x->>'gross')::numeric) from jsonb_array_elements(s->'loads') x), 'FM999,999,990') || ' gross' end)
      || '</tr></table>');
  end if;

  if jsonb_array_length(s->'loads') > 0 then
    v_html := v_html || app_private.disp_tdr_section('Loads you booked', null,
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">'
      || (select string_agg('<tr><td style="padding:10px 0;border-bottom:1px solid #e3e9f2;vertical-align:top"><div style="' || F || 'font-size:14px;font-weight:600;color:#10223B">' || app_private.disp_esc(x->>'lane') || '</div>'
            || '<div style="' || F || 'font-size:12px;color:#5c6f8f">' || app_private.disp_esc(coalesce(x->>'broker','')) || coalesce(' &middot; ' || (x->>'miles') || ' mi', '')
            || case when coalesce((x->>'miles')::numeric,0) > 0 then ' &middot; $' || to_char((x->>'gross')::numeric / (x->>'miles')::numeric, 'FM990.00') || '/mi' else '' end || '</div></td>'
            || '<td style="padding:10px 0;border-bottom:1px solid #e3e9f2;text-align:right;vertical-align:top"><div style="' || F || 'font-size:15px;font-weight:700;color:#10223B">$' || to_char((x->>'gross')::numeric, 'FM999,999,990') || '</div>'
            || '<div style="' || F || 'font-size:12px;color:#0f8a5c">' || initcap(replace(x->>'status', '_', ' ')) || '</div></td></tr>', '')
          from jsonb_array_elements(s->'loads') x)
      || '</table>');
  end if;

  -- pending with each carrier
  for p in select * from jsonb_array_elements(s->'pending') loop
    v_npend := v_npend + jsonb_array_length(p->'items');
    v_body := case when jsonb_array_length(p->'items') = 0
      then '<div style="' || F || 'font-size:14px;color:#0f8a5c;font-weight:600">Nothing pending. Everything the carrier needs to give you is in.</div>'
      else '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">'
        || (select string_agg('<tr><td style="padding:8px 0;border-bottom:1px solid #e3e9f2;' || F || 'font-size:14px;color:#10223B"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'
              || case when (x->>'blocker')::boolean then '#c7321f' else '#FC5305' end || ';margin-right:8px"></span>' || app_private.disp_esc(x->>'label') || '</td>'
              || '<td style="padding:8px 0;border-bottom:1px solid #e3e9f2;text-align:right;' || F || 'font-size:12px;color:#5c6f8f">' || app_private.disp_esc(coalesce(x->>'detail','')) || '</td></tr>', '')
            from jsonb_array_elements(p->'items') x)
        || '</table><div style="margin-top:10px">' || app_private.disp_tdr_btn('Ask ' || app_private.disp_esc(p->>'carrier') || ' in Messages', v_app || 'messages/' || (p->>'assignment_id'), '#f6f9fd', '#10223B', '#e3e9f2') || '</div>' end;
    v_html := v_html || app_private.disp_tdr_section('Still to get from ' || app_private.disp_esc(p->>'carrier'),
      case when jsonb_array_length(p->'items') > 0 then jsonb_array_length(p->'items') || ' open' end, v_body);
  end loop;

  -- scorecard (once there is a day behind them)
  if not v_kick then
    v_html := v_html || app_private.disp_tdr_section(case when v_final then 'Your trial scorecard' else 'Trial scorecard so far' end,
      '$' || to_char(v_gross, 'FM999,999,990') || ' booked' || case when (cu->>'miles')::numeric > 0 then ' &middot; $' || to_char((cu->>'gross_mi')::numeric / (cu->>'miles')::numeric, 'FM990.00') || '/mi avg' else '' end,
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">'
      || app_private.disp_tdr_score('Loads &middot; 3/week/truck', v_nloads || ' of ' || ceil(v_target::numeric * (v_day - 1) / v_days),
           100.0 * v_nloads / greatest(1, ceil(v_target::numeric * (v_day - 1) / v_days)),
           case when v_nloads >= 0.9 * ceil(v_target::numeric * (v_day - 1) / v_days) then 'ok' else 'behind' end)
      || app_private.disp_tdr_score('Above the floor rate', case when v_nloads > 0 then (cu->>'above_floor') || ' of ' || v_nloads else '&ndash;' end,
           case when v_nloads > 0 then 100.0 * (cu->>'above_floor')::int / v_nloads else 0 end,
           case when v_nloads = 0 then 'none' when (cu->>'above_floor')::int = v_nloads then 'ok' else 'missed' end)
      || app_private.disp_tdr_score('Rate confirmations uploaded', case when v_nloads > 0 then (cu->>'rc') || ' of ' || v_nloads else '&ndash;' end,
           case when v_nloads > 0 then 100.0 * (cu->>'rc')::int / v_nloads else 0 end,
           case when v_nloads = 0 then 'none' when (cu->>'rc')::int = v_nloads then 'ok' else 'behind' end)
      || app_private.disp_tdr_score('Calls logged on loads, 2 per load', case when v_nloads > 0 then to_char((cu->>'check_calls')::numeric / v_nloads, 'FM990.0') || ' avg' else '&ndash;' end,
           case when v_nloads > 0 then 50.0 * (cu->>'check_calls')::numeric / v_nloads else 0 end,
           case when v_nloads = 0 then 'none' when (cu->>'check_calls')::numeric / v_nloads >= 2 then 'ok' else 'behind' end)
      || app_private.disp_tdr_score('Deadhead, 15% or less', case when (cu->>'dh_miles')::numeric > 0 then round(100.0 * (cu->>'deadhead')::numeric / ((cu->>'dh_miles')::numeric + (cu->>'deadhead')::numeric)) || '%' else '&ndash;' end,
           case when (cu->>'dh_miles')::numeric > 0 then 100 else 0 end, case when (cu->>'dh_miles')::numeric = 0 then 'none' when 100.0 * (cu->>'deadhead')::numeric / ((cu->>'dh_miles')::numeric + (cu->>'deadhead')::numeric) <= 15 then 'ok' else 'missed' end)
      || app_private.disp_tdr_score('Cancelled loads', cu->>'cancels', 100, case when (cu->>'cancels')::int = 0 then 'ok' else 'missed' end)
      || '</table>');
  end if;

  -- three moves, from the data
  if v_kick then
    v_moves := array['Read each carrier brief in your workspace from start to finish', 'Introduce yourself to the carrier in Messages and in their WhatsApp group', 'Make your first 10 broker calls from the workspace dialer'];
  elsif v_final then
    v_moves := array['Upload every missing rate confirmation', 'Write a handover note: each truck, where it is, its next load, anything you promised', 'Thank the carrier in their group, whatever the outcome'];
  else
    if v_zero then v_moves := array_append(v_moves, 'Message the carrier today: what happened and your plan'::text); end if;
    if (select count(*) from app_private.dispatcher_bookings where dispatcher_user_id = p_user and status = 'pending_rc') > 0 then
      v_moves := array_append(v_moves, ('Upload the rate confirmation for ' || (select count(*) from app_private.dispatcher_bookings where dispatcher_user_id = p_user and status = 'pending_rc') || ' load(s) waiting on RC')::text);
    end if;
    if v_npend > 0 then
      v_moves := array_append(v_moves, ('Get from the carrier: ' || app_private.disp_esc((select x->>'label' from jsonb_array_elements(s->'pending') p0, jsonb_array_elements(p0->'items') x order by (x->>'blocker')::boolean desc limit 1)))::text);
    end if;
    if coalesce((w->>'brokers')::int,0) < 15 then v_moves := array_append(v_moves, ('Reach 15+ brokers today (' || v_when_short || ': ' || coalesce(w->>'brokers','0') || ')')::text); end if;
    if v_nloads > 0 and (cu->>'check_calls')::numeric / v_nloads < 2 then v_moves := array_append(v_moves, 'Make check calls on every moving load and log them on the booking'::text); end if;
    foreach v_m in array array['Find tomorrow''s reload before each truck delivers', 'Save every broker you speak to in Brokers, with the lane they asked about', 'Post each truck''s availability before 9 AM'] loop
      exit when cardinality(v_moves) >= 3;
      v_moves := array_append(v_moves, v_m);
    end loop;
  end if;
  v_html := v_html || app_private.disp_tdr_section(case when v_final then 'Close the trial well' else 'Your three moves today' end, null,
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">'
    || (select string_agg('<tr><td style="width:30px;padding:6px 0;vertical-align:top"><div style="width:22px;height:22px;border-radius:50%;background:#10223B;color:#ffffff;' || F
          || 'font-size:12px;font-weight:700;text-align:center;line-height:22px">' || n || '</div></td><td style="padding:6px 0;' || F || 'font-size:14px;color:#10223B;line-height:1.5">' || m || '</td></tr>', '' order by n)
        from unnest(v_moves[1:3]) with ordinality t(m,n))
    || '</table><div style="margin-top:12px">' || app_private.disp_tdr_btn('Open my workspace', v_ws, '#FC5305', '#ffffff', null) || '</div>');

  -- tip of the day
  v_tips := array[
    ['Kickoff','Read the carrier brief end to end first','Before your first broker call, read your carrier''s brief completely: trucks, floor rate, home base, no-go states. Brokers can tell in ten seconds whether you know your truck. Then introduce yourself in the carrier''s WhatsApp group so they know your name and hours.'],
    ['Broker calls','The first 30 seconds of a broker call','Lead with MC, equipment and where the truck is empty: "MC 1234567, 53 ft dry van, empty in Dallas tomorrow 8 AM, calling about your Memphis load." Then ask what they are paying before you say a number. Whoever names the rate first usually loses.'],
    ['Negotiation','Counter in rate per mile, never in dollars','When a broker offers $1,900 on 452 miles, say "that is $4.20 a mile, I need $4.75 to move this truck." Per-mile keeps the talk about the market. Know the carrier''s floor before you dial, and never go under it without the carrier''s yes.'],
    ['Check calls','Two check calls on every load, before the broker asks','Call the driver at pickup and at the halfway point, then send the broker the update: "Loaded 9:40 AM, rolling, ETA 6 PM." Log each call on the booking. A broker who never has to chase you gives you the next load first.'],
    ['Deadhead','Book the reload before the truck is empty','Start searching the next load the day before delivery, from the delivery city outward: 50, 100, 150 miles. Every empty mile is unpaid. Keep deadhead at 15% or less.'],
    ['Broker relationships','Save every broker who says yes, and every one who says no','Log each broker in Brokers with the lane they asked about. The broker who had nothing on Tuesday may have it on Thursday. By the second week your best loads should come from callbacks, not cold calls.'],
    ['Rate confirmations','Read every rate confirmation line by line','Before you send an RC to the carrier, check it against the call: rate, pickup time, delivery window, detention and TONU terms, and the broker''s MC. A wrong pickup time on the RC is your mistake, not the broker''s.'],
    ['Carrier trust','Never book a truck without the carrier''s yes','Send the load to the carrier (lane, rate, miles, pickup) and wait for a clear "yes, book it". Silence is not approval. This is the one rule that ends a trial on the spot.'],
    ['E-mail craft','Write e-mails a broker answers in one line','Subject: "53 DV · Richmond empty Fri 7 AM · your BAL load". Body: truck, location, time, MC, one question. Reply to broker e-mails within 15 minutes during the day.'],
    ['Final day','Finish clean','Every open load has an RC uploaded, every truck has a plan for Monday, and your handover note says where each truck is and what you promised to whom. The decision looks at how you left things as much as how you started.']];
  v_ti := case when v_kick then 1 when v_final then 10 else 2 + ((v_day - 2) % 8) end;
  v_html := v_html || '<tr><td style="padding:22px 28px 0"><div style="background:#f6f9fd;border:1px solid #e3e9f2;border-radius:12px;padding:16px 18px">'
    || '<div style="' || F || 'font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#0883F7;font-weight:700">Tip of the day &middot; ' || v_tips[v_ti][1] || '</div>'
    || '<div style="' || F || 'font-size:16px;font-weight:700;color:#10223B;margin:6px 0">' || v_tips[v_ti][2] || '</div>'
    || '<div style="' || F || 'font-size:14px;line-height:1.6;color:#334155">' || v_tips[v_ti][3] || '</div></div></td></tr>';

  -- help + feedback
  v_html := v_html || '<tr><td style="padding:22px 28px 0"><div style="border:1px solid #e3e9f2;border-radius:12px;padding:16px 18px">'
    || '<div style="' || F || 'font-size:15px;font-weight:700;color:#10223B">Stuck on something?</div>'
    || '<div style="' || F || 'font-size:14px;color:#334155;margin:4px 0 10px">Tell us in your workspace. A LoadBoot coordinator reads it the same day, usually within the hour during US business hours.</div>'
    || app_private.disp_tdr_btn('I need help', v_app || 'trial/help', '#10223B', '#ffffff', null)
    || app_private.disp_tdr_btn('Send feedback', v_app || 'trial/feedback', '#ffffff', '#10223B', '#e3e9f2')
    || '<div style="' || F || 'font-size:13px;color:#5c6f8f;margin:14px 0 6px">How did ' || case when v_kick then 'your start' else v_when_short end || ' go? One tap:</div>'
    || app_private.disp_tdr_btn('Smooth', v_app || 'trial/mood/smooth', '#e8f6ef', '#0f8a5c', '#bfe6d2')
    || app_private.disp_tdr_btn('Mixed', v_app || 'trial/mood/mixed', '#fff4e2', '#b86e00', '#f5d9a8')
    || app_private.disp_tdr_btn('Stuck, call me', v_app || 'trial/mood/stuck', '#fdecea', '#c7321f', '#f3c3bc')
    || '</div></td></tr>';

  -- footer (contact through the ONE switch, §7)
  v_html := v_html || '<tr><td style="padding:24px 28px 26px">'
    || '<div style="' || F || 'font-size:14px;color:#10223B"><b>LoadBoot Dispatch</b></div>'
    || '<div style="' || F || 'font-size:13px;color:#10223B;margin-top:2px">{{contact_sig}}</div>'
    || '<div style="height:1px;background:#e3e9f2;margin:16px 0 12px;font-size:0;line-height:0">&nbsp;</div>'
    || '<div style="' || F || 'font-size:12px;line-height:1.55;color:#8ea2c3">You get this every working morning while your LoadBoot dispatcher trial runs ('
    || to_char(d.trial_start, 'FMDD Mon') || ' to ' || to_char(d.trial_end, 'FMDD Mon YYYY') || '). It stops when the trial ends. Numbers come from your LoadBoot workspace: calls on your LoadBoot line, your LoadBoot mailbox, your carrier messages and your bookings. Calls or e-mails made outside LoadBoot do not count.</div>'
    || '</td></tr></table></td></tr></table>';

  v_text := 'Good morning ' || v_first_raw || E',\n\n'
    || 'Day ' || v_day || ' of ' || v_days || ' · ' || case when v_final then 'last day of your trial' else v_left || ' working days left (today included), trial ends ' || v_end_lbl end || E'\n'
    || case when v_kick then '' else E'\nYour activity ' || v_when || ': brokers ' || (w->>'brokers') || ', carrier ' || (w->>'carrier') || ', drivers ' || (w->>'driver')
         || ', e-mails sent ' || (w->>'sent') || ', received ' || (w->>'received') || ', loads booked ' || jsonb_array_length(s->'loads') || E'\n' end
    || E'Loads so far: ' || v_nloads || ' of ' || v_target || ' target, $' || to_char(v_gross, 'FM999,999,990') || E' booked.\n'
    || case when v_npend > 0 then E'Still to get from the carrier: ' || v_npend || E' item(s) - see your workspace.\n' else '' end
    || E'\nToday: ' || array_to_string(v_moves[1:3], '; ') || E'\n\nTip: ' || v_tips[v_ti][2] || '. ' || v_tips[v_ti][3]
    || E'\n\nWorkspace: ' || v_ws || E'\nNeed help: ' || v_app || E'trial/help\n\nLoadBoot Dispatch - {{contact_sig}}';

  return jsonb_build_object('skip', false, 'subject', v_subj, 'html', v_html, 'text', v_text, 'tone', v_tone,
    'day', v_day, 'days', v_days, 'left', v_left, 'kickoff', v_kick, 'final', v_final, 'to', d.email, 'name', d.full_name,
    'stats', s || jsonb_build_object('target', v_target, 'window_from', case when v_kick then null else v_from end, 'window_to', v_to));
end $fn$;

-- ───────────────────────── send + staff alert ─────────────────────────
create or replace function app_private.disp_trial_staff_to() returns text
language sql stable security definer set search_path to 'app_private', 'public' as $$
  select coalesce((select nullif(btrim(value),'') from app_private.disp_desk_config where key = 'escalation_email'), app_private.disp_contact()->>'email', 'dispatch@loadboot.com')
$$;

create or replace function app_private.disp_trial_daily_send(p_user uuid, p_date date default null)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public' as $fn$
declare v_date date := coalesce(p_date, (now() at time zone 'America/New_York')::date); d record; b jsonb; v_name text;
begin
  select dp.*, u.email into d from app_private.dispatcher_profiles dp join auth.users u on u.id = dp.user_id where dp.user_id = p_user;
  if d.user_id is null or d.status <> 'trial' or d.blocked_at is not null then return jsonb_build_object('sent', false, 'reason', 'not on an active trial'); end if;
  if d.trial_start is null or d.trial_end is null or v_date not between d.trial_start and d.trial_end then return jsonb_build_object('sent', false, 'reason', 'outside the trial window'); end if;
  if d.email is null then return jsonb_build_object('sent', false, 'reason', 'no e-mail'); end if;
  if exists (select 1 from app_private.disp_trial_daily where dispatcher_user_id = p_user and report_date = v_date) then return jsonb_build_object('sent', false, 'reason', 'already sent'); end if;

  b := app_private.disp_trial_daily_build(p_user, v_date);
  if coalesce((b->>'skip')::boolean, false) then return jsonb_build_object('sent', false, 'reason', b->>'reason'); end if;

  perform app_private.sys_email(d.email, 'dispatcher.trial.daily', b->>'subject', b->>'html', b->>'text',
    'disp.trial.daily:' || p_user::text || ':' || to_char(v_date, 'YYYYMMDD'));
  insert into app_private.disp_trial_daily (dispatcher_user_id, report_date, trial_day, trial_days, tone, subject, stats, sent_to)
  values (p_user, v_date, (b->>'day')::int, (b->>'days')::int, b->>'tone', b->>'subject', b->'stats', d.email)
  on conflict (dispatcher_user_id, report_date) do nothing;

  if b->>'tone' = 'bad' then
    v_name := app_private.disp_esc(coalesce(nullif(d.full_name,''), 'A trial dispatcher'));
    perform app_private.sys_email(app_private.disp_trial_staff_to(), 'dispatcher.trial.alert',
      'Trial: ' || coalesce(nullif(d.full_name,''), 'dispatcher') || ' had no activity (day ' || (b->>'day') || ' of ' || (b->>'days') || ')',
      '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0f172a"><p><b>' || v_name || '</b> made no calls, sent no e-mails and posted no carrier messages on the last working day. '
        || 'Their daily trial report went out red this morning. Day ' || (b->>'day') || ' of ' || (b->>'days') || ', ' || (b->>'left') || ' working days left.</p>'
        || '<p><a href="https://loadboot.com/app/command-center/#/dispatcher?id=' || p_user::text || '&tab=performance">Open the trial card</a></p></div>',
      coalesce(d.full_name,'Dispatcher') || ' had no activity on the last working day (trial day ' || (b->>'day') || ' of ' || (b->>'days') || ').',
      'disp.trial.alert:zero:' || p_user::text || ':' || to_char(v_date, 'YYYYMMDD'));
  end if;
  return jsonb_build_object('sent', true, 'tone', b->>'tone', 'subject', b->>'subject');
end $fn$;

-- Hourly; acts only in the 8 AM Eastern hour on weekdays. Idempotent per dispatcher per day.
create or replace function app_private.disp_trial_daily_run(p_force boolean default false)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public' as $fn$
declare v_now timestamp := now() at time zone 'America/New_York'; r record; v_res jsonb; v_out jsonb := '[]'::jsonb;
begin
  if not p_force and (extract(hour from v_now) <> 8 or extract(isodow from v_now) > 5) then return jsonb_build_object('ran', false); end if;
  for r in select user_id from app_private.dispatcher_profiles
            where status = 'trial' and blocked_at is null and trial_start <= v_now::date and trial_end >= v_now::date loop
    begin
      v_res := app_private.disp_trial_daily_send(r.user_id, v_now::date);
    exception when others then
      v_res := jsonb_build_object('sent', false, 'error', sqlerrm);
      raise warning 'disp_trial_daily_run % : %', r.user_id, sqlerrm;
    end;
    v_out := v_out || jsonb_build_object('user', r.user_id, 'result', v_res);
  end loop;
  return jsonb_build_object('ran', true, 'results', v_out);
end $fn$;

-- ───────────────────────── help / feedback from the workspace ─────────────────────────
create or replace function public.disp_trial_feedback(p_kind text, p_mood text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public' as $fn$
declare v_uid uuid := auth.uid(); d record; v_note text := nullif(left(btrim(coalesce(p_note,'')), 2000), ''); v_mood text := nullif(lower(btrim(coalesce(p_mood,''))), '');
  v_alert boolean; v_lbl text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select dp.full_name, dp.status, dp.trial_start, dp.trial_end, u.email into d from app_private.dispatcher_profiles dp join auth.users u on u.id = dp.user_id where dp.user_id = v_uid;
  if d.status is null then return jsonb_build_object('ok', false, 'error', 'not a dispatcher'); end if;
  if p_kind not in ('help','feedback','mood') then return jsonb_build_object('ok', false, 'error', 'unknown kind'); end if;
  if p_kind = 'mood' and (v_mood is null or v_mood not in ('smooth','mixed','stuck')) then return jsonb_build_object('ok', false, 'error', 'unknown mood'); end if;
  if p_kind in ('help','feedback') and v_note is null then return jsonb_build_object('ok', false, 'error', 'Write a few words first.'); end if;
  if (select count(*) from app_private.disp_trial_feedback where dispatcher_user_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    return jsonb_build_object('ok', false, 'error', 'Too many messages today. Use Messages or WhatsApp instead.');
  end if;
  -- one mood per report day: a second tap replaces the first
  if p_kind = 'mood' then
    delete from app_private.disp_trial_feedback where dispatcher_user_id = v_uid and kind = 'mood'
      and report_date = (now() at time zone 'America/New_York')::date;
  end if;
  insert into app_private.disp_trial_feedback (dispatcher_user_id, kind, mood, note, report_date)
  values (v_uid, p_kind, case when p_kind = 'mood' then v_mood end, v_note, (now() at time zone 'America/New_York')::date);

  v_alert := p_kind in ('help','feedback') or v_mood = 'stuck';
  if v_alert then
    v_lbl := case when p_kind = 'help' then 'asked for help' when p_kind = 'feedback' then 'sent feedback' else 'tapped "Stuck, call me"' end;
    perform app_private.sys_email(app_private.disp_trial_staff_to(), 'dispatcher.trial.alert',
      'Trial: ' || coalesce(nullif(d.full_name,''), 'dispatcher') || ' ' || v_lbl,
      '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0f172a"><p><b>' || app_private.disp_esc(coalesce(nullif(d.full_name,''), 'A dispatcher')) || '</b> ' || v_lbl
        || ' from the daily trial report' || coalesce(' (trial ' || to_char(d.trial_start, 'FMDD Mon') || ' to ' || to_char(d.trial_end, 'FMDD Mon') || ')', '') || '.</p>'
        || coalesce('<blockquote style="margin:0 0 12px;padding:10px 14px;border-left:3px solid #FC5305;background:#fff7f2">' || replace(app_private.disp_esc(v_note), E'\n', '<br>') || '</blockquote>', '')
        || '<p>Reply to them: ' || app_private.disp_esc(coalesce(d.email,'')) || '</p>'
        || '<p><a href="https://loadboot.com/app/command-center/#/dispatcher?id=' || v_uid::text || '&tab=performance">Open the trial card</a></p></div>',
      coalesce(d.full_name,'Dispatcher') || ' ' || v_lbl || coalesce(': ' || v_note, '') || ' (' || coalesce(d.email,'') || ')',
      'disp.trial.alert:fb:' || v_uid::text || ':' || extract(epoch from clock_timestamp())::bigint::text);
  end if;
  return jsonb_build_object('ok', true, 'alerted', v_alert);
end $fn$;
revoke execute on function public.disp_trial_feedback(text, text, text) from public, anon;
grant execute on function public.disp_trial_feedback(text, text, text) to authenticated;

-- app_private helpers are not callable from the API
revoke execute on function app_private.disp_trial_daily_build(uuid, date), app_private.disp_trial_daily_send(uuid, date),
  app_private.disp_trial_daily_run(boolean), app_private.disp_trial_stats(uuid, timestamptz, timestamptz, timestamptz),
  app_private.disp_carrier_ready(uuid), app_private.disp_trial_staff_to() from public, anon, authenticated;

-- ───────────────────────── catalog (§6) ─────────────────────────
insert into app_private.email_catalog as c
 (key,name,purpose,class,audience_role,trigger_type,trigger_source,cadence,cap_note,stop_condition,preference_group,unsub_allowed,status,replaced_by,cc_deep_link)
values
('dispatcher.trial.daily','Trial daily report','Every working morning during a paid trial: countdown, last-day activity, carrier pending items, loads, scorecard, tip, help + feedback','O','dispatcher','cron',
 'app_private.disp_trial_daily_run (cron lb-disp-trial-daily, 8 AM ET weekdays)','once per working day while on trial','1 per day (unique dispatcher+date)','trial ends, dispatcher leaves trial status, or is blocked',
 'account_critical',false,'live',null,'#/dispatchers'),
('dispatcher.trial.alert','Trial alert to staff','Tells LoadBoot a trial dispatcher had a zero-activity day, asked for help, sent feedback or tapped Stuck','S','staff','event',
 'app_private.disp_trial_daily_send / public.disp_trial_feedback','per event','zero day: 1 per dispatcher per day','trial ends',
 'staff_internal',false,'live',null,'#/dispatchers')
on conflict (key) do update set name = excluded.name, purpose = excluded.purpose, class = excluded.class, audience_role = excluded.audience_role,
  trigger_type = excluded.trigger_type, trigger_source = excluded.trigger_source, cadence = excluded.cadence, cap_note = excluded.cap_note,
  stop_condition = excluded.stop_condition, preference_group = excluded.preference_group, unsub_allowed = excluded.unsub_allowed,
  status = excluded.status, cc_deep_link = excluded.cc_deep_link, updated_at = now();

-- ───────────────────────── schedule ─────────────────────────
do $$ begin
  if exists (select 1 from cron.job where jobname = 'lb-disp-trial-daily') then perform cron.unschedule('lb-disp-trial-daily'); end if;
end $$;
select cron.schedule('lb-disp-trial-daily', '7 * * * *', $c$select app_private.disp_trial_daily_run()$c$);
