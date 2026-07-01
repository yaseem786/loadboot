-- cvv_match_rank.sql
-- Increment 46 — Matching Stage B: EXPLAINABLE ranking. Ranks only the ELIGIBLE carriers from Stage A and
-- returns a score WITH a per-factor breakdown (no unexplained AI score). Reuses cc_match_eligibility + trip
-- history. Deadhead/ETA are honestly reported as unavailable when no carrier location exists (no invented GPS).
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create or replace function public.cc_match_rank(p_load uuid)
returns table(carrier_id uuid, carrier text, score integer, factors jsonb,
  available_trucks integer, active_trips integer, delivered bigint, on_time_pct integer,
  equipment_match text, loaded_rpm numeric, deadhead_note text, eta_note text, risks text[])
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_rate numeric; v_miles numeric;
begin
  if not public.has_global_permission('dispatch.view') then raise exception 'not authorized' using errcode='42501'; end if;
  if not exists (select 1 from public.loads where id=p_load) then raise exception 'load not found' using errcode='22023'; end if;
  select rate, miles into v_rate, v_miles from public.loads where id=p_load;
  return query
  with elig as (select * from public.cc_match_eligibility(p_load) where eligible),
  perf as (
    select org.id,
      (select count(*) from app_private.trips t where t.carrier_id=org.id and t.status in ('delivered','invoiced')) delivered,
      (select count(*) from app_private.trips t where t.carrier_id=org.id and t.status in ('delivered','invoiced') and t.delivered_at is not null and t.scheduled_delivery is not null) d_n,
      (select count(*) from app_private.trips t where t.carrier_id=org.id and t.status in ('delivered','invoiced') and t.delivered_at is not null and t.scheduled_delivery is not null and t.delivered_at<=t.scheduled_delivery) d_ot
    from public.organizations org where org.kind='carrier'
  )
  select e.carrier_id, e.carrier,
    (pts.p_comp + pts.p_cap + pts.p_avail + pts.p_perf + pts.p_equip + pts.p_drv)::int as score,
    jsonb_build_array(
      jsonb_build_object('factor','compliance','points',pts.p_comp,'detail','authority/insurance/compliance OK'),
      jsonb_build_object('factor','capacity','points',pts.p_cap,'detail',e.available_trucks||' truck(s) available'),
      jsonb_build_object('factor','availability','points',pts.p_avail,'detail',e.active_trips||' active trip(s)'),
      jsonb_build_object('factor','performance','points',pts.p_perf,'detail',coalesce(round(100.0*pf.d_ot/nullif(pf.d_n,0))::text||'% on-time','no delivery history')),
      jsonb_build_object('factor','equipment','points',pts.p_equip,'detail',e.equipment_match),
      jsonb_build_object('factor','drivers','points',pts.p_drv,'detail',e.available_drivers||' driver(s) available')
    ) as factors,
    e.available_trucks, e.active_trips, pf.delivered,
    (case when pf.d_n>0 then round(100.0*pf.d_ot/pf.d_n)::int else null end) as on_time_pct,
    e.equipment_match,
    (case when coalesce(v_miles,0)>0 then round(v_rate/v_miles,2) else null end) as loaded_rpm,
    'unavailable — no carrier location on file'::text as deadhead_note,
    'unavailable — enable tracking/location to compute ETA'::text as eta_note,
    e.missing_data as risks
  from elig e
  join perf pf on pf.id=e.carrier_id
  cross join lateral (
    select 30 as p_comp,
      least(20, e.available_trucks*10) as p_cap,
      greatest(0, 20 - e.active_trips*5) as p_avail,
      (case when pf.d_n>0 then round(20.0*pf.d_ot/pf.d_n)::int else 10 end) as p_perf,
      (case when e.equipment_match='match' then 10 else 0 end) as p_equip,
      least(10, e.available_drivers*5) as p_drv
  ) pts
  order by score desc, pf.delivered desc, e.carrier;
end; $$;
revoke execute on function public.cc_match_rank(uuid) from anon, public;
grant  execute on function public.cc_match_rank(uuid) to authenticated;
