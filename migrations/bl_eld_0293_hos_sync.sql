-- bl_eld_0293 — ELD hours-of-service → truck_availability.hos_drive_left_h (Samsara / Motive).
-- eld-poll already pulls GPS for carriers with an active integration + active trip. HOS matters
-- MORE when the truck is empty (the dispatcher plans the next load from it), so HOS targets are
-- every active integration, trip or not. The function posts back through eld_hos_ingest with the
-- same per-carrier ingest_token — no service-role write path is added.
-- Matching driver → truck: by driver name on truck_availability / fleet_drivers; a one-truck carrier
-- gets the single driver's clock regardless. Unmatched drivers are returned, never guessed onto a truck.
-- Additive. Staging first, then prod. No live ELD account exists on 28 Aug 2026 — parsers are per the
-- vendors' published docs (Samsara /fleet/hos/clocks: driveRemainingDurationMs; Motive v1/available_time).

-- ---- 0293b (applied on staging as a separate migration) — PROD BUG, fixed here too:
-- eld_integrations_status_check allowed only disconnected|connected|error, but carrier_eld_setup
-- INSERTs status='active' and eld_ingest / eld_poll_targets FILTER on 'active'. So "Connect ELD" has
-- always failed (23514) and the table has 0 rows on prod. Widening the check is the smallest fix that
-- makes every existing function consistent.
alter table app_private.eld_integrations drop constraint if exists eld_integrations_status_check;
alter table app_private.eld_integrations add constraint eld_integrations_status_check
  check (status = any (array['disconnected'::text, 'connected'::text, 'error'::text, 'active'::text]));

create or replace function public.eld_hos_targets()
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  if current_setting('request.jwt.claims', true)::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('provider', e.provider, 'api_token', e.api_token, 'ingest_token', e.ingest_token))
    from app_private.eld_integrations e
    where e.status = 'active' and e.api_token is not null and e.provider in ('samsara','motive')
      and exists (select 1 from app_private.dispatcher_assignments a where a.carrier_org_id = e.carrier_id and a.status = 'active')), '[]'::jsonb);
end $$;

-- p_drivers: [{name, drive_h, shift_h, cycle_h, status, at}]  (hours as numeric, status = driving|onDuty|offDuty|sleeper)
create or replace function public.eld_hos_ingest(p_token uuid, p_drivers jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_int record; d jsonb; v_matched int := 0; v_unmatched jsonb := '[]'::jsonb; v_trucks int; v_truck uuid; v_note text;
begin
  select * into v_int from app_private.eld_integrations where ingest_token = p_token and status = 'active';
  if v_int.id is null then raise exception 'invalid token' using errcode='42501'; end if;
  update app_private.eld_integrations set last_ping_at = now(), updated_at = now() where id = v_int.id;
  select count(*) into v_trucks from app_private.fleet_trucks t where t.carrier_id = v_int.carrier_id and coalesce(t.status,'active') <> 'retired';
  for d in select * from jsonb_array_elements(coalesce(p_drivers, '[]'::jsonb)) loop
    v_truck := null;
    -- 1) driver name already on an availability row
    select ta.truck_id into v_truck from app_private.truck_availability ta join app_private.fleet_trucks t on t.id = ta.truck_id
     where t.carrier_id = v_int.carrier_id and ta.driver_name is not null and lower(btrim(ta.driver_name)) = lower(btrim(d->>'name')) limit 1;
    -- 2) single-truck carrier and a single reported driver → that truck
    if v_truck is null and v_trucks = 1 and jsonb_array_length(coalesce(p_drivers,'[]'::jsonb)) = 1 then
      select t.id into v_truck from app_private.fleet_trucks t where t.carrier_id = v_int.carrier_id and coalesce(t.status,'active') <> 'retired' limit 1;
    end if;
    if v_truck is null then v_unmatched := v_unmatched || to_jsonb(d->>'name'); continue; end if;
    v_note := v_int.provider || ' · ' || coalesce(d->>'status','?')
           || coalesce(' · shift ' || round((d->>'shift_h')::numeric, 1) || 'h', '')
           || coalesce(' · cycle ' || round((d->>'cycle_h')::numeric, 1) || 'h', '')
           || ' · synced ' || to_char(now() at time zone 'America/New_York', 'Mon DD HH24:MI') || ' ET';
    insert into app_private.truck_availability as ta (truck_id, carrier_id, hos_drive_left_h, hos_note, driver_name, updated_by, updated_at)
      values (v_truck, v_int.carrier_id, round((d->>'drive_h')::numeric, 1), v_note, d->>'name', null, now())
    on conflict (truck_id) do update set
      hos_drive_left_h = excluded.hos_drive_left_h, hos_note = excluded.hos_note,
      driver_name = coalesce(ta.driver_name, excluded.driver_name), updated_at = now();
    v_matched := v_matched + 1;
  end loop;
  return jsonb_build_object('ok', true, 'matched', v_matched, 'unmatched', v_unmatched);
end $$;

revoke all on function public.eld_hos_targets() from public, anon, authenticated;
revoke all on function public.eld_hos_ingest(uuid, jsonb) from public, anon;
grant execute on function public.eld_hos_targets() to service_role;
grant execute on function public.eld_hos_ingest(uuid, jsonb) to service_role, authenticated;
