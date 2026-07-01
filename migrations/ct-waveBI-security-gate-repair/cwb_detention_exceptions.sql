-- cwb_detention_exceptions.sql
-- Increments 52–53 — DETENTION / ACCESSORIAL AUTOMATION + EXCEPTION CENTER (additive; extends the existing
-- trip_exceptions / trip_accessorials base from wave 3 rather than replacing it).
--
-- What it adds:
--   * app_private.trip_dwell_events — REAL arrive/depart timestamps per stop (pickup/delivery). No invented
--     times: rows are created only by an explicit arrive/depart action from the carrier or staff.
--   * cc_trip_arrive / cc_trip_depart — carrier self-scoped (own trip) or staff (dispatch.manage). Departure
--     returns the measured dwell + detention minutes (dwell beyond free time) computed from the recorded stamps.
--   * cc_detention_scan — finds stops still ON SITE past their free window, auto-logs ONE 'detention' exception
--     per stop (deduped via detention_exception column) and creates a DRAFT accessorial: billable stays as
--     dispatcher review — the draft's note states the $/hr ASSUMPTION used so nothing is silently invoiced.
--   * cc_exception_center — enriched Exception Center read (dispatch.view): lane, carrier, age, dwell context,
--     accessorial totals per trip.
-- Honesty: detention minutes are arithmetic on recorded timestamps; draft amounts are labeled estimates
-- requiring human review; the scan never bills anything by itself.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create table if not exists app_private.trip_dwell_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references app_private.trips(id) on delete cascade,
  stop_type text not null check (stop_type in ('pickup','delivery')),
  arrived_at timestamptz not null default now(),
  departed_at timestamptz,
  free_minutes integer not null default 120,
  detention_exception uuid,          -- set once when the scan auto-logs detention (dedupe)
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (trip_id, stop_type)
);

-- Shared gate: staff with dispatch.manage OR the carrier who owns the trip.
create or replace function app_private.can_touch_trip(p_trip uuid)
returns boolean language sql stable set search_path to 'app_private, public'
as $$
  select public.has_global_permission('dispatch.manage')
      or exists (select 1 from app_private.trips t
                 where t.id=p_trip and t.carrier_id = app_private.my_carrier_org());
$$;

create or replace function public.cc_trip_arrive(p_trip uuid, p_stop text, p_free_minutes integer default 120)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_id uuid;
begin
  if p_stop not in ('pickup','delivery') then raise exception 'invalid stop type' using errcode='22023'; end if;
  if not app_private.can_touch_trip(p_trip) then raise exception 'not authorized' using errcode='42501'; end if;
  insert into app_private.trip_dwell_events(trip_id, stop_type, free_minutes, created_by)
    values (p_trip, p_stop, least(greatest(coalesce(p_free_minutes,120),0),1440), auth.uid())
    returning id into v_id;
  perform app_private.log_audit('dispatch.dwell.arrive','trip',p_trip::text,null,'arrived at '||p_stop, jsonb_build_object('stop',p_stop));
  perform app_private.emit_event('trip.arrived','trip',p_trip::text, jsonb_build_object('stop',p_stop));
  return jsonb_build_object('ok',true,'dwell_id',v_id,'arrived_at',now(),'free_minutes',least(greatest(coalesce(p_free_minutes,120),0),1440));
exception when unique_violation then
  raise exception 'arrival already recorded for this stop' using errcode='22023';
end; $$;
revoke execute on function public.cc_trip_arrive(uuid, text, integer) from anon, public;
grant  execute on function public.cc_trip_arrive(uuid, text, integer) to authenticated;

create or replace function public.cc_trip_depart(p_trip uuid, p_stop text)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare d record; v_dwell int; v_det int;
begin
  if p_stop not in ('pickup','delivery') then raise exception 'invalid stop type' using errcode='22023'; end if;
  if not app_private.can_touch_trip(p_trip) then raise exception 'not authorized' using errcode='42501'; end if;
  update app_private.trip_dwell_events
     set departed_at = now()
   where trip_id=p_trip and stop_type=p_stop and departed_at is null
   returning * into d;
  if d.id is null then raise exception 'no open arrival for this stop' using errcode='22023'; end if;
  v_dwell := floor(extract(epoch from (d.departed_at - d.arrived_at))/60)::int;
  v_det := greatest(v_dwell - d.free_minutes, 0);
  perform app_private.log_audit('dispatch.dwell.depart','trip',p_trip::text,null,
    format('departed %s after %s min (detention %s min)', p_stop, v_dwell, v_det),
    jsonb_build_object('stop',p_stop,'dwell_minutes',v_dwell,'detention_minutes',v_det));
  perform app_private.emit_event('trip.departed','trip',p_trip::text,
    jsonb_build_object('stop',p_stop,'dwell_minutes',v_dwell,'detention_minutes',v_det));
  return jsonb_build_object('ok',true,'stop',p_stop,'dwell_minutes',v_dwell,
    'free_minutes',d.free_minutes,'detention_minutes',v_det,
    'note', case when v_det>0 then 'detention measured from recorded arrive/depart stamps — file an accessorial for review' else 'within free time' end);
end; $$;
revoke execute on function public.cc_trip_depart(uuid, text) from anon, public;
grant  execute on function public.cc_trip_depart(uuid, text) to authenticated;

-- DETENTION SCAN — staff/automation. For stops still on site past free time (no departure), logs ONE
-- 'detention' exception (deduped) and a DRAFT accessorial with a LABELED $/hr assumption. Never bills.
create or replace function public.cc_detention_scan(p_rate_per_hour numeric default 50)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare d record; v_exc uuid; v_over int; v_amount numeric; v_created int:=0; v_list jsonb:='[]'::jsonb;
begin
  if not public.has_global_permission('dispatch.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  for d in
    select dw.*, t.carrier_id, l.origin, l.destination
      from app_private.trip_dwell_events dw
      join app_private.trips t on t.id=dw.trip_id
      left join public.loads l on l.id=t.load_id
     where dw.departed_at is null and dw.detention_exception is null
       and now() > dw.arrived_at + make_interval(mins => dw.free_minutes)
     order by dw.arrived_at
  loop
    -- minutes past the free window, from the recorded arrival stamp (transparent arithmetic)
    v_over := floor(extract(epoch from (now() - (d.arrived_at + make_interval(mins => d.free_minutes))))/60)::int;
    insert into app_private.trip_exceptions(trip_id, kind, description, created_by)
      values (d.trip_id, 'detention',
        format('AUTO: still at %s %s min past the %s-min free window (arrived %s). Measured from recorded arrival — no departure logged yet.',
               d.stop_type, v_over, d.free_minutes, to_char(d.arrived_at,'MM-DD HH24:MI')), null)
      returning id into v_exc;
    update app_private.trip_dwell_events set detention_exception = v_exc where id = d.id;
    v_amount := round((ceil(v_over/60.0)) * coalesce(p_rate_per_hour,50), 2);
    insert into app_private.trip_accessorials(trip_id, kind, amount, billable, note, created_by)
      values (d.trip_id, 'detention', v_amount, false,
        format('DRAFT (auto): %s min detention so far × $%s/hr ASSUMPTION — review, edit and mark billable manually.', v_over, coalesce(p_rate_per_hour,50)), null);
    perform app_private.emit_event('trip.detention','trip',d.trip_id::text,
      jsonb_build_object('stop',d.stop_type,'minutes_over',v_over,'draft_amount',v_amount));
    v_created := v_created + 1;
    v_list := v_list || jsonb_build_object('trip', d.trip_id, 'lane', coalesce(d.origin,'?')||' → '||coalesce(d.destination,'?'),
      'stop', d.stop_type, 'minutes_over', v_over, 'draft_amount', v_amount);
  end loop;
  return jsonb_build_object('ok',true,'detected',v_created,'items',v_list,
    'note','draft accessorials are NOT billable until a dispatcher reviews them');
end; $$;
revoke execute on function public.cc_detention_scan(numeric) from anon, public;
grant  execute on function public.cc_detention_scan(numeric) to authenticated;

-- EXCEPTION CENTER read — enriched (dispatch.view): lane, carrier, age, open dwell + accessorial context.
create or replace function public.cc_exception_center(p_status text default 'open', p_limit integer default 100)
returns table(id uuid, trip_id uuid, kind text, description text, status text,
  created_at timestamptz, resolved_at timestamptz, resolution_note text,
  carrier_name text, origin text, destination text, age_minutes integer,
  accessorial_total numeric, accessorial_draft numeric, on_site text)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
begin
  if not public.has_global_permission('dispatch.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query
    select e.id, e.trip_id, e.kind, e.description, e.status, e.created_at, e.resolved_at, e.resolution_note,
      o.name, l.origin, l.destination,
      (floor(extract(epoch from (now() - e.created_at))/60))::int,
      coalesce((select sum(a.amount) from app_private.trip_accessorials a where a.trip_id=e.trip_id and a.billable), 0),
      coalesce((select sum(a.amount) from app_private.trip_accessorials a where a.trip_id=e.trip_id and not a.billable), 0),
      (select dw.stop_type||' since '||to_char(dw.arrived_at,'MM-DD HH24:MI')
         from app_private.trip_dwell_events dw
        where dw.trip_id=e.trip_id and dw.departed_at is null
        order by dw.arrived_at desc limit 1)
    from app_private.trip_exceptions e
    left join app_private.trips t on t.id=e.trip_id
    left join public.loads l on l.id=t.load_id
    left join public.organizations o on o.id=t.carrier_id
    where (p_status is null or e.status=p_status)
    order by (e.status='open') desc, e.created_at desc
    limit least(greatest(coalesce(p_limit,100),1),500);
end; $$;
revoke execute on function public.cc_exception_center(text, integer) from anon, public;
grant  execute on function public.cc_exception_center(text, integer) to authenticated;
