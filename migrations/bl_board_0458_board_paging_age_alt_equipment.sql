-- bl_board_0458 — carrier board: paging, post age, delivery pin; alternate equipment in matching;
-- exact pins in "Post similar". Follow-ups from claude/BOARD-AUDIT-0457.md (audit #1, #2, 0457b/c/d).
--
-- 1. public.cc_pocket_available_loads
--    * new p_offset (default 0) → "Load more" on the board (audit #2). Page size stays capped at 50.
--      Order gets l.id as a tie-breaker so pages are stable.
--    * new columns posted_at (loads.created_at = when it reached the board, audit #1) and
--      delivery_lat/lng rounded to 0.1° exactly like the pickup pin (0457c radius search).
--    The body is patched in place from the live definition (prod and staging differ: prod has the
--    demo-isolation line), so each env keeps its own body. Signature changes → drop + create, and the
--    ACL is set explicitly (revoke public, anon — Supabase's default ACL would grant anon).
--    dispatcher_board calls it positionally with one arg; that still resolves.
-- 2. app_private.match_eligibility — counts details->'alt_equipment' (0457d). A truck that is exactly
--    the primary or an alternate is 'match'; one that equip_serves() either is 'compatible'.
--    Same signature → create or replace keeps the ACL (postgres only).
-- 3. public.cc_partner_load_full — returns the four pins so "Post similar" needs no re-geocoding.
--    Broker's own load only (unchanged guard). jsonb return → create or replace keeps the ACL.

do $mig$
declare
  v_old text;
  v_new text;
  v_prev text;
begin
  select pg_get_functiondef('public.cc_pocket_available_loads(integer)'::regprocedure) into v_old;
  v_new := v_old;

  v_prev := v_new;
  v_new := replace(v_new, 'cc_pocket_available_loads(p_limit integer DEFAULT 24)',
                          'cc_pocket_available_loads(p_limit integer DEFAULT 24, p_offset integer DEFAULT 0)');
  if v_new = v_prev then raise exception '0458: signature anchor not found'; end if;

  v_prev := v_new;
  v_new := replace(v_new, 'direct_offer_expired boolean)',
                          'direct_offer_expired boolean, posted_at timestamp with time zone, delivery_lat double precision, delivery_lng double precision)');
  if v_new = v_prev then raise exception '0458: returns anchor not found'; end if;

  v_prev := v_new;
  v_new := replace(v_new, E'oe.expiry_at <= now())\n    from public.loads l',
                          E'oe.expiry_at <= now()),\n      l.created_at,\n      round(l.delivery_lat::numeric,1)::double precision, round(l.delivery_lng::numeric,1)::double precision\n    from public.loads l');
  if v_new = v_prev then raise exception '0458: select-list anchor not found'; end if;

  v_prev := v_new;
  v_new := replace(v_new, E'l.created_at desc\n    limit greatest(1, least(coalesce(p_limit,24),50));',
                          E'l.created_at desc, l.id desc\n    limit greatest(1, least(coalesce(p_limit,24),50))\n    offset greatest(0, least(coalesce(p_offset,0),5000));');
  if v_new = v_prev then raise exception '0458: order/limit anchor not found'; end if;

  drop function public.cc_pocket_available_loads(integer);
  execute v_new;
end
$mig$;

revoke execute on function public.cc_pocket_available_loads(integer, integer) from public, anon;
grant execute on function public.cc_pocket_available_loads(integer, integer) to authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.match_eligibility(p_load uuid)
 RETURNS TABLE(carrier_id uuid, carrier text, eligible boolean, hard_fails text[], missing_data text[], compliant boolean, trucks integer, active_trips integer, available_trucks integer, drivers integer, available_drivers integer, equipment_match text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private', 'public'
AS $function$
declare v_equip text; v_alt text[];
begin
  if not exists (select 1 from public.loads where id=p_load) then raise exception 'load not found' using errcode='22023'; end if;
  -- 0458: alternates the broker accepts ("Van OR Reefer"), details.alt_equipment from the wizard
  select l.equipment,
         case when jsonb_typeof(l.details->'alt_equipment') = 'array'
              then array(select btrim(x) from jsonb_array_elements_text(l.details->'alt_equipment') x where btrim(x) <> '')
              else '{}'::text[] end
    into v_equip, v_alt
    from public.loads l where l.id=p_load;
  if v_equip is null or btrim(v_equip) = '' then v_alt := '{}'::text[]; end if;
  return query
  with c as (
    select o.id, o.name, coalesce(o.status,'') ostatus, coalesce(o.broker_visible,false) bvis,
      app_private.carrier_mandatory_ok(o.id) compliant,
      (select count(*) from app_private.fleet_trucks t where t.carrier_id=o.id and coalesce(t.status,'active')<>'inactive')::int trucks,
      (select count(*) from app_private.fleet_trucks t where t.carrier_id=o.id and coalesce(t.status,'active')<>'inactive'
          and (v_equip is null or lower(trim(t.equipment))=lower(trim(v_equip))
               or exists (select 1 from unnest(v_alt) ae(eq) where lower(trim(t.equipment))=lower(ae.eq))))::int exact_trucks,
      (select count(*) from app_private.fleet_trucks t where t.carrier_id=o.id and coalesce(t.status,'active')<>'inactive'
          and (app_private.equip_serves(v_equip, t.equipment)
               or exists (select 1 from unnest(v_alt) ae(eq) where app_private.equip_serves(ae.eq, t.equipment))))::int equip_trucks,
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
      || (case when v_equip is not null and c.trucks>0 and c.equip_trucks=0
               then array['no compatible equipment for '||v_equip
                          ||case when cardinality(v_alt)>0 then ' or '||array_to_string(v_alt,' / ') else '' end]
               else '{}'::text[] end)
      || (case when c.drivers>0 and c.avail_drivers=0 then array['no available driver (license/medical current)'] else '{}'::text[] end)
        as hf,
      (case when c.trucks=0 then array['no trucks on file'] else '{}'::text[] end)
      || (case when c.drivers=0 then array['no drivers on file'] else '{}'::text[] end)
        as md
  ) e
  order by eligible desc, c.compliant desc, c.name;
end; $function$;

CREATE OR REPLACE FUNCTION public.cc_partner_load_full(p_load uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare v_org uuid; pl app_private.partner_loads;
begin
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  select * into pl from app_private.partner_loads where id = p_load and broker_org = v_org;
  if pl.id is null then raise exception 'load not found' using errcode='22023'; end if;
  return jsonb_build_object(
    'id', pl.id, 'origin', pl.origin, 'destination', pl.destination,
    'origin_full', pl.origin_full, 'destination_full', pl.destination_full,
    'equipment', pl.equipment, 'rate', pl.rate, 'miles', pl.miles,
    'pickup_date', pl.pickup_date, 'delivery_date', pl.delivery_date,
    'pickup_window', pl.pickup_window, 'delivery_window', pl.delivery_window,
    'weight', pl.weight, 'commodity', pl.commodity, 'reference', pl.reference,
    'appointment_required', pl.appointment_required, 'tracking_required', pl.tracking_required,
    'hazmat', pl.hazmat, 'hazmat_info', pl.hazmat_info,
    'accessorials', coalesce(pl.accessorials, '{}'::jsonb),
    'details', coalesce(pl.details, '{}'::jsonb),
    'status', pl.status,
    'pickup_lat', pl.pickup_lat, 'pickup_lng', pl.pickup_lng,
    'delivery_lat', pl.delivery_lat, 'delivery_lng', pl.delivery_lng,
    'broker_name', (select name from public.organizations where id = v_org));
end; $function$;
