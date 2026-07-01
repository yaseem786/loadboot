-- cuz_carrier_trip_timeline.sql
-- Carrier-facing event history/timeline for their OWN trip (dispatched/confirmed/started/location/issues/
-- delivered/POD). Self-scoped via my_carrier_org(); powers the "History" modal in the Carrier Portal.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create or replace function public.cc_pocket_trip_timeline(p_trip uuid)
returns table(id uuid, kind text, note text, from_status text, to_status text, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_org uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  if not exists (select 1 from app_private.trips t where t.id=p_trip and t.carrier_id=v_org) then
    raise exception 'trip not found for your account' using errcode='42501';
  end if;
  return query
    select e.id, e.kind, e.note, e.from_status, e.to_status, e.created_at
    from app_private.trip_events e where e.trip_id=p_trip order by e.created_at desc limit 100;
end; $$;
revoke execute on function public.cc_pocket_trip_timeline(uuid) from anon, public;
grant  execute on function public.cc_pocket_trip_timeline(uuid) to authenticated;
