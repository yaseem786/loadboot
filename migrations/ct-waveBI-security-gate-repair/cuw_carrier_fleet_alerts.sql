-- cuw_carrier_fleet_alerts.sql
-- Carrier-facing compliance alerts: the caller's own drivers whose license or medical card is expired or
-- expiring within 60 days. Self-scoped via my_carrier_org(). Surfaced as a banner on the Fleet tab.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create or replace function public.cc_pocket_fleet_alerts()
returns table(driver_id uuid, name text, kind text, expires_on date, days_left int)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_org uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  return query
    select d.id, d.name, x.kind, x.exp, (x.exp - current_date)::int
    from app_private.fleet_drivers d
    cross join lateral (values ('license', d.license_exp), ('medical', d.medical_exp)) as x(kind, exp)
    where d.carrier_id=v_org and x.exp is not null and x.exp <= current_date + 60
    order by x.exp asc;
end; $$;
revoke execute on function public.cc_pocket_fleet_alerts() from anon, public;
grant  execute on function public.cc_pocket_fleet_alerts() to authenticated;
