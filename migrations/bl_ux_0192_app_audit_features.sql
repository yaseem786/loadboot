-- bl_ux_0192 — 2026-08-16 app-audit backend features (owner-approved).
-- APPLIED: staging (snslhvmkjusozgjelghi) + production (rwscphuhpjoudvljvmdk) on 2026-08-16.
-- Anon-executable SECURITY DEFINER surface verified unchanged after apply (staging 26 / prod 27).
--
-- A) app_private.fuel_prices + public.fuel_prices_get()  — DOE/EIA weekly regional diesel
--    (auto-refreshed by the "LoadBoot weekly diesel prices refresh" scheduled task, Tue 16:00 UTC)
-- B) app_private.user_devices + public.device_seen()/my_devices()  — signed-in device list
-- C) app_private.facility_reviews + public.facility_review_submit()/facility_ratings()
-- D) cc_carrier_view_poster now also returns avg_days_to_pay + paid_transfers
--    (broker pay-speed computed from our OWN app_private.pay_transfers records)
-- All new RPCs: SECURITY DEFINER, EXECUTE revoked from public/anon, granted to authenticated + service_role.

create table if not exists app_private.fuel_prices (
  region text primary key,
  diesel_usd_gal numeric(6,3) not null,
  as_of date not null,
  updated_at timestamptz not null default now()
);

insert into app_private.fuel_prices (region, diesel_usd_gal, as_of) values
  ('US average', 5.257, '2026-08-10'),
  ('East Coast', 5.193, '2026-08-10'),
  ('New England', 5.514, '2026-08-10'),
  ('Central Atlantic', 5.535, '2026-08-10'),
  ('Lower Atlantic', 5.034, '2026-08-10'),
  ('Midwest', 5.181, '2026-08-10'),
  ('Gulf Coast', 5.044, '2026-08-10'),
  ('Rocky Mountain', 5.271, '2026-08-10'),
  ('West Coast', 6.033, '2026-08-10'),
  ('California', 6.618, '2026-08-10')
on conflict (region) do update set diesel_usd_gal = excluded.diesel_usd_gal, as_of = excluded.as_of, updated_at = now();

create or replace function public.fuel_prices_get()
returns jsonb
language sql stable security definer
set search_path to 'app_private, public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object('region', region, 'diesel', diesel_usd_gal, 'as_of', as_of)
         order by case when region = 'US average' then 0 else 1 end, region), '[]'::jsonb)
  from app_private.fuel_prices;
$$;
revoke execute on function public.fuel_prices_get() from public, anon;
grant execute on function public.fuel_prices_get() to authenticated, service_role;

create table if not exists app_private.user_devices (
  user_id uuid not null,
  device_key text not null,
  label text,
  ua text,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, device_key)
);

create or replace function public.device_seen(p_key text, p_label text default null, p_ua text default null)
returns void
language plpgsql volatile security definer
set search_path to 'app_private, public'
as $$
begin
  if auth.uid() is null then raise exception 'auth required' using errcode = '42501'; end if;
  if p_key is null or length(p_key) < 8 or length(p_key) > 80 then raise exception 'bad device key'; end if;
  insert into app_private.user_devices (user_id, device_key, label, ua)
  values (auth.uid(), p_key, left(coalesce(p_label, ''), 80), left(coalesce(p_ua, ''), 300))
  on conflict (user_id, device_key)
  do update set last_seen = now(), label = excluded.label, ua = excluded.ua;
  delete from app_private.user_devices ud
   where ud.user_id = auth.uid()
     and ud.device_key not in (
       select d.device_key from app_private.user_devices d
        where d.user_id = auth.uid() order by d.last_seen desc limit 10);
end $$;
revoke execute on function public.device_seen(text, text, text) from public, anon;
grant execute on function public.device_seen(text, text, text) to authenticated, service_role;

create or replace function public.my_devices()
returns jsonb
language sql stable security definer
set search_path to 'app_private, public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'device_key', device_key, 'label', label, 'ua', ua,
           'created_at', created_at, 'last_seen', last_seen)
         order by last_seen desc), '[]'::jsonb)
  from app_private.user_devices where user_id = auth.uid();
$$;
revoke execute on function public.my_devices() from public, anon;
grant execute on function public.my_devices() to authenticated, service_role;

create table if not exists app_private.facility_reviews (
  id uuid primary key default gen_random_uuid(),
  facility_key text not null,
  trip_id uuid not null,
  reviewer_org uuid not null,
  kind text not null check (kind in ('pickup','delivery')),
  stars int not null check (stars between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique (trip_id, kind)
);
create index if not exists facility_reviews_key_idx on app_private.facility_reviews (facility_key);

create or replace function public.facility_review_submit(p_trip uuid, p_kind text, p_stars int, p_comment text default null)
returns void
language plpgsql volatile security definer
set search_path to 'app_private, public'
as $$
declare v_org uuid; v_key text;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'carrier session required' using errcode = '42501'; end if;
  if p_kind not in ('pickup','delivery') then raise exception 'kind must be pickup or delivery'; end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then raise exception 'stars must be 1-5'; end if;
  select lower(trim(case when p_kind = 'pickup' then l.origin else l.destination end)) into v_key
    from app_private.trips t join public.loads l on l.id = t.load_id
   where t.id = p_trip and t.carrier_id = v_org and t.status in ('delivered','invoiced');
  if v_key is null or v_key = '' then raise exception 'trip not found, not yours, or not delivered yet'; end if;
  insert into app_private.facility_reviews (facility_key, trip_id, reviewer_org, kind, stars, comment)
  values (v_key, p_trip, v_org, p_kind, p_stars, left(coalesce(p_comment, ''), 500))
  on conflict (trip_id, kind)
  do update set stars = excluded.stars, comment = excluded.comment, created_at = now();
end $$;
revoke execute on function public.facility_review_submit(uuid, text, int, text) from public, anon;
grant execute on function public.facility_review_submit(uuid, text, int, text) to authenticated, service_role;

create or replace function public.facility_ratings(p_keys text[])
returns jsonb
language plpgsql stable security definer
set search_path to 'app_private, public'
as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'auth required' using errcode = '42501'; end if;
  select coalesce(jsonb_object_agg(x.facility_key, jsonb_build_object('avg', x.a, 'n', x.n)), '{}'::jsonb) into v
  from (
    select fr.facility_key, round(avg(fr.stars)::numeric, 1) as a, count(*) as n
      from app_private.facility_reviews fr
     where fr.facility_key = any (select lower(trim(k)) from unnest(coalesce(p_keys, '{}')) as k)
     group by fr.facility_key
  ) x;
  return v;
end $$;
revoke execute on function public.facility_ratings(text[]) from public, anon;
grant execute on function public.facility_ratings(text[]) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cc_carrier_view_poster(p_load uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare v_broker uuid; v_posted int; v_covered int; v_del int; v_ontime int; v_sched int; v_tp jsonb; v_dtp numeric; v_dtp_n int;
begin
  if app_private.my_carrier_org() is null and not public.is_active_staff() then
    raise exception 'carrier session required' using errcode='42501'; end if;
  select pl.broker_org into v_broker from app_private.partner_loads pl
    join public.loads l on l.id = pl.posted_load_id where l.id = p_load and l.status = 'available' limit 1;
  if v_broker is null then
    return jsonb_build_object('posted_by','LoadBoot dispatch','signal','direct LoadBoot post — terms enforced at post time','basis','no external posting party');
  end if;
  select count(*), count(*) filter (where pl2.posted_load_id is not null) into v_posted, v_covered
    from app_private.partner_loads pl2 where pl2.broker_org = v_broker;
  select count(*) filter (where t.status in ('delivered','invoiced')),
         count(*) filter (where t.status in ('delivered','invoiced') and t.scheduled_delivery is not null and t.delivered_at <= t.scheduled_delivery),
         count(*) filter (where t.status in ('delivered','invoiced') and t.scheduled_delivery is not null)
    into v_del, v_ontime, v_sched
    from app_private.trips t join public.loads l on l.id = t.load_id
    join app_private.partner_loads pl3 on pl3.posted_load_id = l.id where pl3.broker_org = v_broker;
  v_tp := public.cc_trust_profile(v_broker);
  select round(avg(extract(epoch from pt.received_at - pt.created_at) / 86400)::numeric, 1), count(*)
    into v_dtp, v_dtp_n
    from app_private.pay_transfers pt
   where pt.payer_org = v_broker and pt.received_at is not null;
  return jsonb_build_object('posted_by','Broker partner',
    'loads_submitted', v_posted, 'loads_posted_to_board', v_covered, 'loads_delivered', v_del,
    'on_time_pct', case when v_sched > 0 then round(v_ontime::numeric / v_sched * 100) else null end,
    'broker_verified', (v_tp->>'verified')::boolean, 'broker_trust_score', (v_tp->>'trust_score')::int, 'broker_rating', (v_tp->>'rating')::numeric,
    'avg_days_to_pay', v_dtp, 'paid_transfers', coalesce(v_dtp_n, 0),
    'basis', 'this posting party''s real history on LoadBoot; identity stays hidden');
end; $function$;
