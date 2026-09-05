-- bl_fin_0322 — PORT the per-trip P&L engine + carrier cost model from STAGING to PROD (audit F32, Sprint 2 item 1)
-- 2026-09-05 · Claude · staging-validated 21:3x UTC · APPLIED TO PROD 21:5x UTC on Yaseen's word; prod rollback test RESULT PASS (trip 55a9c732… net 1450→1560, 0 rows left)
--
-- WHY
--   app/carrier/app.js (Earnings / trip P&L / cost-model screens) calls six RPCs that exist on STAGING but NOT on PROD:
--     cc_trip_finance_add, cc_trip_finance_remove, cc_trip_pnl, cc_carrier_earnings, cc_set_cost_model, cc_get_cost_model
--   They come from two staging-only migrations of 11 Jul 2026 — `wd_0032_per_trip_pnl_engine` and
--   `wd_0033_carrier_cost_model_rpc` — that were never applied to prod; prod's own `wd_0032`/`wd_0033` are DIFFERENT
--   migrations (number reuse), which is why nobody noticed. On prod the carrier Earnings UI therefore errors or shows
--   empty values that read as "$0".
--
-- WHAT THIS FILE IS
--   The two staging statements, verbatim (source: staging supabase_migrations.schema_migrations), followed by explicit
--   grants and an ACL re-check. Nothing else changed. Additive: 4 nullable columns on carrier_dispatch_prefs, 1 new
--   table app_private.trip_finance_items, 6 new public RPCs. No existing object is altered or dropped.
--
-- PRE-FLIGHT DONE ON PROD (5 Sep, read-only)
--   • app_private.trips: id, carrier_id, load_id, miles(int), rate, status, started_at, delivered_at, created_at — present
--   • public.loads: id, miles(int), deadhead(int), rate, origin, destination — present
--   • app_private.trip_accessorials: trip_id, amount, status, billable, kind, created_at — present
--   • app_private.carrier_dispatch_prefs: carrier_id (PRIMARY KEY → ON CONFLICT works), truck_mpg, fuel_price,
--     cost_per_mile, updated_at — present; driver_pay_per_mile / maint_per_mile / fixed_per_mile / factoring_pct — MISSING
--     (added below, nullable)
--   • app_private.my_carrier_org() — present
--
-- TEST (do not skip): docs/audit-2026-09/tests/bl_fin_0322_rollback_test.sql — a DO … RAISE block that acts as the owner
--   of a real trip (self-discovered, no hardcoded ids), calls all six RPCs, checks net moves by exactly the amounts added,
--   checks non-carrier callers get 42501 and anon has no EXECUTE, then rolls everything back.
--   STAGING RESULT 2026-09-05 21:4x UTC: RESULT PASS — trip af8118e5… net 2850→2960 (+150 earning −40 cost), 0 rows left.
--   Re-run it on prod right after applying (it PASSes by raising 'RESULT PASS …').
--
-- ROLLBACK
--   drop function public.cc_carrier_earnings(date,date), public.cc_trip_pnl(uuid), public.cc_trip_finance_add(uuid,text,text,text,numeric,text),
--                 public.cc_trip_finance_remove(uuid), public.cc_set_cost_model(numeric,numeric,numeric,numeric,numeric,numeric), public.cc_get_cost_model();
--   drop table app_private.trip_finance_items;   -- only if empty / accepted data loss
--   alter table app_private.carrier_dispatch_prefs drop column driver_pay_per_mile, drop column maint_per_mile, drop column fixed_per_mile, drop column factoring_pct;
--   (The carrier UI then returns to today's behaviour: RPC-not-found.)

-- ===================================================================================================
-- wd_0032_per_trip_pnl_engine  (staging, 20260711171405) — verbatim
-- ===================================================================================================
-- PER-TRIP P&L ENGINE (Uber-style earnings for trucking).
-- Every trip gets a full A-to-Z profit statement: revenue (linehaul + approved accessorials +
-- custom earnings) minus costs (auto-modelled fuel / driver / maintenance / fixed overhead /
-- factoring, plus any custom cost the carrier adds to THAT trip) = net, with per-mile and
-- per-hour metrics and a margin health grade.

-- carrier cost model (additive; nullable => that line is simply skipped)
alter table app_private.carrier_dispatch_prefs add column if not exists driver_pay_per_mile numeric;
alter table app_private.carrier_dispatch_prefs add column if not exists maint_per_mile      numeric;
alter table app_private.carrier_dispatch_prefs add column if not exists fixed_per_mile      numeric;
alter table app_private.carrier_dispatch_prefs add column if not exists factoring_pct       numeric;

-- custom, trip-specific money lines the carrier adds themselves
create table if not exists app_private.trip_finance_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references app_private.trips(id) on delete cascade,
  carrier_id uuid not null,
  direction text not null check (direction in ('earning','cost')),
  category text not null default 'other',
  label text not null,
  amount numeric not null check (amount >= 0),
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists trip_finance_items_trip_idx on app_private.trip_finance_items(trip_id);

CREATE OR REPLACE FUNCTION public.cc_trip_finance_add(p_trip uuid, p_direction text, p_category text, p_label text, p_amount numeric, p_note text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'app_private','public'
AS $function$
declare v_org uuid; v_id uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  if not exists (select 1 from app_private.trips t where t.id=p_trip and t.carrier_id=v_org) then
    raise exception 'not authorized for this trip' using errcode='42501'; end if;
  if p_direction not in ('earning','cost') then raise exception 'direction must be earning or cost' using errcode='22023'; end if;
  if coalesce(trim(p_label),'') = '' then raise exception 'a label is required' using errcode='22023'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'amount must be greater than zero' using errcode='22023'; end if;
  insert into app_private.trip_finance_items(trip_id, carrier_id, direction, category, label, amount, note, created_by)
    values (p_trip, v_org, p_direction, coalesce(nullif(trim(p_category),''),'other'), trim(p_label), p_amount, nullif(trim(p_note),''), auth.uid())
    returning id into v_id;
  return v_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.cc_trip_finance_remove(p_id uuid)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'app_private','public'
AS $function$
declare v_org uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  delete from app_private.trip_finance_items where id=p_id and carrier_id=v_org;
  return found;
end; $function$;

-- The full A-to-Z profit statement for ONE trip.
CREATE OR REPLACE FUNCTION public.cc_trip_pnl(p_trip uuid)
 RETURNS jsonb STABLE SECURITY DEFINER LANGUAGE plpgsql SET search_path TO 'app_private','public'
AS $function$
declare v_org uuid; t record; l record; dp record;
        v_loaded numeric; v_dead numeric; v_total numeric; v_hours numeric;
        v_linehaul numeric; v_acc numeric; v_cust_earn numeric; v_gross numeric;
        v_fuel numeric; v_driver numeric; v_maint numeric; v_fixed numeric; v_fact numeric;
        v_cust_cost numeric; v_cost numeric; v_net numeric; v_margin numeric; v_auto jsonb;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  select * into t from app_private.trips where id=p_trip and carrier_id=v_org;
  if t.id is null then raise exception 'trip not found' using errcode='22023'; end if;
  select * into l from public.loads where id=t.load_id;
  select * into dp from app_private.carrier_dispatch_prefs where carrier_id=v_org;

  v_loaded := coalesce(t.miles, l.miles, 0);
  v_dead   := coalesce(l.deadhead, 0);
  v_total  := v_loaded + v_dead;
  v_hours  := case when t.started_at is not null and t.delivered_at is not null
                   then round(extract(epoch from (t.delivered_at - t.started_at))/3600.0, 1) else null end;

  -- REVENUE
  v_linehaul := coalesce(t.rate, l.rate, 0);
  select coalesce(sum(a.amount),0) into v_acc from app_private.trip_accessorials a
    where a.trip_id=p_trip and a.status='approved' and coalesce(a.billable,true);
  select coalesce(sum(i.amount),0) into v_cust_earn from app_private.trip_finance_items i
    where i.trip_id=p_trip and i.direction='earning';
  v_gross := v_linehaul + v_acc + v_cust_earn;

  -- COSTS (auto-modelled from the carrier's own numbers; null setting => line skipped)
  v_fuel   := case when coalesce(dp.truck_mpg,0) > 0 and coalesce(dp.fuel_price,0) > 0
                   then round(v_total / dp.truck_mpg * dp.fuel_price, 2) else 0 end;
  v_driver := case when coalesce(dp.driver_pay_per_mile,0) > 0 then round(v_total * dp.driver_pay_per_mile, 2) else 0 end;
  v_maint  := case when coalesce(dp.maint_per_mile,0) > 0      then round(v_total * dp.maint_per_mile, 2) else 0 end;
  v_fixed  := case when coalesce(dp.fixed_per_mile,0) > 0      then round(v_total * dp.fixed_per_mile, 2)
                   when coalesce(dp.cost_per_mile,0) > 0       then round(v_total * dp.cost_per_mile, 2) else 0 end;
  v_fact   := case when coalesce(dp.factoring_pct,0) > 0       then round(v_gross * dp.factoring_pct / 100.0, 2) else 0 end;
  select coalesce(sum(i.amount),0) into v_cust_cost from app_private.trip_finance_items i
    where i.trip_id=p_trip and i.direction='cost';

  v_cost := v_fuel + v_driver + v_maint + v_fixed + v_fact + v_cust_cost;
  v_net  := v_gross - v_cost;
  v_margin := case when v_gross > 0 then round(v_net / v_gross * 100.0, 1) else null end;

  v_auto := jsonb_build_array()
    || (case when v_fuel   > 0 then jsonb_build_array(jsonb_build_object('category','fuel','label',
         'Fuel — ' || round(v_total) || ' mi @ ' || coalesce(dp.truck_mpg,0) || ' mpg × $' || coalesce(dp.fuel_price,0), 'amount', v_fuel)) else '[]'::jsonb end)
    || (case when v_driver > 0 then jsonb_build_array(jsonb_build_object('category','driver','label',
         'Driver pay — ' || round(v_total) || ' mi × $' || dp.driver_pay_per_mile || '/mi', 'amount', v_driver)) else '[]'::jsonb end)
    || (case when v_maint  > 0 then jsonb_build_array(jsonb_build_object('category','maintenance','label',
         'Maintenance reserve — ' || round(v_total) || ' mi × $' || dp.maint_per_mile || '/mi', 'amount', v_maint)) else '[]'::jsonb end)
    || (case when v_fixed  > 0 then jsonb_build_array(jsonb_build_object('category','fixed','label',
         'Fixed overhead — ' || round(v_total) || ' mi × $' || coalesce(dp.fixed_per_mile, dp.cost_per_mile) || '/mi', 'amount', v_fixed)) else '[]'::jsonb end)
    || (case when v_fact   > 0 then jsonb_build_array(jsonb_build_object('category','factoring','label',
         'Factoring — ' || dp.factoring_pct || '% of gross', 'amount', v_fact)) else '[]'::jsonb end);

  return jsonb_build_object(
    'trip', jsonb_build_object('id', t.id, 'status', t.status,
      'origin', l.origin, 'destination', l.destination,
      'delivered_at', t.delivered_at, 'started_at', t.started_at,
      'miles_loaded', v_loaded, 'miles_deadhead', v_dead, 'miles_total', v_total, 'hours', v_hours),
    'revenue', jsonb_build_object(
      'linehaul', v_linehaul,
      'accessorials_total', v_acc,
      'accessorials', coalesce((select jsonb_agg(jsonb_build_object('kind',a.kind,'amount',a.amount,'status',a.status) order by a.created_at)
                                 from app_private.trip_accessorials a where a.trip_id=p_trip), '[]'::jsonb),
      'custom_total', v_cust_earn,
      'custom', coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'label',i.label,'category',i.category,'amount',i.amount) order by i.created_at)
                           from app_private.trip_finance_items i where i.trip_id=p_trip and i.direction='earning'), '[]'::jsonb),
      'gross', v_gross),
    'costs', jsonb_build_object(
      'auto', v_auto,
      'custom', coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'label',i.label,'category',i.category,'amount',i.amount) order by i.created_at)
                           from app_private.trip_finance_items i where i.trip_id=p_trip and i.direction='cost'), '[]'::jsonb),
      'custom_total', v_cust_cost,
      'total', v_cost),
    'net', v_net,
    'metrics', jsonb_build_object(
      'rpm',          case when v_total > 0 then round(v_gross / v_total, 2) else null end,
      'cpm',          case when v_total > 0 then round(v_cost  / v_total, 2) else null end,
      'net_per_mile', case when v_total > 0 then round(v_net   / v_total, 2) else null end,
      'margin_pct',   v_margin,
      'net_per_hour', case when v_hours > 0 then round(v_net / v_hours, 2) else null end,
      'breakeven_rpm',case when v_total > 0 then round(v_cost / v_total, 2) else null end,
      'health', case when v_margin is null then 'unknown'
                     when v_margin >= 30 then 'good'
                     when v_margin >= 15 then 'ok'
                     else 'risky' end),
    'settings_missing', (coalesce(dp.truck_mpg,0)=0 or coalesce(dp.fuel_price,0)=0));
end; $function$;

-- Roll-up across trips (the "Earnings" hub).
CREATE OR REPLACE FUNCTION public.cc_carrier_earnings(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
 RETURNS jsonb STABLE SECURITY DEFINER LANGUAGE plpgsql SET search_path TO 'app_private','public'
AS $function$
declare v_org uuid; v_from date; v_to date; v_trips jsonb; v_g numeric; v_c numeric; v_n numeric; v_m numeric; v_h numeric; v_cnt int;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  v_from := coalesce(p_from, (current_date - interval '30 days')::date);
  v_to   := coalesce(p_to, current_date);

  select coalesce(jsonb_agg(x.pnl order by x.ord desc), '[]'::jsonb),
         coalesce(sum((x.pnl->'revenue'->>'gross')::numeric),0),
         coalesce(sum((x.pnl->'costs'->>'total')::numeric),0),
         coalesce(sum((x.pnl->>'net')::numeric),0),
         coalesce(sum((x.pnl->'trip'->>'miles_total')::numeric),0),
         coalesce(sum((x.pnl->'trip'->>'hours')::numeric),0),
         count(*)
    into v_trips, v_g, v_c, v_n, v_m, v_h, v_cnt
    from (select public.cc_trip_pnl(t.id) as pnl, coalesce(t.delivered_at, t.created_at) as ord
            from app_private.trips t
           where t.carrier_id = v_org
             and t.status in ('delivered','invoiced','paid','in_transit','dispatched')
             and coalesce(t.delivered_at, t.created_at)::date between v_from and v_to) x;

  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'trips', v_trips,
    'totals', jsonb_build_object(
      'trip_count', v_cnt, 'gross', v_g, 'costs', v_c, 'net', v_n,
      'miles', v_m, 'hours', v_h,
      'rpm', case when v_m > 0 then round(v_g / v_m, 2) else null end,
      'cpm', case when v_m > 0 then round(v_c / v_m, 2) else null end,
      'net_per_mile', case when v_m > 0 then round(v_n / v_m, 2) else null end,
      'net_per_hour', case when v_h > 0 then round(v_n / v_h, 2) else null end,
      'margin_pct', case when v_g > 0 then round(v_n / v_g * 100.0, 1) else null end));
end; $function$;

-- ===================================================================================================
-- wd_0033_carrier_cost_model_rpc  (staging, 20260711171530) — verbatim
-- ===================================================================================================
-- The carrier's own cost model — drives every auto cost line in the per-trip P&L.
CREATE OR REPLACE FUNCTION public.cc_set_cost_model(
  p_truck_mpg numeric DEFAULT NULL, p_fuel_price numeric DEFAULT NULL,
  p_driver_pay_per_mile numeric DEFAULT NULL, p_maint_per_mile numeric DEFAULT NULL,
  p_fixed_per_mile numeric DEFAULT NULL, p_factoring_pct numeric DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'app_private','public'
AS $function$
declare v_org uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  insert into app_private.carrier_dispatch_prefs(carrier_id) values (v_org) on conflict (carrier_id) do nothing;
  update app_private.carrier_dispatch_prefs set
    truck_mpg           = coalesce(p_truck_mpg, truck_mpg),
    fuel_price          = coalesce(p_fuel_price, fuel_price),
    driver_pay_per_mile = coalesce(p_driver_pay_per_mile, driver_pay_per_mile),
    maint_per_mile      = coalesce(p_maint_per_mile, maint_per_mile),
    fixed_per_mile      = coalesce(p_fixed_per_mile, fixed_per_mile),
    factoring_pct       = coalesce(p_factoring_pct, factoring_pct),
    updated_at          = now()
  where carrier_id = v_org;
  return (select jsonb_build_object('ok',true,'truck_mpg',truck_mpg,'fuel_price',fuel_price,
            'driver_pay_per_mile',driver_pay_per_mile,'maint_per_mile',maint_per_mile,
            'fixed_per_mile',fixed_per_mile,'factoring_pct',factoring_pct)
          from app_private.carrier_dispatch_prefs where carrier_id=v_org);
end; $function$;

CREATE OR REPLACE FUNCTION public.cc_get_cost_model()
 RETURNS jsonb STABLE SECURITY DEFINER LANGUAGE plpgsql SET search_path TO 'app_private','public'
AS $function$
declare v_org uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  return coalesce((select jsonb_build_object('truck_mpg',truck_mpg,'fuel_price',fuel_price,
      'driver_pay_per_mile',driver_pay_per_mile,'maint_per_mile',maint_per_mile,
      'fixed_per_mile',fixed_per_mile,'factoring_pct',factoring_pct,'cost_per_mile',cost_per_mile)
    from app_private.carrier_dispatch_prefs where carrier_id=v_org), '{}'::jsonb);
end; $function$;

-- ===================================================================================================
-- grants — explicit (Supabase default privileges would otherwise hand anon EXECUTE on every new fn)
-- mirrors staging: authenticated + service_role; never anon/public. All six guard via my_carrier_org().
-- ===================================================================================================
do $g$
declare f text;
begin
  foreach f in array array[
    'public.cc_trip_finance_add(uuid,text,text,text,numeric,text)',
    'public.cc_trip_finance_remove(uuid)',
    'public.cc_trip_pnl(uuid)',
    'public.cc_carrier_earnings(date,date)',
    'public.cc_set_cost_model(numeric,numeric,numeric,numeric,numeric,numeric)',
    'public.cc_get_cost_model()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $g$;

-- ACL re-check
do $chk$
declare bad text;
begin
  select string_agg(routine_name||'←'||grantee, ', ') into bad
  from information_schema.routine_privileges
  where specific_schema='public'
    and routine_name in ('cc_trip_finance_add','cc_trip_finance_remove','cc_trip_pnl','cc_carrier_earnings','cc_set_cost_model','cc_get_cost_model')
    and grantee in ('anon','PUBLIC');
  if bad is not null then raise exception 'bl_fin_0322: anon/PUBLIC grant present: %', bad; end if;
  raise notice 'bl_fin_0322: ACL ok (authenticated + service_role only)';
end $chk$;
