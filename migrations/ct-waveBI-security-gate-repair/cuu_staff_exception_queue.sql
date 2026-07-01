-- cuu_staff_exception_queue.sql
-- Command Center queue for carrier/driver-reported trip exceptions (detention, TONU, accident, ...).
-- Staff with dispatch.manage list open/resolved exceptions (with carrier + load context) and resolve them.
-- Closes the loop with cur_report_issue_kinds (the carrier-side reporting).
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

alter table app_private.trip_exceptions add column if not exists resolved_by uuid;
alter table app_private.trip_exceptions add column if not exists resolution_note text;

create or replace function public.cc_list_exceptions(p_status text default 'open', p_limit integer default 100)
returns table(id uuid, trip_id uuid, kind text, description text, status text, created_at timestamptz, resolved_at timestamptz,
              carrier_name text, origin text, destination text, resolution_note text)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
begin
  if not public.has_global_permission('dispatch.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  return query
    select e.id, e.trip_id, e.kind, e.description, e.status, e.created_at, e.resolved_at,
           o.name, l.origin, l.destination, e.resolution_note
    from app_private.trip_exceptions e
    left join app_private.trips t on t.id=e.trip_id
    left join public.loads l on l.id=t.load_id
    left join public.organizations o on o.id=t.carrier_id
    where (p_status is null or e.status=p_status)
    order by (e.status='open') desc, e.created_at desc
    limit least(greatest(coalesce(p_limit,100),1),500);
end; $$;
revoke execute on function public.cc_list_exceptions(text,integer) from anon, public;
grant  execute on function public.cc_list_exceptions(text,integer) to authenticated;

create or replace function public.cc_resolve_exception(p_id uuid, p_note text default null)
returns text
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_status text; v_trip uuid;
begin
  if not public.has_global_permission('dispatch.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  select status, trip_id into v_status, v_trip from app_private.trip_exceptions where id=p_id for update;
  if v_status is null then raise exception 'exception not found' using errcode='22023'; end if;
  if v_status='resolved' then return 'resolved'; end if; -- idempotent
  update app_private.trip_exceptions set status='resolved', resolved_at=now(), resolved_by=auth.uid(), resolution_note=p_note where id=p_id;
  perform app_private.emit_event('trip.exception.resolved','trip', v_trip::text, jsonb_build_object('exception',p_id));
  perform app_private.log_audit('exception.resolve','trip_exception',p_id::text,null,'resolved', jsonb_build_object('note_present',coalesce(btrim(p_note),'')<>''));
  return 'resolved';
end; $$;
revoke execute on function public.cc_resolve_exception(uuid,text) from anon, public;
grant  execute on function public.cc_resolve_exception(uuid,text) to authenticated;

-- Register the module in the platform catalog (idempotent).
insert into app_private.platform_modules(id, name, description, area, route, status, owning_team, permissions, events_produced, events_consumed, data_classification, version)
select gen_random_uuid(), 'Trip Exceptions', 'Dispatch queue for carrier/driver-reported trip exceptions (detention, TONU, accident, breakdown); staff resolve each with a note.', 'Operations', '/exceptions', 'LIVE', 'Dispatch',
  array['dispatch.manage'], array['trip.exception.resolved'], array['trip.exception'], 'internal', 1
where not exists (select 1 from app_private.platform_modules where route='/exceptions');
