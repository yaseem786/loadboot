-- bl_avail_0320 — Daily truck availability (owner request, 5 Sep 2026)
--
-- What changes for the carrier:
--   * "Post my truck" becomes "Post your availability": a post is either the truck is EMPTY now
--     (post_kind='empty') or it is BOOKED and needs a BACKHAUL from where it delivers
--     (post_kind='backhaul' — origin = delivery city, dest_pref = where they want to reload toward).
--   * A post must be re-confirmed every day. last_confirmed_at drives is_fresh (24h). A stale post is
--     still visible to the carrier but is flagged, and the dedicated dispatcher rule is:
--     LoadBoot's dispatcher works a carrier's loads ONLY while a fresh post exists.
--   * Fleet gate: posting requires at least one truck AND one driver on file (LB003 / LB004), so the
--     app can navigate the carrier to #fleet/add-truck or #fleet/add-driver.
--   * New read RPC cc_my_availability_status() feeds the dashboard card + Load Board banner.
--   * New write RPC cc_confirm_truck_posting(id) = one-tap "Still available today".
--
-- Additive: no column removed, existing extend/pause/edit/delete untouched. Grants: authenticated only.
-- Also fixes a grant leak found while building: cc_update_truck_posting(uuid,text,jsonb) was executable
-- by PUBLIC/anon (default privilege never revoked). Carrier-only function; anon has no business here.

begin;

-- 1) Columns ---------------------------------------------------------------------------------
alter table app_private.truck_postings
  add column if not exists post_kind text not null default 'empty',
  add column if not exists last_confirmed_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'truck_postings_post_kind_chk') then
    alter table app_private.truck_postings
      add constraint truck_postings_post_kind_chk check (post_kind in ('empty','backhaul'));
  end if;
end $$;

update app_private.truck_postings
   set last_confirmed_at = coalesce(updated_at, created_at, now())
 where last_confirmed_at is null;

alter table app_private.truck_postings alter column last_confirmed_at set default now();

-- 2) cc_post_truck — fleet gate + post_kind + confirmed stamp -----------------------------------
create or replace function public.cc_post_truck(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'app_private, public'
as $function$
declare v_org uuid; v_id uuid; v_n int; v_truck app_private.fleet_trucks; v_eq text[];
        v_kind text; v_trucks int; v_drivers int;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;

  -- Fleet gate (owner rule 5 Sep 2026): we need a real unit and a real driver before a post means
  -- anything to a dispatcher. Codes let the app send the carrier to the exact missing step.
  select count(*) into v_trucks  from app_private.fleet_trucks  where carrier_id = v_org and coalesce(status,'active') not in ('inactive','retired');
  select count(*) into v_drivers from app_private.fleet_drivers where carrier_id = v_org and coalesce(status,'active') not in ('inactive','retired');
  if v_trucks = 0  then raise exception 'Add at least one truck under Fleet before posting availability.'  using errcode='LB003'; end if;
  if v_drivers = 0 then raise exception 'Add at least one driver under Fleet before posting availability.' using errcode='LB004'; end if;

  if coalesce(btrim(p->>'origin'),'') = '' then raise exception 'origin required' using errcode='22023'; end if;
  if (p->>'available_from') is null or (p->>'available_to') is null then
    raise exception 'availability dates required' using errcode='22023'; end if;

  v_kind := coalesce(nullif(btrim(p->>'post_kind'),''), 'empty');
  if v_kind not in ('empty','backhaul') then raise exception 'post_kind must be empty or backhaul' using errcode='22023'; end if;
  if v_kind = 'backhaul' and coalesce(btrim(p->>'dest_pref'),'') = '' then
    raise exception 'A backhaul post needs where you want to reload toward.' using errcode='22023'; end if;

  if nullif(p->>'truck_id','') is not null then
    select * into v_truck from app_private.fleet_trucks
      where id = (p->>'truck_id')::uuid and carrier_id = v_org;
    if v_truck.id is null then raise exception 'truck not found for your account' using errcode='42501'; end if;
    -- A truck we are not insured to dispatch must never reach a broker's board.
    perform app_private.assert_vin_dispatchable(v_org, v_truck.vin);
  end if;

  v_eq := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'equipment','[]'::jsonb)) x), '{}');
  if array_length(v_eq,1) is null and v_truck.equipment is not null then v_eq := array[v_truck.equipment]; end if;

  insert into app_private.truck_postings(carrier_id, truck_id, origin, origin_lat, origin_lng, radius_miles,
      dest_pref, equipment, min_rpm, available_from, available_to, auto_request, notes, created_by,
      post_kind, last_confirmed_at)
  values (v_org, nullif(p->>'truck_id','')::uuid, btrim(p->>'origin'),
    nullif(p->>'origin_lat','')::double precision, nullif(p->>'origin_lng','')::double precision,
    coalesce(nullif(p->>'radius_miles','')::int, v_truck.max_radius_miles, 150),
    nullif(btrim(coalesce(p->>'dest_pref','')),''), v_eq,
    coalesce(nullif(p->>'min_rpm','')::numeric, v_truck.min_rpm),
    (p->>'available_from')::date, (p->>'available_to')::date,
    coalesce((p->>'auto_request')::boolean, false),
    nullif(btrim(coalesce(p->>'notes','')),''), auth.uid(),
    v_kind, now())
  returning id into v_id;

  v_n := app_private.tp_run_matcher(v_id);
  perform app_private.log_audit('carrier.post_truck','truck_posting',v_id::text,null,'availability posted ('||v_kind||')',p);
  return jsonb_build_object('ok', true, 'id', v_id, 'matches', v_n);
end $function$;

-- 3) cc_my_truck_postings — expose kind + freshness -----------------------------------------
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
      'equipment',t.equipment,'min_rpm',t.min_rpm,'from',t.available_from,'to',t.available_to,
      'radius',t.radius_miles,'auto_request',t.auto_request,'status',t.status,'notes',t.notes,
      'truck_id',t.truck_id,'unit_no',ft.unit_no,
      'post_kind', coalesce(t.post_kind,'empty'),
      'last_confirmed_at', t.last_confirmed_at,
      'hours_since_confirm', (case when t.last_confirmed_at is null then null
                                   else floor(extract(epoch from (now() - t.last_confirmed_at))/3600)::int end),
      'is_fresh', (t.status='active' and t.available_to >= current_date
                   and t.last_confirmed_at >= now() - interval '24 hours'),
      'is_live',(t.status='active' and t.available_to >= current_date),
      'days_ago',(case when t.available_to < current_date then current_date - t.available_to else 0 end),
      'matches',(select count(*) from app_private.truck_posting_matches m where m.posting_id=t.id))
      order by (t.status='active' and t.available_to >= current_date) desc, t.available_to desc), '[]'::jsonb) into v_out
  from app_private.truck_postings t
  left join app_private.fleet_trucks ft on ft.id = t.truck_id
  where t.carrier_id = v_org
    and (t.status in ('active','paused') or t.available_to >= current_date - 14);
  return v_out;
end $function$;

-- 4) cc_confirm_truck_posting — "Still available today" (one tap, daily) ---------------------
create or replace function public.cc_confirm_truck_posting(p_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'app_private, public'
as $function$
declare v_org uuid; v_row app_private.truck_postings; v_n int := 0;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  select * into v_row from app_private.truck_postings where id = p_id and carrier_id = v_org;
  if v_row.id is null then raise exception 'posting not found' using errcode='22023'; end if;
  update app_private.truck_postings
     set last_confirmed_at = now(),
         status = 'active',
         available_from = least(coalesce(available_from, current_date), current_date),
         -- keep the window at least through today so the post is live, never shorten it
         available_to = greatest(coalesce(available_to, current_date), current_date),
         updated_at = now()
   where id = p_id and carrier_id = v_org;
  v_n := app_private.tp_run_matcher(p_id);
  perform app_private.log_audit('carrier.confirm_truck_posting','truck_posting',p_id::text,null,'availability confirmed for today',null);
  return jsonb_build_object('ok', true, 'id', p_id, 'matches', v_n);
end $function$;

-- 5) cc_my_availability_status — dashboard card / Load Board banner / fleet gate pre-check ----
create or replace function public.cc_my_availability_status()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'app_private, public'
as $function$
declare v_org uuid; v_trucks int; v_drivers int; v_live int; v_fresh int; v_last timestamptz;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  select count(*) into v_trucks  from app_private.fleet_trucks  where carrier_id = v_org and coalesce(status,'active') not in ('inactive','retired');
  select count(*) into v_drivers from app_private.fleet_drivers where carrier_id = v_org and coalesce(status,'active') not in ('inactive','retired');
  select count(*) filter (where status='active' and available_to >= current_date),
         count(*) filter (where status='active' and available_to >= current_date and last_confirmed_at >= now() - interval '24 hours'),
         max(last_confirmed_at)
    into v_live, v_fresh, v_last
    from app_private.truck_postings where carrier_id = v_org;
  return jsonb_build_object(
    'has_truck', v_trucks > 0, 'has_driver', v_drivers > 0,
    'trucks', v_trucks, 'drivers', v_drivers,
    'live', v_live, 'fresh', v_fresh,
    'last_confirmed_at', v_last,
    'hours_since_confirm', case when v_last is null then null else floor(extract(epoch from (now() - v_last))/3600)::int end,
    -- The one rule the UI states everywhere: your dedicated dispatcher is working your loads
    -- only while at least one post was confirmed in the last 24 hours.
    'dispatcher_active', v_fresh > 0,
    'needs_update', v_fresh = 0);
end $function$;

-- 6) Grants — authenticated only. Fix the PUBLIC/anon leak on the 3-arg update overload. -------
revoke all on function public.cc_post_truck(jsonb) from public, anon;
revoke all on function public.cc_my_truck_postings() from public, anon;
revoke all on function public.cc_confirm_truck_posting(uuid) from public, anon;
revoke all on function public.cc_my_availability_status() from public, anon;
revoke all on function public.cc_update_truck_posting(uuid, text, jsonb) from public, anon;
grant execute on function public.cc_post_truck(jsonb) to authenticated, service_role;
grant execute on function public.cc_my_truck_postings() to authenticated, service_role;
grant execute on function public.cc_confirm_truck_posting(uuid) to authenticated, service_role;
grant execute on function public.cc_my_availability_status() to authenticated, service_role;
grant execute on function public.cc_update_truck_posting(uuid, text, jsonb) to authenticated, service_role;

commit;
