-- bl_avail_0321 — Availability v2 (owner feedback 5 Sep 2026, on top of bl_avail_0320)
--
--   * Structured place: origin_city / origin_state / origin_zip (ZIP optional but recommended —
--     the matcher does a real radius match only when the posting has lat/lng; a ZIP geocodes to a
--     point, a city to its centre). origin text stays "City, ST" so every existing reader still works.
--   * Truck is now REQUIRED on a post (no "posting without one"), on top of the 0320 fleet gate.
--   * Auto-expiry: a post not confirmed for 24h flips to status='expired' (pg_cron, every 15 min).
--     cc_confirm_truck_posting on an expired post = "Repost" (active again, fresh stamp).
--   * expires_at exposed to the carrier app + dispatcher board (dispatcher_board → cc_my_truck_postings).
--   * New cc_update_truck_posting_place(id, p) — additive edit of place/kind/zip that also re-confirms.
--   * geo_fill_truck_postings prefers the ZIP point over the city centre when a ZIP is on the post.
--
-- Additive, reversible. Grants: authenticated only.

begin;

-- 1) Columns ---------------------------------------------------------------------------------
alter table app_private.truck_postings
  add column if not exists origin_city  text,
  add column if not exists origin_state text,
  add column if not exists origin_zip   text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'truck_postings_origin_zip_chk') then
    alter table app_private.truck_postings
      add constraint truck_postings_origin_zip_chk check (origin_zip is null or origin_zip ~ '^\d{5}$');
  end if;
end $$;

-- backfill city/state from the existing "City, ST" text where it parses
update app_private.truck_postings
   set origin_city  = initcap(btrim(split_part(origin, ',', 1))),
       origin_state = upper(btrim(split_part(origin, ',', 2)))
 where origin_city is null and origin ~ '^[^,]+,\s*[A-Za-z]{2}\s*$';

-- 2) Geocode: prefer the ZIP point -----------------------------------------------------------
create or replace function app_private.geo_fill_truck_postings()
returns int language plpgsql security definer
set search_path to 'app_private, public' as $$
declare r record; n int := 0; v_lat numeric; v_lng numeric;
begin
  for r in select id, origin, origin_zip from app_private.truck_postings
            where (origin is not null or origin_zip is not null) and (origin_lat is null or origin_lng is null)
  loop
    v_lat := null; v_lng := null;
    if r.origin_zip is not null then select lat, lng into v_lat, v_lng from app_private.geo_resolve('ZIP ' || r.origin_zip); end if;
    if v_lat is null and r.origin is not null then select lat, lng into v_lat, v_lng from app_private.geo_resolve(r.origin); end if;
    if v_lat is not null then
      update app_private.truck_postings set origin_lat = v_lat, origin_lng = v_lng where id = r.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- 3) cc_post_truck — structured place, truck required, immediate geocode when cached ------------
create or replace function public.cc_post_truck(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'app_private, public'
as $function$
declare v_org uuid; v_id uuid; v_n int; v_truck app_private.fleet_trucks; v_eq text[];
        v_kind text; v_trucks int; v_drivers int;
        v_city text; v_state text; v_zip text; v_origin text; v_lat numeric; v_lng numeric;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;

  -- Fleet gate (owner rule 5 Sep 2026)
  select count(*) into v_trucks  from app_private.fleet_trucks  where carrier_id = v_org and coalesce(status,'active') not in ('inactive','retired');
  select count(*) into v_drivers from app_private.fleet_drivers where carrier_id = v_org and coalesce(status,'active') not in ('inactive','retired');
  if v_trucks = 0  then raise exception 'Add at least one truck under Fleet before posting availability.'  using errcode='LB003'; end if;
  if v_drivers = 0 then raise exception 'Add at least one driver under Fleet before posting availability.' using errcode='LB004'; end if;

  -- Truck is required: a post is a unit, not an account.
  if nullif(p->>'truck_id','') is null then raise exception 'Pick which truck you are posting.' using errcode='LB005'; end if;
  select * into v_truck from app_private.fleet_trucks where id = (p->>'truck_id')::uuid and carrier_id = v_org;
  if v_truck.id is null then raise exception 'truck not found for your account' using errcode='42501'; end if;
  perform app_private.assert_vin_dispatchable(v_org, v_truck.vin);

  -- Place: structured first, "City, ST" text as fallback (older clients / dispatcher portal).
  v_city  := nullif(initcap(btrim(coalesce(p->>'origin_city',''))), '');
  v_state := nullif(upper(btrim(coalesce(p->>'origin_state',''))), '');
  v_zip   := nullif(regexp_replace(coalesce(p->>'origin_zip',''), '\D', '', 'g'), '');
  if v_zip is not null and v_zip !~ '^\d{5}$' then raise exception 'ZIP must be 5 digits.' using errcode='22023'; end if;
  if v_city is null and coalesce(btrim(p->>'origin'),'') <> '' and (p->>'origin') ~ '^[^,]+,\s*[A-Za-z]{2}\s*$' then
    v_city := initcap(btrim(split_part(p->>'origin', ',', 1))); v_state := upper(btrim(split_part(p->>'origin', ',', 2)));
  end if;
  if v_city is null or v_state is null or v_state !~ '^[A-Z]{2}$' then
    raise exception 'City and state required.' using errcode='22023'; end if;
  v_origin := v_city || ', ' || v_state;

  if (p->>'available_from') is null or (p->>'available_to') is null then
    raise exception 'availability dates required' using errcode='22023'; end if;

  v_kind := coalesce(nullif(btrim(p->>'post_kind'),''), 'empty');
  if v_kind not in ('empty','backhaul') then raise exception 'post_kind must be empty or backhaul' using errcode='22023'; end if;
  if v_kind = 'backhaul' and coalesce(btrim(p->>'dest_pref'),'') = '' then
    raise exception 'A backhaul post needs where you want to reload toward.' using errcode='22023'; end if;

  v_eq := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'equipment','[]'::jsonb)) x), '{}');
  if array_length(v_eq,1) is null and v_truck.equipment is not null then v_eq := array[v_truck.equipment]; end if;

  -- Immediate lat/lng when the geocode cache already knows the place (ZIP first); else geo_tick fills it.
  if v_zip is not null then
    perform app_private.geo_enqueue('ZIP ' || v_zip, 'truck_posting_zip');
    select lat, lng into v_lat, v_lng from app_private.geo_resolve('ZIP ' || v_zip);
  end if;
  if v_lat is null then select lat, lng into v_lat, v_lng from app_private.geo_resolve(v_origin); end if;

  insert into app_private.truck_postings(carrier_id, truck_id, origin, origin_lat, origin_lng, radius_miles,
      dest_pref, equipment, min_rpm, available_from, available_to, auto_request, notes, created_by,
      post_kind, last_confirmed_at, origin_city, origin_state, origin_zip)
  values (v_org, v_truck.id, v_origin,
    coalesce(nullif(p->>'origin_lat','')::double precision, v_lat::double precision),
    coalesce(nullif(p->>'origin_lng','')::double precision, v_lng::double precision),
    coalesce(nullif(p->>'radius_miles','')::int, v_truck.max_radius_miles, 150),
    nullif(btrim(coalesce(p->>'dest_pref','')),''), v_eq,
    coalesce(nullif(p->>'min_rpm','')::numeric, v_truck.min_rpm),
    (p->>'available_from')::date, (p->>'available_to')::date,
    coalesce((p->>'auto_request')::boolean, false),
    nullif(btrim(coalesce(p->>'notes','')),''), auth.uid(),
    v_kind, now(), v_city, v_state, v_zip)
  returning id into v_id;

  v_n := app_private.tp_run_matcher(v_id);
  perform app_private.log_audit('carrier.post_truck','truck_posting',v_id::text,null,'availability posted ('||v_kind||')',p);
  return jsonb_build_object('ok', true, 'id', v_id, 'matches', v_n, 'geocoded', (v_lat is not null));
end $function$;

-- 4) cc_update_truck_posting_place — edit place/kind/zip on an existing post (+ re-confirm) ------
create or replace function public.cc_update_truck_posting_place(p_id uuid, p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'app_private, public'
as $function$
declare v_org uuid; v_row app_private.truck_postings; v_city text; v_state text; v_zip text; v_kind text; v_lat numeric; v_lng numeric; v_n int := 0;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  select * into v_row from app_private.truck_postings where id = p_id and carrier_id = v_org;
  if v_row.id is null then raise exception 'posting not found' using errcode='22023'; end if;
  v_city  := coalesce(nullif(initcap(btrim(coalesce(p->>'origin_city',''))), ''), v_row.origin_city);
  v_state := coalesce(nullif(upper(btrim(coalesce(p->>'origin_state',''))), ''), v_row.origin_state);
  v_zip   := case when p ? 'origin_zip' then nullif(regexp_replace(coalesce(p->>'origin_zip',''), '\D', '', 'g'), '') else v_row.origin_zip end;
  if v_zip is not null and v_zip !~ '^\d{5}$' then raise exception 'ZIP must be 5 digits.' using errcode='22023'; end if;
  v_kind  := coalesce(nullif(btrim(p->>'post_kind'),''), v_row.post_kind, 'empty');
  if v_kind not in ('empty','backhaul') then raise exception 'post_kind must be empty or backhaul' using errcode='22023'; end if;
  if v_city is null or v_state is null then raise exception 'City and state required.' using errcode='22023'; end if;
  if v_zip is not null then perform app_private.geo_enqueue('ZIP ' || v_zip, 'truck_posting_zip'); select lat, lng into v_lat, v_lng from app_private.geo_resolve('ZIP ' || v_zip); end if;
  if v_lat is null then select lat, lng into v_lat, v_lng from app_private.geo_resolve(v_city || ', ' || v_state); end if;
  update app_private.truck_postings
     set origin_city = v_city, origin_state = v_state, origin_zip = v_zip,
         origin = v_city || ', ' || v_state,
         origin_lat = v_lat::double precision, origin_lng = v_lng::double precision,   -- null → geo_tick refills
         post_kind = v_kind,
         dest_pref = case when p ? 'dest_pref' then nullif(btrim(coalesce(p->>'dest_pref','')),'') else dest_pref end,
         last_confirmed_at = now(), status = 'active',
         available_from = least(coalesce(available_from, current_date), current_date),
         available_to   = greatest(coalesce(available_to, current_date), current_date),
         updated_at = now()
   where id = p_id and carrier_id = v_org;
  v_n := app_private.tp_run_matcher(p_id);
  perform app_private.log_audit('carrier.update_truck_posting_place','truck_posting',p_id::text,null,'availability place updated',p);
  return jsonb_build_object('ok', true, 'id', p_id, 'matches', v_n, 'geocoded', (v_lat is not null));
end $function$;

-- 5) cc_my_truck_postings — place fields + expires_at ---------------------------------------
create or replace function public.cc_my_truck_postings()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'app_private, public'
as $function$
declare v_org uuid; v_out jsonb;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'origin',t.origin,'dest_pref',t.dest_pref,
      'origin_city', t.origin_city, 'origin_state', t.origin_state, 'origin_zip', t.origin_zip,
      'geocoded', (t.origin_lat is not null and t.origin_lng is not null),
      'equipment',t.equipment,'min_rpm',t.min_rpm,'from',t.available_from,'to',t.available_to,
      'radius',t.radius_miles,'auto_request',t.auto_request,'status',t.status,'notes',t.notes,
      'truck_id',t.truck_id,'unit_no',ft.unit_no,
      'post_kind', coalesce(t.post_kind,'empty'),
      'last_confirmed_at', t.last_confirmed_at,
      'expires_at', (t.last_confirmed_at + interval '24 hours'),
      'hours_left', (case when t.last_confirmed_at is null then null
                          else greatest(0, floor(extract(epoch from ((t.last_confirmed_at + interval '24 hours') - now()))/3600))::int end),
      'hours_since_confirm', (case when t.last_confirmed_at is null then null
                                   else floor(extract(epoch from (now() - t.last_confirmed_at))/3600)::int end),
      'is_fresh', (t.status='active' and t.available_to >= current_date
                   and t.last_confirmed_at >= now() - interval '24 hours'),
      'is_live',(t.status='active' and t.available_to >= current_date),
      'days_ago',(case when t.available_to < current_date then current_date - t.available_to else 0 end),
      'matches',(select count(*) from app_private.truck_posting_matches m where m.posting_id=t.id))
      order by (t.status='active' and t.available_to >= current_date) desc, t.last_confirmed_at desc nulls last), '[]'::jsonb) into v_out
  from app_private.truck_postings t
  left join app_private.fleet_trucks ft on ft.id = t.truck_id
  where t.carrier_id = v_org
    and (t.status in ('active','paused') or t.available_to >= current_date - 14 or t.last_confirmed_at >= now() - interval '14 days');
  return v_out;
end $function$;

-- 6) Auto-expiry (24h after last confirmation) — pg_cron every 15 min ----------------------------
create or replace function app_private.avail_expire_stale()
returns int language plpgsql security definer
set search_path to 'app_private, public' as $$
declare n int;
begin
  update app_private.truck_postings
     set status = 'expired', updated_at = now()
   where status = 'active'
     and last_confirmed_at is not null
     and last_confirmed_at < now() - interval '24 hours';
  get diagnostics n = row_count;
  return n;
end $$;

do $$ begin
  perform cron.unschedule('avail_expire_stale');
exception when others then null; end $$;
select cron.schedule('avail_expire_stale', '*/15 * * * *', $cron$select app_private.avail_expire_stale();$cron$);

-- 7) Grants ----------------------------------------------------------------------------------
revoke all on function public.cc_post_truck(jsonb) from public, anon;
revoke all on function public.cc_update_truck_posting_place(uuid, jsonb) from public, anon;
revoke all on function public.cc_my_truck_postings() from public, anon;
grant execute on function public.cc_post_truck(jsonb) to authenticated, service_role;
grant execute on function public.cc_update_truck_posting_place(uuid, jsonb) to authenticated, service_role;
grant execute on function public.cc_my_truck_postings() to authenticated, service_role;

commit;
