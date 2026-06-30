-- WAVE 6 — ANALYTICS foundation.
-- Read-only operational analytics over the live modules (loads, trips, invoices, carriers,
-- leads, compliance, automation). No new business tables — just RBAC-gated, audited
-- SECURITY DEFINER read RPCs that aggregate existing data. Feature-flagged (analytics_enabled,
-- default OFF). Production-safe additive.
-- Applied to STAGING as ledger name w6_analytics_0001_foundation.
-- DOWN: drop public cc_analytics_* fns + analytics.* permission rows.

insert into app_private.permissions(key,description) values
  ('analytics.view',null)
on conflict (key) do nothing;
do $$ declare m record; begin
  for m in select * from (values
    ('owner', array['analytics.view']::text[]),
    ('operations_admin', array['analytics.view']::text[]),
    ('finance', array['analytics.view']::text[]),
    ('dispatcher', array['analytics.view']::text[]),
    ('auditor', array['analytics.view']::text[])
  ) as t(rk, perms) loop
    insert into app_private.role_permissions(role_id,permission_id)
      select r.id,p.id from app_private.roles r, app_private.permissions p
      where r.key=m.rk and p.key=any(m.perms)
    on conflict do nothing;
  end loop;
end $$;

-- headline KPIs across the whole operation
create or replace function public.cc_analytics_overview()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin
  if not public.has_global_permission('analytics.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object(
    'loads_total',     (select count(*) from public.loads),
    'loads_available', (select count(*) from public.loads where status='available'),
    'trips_active',    (select count(*) from app_private.trips where status in ('planned','dispatched','in_transit')),
    'trips_delivered', (select count(*) from app_private.trips where status in ('delivered','invoiced')),
    'revenue_collected',(select coalesce(sum(fee),0) from app_private.fin_invoices where status='paid'),
    'revenue_outstanding',(select coalesce(sum(fee),0) from app_private.fin_invoices where status='sent'),
    'gross_booked',    (select coalesce(sum(gross),0) from app_private.fin_invoices where status in ('sent','paid')),
    'carriers_active', (select count(*) from public.organizations where kind='carrier' and status='active'),
    'leads_open',      (select count(*) from app_private.crm_leads where status='open'),
    'compliance_approved',(select count(*) from app_private.carrier_onboarding where stage='approved'),
    'tasks_open',      (select count(*) from app_private.automation_tasks where status='open'));
end; $function$;

-- daily dispatch-fee revenue series for the last N days (for the bar chart)
create or replace function public.cc_analytics_revenue(p_days int default 14)
returns table (day date, gross numeric, fee numeric, invoices bigint)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_days int := least(greatest(coalesce(p_days,14),1),120);
begin
  if not public.has_global_permission('analytics.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query
    select d::date,
      coalesce((select sum(i.gross) from app_private.fin_invoices i where i.created_at::date=d::date),0),
      coalesce((select sum(i.fee) from app_private.fin_invoices i where i.created_at::date=d::date),0),
      (select count(*) from app_private.fin_invoices i where i.created_at::date=d::date)
    from generate_series(current_date - (v_days-1), current_date, interval '1 day') d
    order by d;
end; $function$;

-- operational breakdown: loads by status, trips by status, on-time delivery rate
create or replace function public.cc_analytics_ops()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_delivered int; v_ontime int;
begin
  if not public.has_global_permission('analytics.view') then raise exception 'not authorized' using errcode='42501'; end if;
  select count(*) into v_delivered from app_private.trips where status in ('delivered','invoiced') and delivered_at is not null and scheduled_delivery is not null;
  select count(*) into v_ontime from app_private.trips where status in ('delivered','invoiced') and delivered_at is not null and scheduled_delivery is not null and delivered_at <= scheduled_delivery;
  return jsonb_build_object(
    'loads_by_status', (select coalesce(jsonb_object_agg(status,c),'{}'::jsonb) from (select status,count(*) c from public.loads group by status) x),
    'trips_by_status', (select coalesce(jsonb_object_agg(status,c),'{}'::jsonb) from (select status,count(*) c from app_private.trips group by status) y),
    'on_time_pct', case when v_delivered>0 then round(100.0*v_ontime/v_delivered) else null end,
    'on_time_n', v_delivered);
end; $function$;

-- top carriers by trips + dispatch-fee revenue
create or replace function public.cc_analytics_carriers(p_limit int default 8)
returns table (carrier text, trips bigint, revenue numeric)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_limit int := least(greatest(coalesce(p_limit,8),1),50);
begin
  if not public.has_global_permission('analytics.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query
    select org.name,
      (select count(*) from app_private.trips t where t.carrier_id=org.id),
      coalesce((select sum(i.fee) from app_private.fin_invoices i where i.carrier_id=org.id and i.status in ('sent','paid')),0)
    from public.organizations org
    where org.kind='carrier'
    order by (select count(*) from app_private.trips t where t.carrier_id=org.id) desc,
             coalesce((select sum(i.fee) from app_private.fin_invoices i where i.carrier_id=org.id and i.status in ('sent','paid')),0) desc
    limit v_limit;
end; $function$;

revoke all on all functions in schema app_private from public, anon, authenticated;
do $$ declare fn text; begin
  for fn in select unnest(array[
    'public.cc_analytics_overview()','public.cc_analytics_revenue(int)',
    'public.cc_analytics_ops()','public.cc_analytics_carriers(int)']) loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

insert into app_private.feature_flags(key,enabled,description,environment,audience)
  values ('analytics_enabled',false,'Enable the Analytics module','all','staff')
on conflict (key) do nothing;
