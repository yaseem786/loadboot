-- cva_carrier_my_exceptions.sql
-- Carrier-facing list of exceptions on their OWN trips (with resolution status), so a carrier can track the
-- detention/TONU/accident/breakdown issues they reported. Self-scoped via my_carrier_org().
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create or replace function public.cc_pocket_my_exceptions(p_limit integer default 50)
returns table(id uuid, trip_id uuid, kind text, description text, status text, created_at timestamptz, resolved_at timestamptz, origin text, destination text)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_org uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  return query
    select e.id, e.trip_id, e.kind, e.description, e.status, e.created_at, e.resolved_at, l.origin, l.destination
    from app_private.trip_exceptions e
    join app_private.trips t on t.id=e.trip_id and t.carrier_id=v_org
    left join public.loads l on l.id=t.load_id
    order by e.created_at desc
    limit least(greatest(coalesce(p_limit,50),1),200);
end; $$;
revoke execute on function public.cc_pocket_my_exceptions(integer) from anon, public;
grant  execute on function public.cc_pocket_my_exceptions(integer) to authenticated;
