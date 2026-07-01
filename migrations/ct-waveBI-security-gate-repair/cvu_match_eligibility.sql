-- cvu_match_eligibility.sql
-- Increment 45 — Matching Stage A: EXPLAINABLE hard-eligibility filters. Extends the existing matcher into a
-- two-stage engine. This stage returns, for every carrier org, whether it is ELIGIBLE for a load and — when not
-- — the exact structured hard-fail reasons, plus any missing data. An ineligible carrier is never silently
-- offered a load. Reuses carrier_mandatory_ok + fleet_trucks/fleet_drivers/trips. No fabricated data.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create or replace function public.cc_match_eligibility(p_load uuid)
returns table(carrier_id uuid, carrier text, eligible boolean, hard_fails text[], missing_data text[],
  compliant boolean, trucks integer, active_trips integer, available_trucks integer,
  drivers integer, available_drivers integer, equipment_match text)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_equip text;
begin
  if not public.has_global_permission('dispatch.view') then raise exception 'not authorized' using errcode='42501'; end if;
  if not exists (select 1 from public.loads where id=p_load) then raise exception 'load not found' using errcode='22023'; end if;
  select equipment into v_equip from public.loads where id=p_load;
  return query
  with c as (
    select o.id, o.name, coalesce(o.status,'') ostatus,
      app_private.carrier_mandatory_ok(o.id) compliant,
      (select count(*) from app_private.fleet_trucks t where t.carrier_id=o.id and coalesce(t.status,'active')<>'inactive')::int trucks,
      (select count(*) from app_private.fleet_trucks t where t.carrier_id=o.id and coalesce(t.status,'active')<>'inactive'
          and (v_equip is null or lower(trim(t.equipment))=lower(trim(v_equip))))::int equip_trucks,
      (select count(*) from app_private.fleet_drivers d where d.carrier_id=o.id)::int drivers,
      (select count(*) from app_private.fleet_drivers d where d.carrier_id=o.id and coalesce(d.status,'active')='active'
          and (d.license_exp is null or d.license_exp>=current_date) and (d.medical_exp is null or d.medical_exp>=current_date))::int avail_drivers,
      (select count(*) from app_private.trips t where t.carrier_id=o.id and t.status in ('planned','dispatched','in_transit'))::int active_trips
    from public.organizations o where o.kind='carrier' and coalesce(o.status,'') <> 'archived'
  )
  select c.id, c.name,
    (coalesce(array_length(e.hf,1),0)=0) as eligible,
    e.hf, e.md, c.compliant, c.trucks, c.active_trips, greatest(c.trucks - c.active_trips, 0) as available_trucks,
    c.drivers, c.avail_drivers,
    (case when v_equip is null then 'unknown' when c.trucks=0 then 'unknown' when c.equip_trucks>0 then 'match' else 'no_match' end) as equipment_match
  from c
  cross join lateral (
    select
      (case when c.ostatus<>'active' then array['carrier not active ('||c.ostatus||')'] else '{}'::text[] end)
      || (case when not c.compliant then array['compliance / authority / insurance incomplete'] else '{}'::text[] end)
      || (case when c.trucks>0 and c.active_trips>=c.trucks then array['no available truck (all on active trips)'] else '{}'::text[] end)
      || (case when v_equip is not null and c.trucks>0 and c.equip_trucks=0 then array['no compatible equipment for '||v_equip] else '{}'::text[] end)
      || (case when c.drivers>0 and c.avail_drivers=0 then array['no available driver (license/medical current)'] else '{}'::text[] end)
        as hf,
      (case when c.trucks=0 then array['no trucks on file'] else '{}'::text[] end)
      || (case when c.drivers=0 then array['no drivers on file'] else '{}'::text[] end)
        as md
  ) e
  order by eligible desc, c.compliant desc, c.name;
end; $$;
revoke execute on function public.cc_match_eligibility(uuid) from anon, public;
grant  execute on function public.cc_match_eligibility(uuid) to authenticated;
