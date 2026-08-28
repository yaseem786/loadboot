-- bl_disp_0290 — Dispatcher Workspace P1 (cont.): real-trip tools on an approved booking.
-- Once staff approve a booking it has a trip_id. The dispatcher can now read the CC trip
-- (timeline, dwell stops, PODs, RC, last GPS) and act on it (arrive/depart, check-in, request
-- detention/TONU/layover, report an issue) through the SAME carrier-facing engines the carrier
-- uses — acting as the carrier via app.dispatch_as (bl_disp_0289), plus can_touch_trip() gains
-- the same assignment-scoped clause. Additive. Staging first, then prod.

create or replace function app_private.can_touch_trip(p_trip uuid)
returns boolean language sql stable set search_path = app_private, public as $$
  select public.has_global_permission('dispatch.manage')
      or exists (
        select 1
          from app_private.trips t
          join public.organization_memberships om
            on om.org_id = t.carrier_id and om.user_id = auth.uid() and om.status = 'active'
         where t.id = p_trip
           and ( om.member_role is distinct from 'driver'
                 or (t.driver_id is not null and t.driver_id = app_private.my_fleet_driver_id()) )
      )
      -- assigned dispatcher, only inside a dispatcher_* wrapper (app.dispatch_as is transaction-local)
      or exists (
        select 1
          from app_private.trips t
          join app_private.dispatcher_assignments a on a.carrier_org_id = t.carrier_id
         where t.id = p_trip
           and a.dispatcher_user_id = auth.uid() and a.status = 'active'
           and a.carrier_org_id::text = nullif(current_setting('app.dispatch_as', true), '')
      );
$$;

-- one read: everything the dispatcher needs about the trip behind a booking
create or replace function public.dispatcher_trip(p_org uuid, p_trip uuid)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_t record; v_tl jsonb; v_pods jsonb; v_rc jsonb; v_dwell jsonb; v_acc jsonb; v_exc jsonb;
begin
  begin perform app_private.disp_act_as(p_org); exception when others then return jsonb_build_object('error', sqlerrm); end;
  select * into v_t from app_private.trips where id = p_trip and carrier_id = p_org;
  if v_t.id is null then return jsonb_build_object('error','trip not found for this carrier'); end if;
  begin select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_tl from public.cc_pocket_trip_timeline(p_trip) x; exception when others then v_tl := '[]'::jsonb; end;
  begin select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_pods from public.cc_pocket_trip_pods(p_trip) x; exception when others then v_pods := '[]'::jsonb; end;
  begin v_rc := public.cc_my_rate_confirmation(p_trip); exception when others then v_rc := null; end;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('stop', d.stop_type, 'arrived_at', d.arrived_at, 'departed_at', d.departed_at, 'free_minutes', d.free_minutes) order by d.arrived_at), '[]'::jsonb)
      into v_dwell from app_private.trip_dwell_events d where d.trip_id = p_trip;
  exception when others then v_dwell := '[]'::jsonb; end;
  begin v_acc := public.cc_trip_accessorials(p_trip); exception when others then v_acc := '[]'::jsonb; end;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'status', x.status, 'description', x.description, 'created_at', x.created_at) order by x.created_at desc), '[]'::jsonb)
      into v_exc from app_private.trip_exceptions x where x.trip_id = p_trip;
  exception when others then v_exc := '[]'::jsonb; end;
  return jsonb_build_object(
    'trip', jsonb_build_object('id', v_t.id, 'status', v_t.status, 'rate', v_t.rate, 'miles', v_t.miles, 'driver_name', v_t.driver_name, 'driver_phone', v_t.driver_phone,
       'truck_no', v_t.truck_no, 'scheduled_pickup', v_t.scheduled_pickup, 'scheduled_delivery', v_t.scheduled_delivery, 'dispatched_at', v_t.dispatched_at,
       'started_at', v_t.started_at, 'delivered_at', v_t.delivered_at, 'last_lat', v_t.last_lat, 'last_lng', v_t.last_lng, 'last_loc_at', v_t.last_loc_at,
       'tracking_method', v_t.tracking_method, 'pickup_risk', v_t.pickup_risk, 'must_depart_by', v_t.must_depart_by),
    'stops', coalesce((select jsonb_agg(jsonb_build_object('kind', s.kind, 'sort', s.sort, 'location', s.location, 'scheduled_at', s.scheduled_at, 'arrived_at', s.arrived_at, 'departed_at', s.departed_at) order by s.sort) from app_private.trip_stops s where s.trip_id = p_trip), '[]'::jsonb),
    'timeline', v_tl, 'pods', v_pods, 'rc', v_rc, 'dwell', v_dwell, 'accessorials', v_acc, 'exceptions', v_exc);
end $$;

-- one action: arrive / depart / checkin / accessorial / issue — all through the carrier engines
create or replace function public.dispatcher_trip_action(p_org uuid, p_trip uuid, p_action text, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v jsonb; v_id uuid; v_b uuid;
begin
  begin perform app_private.disp_act_as(p_org); exception when others then return jsonb_build_object('error', sqlerrm); end;
  if not exists (select 1 from app_private.trips where id = p_trip and carrier_id = p_org) then return jsonb_build_object('error','trip not found for this carrier'); end if;
  begin
    if p_action = 'arrive' then
      v := public.cc_trip_arrive(p_trip, coalesce(p->>'stop','pickup'), coalesce(nullif(p->>'free_minutes','')::int, 120));
    elsif p_action = 'depart' then
      v := public.cc_trip_depart(p_trip, coalesce(p->>'stop','pickup'), nullif(p->>'lat','')::double precision, nullif(p->>'lng','')::double precision);
    elsif p_action = 'checkin' then
      v := public.cc_trip_checkin(p_trip, nullif(p->>'lat','')::double precision, nullif(p->>'lng','')::double precision, p->>'note', 'carrier_update');
    elsif p_action = 'accessorial' then
      v := public.cc_carrier_request_accessorial(p_trip, p->>'kind', p->>'note', nullif(p->>'amount','')::numeric);
    elsif p_action = 'issue' then
      v_id := public.cc_pocket_report_issue(p_trip, p->>'kind', p->>'note'); v := jsonb_build_object('ok', true, 'id', v_id);
    else
      return jsonb_build_object('error','bad action');
    end if;
  exception when others then return jsonb_build_object('error', sqlerrm); end;
  -- mirror on the booking timeline so the dispatcher's own record stays complete
  select id into v_b from app_private.dispatcher_bookings where trip_id = p_trip and dispatcher_user_id = auth.uid() limit 1;
  if v_b is not null then
    insert into app_private.dispatcher_booking_events (booking_id, kind, note, location, created_by)
      values (v_b, case when p_action in ('accessorial','issue') then 'exception' when p_action = 'checkin' then 'check_call' else 'status' end,
              '[trip:' || p_action || '] ' || coalesce(p->>'stop', p->>'kind', '') || coalesce(' — ' || (p->>'note'), ''), p->>'location', auth.uid());
  end if;
  return coalesce(v, jsonb_build_object('ok', true));
end $$;

revoke all on function public.dispatcher_trip(uuid, uuid) from public, anon;
revoke all on function public.dispatcher_trip_action(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.dispatcher_trip(uuid, uuid), public.dispatcher_trip_action(uuid, uuid, text, jsonb) to authenticated;
