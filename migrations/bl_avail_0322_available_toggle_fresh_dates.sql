-- bl_avail_0322 — "Not available" toggle + one-call save + fresh dates (owner feedback 5 Sep 2026)
--
--   * cc_set_truck_posting_available(id, false) = the carrier says the truck is NOT available.
--     The post is paused (off the board, dispatcher stops) but keeps every value, so turning it
--     back on shows the whole card again, prefilled — except the dates, which the app blanks so
--     the carrier must state today's window every time (owner rule: never reuse a saved date).
--   * cc_update_truck_posting_place is widened into the ONE call the form makes on an existing
--     post: place + kind + destination + dates + truck + radius/equipment/rate/notes/auto-request,
--     and it re-activates + re-confirms in the same statement. Two half-applied calls are gone.
--     Dates given in the patch are stored VERBATIM (a backhaul delivery date is in the future);
--     only when the patch carries no dates does it clamp the window around today (pure confirm).
--   * cc_my_availability_status also returns `paused` so the card can say "you turned it off".
--
-- Additive: cc_update_truck_posting ('pause'/'resume'/'extend'/'edit'/'delete') is untouched, so
-- the dispatcher portal keeps working exactly as before. Grants: authenticated only.

begin;

-- 1) The availability toggle ------------------------------------------------------------------
create or replace function public.cc_set_truck_posting_available(p_id uuid, p_available boolean)
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

  if p_available is not true then
    -- NOT AVAILABLE: off the board, dispatcher stops, values kept for the next time.
    update app_private.truck_postings set status = 'paused', updated_at = now()
     where id = p_id and carrier_id = v_org;
    perform app_private.log_audit('carrier.posting_not_available','truck_posting',p_id::text,null,'carrier marked the truck not available',null);
    return jsonb_build_object('ok', true, 'id', p_id, 'status', 'paused');
  end if;

  -- AVAILABLE again without new dates (kept for API completeness — the app reopens the form
  -- instead, so the carrier restates the window). Window is clamped around today so the post
  -- cannot go live with a dead date range.
  update app_private.truck_postings
     set status = 'active', last_confirmed_at = now(),
         available_from = least(coalesce(available_from, current_date), current_date),
         available_to   = greatest(coalesce(available_to, current_date), current_date),
         updated_at = now()
   where id = p_id and carrier_id = v_org;
  v_n := app_private.tp_run_matcher(p_id);
  perform app_private.log_audit('carrier.posting_available','truck_posting',p_id::text,null,'carrier marked the truck available again',null);
  return jsonb_build_object('ok', true, 'id', p_id, 'status', 'active', 'matches', v_n);
end $function$;

-- 2) One-call save for an existing posting ------------------------------------------------------
create or replace function public.cc_update_truck_posting_place(p_id uuid, p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'app_private, public'
as $function$
declare v_org uuid; v_row app_private.truck_postings; v_truck app_private.fleet_trucks;
        v_city text; v_state text; v_zip text; v_kind text; v_dest text;
        v_lat numeric; v_lng numeric; v_n int := 0;
        v_from date; v_to date; v_dates boolean := false; v_eq text[];
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  select * into v_row from app_private.truck_postings where id = p_id and carrier_id = v_org;
  if v_row.id is null then raise exception 'posting not found' using errcode='22023'; end if;

  -- truck (optional change) — same insurance gate as posting fresh
  if nullif(p->>'truck_id','') is not null and (p->>'truck_id')::uuid is distinct from v_row.truck_id then
    select * into v_truck from app_private.fleet_trucks where id = (p->>'truck_id')::uuid and carrier_id = v_org;
    if v_truck.id is null then raise exception 'truck not found for your account' using errcode='42501'; end if;
    perform app_private.assert_vin_dispatchable(v_org, v_truck.vin);
  end if;

  v_city  := coalesce(nullif(initcap(btrim(coalesce(p->>'origin_city',''))), ''), v_row.origin_city);
  v_state := coalesce(nullif(upper(btrim(coalesce(p->>'origin_state',''))), ''), v_row.origin_state);
  v_zip   := case when p ? 'origin_zip' then nullif(regexp_replace(coalesce(p->>'origin_zip',''), '\D', '', 'g'), '') else v_row.origin_zip end;
  if v_zip is not null and v_zip !~ '^\d{5}$' then raise exception 'ZIP must be 5 digits.' using errcode='22023'; end if;
  if v_city is null or v_state is null then raise exception 'City and state required.' using errcode='22023'; end if;

  v_kind := coalesce(nullif(btrim(p->>'post_kind'),''), v_row.post_kind, 'empty');
  if v_kind not in ('empty','backhaul') then raise exception 'post_kind must be empty or backhaul' using errcode='22023'; end if;
  v_dest := case when p ? 'dest_pref' then nullif(btrim(coalesce(p->>'dest_pref','')),'') else v_row.dest_pref end;
  if v_kind = 'backhaul' and coalesce(btrim(coalesce(v_dest,'')),'') = '' then
    raise exception 'A backhaul post needs where you want to reload toward.' using errcode='22023'; end if;

  -- Dates: the app blanks them on every reopen, so a patch that carries them is the carrier
  -- restating the window today — store it verbatim, no clamping.
  if nullif(p->>'available_from','') is not null and nullif(p->>'available_to','') is not null then
    v_from := (p->>'available_from')::date; v_to := (p->>'available_to')::date; v_dates := true;
    if v_to < v_from then raise exception 'The end date cannot be before the start date.' using errcode='22023'; end if;
    if v_to < current_date then raise exception 'That window has already passed — pick today or later.' using errcode='22023'; end if;
  end if;

  v_eq := case when p ? 'equipment'
               then coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'equipment','[]'::jsonb)) x), '{}')
               else v_row.equipment end;

  if v_zip is not null then perform app_private.geo_enqueue('ZIP ' || v_zip, 'truck_posting_zip'); select lat, lng into v_lat, v_lng from app_private.geo_resolve('ZIP ' || v_zip); end if;
  if v_lat is null then select lat, lng into v_lat, v_lng from app_private.geo_resolve(v_city || ', ' || v_state); end if;

  update app_private.truck_postings
     set truck_id      = coalesce(nullif(p->>'truck_id','')::uuid, truck_id),
         origin_city   = v_city, origin_state = v_state, origin_zip = v_zip,
         origin        = v_city || ', ' || v_state,
         origin_lat    = v_lat::double precision, origin_lng = v_lng::double precision,  -- null → geo_tick refills
         post_kind     = v_kind,
         dest_pref     = v_dest,
         equipment     = v_eq,
         radius_miles  = case when p ? 'radius_miles' then coalesce(nullif(p->>'radius_miles','')::int, radius_miles) else radius_miles end,
         min_rpm       = case when p ? 'min_rpm'      then nullif(p->>'min_rpm','')::numeric else min_rpm end,
         notes         = case when p ? 'notes'        then nullif(btrim(coalesce(p->>'notes','')),'') else notes end,
         auto_request  = case when p ? 'auto_request' then coalesce((p->>'auto_request')::boolean, false) else auto_request end,
         available_from = case when v_dates then v_from else least(coalesce(available_from, current_date), current_date) end,
         available_to   = case when v_dates then v_to   else greatest(coalesce(available_to, current_date), current_date) end,
         last_confirmed_at = now(),
         status = 'active',
         updated_at = now()
   where id = p_id and carrier_id = v_org;

  v_n := app_private.tp_run_matcher(p_id);
  perform app_private.log_audit('carrier.update_truck_posting_place','truck_posting',p_id::text,null,'availability updated and confirmed',p);
  return jsonb_build_object('ok', true, 'id', p_id, 'matches', v_n, 'geocoded', (v_lat is not null));
end $function$;

-- 3) status: expose the paused ("not available") count -------------------------------------------
create or replace function public.cc_my_availability_status()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'app_private, public'
as $function$
declare v_org uuid; v_trucks int; v_drivers int; v_live int; v_fresh int; v_paused int; v_last timestamptz;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  select count(*) into v_trucks  from app_private.fleet_trucks  where carrier_id = v_org and coalesce(status,'active') not in ('inactive','retired');
  select count(*) into v_drivers from app_private.fleet_drivers where carrier_id = v_org and coalesce(status,'active') not in ('inactive','retired');
  select count(*) filter (where status='active' and available_to >= current_date),
         count(*) filter (where status='active' and available_to >= current_date and last_confirmed_at >= now() - interval '24 hours'),
         count(*) filter (where status='paused'),
         max(last_confirmed_at) filter (where status='active')
    into v_live, v_fresh, v_paused, v_last
    from app_private.truck_postings where carrier_id = v_org;
  return jsonb_build_object(
    'has_truck', v_trucks > 0, 'has_driver', v_drivers > 0,
    'trucks', v_trucks, 'drivers', v_drivers,
    'live', v_live, 'fresh', v_fresh, 'paused', v_paused,
    'last_confirmed_at', v_last,
    'hours_since_confirm', case when v_last is null then null else floor(extract(epoch from (now() - v_last))/3600)::int end,
    'dispatcher_active', v_fresh > 0,
    'needs_update', v_fresh = 0);
end $function$;

-- 4) Grants --------------------------------------------------------------------------------------
revoke all on function public.cc_set_truck_posting_available(uuid, boolean) from public, anon;
revoke all on function public.cc_update_truck_posting_place(uuid, jsonb) from public, anon;
revoke all on function public.cc_my_availability_status() from public, anon;
grant execute on function public.cc_set_truck_posting_available(uuid, boolean) to authenticated, service_role;
grant execute on function public.cc_update_truck_posting_place(uuid, jsonb) to authenticated, service_role;
grant execute on function public.cc_my_availability_status() to authenticated, service_role;

commit;
