-- =====================================================================================
-- bl_gaps_0259_0265 — carrier data-flow audit: the remaining gaps, closed
-- Applied 2026-08-22 to STAGING (snslhvmkjusozgjelghi) then PROD (rwscphuhpjoudvljvmdk)
-- as these named migrations:
--   bl_geo_0259_geocode_cache            · bl_geo_0259b_zip_validation
--   bl_match_0260_deadhead_and_equipment_detail
--   bl_comm_0261_weekly_summary_and_announcement_prefs (+0261b/c fixes)
--   bl_match_0262_equipment_classes
--   bl_match_0263_compatible_equipment_and_domicile (+0263b domicile prefers city)
--   bl_geo_0264_city_key_priority_and_load_places
--   bl_geo_0265_loads_geocode_on_post
-- This file is the consolidated, idempotent record. Everything is create-or-replace.
--
-- What it closes (from loadboot-carrier-data-audit.md):
--  1. deadhead / max_deadhead_miles / operating_radius_miles / home_base were collected
--     but cc_match_rank said "deadhead unavailable" — now real miles from a real position.
--  2. truck_postings.origin_lat/lng were 0/12 populated — now filled from the geocode cache.
--  3. equipment matching was exact string equality, so a Hotshot truck could never take a
--     Flatbed load — now class-based with real-world equivalents.
--  4. carrier_dispatch_prefs.equipment_detail was write-only — now shown in CC + match notes.
--  5. comm_preferences.product_announcements was ignored by the announcement sender.
--  6. comm_preferences.weekly_summaries had no sender at all — now there is one (off by default).
-- =====================================================================================

-- ------------------------------------------------------------------ 1. geocode cache
create table if not exists app_private.geo_places (
  place_key   text primary key,
  query       text not null,
  lat         numeric,
  lng         numeric,
  status      text not null default 'pending' check (status in ('pending','sent','ok','failed')),
  attempts    int  not null default 0,
  request_id  bigint,
  source      text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists geo_places_status_idx on app_private.geo_places(status);

create or replace function app_private.geo_state_abbr(p text)
returns text language sql immutable
set search_path to 'app_private, public' as $$
  select case lower(btrim(coalesce(p,'')))
    when 'alabama' then 'AL' when 'alaska' then 'AK' when 'arizona' then 'AZ'
    when 'arkansas' then 'AR' when 'california' then 'CA' when 'colorado' then 'CO'
    when 'connecticut' then 'CT' when 'delaware' then 'DE' when 'florida' then 'FL'
    when 'georgia' then 'GA' when 'hawaii' then 'HI' when 'idaho' then 'ID'
    when 'illinois' then 'IL' when 'indiana' then 'IN' when 'iowa' then 'IA'
    when 'kansas' then 'KS' when 'kentucky' then 'KY' when 'louisiana' then 'LA'
    when 'maine' then 'ME' when 'maryland' then 'MD' when 'massachusetts' then 'MA'
    when 'michigan' then 'MI' when 'minnesota' then 'MN' when 'mississippi' then 'MS'
    when 'missouri' then 'MO' when 'montana' then 'MT' when 'nebraska' then 'NE'
    when 'nevada' then 'NV' when 'new hampshire' then 'NH' when 'new jersey' then 'NJ'
    when 'new mexico' then 'NM' when 'new york' then 'NY' when 'north carolina' then 'NC'
    when 'north dakota' then 'ND' when 'ohio' then 'OH' when 'oklahoma' then 'OK'
    when 'oregon' then 'OR' when 'pennsylvania' then 'PA' when 'rhode island' then 'RI'
    when 'south carolina' then 'SC' when 'south dakota' then 'SD' when 'tennessee' then 'TN'
    when 'texas' then 'TX' when 'utah' then 'UT' when 'vermont' then 'VT'
    when 'virginia' then 'VA' when 'washington' then 'WA' when 'west virginia' then 'WV'
    when 'wisconsin' then 'WI' when 'wyoming' then 'WY' when 'district of columbia' then 'DC'
    else null end;
$$;

-- "City, ST" wins over ZIP: Photon resolves cities reliably and bare US ZIPs badly.
create or replace function app_private.geo_key(p_in text)
returns text language plpgsql immutable
set search_path to 'app_private, public' as $$
declare s text; z text; m text[]; st text;
begin
  s := btrim(regexp_replace(coalesce(p_in,''), '\s+', ' ', 'g'));
  if s = '' then return null; end if;
  m := regexp_match(s, '([A-Za-z][A-Za-z .''-]*),\s*([A-Za-z]{2})(?:[\s,]|$)');
  if m is not null then return upper(btrim(m[1])) || ', ' || upper(m[2]); end if;
  m := regexp_match(s, '([A-Za-z][A-Za-z .''-]*),\s*([A-Za-z][A-Za-z ]+?)\s*$');
  if m is not null then
    st := app_private.geo_state_abbr(btrim(m[2]));
    if st is not null then return upper(btrim(m[1])) || ', ' || st; end if;
  end if;
  z := (regexp_match(s, '(\d{5})(?:-\d{4})?\s*$'))[1];
  if z is not null then return 'ZIP ' || z; end if;
  return null;
end $$;

create or replace function app_private.geo_urlenc(p text)
returns text language sql immutable
set search_path to 'app_private, public' as $$
  select coalesce(string_agg(
           case when ch ~ '[A-Za-z0-9_.~-]' then ch
                else '%' || upper(lpad(to_hex(ascii(ch)), 2, '0')) end, ''), '')
  from regexp_split_to_table(regexp_replace(coalesce(p,''), '[^ -~]', '', 'g'), '') ch;
$$;

create or replace function app_private.geo_resolve(p_in text)
returns table(lat numeric, lng numeric)
language sql stable security definer
set search_path to 'app_private, public' as $$
  select g.lat, g.lng from app_private.geo_places g
  where g.place_key = app_private.geo_key(p_in)
    and g.status = 'ok' and g.lat is not null and g.lng is not null
  limit 1;
$$;

create or replace function app_private.geo_learn(p_in text, p_lat numeric, p_lng numeric, p_source text default 'seed')
returns text language plpgsql security definer
set search_path to 'app_private, public' as $$
declare k text;
begin
  k := app_private.geo_key(p_in);
  if k is null or p_lat is null or p_lng is null then return null; end if;
  insert into app_private.geo_places as g (place_key, query, lat, lng, status, source)
  values (k, k, p_lat, p_lng, 'ok', p_source)
  on conflict (place_key) do update
     set lat = excluded.lat, lng = excluded.lng, status = 'ok',
         source = coalesce(g.source, excluded.source), updated_at = now()
   where g.status <> 'ok';
  return k;
end $$;

create or replace function app_private.geo_enqueue(p_in text, p_source text default null)
returns text language plpgsql security definer
set search_path to 'app_private, public' as $$
declare k text; q text;
begin
  k := app_private.geo_key(p_in);
  if k is null then return null; end if;
  if k like 'ZIP %' then q := substring(k from 5) || ', USA';
  else q := initcap(btrim(split_part(k, ',', 1))) || ', ' || btrim(split_part(k, ',', 2)) || ', USA';
  end if;
  insert into app_private.geo_places (place_key, query, source)
  values (k, q, p_source) on conflict (place_key) do nothing;
  return k;
end $$;

create or replace function app_private.geo_seed_from_history()
returns int language plpgsql security definer
set search_path to 'app_private, public' as $$
declare r record; n int := 0;
begin
  for r in
    select coalesce(origin_full, origin) txt, pickup_lat::numeric la, pickup_lng::numeric ln
      from public.loads where pickup_lat is not null and coalesce(origin_full, origin) is not null
    union all
    select coalesce(destination_full, destination), delivery_lat::numeric, delivery_lng::numeric
      from public.loads where delivery_lat is not null and coalesce(destination_full, destination) is not null
    union all
    select coalesce(origin_full, origin), pickup_lat::numeric, pickup_lng::numeric
      from app_private.partner_loads where pickup_lat is not null and coalesce(origin_full, origin) is not null
    union all
    select coalesce(destination_full, destination), delivery_lat::numeric, delivery_lng::numeric
      from app_private.partner_loads where delivery_lat is not null and coalesce(destination_full, destination) is not null
  loop
    if app_private.geo_learn(r.txt, r.la, r.ln, 'history') is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

create or replace function app_private.geo_dispatch(p_limit int default 25)
returns int language plpgsql security definer
set search_path to 'app_private, public' as $$
declare r record; n int := 0; rid bigint;
begin
  for r in select * from app_private.geo_places
            where status = 'pending' and attempts < 3
            order by created_at limit greatest(1, coalesce(p_limit, 25))
  loop
    begin
      select net.http_get('https://photon.komoot.io/api/?limit=1&lang=en&bbox=-125,24,-66.5,49.6&q='
        || app_private.geo_urlenc(r.query)) into rid;
      update app_private.geo_places
         set status='sent', request_id=rid, attempts=attempts+1, sent_at=now(), updated_at=now()
       where place_key = r.place_key;
      n := n + 1;
    exception when others then
      update app_private.geo_places
         set attempts = attempts + 1,
             status = case when attempts + 1 >= 3 then 'failed' else 'pending' end, updated_at = now()
       where place_key = r.place_key;
    end;
  end loop;
  return n;
end $$;

-- a geocoder answer is only accepted when it comes back as the place we asked for
create or replace function app_private.geo_harvest()
returns int language plpgsql security definer
set search_path to 'app_private, public' as $$
declare r record; n int := 0; j jsonb; f jsonb; c jsonb; ok boolean;
begin
  for r in select * from app_private.geo_places where status='sent' and request_id is not null
  loop
    begin
      j := null;
      select case when x.status_code = 200 and x.content is not null then x.content::jsonb else null end
        into j from net._http_response x where x.id = r.request_id;
    exception when others then j := null;
    end;

    if j is null then
      if r.sent_at is not null and r.sent_at < now() - interval '30 minutes' then
        update app_private.geo_places
           set status = case when attempts >= 3 then 'failed' else 'pending' end,
               request_id = null, updated_at = now()
         where place_key = r.place_key;
      end if;
      continue;
    end if;

    f := j->'features'->0;
    c := f->'geometry'->'coordinates';
    ok := c is not null and jsonb_typeof(c) = 'array' and jsonb_array_length(c) = 2
          and upper(coalesce(f->'properties'->>'countrycode','US')) = 'US';
    if ok and r.place_key like 'ZIP %' then
      ok := coalesce(f->'properties'->>'postcode','') = substring(r.place_key from 5);
    end if;
    if ok and r.place_key not like 'ZIP %' then
      ok := app_private.geo_state_abbr(coalesce(f->'properties'->>'state','')) is not distinct from
            btrim(split_part(r.place_key, ',', 2))
         or coalesce(f->'properties'->>'state','') = btrim(split_part(r.place_key, ',', 2));
    end if;

    if ok then
      update app_private.geo_places
         set lng = (c->>0)::numeric, lat = (c->>1)::numeric,
             status = 'ok', source = coalesce(source, 'photon'), updated_at = now()
       where place_key = r.place_key;
      n := n + 1;
    else
      update app_private.geo_places
         set status = case when attempts >= 3 then 'failed' else 'pending' end,
             request_id = null, updated_at = now()
       where place_key = r.place_key;
    end if;
  end loop;
  return n;
end $$;

create or replace function app_private.geo_fill_truck_postings()
returns int language plpgsql security definer
set search_path to 'app_private, public' as $$
declare r record; n int := 0; g record;
begin
  for r in select id, origin from app_private.truck_postings
            where origin is not null and (origin_lat is null or origin_lng is null)
  loop
    select * into g from app_private.geo_resolve(r.origin);
    if g.lat is not null then
      update app_private.truck_postings set origin_lat = g.lat, origin_lng = g.lng where id = r.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function app_private.geo_enqueue_load_places(p_limit int default 200)
returns int language plpgsql security definer
set search_path to 'app_private, public' as $$
declare r record; n int := 0;
begin
  for r in
    select coalesce(origin_full, origin) txt from public.loads
     where coalesce(origin_full, origin) is not null and pickup_lat is null
       and created_at > now() - interval '120 days'
    union
    select coalesce(destination_full, destination) from public.loads
     where coalesce(destination_full, destination) is not null and delivery_lat is null
       and created_at > now() - interval '120 days'
    limit greatest(1, coalesce(p_limit, 200))
  loop
    if app_private.geo_enqueue(r.txt, 'load') is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

create or replace function app_private.geo_tick()
returns jsonb language plpgsql security definer
set search_path to 'app_private, public' as $$
declare h int; d int; f int; q int;
begin
  h := app_private.geo_harvest();
  f := app_private.geo_fill_truck_postings();
  q := app_private.geo_enqueue_load_places(200);
  d := app_private.geo_dispatch(25);
  return jsonb_build_object('harvested', h, 'filled_postings', f, 'queued_loads', q, 'dispatched', d);
end $$;

create or replace function app_private.truck_domicile_text(p_city text, p_state text, p_zip text)
returns text language sql immutable
set search_path to 'app_private, public' as $$
  select coalesce(nullif(btrim(coalesce(p_city,'')||', '||coalesce(p_state,'')), ', '),
                  nullif(btrim(coalesce(p_zip,'')),''));
$$;

create or replace function app_private.geo_enqueue_trg()
returns trigger language plpgsql security definer
set search_path to 'app_private, public' as $$
begin
  begin
    if tg_table_name = 'carrier_dispatch_prefs' then
      perform app_private.geo_enqueue(new.home_base, 'prefs');
    elsif tg_table_name = 'truck_postings' then
      perform app_private.geo_enqueue(new.origin, 'truck_posting');
    elsif tg_table_name = 'fleet_trucks' then
      perform app_private.geo_enqueue(
        app_private.truck_domicile_text(new.domicile_city, new.domicile_state, new.domicile_zip), 'truck_domicile');
    end if;
  exception when others then null;  -- never block the carrier's save
  end;
  return new;
end $$;

create or replace function app_private.geo_loads_trg()
returns trigger language plpgsql security definer
set search_path to 'app_private, public' as $$
declare k1 text; k2 text;
begin
  begin
    if new.pickup_lat is null then
      k1 := app_private.geo_enqueue(coalesce(new.origin_full, new.origin), 'load');
    else
      perform app_private.geo_learn(coalesce(new.origin_full, new.origin), new.pickup_lat::numeric, new.pickup_lng::numeric, 'load');
    end if;
    if new.delivery_lat is null then
      k2 := app_private.geo_enqueue(coalesce(new.destination_full, new.destination), 'load');
    else
      perform app_private.geo_learn(coalesce(new.destination_full, new.destination), new.delivery_lat::numeric, new.delivery_lng::numeric, 'load');
    end if;
    if k1 is not null or k2 is not null then perform app_private.geo_dispatch(4); end if;
  exception when others then null;  -- never block a load post
  end;
  return new;
end $$;

drop trigger if exists trg_geo_prefs on app_private.carrier_dispatch_prefs;
create trigger trg_geo_prefs after insert or update of home_base
  on app_private.carrier_dispatch_prefs for each row execute function app_private.geo_enqueue_trg();

drop trigger if exists trg_geo_truck_posting on app_private.truck_postings;
create trigger trg_geo_truck_posting after insert or update of origin
  on app_private.truck_postings for each row execute function app_private.geo_enqueue_trg();

drop trigger if exists trg_geo_truck_domicile on app_private.fleet_trucks;
create trigger trg_geo_truck_domicile after insert or update of domicile_zip, domicile_city, domicile_state
  on app_private.fleet_trucks for each row execute function app_private.geo_enqueue_trg();

drop trigger if exists trg_geo_loads on public.loads;
create trigger trg_geo_loads after insert or update of origin, origin_full, destination, destination_full, pickup_lat, delivery_lat
  on public.loads for each row execute function app_private.geo_loads_trg();

-- backfill (free from history first, then the geocoder for what is left)
select app_private.geo_seed_from_history();
select app_private.geo_enqueue_load_places(200);
select app_private.geo_enqueue(home_base, 'prefs') from app_private.carrier_dispatch_prefs where home_base is not null;
select app_private.geo_enqueue(origin, 'truck_posting') from app_private.truck_postings where origin is not null;
select app_private.geo_enqueue(app_private.truck_domicile_text(domicile_city, domicile_state, domicile_zip), 'truck_domicile') from app_private.fleet_trucks;

select cron.unschedule('geo_tick') where exists (select 1 from cron.job where jobname='geo_tick');
select cron.schedule('geo_tick', '*/2 * * * *', $cron$select app_private.geo_tick();$cron$);

revoke all on app_private.geo_places from public, anon, authenticated;
do $g$
declare r record;
begin
  for r in select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app_private' and (p.proname like 'geo\_%' or p.proname = 'truck_domicile_text')
  loop execute 'revoke all on function ' || r.sig || ' from public, anon'; end loop;
end $g$;

-- ------------------------------------------------------- 2. equipment class matching
create or replace function app_private.equip_class(p text)
returns text language sql immutable
set search_path to 'app_private, public' as $$
  select case
    when s is null or s = '' then null
    when s ~ '(car|auto)\s*(hauler|carrier|transport)' then 'car_hauler'
    when s ~ '(tanker|tank\b|liquid bulk)'            then 'tanker'
    when s ~ '(dump)'                                  then 'dump'
    when s ~ '(hopper|pneumatic|grain)'                then 'hopper'
    when s ~ '(container|drayage|intermodal|chassis)'  then 'container'
    when s ~ '(power[ -]?only|^po$|tractor only|bobtail)' then 'power_only'
    when s ~ '(sprinter|cargo\s*van|cargovan)'         then 'sprinter'
    when s ~ '(box\s*truck|boxtruck|^box$|straight\s*truck|^straight$|cube)' then 'box'
    when s ~ '(reefer|refrigerat|refer\b|temp)'        then 'reefer'
    when s ~ '(flat\s*-?\s*bed|^flat$|^fb$|hot\s*-?\s*shot|hotshot|step\s*-?\s*deck|stepdeck|^sd$|drop\s*deck|dropdeck|double\s*drop|rgn|removable gooseneck|low\s*-?\s*boy|lowboy|conestoga|curtain|^deck$|gooseneck)' then 'flatbed'
    when s ~ '(dry\s*van|dryvan|^van$|^dv$|^v$|enclosed)' then 'van'
    else null end
  from (select nullif(btrim(lower(coalesce(p,''))), '') s) q;
$$;

create or replace function app_private.equip_serves(p_load text, p_truck text)
returns boolean language sql immutable
set search_path to 'app_private, public' as $$
  select case
    when p_load is null or btrim(p_load) = '' then true
    when lower(btrim(p_load)) = lower(btrim(coalesce(p_truck,''))) then true
    when lc is null or tc is null then false
    when lc = tc then true
    when lc = 'sprinter' and tc in ('box','van')  then true   -- bigger enclosed unit takes a smaller load
    when lc = 'box'      and tc = 'van'           then true
    when lc = 'power_only' and tc in ('flatbed','van','reefer','container') then true
    else false end
  from (select app_private.equip_class(p_load) lc, app_private.equip_class(p_truck) tc) q;
$$;

create or replace function app_private.match_eligibility(p_load uuid)
returns table(carrier_id uuid, carrier text, eligible boolean, hard_fails text[], missing_data text[],
              compliant boolean, trucks integer, active_trips integer, available_trucks integer,
              drivers integer, available_drivers integer, equipment_match text)
language plpgsql stable security definer
set search_path to 'app_private', 'public'
as $function$
declare v_equip text;
begin
  if not exists (select 1 from public.loads where id=p_load) then raise exception 'load not found' using errcode='22023'; end if;
  select equipment into v_equip from public.loads where id=p_load;
  return query
  with c as (
    select o.id, o.name, coalesce(o.status,'') ostatus, coalesce(o.broker_visible,false) bvis,
      app_private.carrier_mandatory_ok(o.id) compliant,
      (select count(*) from app_private.fleet_trucks t where t.carrier_id=o.id and coalesce(t.status,'active')<>'inactive')::int trucks,
      (select count(*) from app_private.fleet_trucks t where t.carrier_id=o.id and coalesce(t.status,'active')<>'inactive'
          and (v_equip is null or lower(trim(t.equipment))=lower(trim(v_equip))))::int exact_trucks,
      (select count(*) from app_private.fleet_trucks t where t.carrier_id=o.id and coalesce(t.status,'active')<>'inactive'
          and app_private.equip_serves(v_equip, t.equipment))::int equip_trucks,
      (select count(*) from app_private.fleet_drivers d where d.carrier_id=o.id)::int drivers,
      (select count(*) from app_private.fleet_drivers d where d.carrier_id=o.id and coalesce(d.status,'active')='active'
          and (d.license_exp is null or d.license_exp>=current_date) and (d.medical_exp is null or d.medical_exp>=current_date))::int avail_drivers,
      (select count(*) from app_private.trips t where t.carrier_id=o.id and t.status in ('planned','dispatched','in_transit'))::int active_trips
    from public.organizations o where o.kind='carrier' and coalesce(o.status,'') <> 'archived'
  )
  select c.id, c.name,
    (coalesce(array_length(e.hf,1),0)=0) as eligible,
    e.hf, e.md, c.compliant, c.trucks, c.active_trips, greatest(greatest(c.trucks,1) - c.active_trips, 0) as available_trucks,
    c.drivers, c.avail_drivers,
    (case when v_equip is null then 'unknown'
          when c.trucks=0 then 'unknown'
          when c.exact_trucks>0 then 'match'
          when c.equip_trucks>0 then 'compatible'
          else 'no_match' end) as equipment_match
  from c
  cross join lateral (
    select
      (case when c.ostatus<>'active' then array['carrier not active ('||c.ostatus||')'] else '{}'::text[] end)
      || (case when not c.bvis then array['not published to broker portals'] else '{}'::text[] end)
      || (case when not c.compliant then array['compliance / authority / insurance incomplete'] else '{}'::text[] end)
      || (case when c.active_trips >= greatest(c.trucks,1) then array['no available truck (all on active trips)'] else '{}'::text[] end)
      || (case when v_equip is not null and c.trucks>0 and c.equip_trucks=0 then array['no compatible equipment for '||v_equip] else '{}'::text[] end)
      || (case when c.drivers>0 and c.avail_drivers=0 then array['no available driver (license/medical current)'] else '{}'::text[] end)
        as hf,
      (case when c.trucks=0 then array['no trucks on file'] else '{}'::text[] end)
      || (case when c.drivers=0 then array['no drivers on file'] else '{}'::text[] end)
        as md
  ) e
  order by eligible desc, c.compliant desc, c.name;
end; $function$;

revoke all on function app_private.equip_class(text) from public, anon;
revoke all on function app_private.equip_serves(text, text) from public, anon;
revoke all on function app_private.match_eligibility(uuid) from public, anon;

-- --------------------------------------------- 3. cc_match_rank: deadhead + equipment
-- Carrier position, best available: live trip GPS > active truck posting > truck
-- domicile > carrier home base. Load pin falls back to the geocode cache. Road factor 1.15.
create or replace function public.cc_match_rank(p_load uuid)
returns table(carrier_id uuid, carrier text, score integer, factors jsonb, available_trucks integer,
              active_trips integer, delivered bigint, on_time_pct integer, equipment_match text,
              loaded_rpm numeric, deadhead_note text, eta_note text, risks text[])
language plpgsql stable security definer
set search_path to 'app_private, public'
as $function$
declare v_rate numeric; v_miles numeric; v_pickup date; v_origin text; v_dest text;
        v_o_st text; v_d_st text; v_weight_lbs bigint; v_notice_hours numeric;
        v_origin_raw text; v_p_lat double precision; v_p_lng double precision;
begin
  if not public.has_global_permission('dispatch.view') then raise exception 'not authorized' using errcode='42501'; end if;
  if not exists (select 1 from public.loads where id=p_load) then raise exception 'load not found' using errcode='22023'; end if;
  select rate, miles, pickup_date, lower(coalesce(origin_full, origin, '')), lower(coalesce(destination_full, destination, '')),
         upper(coalesce(substring(coalesce(origin_full, origin) from ',\s*([A-Za-z]{2})\s*\d{5}'), substring(coalesce(origin_full, origin) from ',\s*([A-Za-z]{2})\s*$'))),
         upper(coalesce(substring(coalesce(destination_full, destination) from ',\s*([A-Za-z]{2})\s*\d{5}'), substring(coalesce(destination_full, destination) from ',\s*([A-Za-z]{2})\s*$'))),
         nullif(regexp_replace(coalesce(weight,''), '[^0-9]', '', 'g'), '')::bigint,
         coalesce(origin_full, origin), pickup_lat, pickup_lng
    into v_rate, v_miles, v_pickup, v_origin, v_dest, v_o_st, v_d_st, v_weight_lbs, v_origin_raw, v_p_lat, v_p_lng
    from public.loads where id=p_load;
  v_notice_hours := case when v_pickup is not null then extract(epoch from (v_pickup::timestamp + interval '8 hours' - now()))/3600.0 end;
  if v_p_lat is null and v_origin_raw is not null then
    select g.lat::double precision, g.lng::double precision into v_p_lat, v_p_lng
      from app_private.geo_resolve(v_origin_raw) g;
  end if;

  return query
  with elig as (select * from public.cc_match_eligibility(p_load) where eligible),
  perf as (
    select org.id,
      (select count(*) from app_private.trips t where t.carrier_id=org.id and t.status in ('delivered','invoiced')) delivered,
      (select count(*) from app_private.trips t where t.carrier_id=org.id and t.status in ('delivered','invoiced') and t.delivered_at is not null and t.scheduled_delivery is not null) d_n,
      (select count(*) from app_private.trips t where t.carrier_id=org.id and t.status in ('delivered','invoiced') and t.delivered_at is not null and t.scheduled_delivery is not null and t.delivered_at<=t.scheduled_delivery) d_ot
    from public.organizations org where org.kind='carrier'
  )
  select e.carrier_id, e.carrier,
    (pts.p_comp + pts.p_cap + pts.p_avail + pts.p_perf + pts.p_equip + pts.p_drv + pfit.p_prefs)::int as score,
    jsonb_build_array(
      jsonb_build_object('factor','compliance','points',pts.p_comp,'detail','authority/insurance/compliance OK'),
      jsonb_build_object('factor','capacity','points',pts.p_cap,'detail',e.available_trucks||' truck(s) available'),
      jsonb_build_object('factor','availability','points',pts.p_avail,'detail',e.active_trips||' active trip(s)'),
      jsonb_build_object('factor','performance','points',pts.p_perf,'detail',coalesce(round(100.0*pf.d_ot/nullif(pf.d_n,0))::text||'% on-time','no delivery history')),
      jsonb_build_object('factor','equipment','points',pts.p_equip,'detail',
         (case e.equipment_match when 'compatible' then 'compatible class' else e.equipment_match end)
         || case when eq.note <> '' then ' · '||eq.note else '' end),
      jsonb_build_object('factor','drivers','points',pts.p_drv,'detail',e.available_drivers||' driver(s) available'),
      jsonb_build_object('factor','prefs_fit','points',pfit.p_prefs,'detail',pfit.prefs_detail)
    ) as factors,
    e.available_trucks, e.active_trips, pf.delivered,
    (case when pf.d_n>0 then round(100.0*pf.d_ot/pf.d_n)::int else null end) as on_time_pct,
    e.equipment_match,
    (case when coalesce(v_miles,0)>0 then round(v_rate/v_miles,2) else null end) as loaded_rpm,
    (case when dh0.mi is null then 'unavailable — no carrier position on file'
          else dh0.mi||' mi deadhead — from '||pos.src end)::text as deadhead_note,
    (case when dh0.mi is null then 'unavailable — no carrier position on file'
          else '~'||round(dh0.mi/50.0, 1)||'h to pickup at 50 mph' end)::text as eta_note,
    (e.missing_data || pfit.prefs_risks) as risks
  from elig e
  join perf pf on pf.id=e.carrier_id
  left join app_private.carrier_dispatch_prefs cp on cp.carrier_id=e.carrier_id
  cross join lateral (
    select
      (select tr.last_lat from app_private.trips tr
        where tr.carrier_id=e.carrier_id and tr.last_lat is not null
          and tr.last_loc_at > now() - interval '24 hours'
          and tr.status not in ('delivered','invoiced','cancelled','canceled')
        order by tr.last_loc_at desc limit 1) gps_la,
      (select tr.last_lng from app_private.trips tr
        where tr.carrier_id=e.carrier_id and tr.last_lat is not null
          and tr.last_loc_at > now() - interval '24 hours'
          and tr.status not in ('delivered','invoiced','cancelled','canceled')
        order by tr.last_loc_at desc limit 1) gps_ln,
      (select coalesce(tp.origin_lat, (select g.lat::double precision from app_private.geo_resolve(tp.origin) g))
         from app_private.truck_postings tp
        where tp.carrier_id=e.carrier_id and tp.status='active'
        order by tp.updated_at desc nulls last limit 1) post_la,
      (select coalesce(tp.origin_lng, (select g.lng::double precision from app_private.geo_resolve(tp.origin) g))
         from app_private.truck_postings tp
        where tp.carrier_id=e.carrier_id and tp.status='active'
        order by tp.updated_at desc nulls last limit 1) post_ln,
      (select (select g.lat::double precision from app_private.geo_resolve(
                 app_private.truck_domicile_text(ft.domicile_city, ft.domicile_state, ft.domicile_zip)) g)
         from app_private.fleet_trucks ft
        where ft.carrier_id=e.carrier_id and coalesce(ft.status,'active')<>'inactive'
          and (ft.domicile_zip is not null or ft.domicile_city is not null)
        order by ft.unit_no limit 1) dom_la,
      (select (select g.lng::double precision from app_private.geo_resolve(
                 app_private.truck_domicile_text(ft.domicile_city, ft.domicile_state, ft.domicile_zip)) g)
         from app_private.fleet_trucks ft
        where ft.carrier_id=e.carrier_id and coalesce(ft.status,'active')<>'inactive'
          and (ft.domicile_zip is not null or ft.domicile_city is not null)
        order by ft.unit_no limit 1) dom_ln,
      (select g.lat::double precision from app_private.geo_resolve(cp.home_base) g) home_la,
      (select g.lng::double precision from app_private.geo_resolve(cp.home_base) g) home_ln
  ) raw
  cross join lateral (
    select coalesce(raw.gps_la, raw.post_la, raw.dom_la, raw.home_la) clat,
           coalesce(raw.gps_ln, raw.post_ln, raw.dom_ln, raw.home_ln) clng,
           case when raw.gps_la is not null then 'live truck GPS'
                when raw.post_la is not null then 'posted truck location'
                when raw.dom_la is not null then 'truck domicile'
                when raw.home_la is not null then 'carrier home base' end src
  ) pos
  cross join lateral (
    select case when pos.clat is not null and v_p_lat is not null
                then round((app_private.haversine_miles(pos.clat, pos.clng, v_p_lat, v_p_lng) * 1.15)::numeric)::int
           end as mi
  ) dh0
  cross join lateral (
    select coalesce((select string_agg(initcap(replace(t.k,'_',' '))||': '||t.v, ', ')
                       from jsonb_each_text(coalesce(cp.equipment_detail,'{}'::jsonb)) as t(k,v)), '') as note
  ) eq
  cross join lateral (
    select 30 as p_comp,
      least(20, e.available_trucks*10) as p_cap,
      greatest(0, 20 - e.active_trips*5) as p_avail,
      (case when pf.d_n>0 then round(20.0*pf.d_ot/pf.d_n)::int else 10 end) as p_perf,
      (case e.equipment_match when 'match' then 10 when 'compatible' then 7 else 0 end) as p_equip,
      least(10, e.available_drivers*5) as p_drv
  ) pts
  cross join lateral (
    select (lane.pts + rf.pts + wk.pts + av.pts + tm.pts + nt.pts + wt.pts + dh.pts) as p_prefs,
      concat_ws(' · ', lane.note, rf.note, wk.note, av.note, tm.note, nt.note, wt.note, dh.note) as prefs_detail,
      (rf.risk || wk.risk || av.risk || tm.risk || nt.risk || wt.risk || dh.risk) as prefs_risks
    from
      (select case when cp.carrier_id is not null and exists (
          select 1 from unnest(coalesce(cp.preferred_lanes,'{}'::text[])) ln
          where (position('→' in ln)>0 or position('->' in ln)>0)
            and v_origin like '%'||lower(trim(split_part(replace(ln,'->','→'),'→',1)))||'%'
            and v_dest   like '%'||lower(trim(split_part(replace(ln,'->','→'),'→',2)))||'%'
        ) then 7 else 0 end as pts,
        case when cp.carrier_id is not null and exists (
          select 1 from unnest(coalesce(cp.preferred_lanes,'{}'::text[])) ln
          where (position('→' in ln)>0 or position('->' in ln)>0)
            and v_origin like '%'||lower(trim(split_part(replace(ln,'->','→'),'→',1)))||'%'
            and v_dest   like '%'||lower(trim(split_part(replace(ln,'->','→'),'→',2)))||'%'
        ) then 'preferred lane' else 'not a preferred lane' end as note) lane,
      (select case when cp.min_rpm is null then 2
                   when coalesce(v_miles,0)>0 and round(v_rate/v_miles,2) >= cp.min_rpm then 4
                   else 0 end as pts,
              case when cp.min_rpm is null then 'no rate floor set'
                   when coalesce(v_miles,0)>0 and round(v_rate/v_miles,2) >= cp.min_rpm then 'meets rate floor $'||cp.min_rpm||'/mi'
                   else 'below rate floor $'||cp.min_rpm||'/mi' end as note,
              case when cp.min_rpm is not null and coalesce(v_miles,0)>0 and round(v_rate/v_miles,2) < cp.min_rpm
                   then array['below carrier rate floor $'||cp.min_rpm||'/mi'] else '{}'::text[] end as risk) rf,
      (select case when v_pickup is not null and extract(isodow from v_pickup) in (6,7) and cp.weekend_ok = false then 0 else 2 end as pts,
              case when v_pickup is not null and extract(isodow from v_pickup) in (6,7) and cp.weekend_ok = false then 'weekend pickup — carrier avoids weekends' else null end as note,
              case when v_pickup is not null and extract(isodow from v_pickup) in (6,7) and cp.weekend_ok = false
                   then array['weekend pickup vs carrier no-weekends pref'] else '{}'::text[] end as risk) wk,
      (select case when hit.st is not null then -8 else 0 end as pts,
              case when hit.st is not null then '⛔ '||hit.st||' is on the carrier''s avoid list' else null end as note,
              case when hit.st is not null then array['⛔ '||hit.st||' on carrier avoid-states list'] else '{}'::text[] end as risk
         from (select (select a.s from (select upper(trim(x)) s from unnest(coalesce(cp.avoid_states,'{}'::text[])) x) a
                        where a.s in (v_o_st, v_d_st) limit 1) st) hit) av,
      (select case when cp.carrier_id is null or coalesce(v_miles,0)=0 or (cp.min_trip_miles is null and cp.max_trip_miles is null) then 0
                   when (cp.min_trip_miles is not null and v_miles < cp.min_trip_miles)
                     or (cp.max_trip_miles is not null and v_miles > cp.max_trip_miles) then -3
                   else 2 end as pts,
              case when cp.carrier_id is not null and coalesce(v_miles,0)>0 and cp.min_trip_miles is not null and v_miles < cp.min_trip_miles then 'shorter than carrier''s '||cp.min_trip_miles||' mi minimum'
                   when cp.carrier_id is not null and coalesce(v_miles,0)>0 and cp.max_trip_miles is not null and v_miles > cp.max_trip_miles then 'longer than carrier''s '||cp.max_trip_miles||' mi maximum'
                   when cp.carrier_id is not null and coalesce(v_miles,0)>0 and (cp.min_trip_miles is not null or cp.max_trip_miles is not null) then 'in the carrier''s trip-length band'
                   else null end as note,
              case when cp.carrier_id is not null and coalesce(v_miles,0)>0 and ((cp.min_trip_miles is not null and v_miles < cp.min_trip_miles) or (cp.max_trip_miles is not null and v_miles > cp.max_trip_miles))
                   then array['outside carrier trip-length band'] else '{}'::text[] end as risk) tm,
      (select case when cp.min_notice_hours is null or v_notice_hours is null then 0
                   when v_notice_hours < cp.min_notice_hours then -3 else 1 end as pts,
              case when cp.min_notice_hours is not null and v_notice_hours is not null and v_notice_hours < cp.min_notice_hours
                   then 'only '||greatest(0,round(v_notice_hours))||'h notice — carrier asks '||cp.min_notice_hours||'h' else null end as note,
              case when cp.min_notice_hours is not null and v_notice_hours is not null and v_notice_hours < cp.min_notice_hours
                   then array['short notice: '||greatest(0,round(v_notice_hours))||'h vs '||cp.min_notice_hours||'h required'] else '{}'::text[] end as risk) nt,
      (select case when cp.max_weight_lbs is null or v_weight_lbs is null then 0
                   when v_weight_lbs > cp.max_weight_lbs then -5 else 1 end as pts,
              case when cp.max_weight_lbs is not null and v_weight_lbs is not null and v_weight_lbs > cp.max_weight_lbs
                   then 'load '||v_weight_lbs||' lb exceeds carrier max '||cp.max_weight_lbs||' lb' else null end as note,
              case when cp.max_weight_lbs is not null and v_weight_lbs is not null and v_weight_lbs > cp.max_weight_lbs
                   then array['over carrier weight cap ('||v_weight_lbs||' > '||cp.max_weight_lbs||' lb)'] else '{}'::text[] end as risk) wt,
      (select case when dh0.mi is null then 0
                   when cp.max_deadhead_miles is not null and dh0.mi > cp.max_deadhead_miles then -6
                   when cp.operating_radius_miles is not null and dh0.mi > cp.operating_radius_miles then -4
                   else 3 end as pts,
              case when dh0.mi is null then null
                   when cp.max_deadhead_miles is not null and dh0.mi > cp.max_deadhead_miles
                     then dh0.mi||' mi deadhead — over carrier max '||cp.max_deadhead_miles||' mi'
                   when cp.operating_radius_miles is not null and dh0.mi > cp.operating_radius_miles
                     then dh0.mi||' mi deadhead — outside '||cp.operating_radius_miles||' mi operating radius'
                   else dh0.mi||' mi deadhead' end as note,
              case when dh0.mi is not null and cp.max_deadhead_miles is not null and dh0.mi > cp.max_deadhead_miles
                     then array[dh0.mi||' mi deadhead exceeds carrier max '||cp.max_deadhead_miles||' mi']
                   when dh0.mi is not null and cp.operating_radius_miles is not null and dh0.mi > cp.operating_radius_miles
                     then array[dh0.mi||' mi deadhead is outside the carrier''s '||cp.operating_radius_miles||' mi radius']
                   else '{}'::text[] end as risk) dh
  ) pfit
  order by score desc, pf.delivered desc, e.carrier;
end $function$;

revoke all on function public.cc_match_rank(uuid) from public, anon;
grant execute on function public.cc_match_rank(uuid) to authenticated;

-- ------------------------------- 4. comm_preferences: weekly summaries + announcements
create or replace function app_private.carrier_weekly_summary(p_org uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare j jsonb; st jsonb;
begin
  begin st := app_private.carrier_onboarding_state(p_org); exception when others then st := null; end;
  select jsonb_build_object(
    'org', p_org,
    'name', (select o.name from public.organizations o where o.id=p_org),
    'offers', (select count(*) from app_private.load_offers lo
                where lo.carrier_id=p_org and lo.sent_at > now() - interval '7 days'),
    'offers_won', (select count(*) from app_private.load_offers lo
                where lo.carrier_id=p_org and lo.sent_at > now() - interval '7 days' and lo.status in ('accepted','booked')),
    'offers_expired', (select count(*) from app_private.load_offers lo
                where lo.carrier_id=p_org and lo.sent_at > now() - interval '7 days'
                  and lo.status not in ('accepted','booked') and lo.expiry_at is not null and lo.expiry_at < now()),
    'delivered', (select count(*) from app_private.trips t
                where t.carrier_id=p_org and t.status in ('delivered','invoiced') and t.delivered_at > now() - interval '7 days'),
    'miles', (select coalesce(sum(t.miles),0) from app_private.trips t
                where t.carrier_id=p_org and t.status in ('delivered','invoiced') and t.delivered_at > now() - interval '7 days'),
    'in_progress', (select count(*) from app_private.trips t
                where t.carrier_id=p_org and t.status not in ('delivered','invoiced','cancelled','canceled')),
    'invoiced', (select coalesce(sum(i.net),0) from app_private.fin_invoices i
                where i.carrier_id=p_org and i.issued_at > now() - interval '7 days'),
    'unpaid', (select coalesce(sum(i.net),0) from app_private.fin_invoices i
                where i.carrier_id=p_org and i.status not in ('paid','void','cancelled')),
    'expiring', coalesce((
       select jsonb_agg(x order by x->>'due')
       from (
         select jsonb_build_object('what', replace(initcap(replace(cc.requirement_key,'_',' ')),'Coi','COI'),
                                   'due', cc.expiry_date::text) x
           from app_private.carrier_compliance cc
          where cc.carrier_id=p_org and cc.expiry_date is not null
            and cc.expiry_date <= (current_date + 30) and cc.expiry_date >= current_date - 30
         union all
         select jsonb_build_object('what','Insurance (COI)','due', cv.expiry_date::text)
           from app_private.coi_coverage cv
          where cv.org_id=p_org and cv.expiry_date is not null
            and cv.expiry_date <= (current_date + 30) and cv.expiry_date >= current_date - 30
         union all
         select jsonb_build_object('what', d.name||' — CDL', 'due', d.license_exp::text)
           from app_private.fleet_drivers d
          where d.carrier_id=p_org and d.license_exp is not null
            and d.license_exp <= (current_date + 30) and d.license_exp >= current_date - 30
         union all
         select jsonb_build_object('what', d.name||' — medical card', 'due', d.medical_exp::text)
           from app_private.fleet_drivers d
          where d.carrier_id=p_org and d.medical_exp is not null
            and d.medical_exp <= (current_date + 30) and d.medical_exp >= current_date - 30
       ) q), '[]'::jsonb),
    'posting_active', (select count(*) from app_private.truck_postings tp
                where tp.carrier_id=p_org and tp.status='active'
                  and (tp.available_to is null or tp.available_to >= current_date)),
    'posting_stale', (select count(*) from app_private.truck_postings tp
                where tp.carrier_id=p_org and tp.status='active'
                  and tp.available_to is not null and tp.available_to < current_date + 2),
    'onboarding_stage', coalesce(st->>'stage','unknown'),
    'onboarding_missing', coalesce(st->'missing','[]'::jsonb)
  ) into j;
  return j;
end $$;

-- no weekly email unless there is something real to say
create or replace function app_private.carrier_weekly_worth_sending(p_org uuid)
returns boolean language sql stable security definer
set search_path to 'app_private, public' as $$
  select
    (s->>'offers')::int > 0
    or (s->>'delivered')::int > 0
    or (s->>'in_progress')::int > 0
    or (s->>'unpaid')::numeric > 0
    or jsonb_array_length(coalesce(s->'expiring','[]'::jsonb)) > 0
    or (coalesce(s->>'onboarding_stage','') in ('approved','active')
        and ((s->>'posting_active')::int = 0 or (s->>'posting_stale')::int > 0))
  from (select app_private.carrier_weekly_summary(p_org) s) q;
$$;

create or replace function app_private.carrier_weekly_summary_html(p_org uuid, p_name text default null)
returns text language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare s jsonb; h text; rows text := ''; e jsonb; miss text;
begin
  s := app_private.carrier_weekly_summary(p_org);
  rows := rows || '<tr><td style="padding:8px 0;color:#475569">Loads sent to you</td><td style="padding:8px 0;text-align:right;font-weight:700">'||(s->>'offers')||'</td></tr>';
  if (s->>'offers_expired')::int > 0 then
    rows := rows || '<tr><td style="padding:8px 0;color:#475569">Expired before you replied</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#b91c1c">'||(s->>'offers_expired')||'</td></tr>';
  end if;
  rows := rows || '<tr><td style="padding:8px 0;color:#475569">Delivered this week</td><td style="padding:8px 0;text-align:right;font-weight:700">'||(s->>'delivered')||'</td></tr>';
  if (s->>'miles')::numeric > 0 then
    rows := rows || '<tr><td style="padding:8px 0;color:#475569">Miles run</td><td style="padding:8px 0;text-align:right;font-weight:700">'||round((s->>'miles')::numeric)||'</td></tr>';
  end if;
  if (s->>'invoiced')::numeric > 0 then
    rows := rows || '<tr><td style="padding:8px 0;color:#475569">Invoiced this week</td><td style="padding:8px 0;text-align:right;font-weight:700">$'||to_char((s->>'invoiced')::numeric,'FM999,999,990.00')||'</td></tr>';
  end if;
  if (s->>'unpaid')::numeric > 0 then
    rows := rows || '<tr><td style="padding:8px 0;color:#475569">Awaiting payment</td><td style="padding:8px 0;text-align:right;font-weight:700">$'||to_char((s->>'unpaid')::numeric,'FM999,999,990.00')||'</td></tr>';
  end if;
  rows := rows || '<tr><td style="padding:8px 0;color:#475569">Trips in progress</td><td style="padding:8px 0;text-align:right;font-weight:700">'||(s->>'in_progress')||'</td></tr>';

  h := '<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.06em;color:#F97316;text-transform:uppercase">Your week on LoadBoot</p>'
    || '<h2 style="margin:0 0 4px;color:#10223B">'||coalesce(p_name, s->>'name', 'Your week')||'</h2>'
    || '<p style="margin:0 0 16px;color:#64748b;font-size:14px">'||to_char(current_date - 7,'Mon DD')||' – '||to_char(current_date,'Mon DD, YYYY')||'</p>'
    || '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:15px;border-top:1px solid #e2e8f0">'||rows||'</table>';

  if jsonb_array_length(coalesce(s->'expiring','[]'::jsonb)) > 0 then
    h := h || '<div style="margin:18px 0 0;padding:14px 16px;background:#FEF3C7;border-radius:10px">'
           || '<p style="margin:0 0 8px;font-weight:700;color:#92400E">Expiring in the next 30 days</p><ul style="margin:0;padding-left:18px;color:#78350F">';
    for e in select * from jsonb_array_elements(s->'expiring') loop
      h := h || '<li style="margin:3px 0">'||(e->>'what')||' — '||(e->>'due')||'</li>';
    end loop;
    h := h || '</ul></div>';
  end if;

  if (s->>'posting_active')::int = 0 then
    h := h || '<p style="margin:16px 0 0;padding:12px 14px;background:#EFF6FF;border-radius:10px;color:#1e3a8a">Your truck is not posted right now — posted trucks get matched first.</p>';
  elsif (s->>'posting_stale')::int > 0 then
    h := h || '<p style="margin:16px 0 0;padding:12px 14px;background:#EFF6FF;border-radius:10px;color:#1e3a8a">Your truck posting runs out in the next couple of days — push the dates forward so you keep getting matches.</p>';
  end if;

  if jsonb_array_length(coalesce(s->'onboarding_missing','[]'::jsonb)) > 0 then
    miss := (select string_agg(x, ', ') from jsonb_array_elements_text(s->'onboarding_missing') x);
    h := h || '<p style="margin:16px 0 0;padding:12px 14px;background:#FEE2E2;border-radius:10px;color:#991B1B">Still needed before you can book: '||miss||'</p>';
  end if;

  h := h || '<p style="margin:22px 0"><a href="https://loadboot.com/app/carrier/#dashboard" style="background:#0883F7;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Open your dashboard</a></p>'
         || '<p style="margin:18px 0 0;color:#94a3b8;font-size:12px">You are getting this because weekly summaries are on in your notification settings. Turn them off any time in Account → Notifications.</p>';
  return h;
end $$;

-- staff can look before anything goes out
create or replace function public.cc_carrier_weekly_preview(p_org uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
begin
  if not (public.has_global_permission('carriers.view') or public.has_global_permission('dispatch.manage')) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  return jsonb_build_object(
    'facts', app_private.carrier_weekly_summary(p_org),
    'html',  app_private.carrier_weekly_summary_html(p_org),
    'would_send', app_private.carrier_weekly_worth_sending(p_org)
  );
end $$;

insert into app_private.system_setting_defs(key, value_type, description, sensitivity, required_permission, default_value, environment)
values ('comm.weekly_summary_enabled','boolean','Send the carrier weekly summary email every Monday. Off until the owner turns it on.','internal','settings.manage','false'::jsonb,'all')
on conflict (key) do nothing;
insert into app_private.system_settings(key, value)
values ('comm.weekly_summary_enabled', 'false'::jsonb) on conflict (key) do nothing;

create or replace function app_private.carrier_weekly_digest_run()
returns jsonb language plpgsql security definer
set search_path to 'app_private, public' as $$
declare org_row record; usr record; v_html text; v_sent int := 0; v_skipped int := 0; v_wk text;
begin
  if coalesce((select s.value #>> '{}' from app_private.system_settings s where s.key='comm.weekly_summary_enabled'), 'false') <> 'true' then
    return jsonb_build_object('ok', true, 'disabled', true);
  end if;
  v_wk := to_char(current_date, 'IYYY-"W"IW');

  for org_row in
    select o.id org_id, o.name org_name from public.organizations o
     where o.kind='carrier' and o.status='active'
       and not coalesce((to_jsonb(o)->>'is_demo')::boolean, false)
  loop
    if not app_private.carrier_weekly_worth_sending(org_row.org_id) then
      v_skipped := v_skipped + 1; continue;
    end if;
    v_html := app_private.carrier_weekly_summary_html(org_row.org_id, org_row.org_name);
    for usr in
      select distinct u.email
        from public.organization_memberships m
        join auth.users u on u.id = m.user_id
        left join app_private.comm_preferences cp on cp.user_id = m.user_id
       where m.org_id = org_row.org_id and m.status='active' and u.email is not null
         and coalesce(cp.weekly_summaries, true)
         and not coalesce(cp.unsubscribed_all, false)
    loop
      perform app_private.sys_email(usr.email, 'carrier_weekly_summary',
        'Your week on LoadBoot — ' || to_char(current_date,'Mon DD'),
        v_html, null, 'wk:'||v_wk||':'||org_row.org_id::text||':'||lower(usr.email));
      v_sent := v_sent + 1;
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'sent', v_sent, 'skipped', v_skipped, 'week', v_wk);
end $$;

-- announcements now respect comm_preferences.product_announcements / unsubscribed_all
create or replace function app_private.tg_announcement_notify()
returns trigger language plpgsql security definer
set search_path to 'public', 'app_private' as $$
declare r record; v_tone text; v_label text;
begin
  if coalesce(new.active, true) then
    v_tone := case when new.kind in ('warning','urgent') then 'urgent'
                   when new.kind in ('promo','promotion','success') then 'success' else 'info' end;
    v_label := case when new.kind in ('warning','urgent') then 'Policy notice'
                    when new.kind in ('promo','promotion') then 'Offer' else 'Announcement' end;
    insert into app_private.notifications(recipient_role, recipient_user, channel, template_key, payload, status, sent_at)
    select 'carrier', m.user_id, 'in_app', 'announcement',
           jsonb_build_object('title', new.title, 'body', new.body, 'tone', v_tone, 'url', '/app/carrier/#dashboard'),
           'sent', now()
    from public.organization_memberships m
    join public.organizations o on o.id = m.org_id
    where m.status = 'active'
      and ( (new.target_org is not null and m.org_id = new.target_org)
         or (new.target_org is null and new.audience in ('all','all_carriers','carriers') and o.kind = 'carrier') );

    for r in
      select distinct u.email
      from public.organization_memberships m
      join public.organizations o on o.id = m.org_id
      join auth.users u on u.id = m.user_id
      left join app_private.comm_preferences cp on cp.user_id = m.user_id
      where m.status='active' and u.email is not null
        and coalesce(cp.product_announcements, true)
        and not coalesce(cp.unsubscribed_all, false)
        and ( (new.target_org is not null and m.org_id = new.target_org)
           or (new.target_org is null and new.audience in ('all','all_carriers','carriers') and o.kind = 'carrier') )
    loop
      perform app_private.sys_email(r.email, 'announcement',
        new.title || ' — LoadBoot',
        '<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.06em;color:#F97316;text-transform:uppercase">' || v_label || '</p>'
        || '<h2 style="margin:0 0 10px">' || new.title || '</h2>'
        || '<p style="margin:0 0 16px">' || new.body || '</p>'
        || '<p style="margin:18px 0"><a href="https://loadboot.com/app/carrier/#dashboard" style="background:#0883F7;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Open your dashboard</a></p>',
        null, 'ann:' || new.id::text || ':' || r.email);
    end loop;
  end if;
  return new;
end $$;

select cron.unschedule('carrier_weekly_digest') where exists (select 1 from cron.job where jobname='carrier_weekly_digest');
select cron.schedule('carrier_weekly_digest', '0 13 * * 1', $cron$select app_private.carrier_weekly_digest_run();$cron$);

revoke all on function app_private.carrier_weekly_summary(uuid) from public, anon;
revoke all on function app_private.carrier_weekly_summary_html(uuid, text) from public, anon;
revoke all on function app_private.carrier_weekly_worth_sending(uuid) from public, anon;
revoke all on function app_private.carrier_weekly_digest_run() from public, anon;
revoke all on function public.cc_carrier_weekly_preview(uuid) from public, anon;
grant execute on function public.cc_carrier_weekly_preview(uuid) to authenticated;

-- ------------------------------------------------------------------ anon surface check
do $a$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace nsp on nsp.oid=p.pronamespace
   where nsp.nspname='public' and has_function_privilege('anon', p.oid, 'EXECUTE');
  raise notice 'anon-executable public functions: %', n;
end $a$;
