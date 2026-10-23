-- bl_match_0566: load matching on dispatch prefs + home base, ranking, email_kit alerts, carrier SMS,
-- max 3 alerts / carrier / 24h. Applied to STAGING 23 Oct 2026 (as 0566 + 0566b; 0566b fix folded in here).
-- Decisions (Yaseen, 23 Oct 2026): geocode home base; no home base -> lanes/equipment only;
-- prefs matches are ALERT ONLY (auto-request stays posted-truck only); cap 3/carrier/24h on email+SMS.

create table if not exists app_private.load_pref_matches (
  carrier_id uuid not null,
  load_id uuid not null references public.loads(id) on delete cascade,
  score numeric not null,
  basis text not null,
  deadhead_mi int,
  created_at timestamptz not null default now(),
  alerted_at timestamptz,
  alert_skip text,
  primary key (carrier_id, load_id));
create index if not exists load_pref_matches_pending on app_private.load_pref_matches (carrier_id) where alerted_at is null and alert_skip is null;
create index if not exists load_pref_matches_alerted on app_private.load_pref_matches (carrier_id, alerted_at);
alter table app_private.load_pref_matches enable row level security;

create or replace function app_private.match_us_states() returns text[] language sql immutable as $$
  select array['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'] $$;

create or replace function app_private.match_state(p text) returns text language sql immutable as $$
  select s from (select upper((regexp_match(btrim(coalesce(p,'')), '([A-Za-z]{2})\.?\s*(\d{5}(-\d{4})?)?\s*$'))[1]) s) x
  where s = any(app_private.match_us_states()) $$;

create or replace function app_private.match_equip(p text) returns text language sql immutable as $$
  select case when nullif(btrim(coalesce(p,'')),'') is null then null
    when p ~* 'reefer|refrig' then 'reefer'
    when p ~* 'conestoga' then 'conestoga'
    when p ~* 'step|drop ?deck' then 'stepdeck'
    when p ~* 'flat' then 'flatbed'
    when p ~* 'hot ?shot' then 'hotshot'
    when p ~* 'power ?only' then 'power_only'
    when p ~* 'sprinter|cargo ?van' then 'cargo_van'
    when p ~* 'box' then 'box_truck'
    when p ~* 'tank' then 'tanker'
    when p ~* 'van' then 'dry_van'
    else lower(btrim(p)) end $$;

-- Lane text is free-form ("IL", "TX-AR-KS", "south", "Akron, OH -> Toledo, OH", "EAST COAST"): states + regions -> state set.
create or replace function app_private.match_lane_states(p text[]) returns text[] language sql immutable as $$
  with t as (select upper(x) x from unnest(coalesce(p,'{}'::text[])) x),
  r(k, st) as (values
    ('EAST\s*COAST', array['ME','NH','MA','RI','CT','NY','NJ','PA','DE','MD','VA','NC','SC','GA','FL']),
    ('WEST\s*COAST', array['CA','OR','WA']),
    ('NORTH\s*EAST', array['ME','NH','VT','MA','RI','CT','NY','NJ','PA']),
    ('SOUTH\s*EAST', array['VA','NC','SC','GA','FL','AL','MS','TN','KY']),
    ('SOUTH\s*WEST', array['AZ','NM','TX','OK','NV']),
    ('NORTH\s*WEST', array['WA','OR','ID','MT','WY']),
    ('MID\s*WEST', array['OH','MI','IN','IL','WI','MN','IA','MO','KS','NE','SD','ND']),
    ('\mSOUTH\M(?!\s*(EAST|WEST))', array['TX','OK','AR','LA','MS','AL','TN','KY','GA','FL','SC','NC','VA','WV']),
    ('\mWEST\M(?!\s*COAST)', array['CA','OR','WA','NV','AZ','UT','ID','MT','WY','CO','NM']),
    ('\mEAST\M(?!\s*COAST)', array['ME','NH','VT','MA','RI','CT','NY','NJ','PA','DE','MD','VA','WV','NC','SC','GA','FL'])),
  codes as (select m[1] s from t, regexp_matches(t.x, '\m([A-Z]{2})\M', 'g') m),
  regs as (select unnest(r.st) s from t join r on t.x ~ r.k)
  select coalesce(array_agg(distinct s), '{}') from (select s from codes union select s from regs) z
  where s = any(app_private.match_us_states()) $$;

-- null = no match. Unknown pref values never filter (only values the carrier set).
create or replace function app_private.dp_load_score(d app_private.carrier_dispatch_prefs, l public.loads)
returns jsonb language plpgsql stable set search_path to 'app_private','public','extensions','pg_temp' as $$
declare v_basis text[] := '{}'; v_eq text; v_rpm numeric; v_w numeric; v_os text; v_ds text; v_lanes text[];
  v_lane boolean := false; v_hlat double precision; v_hlng double precision; v_dh numeric; v_rad int; v_hs text;
  v_pick date; v_band text; v_score numeric;
begin
  if l.status is distinct from 'available' or coalesce(d.available, true) = false then return null; end if;
  if l.equipment is null or coalesce(cardinality(d.preferred_equipment),0) = 0 then return null; end if;
  v_eq := app_private.match_equip(l.equipment);
  if not exists (select 1 from unnest(d.preferred_equipment) e where app_private.match_equip(e) = v_eq) then return null; end if;
  v_basis := v_basis || l.equipment;

  if lower(coalesce(l.hazmat::text,'')) in ('true','t','yes','y','1') and d.hazmat is not true then return null; end if;
  if d.max_weight_lbs is not null then
    begin v_w := nullif(regexp_replace(coalesce(l.weight::text,''), '[^0-9.]', '', 'g'), '')::numeric;
    exception when others then v_w := null; end;
    if v_w > d.max_weight_lbs then return null; end if;
  end if;
  if l.miles is not null then
    if l.miles < d.min_trip_miles or l.miles > d.max_trip_miles then return null; end if;
  end if;
  if l.rate is not null and coalesce(l.miles,0) > 0 then v_rpm := round(l.rate / l.miles, 2); end if;
  if v_rpm < d.min_rpm then return null; end if;
  if l.rate < d.min_total_rate then return null; end if;

  v_os := app_private.match_state(l.origin); v_ds := app_private.match_state(l.destination);
  if exists (select 1 from unnest(coalesce(d.avoid_states,'{}'::text[])) a where upper(btrim(a)) in (v_os, v_ds)) then return null; end if;
  if coalesce(cardinality(d.haul_types),0) > 0 and l.miles is not null then
    v_band := app_private.haul_band(l.miles);
    if v_band is not null and not (v_band = any(d.haul_types)) then return null; end if;
  end if;

  begin v_pick := l.pickup_date::date; exception when others then v_pick := null; end;
  if v_pick is not null then
    if v_pick < current_date then return null; end if;
    if d.min_notice_hours is not null and (v_pick + 1)::timestamptz < now() + make_interval(hours => d.min_notice_hours) then return null; end if;
    if d.weekend_ok = false and extract(isodow from v_pick) in (6,7) then return null; end if;
  end if;

  v_lanes := app_private.match_lane_states(d.preferred_lanes);
  v_lane := cardinality(v_lanes) > 0 and (v_os = any(v_lanes) or v_ds = any(v_lanes));
  v_rad := coalesce(d.max_deadhead_miles, d.operating_radius_miles);
  if nullif(btrim(coalesce(d.home_base,'')),'') is not null then
    select g.lat, g.lng into v_hlat, v_hlng from app_private.geo_resolve(d.home_base) g;
    v_hs := app_private.match_state(d.home_base);
  end if;
  if v_hlat is not null and l.pickup_lat is not null and l.pickup_lng is not null then
    v_dh := round(app_private.haversine_miles(v_hlat, v_hlng, l.pickup_lat, l.pickup_lng)::numeric);
  end if;

  if v_dh is not null and v_rad is not null then
    if v_dh > v_rad then return null; end if;
    v_basis := v_basis || (v_dh::text || ' mi from your home base');
  elsif v_hs is not null and v_os is not null then
    if v_hs <> v_os and not v_lane then return null; end if;
    if v_hs = v_os then v_basis := v_basis || ('pickup in your home state ' || v_hs); end if;
  elsif not v_lane then
    return null;  -- no usable home-base distance and no lane hit
  end if;
  if v_lane then v_basis := v_basis || 'on your lanes'::text; end if;
  if v_rpm is not null then v_basis := v_basis || ('$' || v_rpm::text || '/mi'); end if;

  v_score := case when v_rpm is null then 10
      when d.target_rpm > 0 then 40 * least(v_rpm / d.target_rpm, 1.25) / 1.25
      when d.min_rpm > 0 then 30 * least(v_rpm / d.min_rpm, 1.5) / 1.5
      else 15 end
    + case when v_dh is not null then 30 * greatest(0, 1 - v_dh / coalesce(nullif(v_rad,0), 250)::numeric) else 10 end
    + case when v_lane then 20 else 0 end
    + case when v_rpm is not null and d.cost_per_mile > 0 and v_rpm >= d.cost_per_mile * 1.15 then 10 else 0 end;

  return jsonb_build_object('score', round(v_score,1), 'basis', array_to_string(v_basis, ' · '), 'deadhead', v_dh, 'rpm', v_rpm);
end $$;

create or replace function app_private.match_carrier_user(p_org uuid) returns uuid language sql stable
set search_path to 'app_private','public','pg_temp' as $$
  select om.user_id from public.organization_memberships om
   where om.org_id = p_org and om.status = 'active' and coalesce(om.member_role,'') <> 'driver'
   order by (om.member_role = 'owner') desc, (om.member_role = 'admin') desc, om.created_at limit 1 $$;

create or replace function app_private.match_alerts_24h(p_carrier uuid) returns int language sql stable
set search_path to 'app_private','public','pg_temp' as $$
  select ((select count(*) from app_private.load_pref_matches where carrier_id = p_carrier and alerted_at > now() - interval '24 hours')
        + (select count(*) from app_private.truck_posting_matches m join app_private.truck_postings p on p.id = m.posting_id
            where p.carrier_id = p_carrier and m.notified_at > now() - interval '24 hours'))::int $$;

-- Dynamic per-load text. Switch: email_catalog 'load.match.sms'.sms_enabled (CC > Email texts); same gates as email_sms_note.
create or replace function app_private.match_sms(p_user uuid, p_org uuid, p_body text, p_idem text) returns boolean
language plpgsql security definer set search_path to 'app_private','public','pg_temp' as $$
declare c app_private.email_catalog; v_num text;
begin
  select * into c from app_private.email_catalog where key = 'load.match.sms';
  if not coalesce(c.sms_enabled, false) then return false; end if;
  if app_private.email_sms_allowed(c.class, c.preference_group, c.audience_role) is not null then return false; end if;
  if not coalesce((select x.email_enabled from app_private.doc_sms_config x where x.id = 1), false) then return false; end if;
  if exists (select 1 from public.organizations o where o.id = p_org and coalesce(o.is_demo,false)) then return false; end if;
  select x.e into v_num
    from (select app_private.dial_e164(coalesce(u.raw_user_meta_data->>'phone','')) e from auth.users u where u.id = p_user) x
    join app_private.sms_consent sc on sc.number = x.e and sc.revoked_at is null;
  if v_num is null then return false; end if;
  insert into app_private.doc_sms_queue (org_id, user_id, status, due_at, kind, catalog_key, body, to_number, idem, decisions)
  values (p_org, p_user, 'pending', now(), 'email', 'load.match.sms', p_body, v_num, 'email:' || p_idem, '[]'::jsonb)
  on conflict (idem) where idem is not null do nothing;
  return found;
end $$;

-- One alert = email_kit email + push + SMS to the carrier's owner/admin. Returns true if a user was reached.
create or replace function app_private.match_send_alert(p_carrier uuid, l public.loads, p_kind text, p_basis text, p_extra text)
returns boolean language plpgsql security definer set search_path to 'app_private','public','extensions','pg_temp' as $$
declare v_uid uuid; v_email text; v_key text; v_lane text; v_sub text; v_html text; v_txt text; v_gate jsonb;
  v_url text := '/app/carrier/#loads'; v_rate text; v_rpm text;
begin
  v_uid := app_private.match_carrier_user(p_carrier);
  if v_uid is null then return false; end if;
  select u.email into v_email from auth.users u where u.id = v_uid;
  v_key := case when p_kind = 'posted' then 'load.match.posted_truck' else 'load.match.prefs' end;
  v_lane := coalesce(l.origin,'—') || ' → ' || coalesce(l.destination,'—');
  v_rate := '$' || to_char(l.rate, 'FM999,999,990');
  if l.rate is not null and coalesce(l.miles,0) > 0 then v_rpm := '$' || round(l.rate / l.miles, 2)::text || '/mi'; end if;
  v_sub := 'Load match: ' || v_lane || coalesce(' · ' || v_rate, '');

  begin
    v_html := app_private.email_kit(jsonb_build_object(
      'eyebrow', jsonb_build_object('text', case when p_kind = 'posted' then 'Matches your posted truck' else 'Matches your dispatch preferences' end, 'tone', 'info'),
      'title', v_lane,
      'intro_html', case when p_kind = 'posted' then 'A new load on LoadBoot fits the truck you posted.'
                         else 'A new load on LoadBoot fits the equipment, lanes and rates in your dispatch preferences.' end
                    || coalesce('<br><br><b style="color:#92400e">' || app_private.h_esc(p_extra) || '</b>', ''),
      'facts', jsonb_build_array(
        jsonb_build_object('k','Rate','v', coalesce(v_rate,'—') || coalesce(' · ' || v_rpm, '')),
        jsonb_build_object('k','Miles','v', coalesce(l.miles::text || ' mi','—')),
        jsonb_build_object('k','Equipment','v', coalesce(l.equipment,'—')),
        jsonb_build_object('k','Pickup','v', coalesce(l.pickup_date::text,'—')),
        jsonb_build_object('k','Why you','v', coalesce(nullif(p_basis,''),'—'))),
      'cta', jsonb_build_object('label','Open in LoadBoot','url','https://loadboot.com' || v_url),
      'note', 'We send at most 3 load alerts a day, best matches first. What we match comes from your dispatch preferences.'));
    v_txt := v_lane || E'\n' || coalesce(v_rate,'') || coalesce(' · ' || l.miles::text || ' mi','') || coalesce(' · ' || l.equipment,'')
             || coalesce(E'\n' || p_extra, '') || E'\n\nOpen it: https://loadboot.com' || v_url;
    if v_email is not null then
      v_gate := app_private.email_gate(v_key, v_email, v_uid);
      if coalesce((v_gate->>'allowed')::boolean, true) then
        perform app_private.sys_email(v_email, v_key, v_sub, v_html, v_txt, 'match:' || p_carrier::text || ':' || l.id::text);
      end if;
    end if;
  exception when others then raise warning 'match email failed %: %', l.id, sqlerrm; end;

  begin perform app_private.push_enqueue(v_uid, 'Load match: ' || v_lane, coalesce(v_rate,'') || coalesce(' · ' || v_rpm,''), v_url, 'match-' || p_carrier::text || '-' || l.id::text);
  exception when others then null; end;

  begin
    perform app_private.match_sms(v_uid, p_carrier,
      app_private.sms_clean('Load match: ' || coalesce(l.origin,'?') || ' to ' || coalesce(l.destination,'?') || coalesce(', ' || v_rate,'')
        || coalesce(', ' || l.miles::text || ' mi','') || coalesce(', ' || l.equipment,'') || coalesce(', pickup ' || l.pickup_date::text,'')
        || '. loadboot.com/app/carrier', 230),
      'match-sms:' || p_carrier::text || ':' || l.id::text);
  exception when others then raise warning 'match sms failed %: %', l.id, sqlerrm; end;
  return true;
end $$;

create or replace function app_private.tp_match_new_load(p_load uuid)
returns integer language plpgsql set search_path to 'app_private','public','extensions','pg_temp' as $function$
declare l public.loads; p app_private.truck_postings; d app_private.carrier_dispatch_prefs; v_basis text; v_n int := 0;
        v_exists boolean; v_wk_off boolean; v_r jsonb; v_uid uuid; v_sent boolean;
begin
  select * into l from public.loads where id = p_load and status='available' and not is_demo and target_carrier_org is null;
  if l.id is null then return 0; end if;

  -- 1) Posted trucks (explicit opt-in): immediate, still counts toward the 3/day cap.
  for p in select * from app_private.truck_postings where status='active' and available_to >= current_date loop
    if exists (select 1 from app_private.truck_posting_matches m where m.posting_id=p.id and m.load_id=l.id) then continue; end if;
    v_basis := app_private.tp_load_matches(p, l);
    if v_basis is null then continue; end if;
    v_wk_off := l.pickup_date is not null
      and extract(isodow from l.pickup_date) in (6,7)
      and exists (select 1 from app_private.carrier_dispatch_prefs dd where dd.carrier_id = p.carrier_id and dd.weekend_ok = false);
    if v_wk_off then v_basis := v_basis || ' · weekend pickup — auto-request held (carrier keeps weekends off)'; end if;

    insert into app_private.truck_posting_matches(posting_id, load_id, match_basis, notified_at) values (p.id, l.id, v_basis, null);
    v_n := v_n + 1;
    insert into app_private.notifications(recipient_role, recipient_user, channel, template_key, payload, status, sent_at)
    values ('carrier', p.created_by, 'in_app', 'truck_match',
      jsonb_build_object('title', case when v_wk_off then 'Weekend load matches your truck — your call' else 'New load matches your posted truck' end,
        'body', coalesce(l.origin,'—') || ' → ' || coalesce(l.destination,'—') || ' · $' || coalesce(l.rate,0)::text
                || case when v_wk_off then ' · weekend pickup, so we did not request it for you' else '' end,
        'tone','action','url','/app/carrier/#loads','load_id', l.id), 'sent', now());
    if app_private.match_alerts_24h(p.carrier_id) < 3 then
      v_sent := app_private.match_send_alert(p.carrier_id, l, 'posted', v_basis,
        case when v_wk_off then 'Pickup falls on a weekend and your preferences say weekends off, so we have NOT requested it for you.' end);
      if v_sent then update app_private.truck_posting_matches set notified_at = now() where posting_id=p.id and load_id=l.id; end if;
    end if;
    if p.auto_request and not v_wk_off then
      select exists(select 1 from app_private.load_book_requests r where r.load_id=l.id and r.carrier_org=p.carrier_id) into v_exists;
      if not v_exists then
        insert into app_private.load_book_requests(load_id, carrier_org, carrier_user, broker_org, status, note)
        values (l.id, p.carrier_id, p.created_by, l.broker_org, 'pending', 'Auto-request from posted truck (Post-a-Truck)');
        update app_private.truck_posting_matches set requested=true where posting_id=p.id and load_id=l.id;
      end if;
    end if;
  end loop;

  -- 2) Dispatch prefs + home base: in-app now; email/SMS by match_alert_sweep (ranked, 3/day). Never auto-requests.
  for d in select dp.* from app_private.carrier_dispatch_prefs dp join public.organizations o on o.id = dp.carrier_id
            where coalesce(dp.available, true) and not coalesce(o.is_demo, false) and dp.carrier_id is distinct from l.broker_org loop
    begin
      if exists (select 1 from app_private.truck_posting_matches m join app_private.truck_postings tp on tp.id = m.posting_id
                  where tp.carrier_id = d.carrier_id and m.load_id = l.id) then continue; end if;
      v_r := app_private.dp_load_score(d, l);
      if v_r is null then continue; end if;
      insert into app_private.load_pref_matches(carrier_id, load_id, score, basis, deadhead_mi)
      values (d.carrier_id, l.id, (v_r->>'score')::numeric, v_r->>'basis', (v_r->>'deadhead')::numeric::int)
      on conflict do nothing;
      if not found then continue; end if;
      v_n := v_n + 1;
      v_uid := app_private.match_carrier_user(d.carrier_id);
      if v_uid is not null then
        insert into app_private.notifications(recipient_role, recipient_user, channel, template_key, payload, status, sent_at)
        values ('carrier', v_uid, 'in_app', 'load_match_prefs',
          jsonb_build_object('title','New load fits your preferences',
            'body', coalesce(l.origin,'—') || ' → ' || coalesce(l.destination,'—') || ' · $' || coalesce(l.rate,0)::text || ' · ' || (v_r->>'basis'),
            'tone','action','url','/app/carrier/#loads','load_id', l.id), 'sent', now());
      end if;
    exception when others then raise warning 'pref match failed carrier % load %: %', d.carrier_id, l.id, sqlerrm; end;
  end loop;
  return v_n;
end; $function$;

create or replace function app_private.match_alert_sweep() returns int
language plpgsql security definer set search_path to 'app_private','public','extensions','pg_temp' as $$
declare c record; m record; l public.loads; v_left int; v_n int := 0;
begin
  update app_private.load_pref_matches pm set alert_skip = 'load no longer available'
   where alerted_at is null and alert_skip is null
     and not exists (select 1 from public.loads x where x.id = pm.load_id and x.status = 'available');
  update app_private.load_pref_matches set alert_skip = 'below alert score'
   where alerted_at is null and alert_skip is null and score < 40;
  update app_private.load_pref_matches set alert_skip = 'daily cap reached for 24h'
   where alerted_at is null and alert_skip is null and created_at < now() - interval '24 hours';
  for c in select distinct carrier_id from app_private.load_pref_matches where alerted_at is null and alert_skip is null loop
    v_left := 3 - app_private.match_alerts_24h(c.carrier_id);
    continue when v_left <= 0;
    for m in select * from app_private.load_pref_matches
              where carrier_id = c.carrier_id and alerted_at is null and alert_skip is null
              order by score desc, created_at limit v_left loop
      select * into l from public.loads where id = m.load_id;
      if app_private.match_send_alert(m.carrier_id, l, 'prefs', m.basis, null) then
        update app_private.load_pref_matches set alerted_at = now() where carrier_id = m.carrier_id and load_id = m.load_id;
        v_n := v_n + 1;
      else
        update app_private.load_pref_matches set alert_skip = 'no active owner/admin user' where carrier_id = m.carrier_id and load_id = m.load_id;
      end if;
    end loop;
  end loop;
  return v_n;
end $$;

-- Catalog rows (copied from load.match.posted_truck so required columns match). SMS ships OFF.
insert into app_private.email_catalog
select (jsonb_populate_record(null::app_private.email_catalog, to_jsonb(c) || jsonb_build_object(
  'key','load.match.prefs','name','Load match: dispatch preferences',
  'purpose','A newly posted load fits a carrier''s dispatch preferences / home base. Ranked, max 3 alerts per carrier per 24h (bl_match_0566).',
  'sends_total',0,'sends_30d',0,'sms_enabled',false,'sms_text',null,'created_at',now(),'updated_at',now()))).*
from app_private.email_catalog c where c.key = 'load.match.posted_truck'
on conflict (key) do nothing;
insert into app_private.email_catalog
select (jsonb_populate_record(null::app_private.email_catalog, to_jsonb(c) || jsonb_build_object(
  'key','load.match.sms','name','Load match: carrier text',
  'purpose','Switch for the per-load match text (lane, rate, miles). The text is built per load; sms_text below is only the switch label. Counts in the 3/day cap.',
  'sends_total',0,'sends_30d',0,'sms_enabled',false,'sms_text','New load matches your truck. Open LoadBoot to see it.','created_at',now(),'updated_at',now()))).*
from app_private.email_catalog c where c.key = 'load.match.posted_truck'
on conflict (key) do nothing;

-- Home bases into the existing geocoder.
create or replace function app_private.tg_prefs_home_geo() returns trigger language plpgsql security definer
set search_path to 'app_private','public','pg_temp' as $$
begin
  if nullif(btrim(coalesce(new.home_base,'')),'') is not null and (tg_op = 'INSERT' or new.home_base is distinct from old.home_base) then
    begin perform app_private.geo_enqueue(new.home_base, 'dispatch_prefs'); exception when others then null; end;
  end if;
  return new;
end $$;
drop trigger if exists prefs_home_geo on app_private.carrier_dispatch_prefs;
create trigger prefs_home_geo after insert or update of home_base on app_private.carrier_dispatch_prefs
  for each row execute function app_private.tg_prefs_home_geo();

do $$ declare r record; begin
  for r in select distinct home_base from app_private.carrier_dispatch_prefs
            where nullif(btrim(coalesce(home_base,'')),'') is not null
              and not exists (select 1 from app_private.geo_resolve(home_base)) loop
    begin perform app_private.geo_enqueue(r.home_base, 'dispatch_prefs'); exception when others then null; end;
  end loop;
end $$;

select cron.schedule('lb-match-alerts', '*/10 * * * *', $$select app_private.match_alert_sweep()$$);
