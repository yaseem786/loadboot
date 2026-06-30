-- ENTERPRISE COMPLETION WAVE 3 — COMPLIANCE EXTERNAL-DATA FOUNDATION.
-- carrier_safety record (DOT/MC/authority/safety rating + FMCSA-ready fields) and a safety
-- scorecard combining compliance, safety rating and on-time. Real FMCSA/SAFER API sync is an
-- owner-credentialed integration (recorded as source='manual' until connected). RBAC via
-- compliance.* perms. Additive. Applied to STAGING as ledger name ec3_compliance_0001.

create table if not exists app_private.carrier_safety (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references public.organizations(id) on delete cascade unique,
  dot_number text, mc_number text,
  authority_status text check (authority_status in ('active','inactive','pending','revoked')) default 'pending',
  safety_rating text check (safety_rating in ('satisfactory','conditional','unsatisfactory','none')) default 'none',
  power_units int, driver_count int, out_of_service boolean not null default false, out_of_service_date date,
  source text not null default 'manual' check (source in ('manual','fmcsa')),
  last_checked timestamptz, updated_by uuid, updated_at timestamptz not null default now());
alter table app_private.carrier_safety enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;

create or replace function public.cc_upsert_carrier_safety(p_carrier uuid, p_dot text default null, p_mc text default null,
   p_authority text default null, p_rating text default null, p_power_units int default null, p_oos boolean default null)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid;
begin
  if not public.has_global_permission('compliance.verify') then raise exception 'not authorized' using errcode='42501'; end if;
  insert into app_private.carrier_safety(carrier_id,dot_number,mc_number,authority_status,safety_rating,power_units,out_of_service,source,last_checked,updated_by)
    values (p_carrier,p_dot,p_mc,coalesce(p_authority,'pending'),coalesce(p_rating,'none'),p_power_units,coalesce(p_oos,false),'manual',now(),auth.uid())
  on conflict (carrier_id) do update set dot_number=coalesce(excluded.dot_number,app_private.carrier_safety.dot_number),
    mc_number=coalesce(excluded.mc_number,app_private.carrier_safety.mc_number),
    authority_status=coalesce(p_authority,app_private.carrier_safety.authority_status),
    safety_rating=coalesce(p_rating,app_private.carrier_safety.safety_rating),
    power_units=coalesce(p_power_units,app_private.carrier_safety.power_units),
    out_of_service=coalesce(p_oos,app_private.carrier_safety.out_of_service), last_checked=now(), updated_by=auth.uid(), updated_at=now()
  returning id into v_id;
  perform app_private.log_audit('compliance.safety.upsert','carrier',p_carrier::text,null,'safety record updated', jsonb_build_object('authority',p_authority,'rating',p_rating));
  return v_id;
end; $function$;

create or replace function public.cc_safety_scorecard(p_carrier uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_rating text; v_authority text; v_oos boolean; v_compliant boolean; v_d_n int; v_d_ot int; v_score int;
begin
  if not public.has_global_permission('compliance.view') then raise exception 'not authorized' using errcode='42501'; end if;
  select safety_rating,authority_status,out_of_service into v_rating,v_authority,v_oos from app_private.carrier_safety where carrier_id=p_carrier;
  v_compliant := app_private.carrier_mandatory_ok(p_carrier);
  select count(*), count(*) filter (where delivered_at<=scheduled_delivery)
    into v_d_n, v_d_ot from app_private.trips where carrier_id=p_carrier and status in ('delivered','invoiced') and delivered_at is not null and scheduled_delivery is not null;
  v_score := (case when v_compliant then 35 else 0 end)
           + (case coalesce(v_rating,'none') when 'satisfactory' then 30 when 'conditional' then 15 when 'none' then 10 else 0 end)
           + (case when coalesce(v_authority,'pending')='active' then 20 else 0 end)
           + (case when v_d_n>0 then round(15.0*v_d_ot/v_d_n) else 8 end)::int
           - (case when coalesce(v_oos,false) then 40 else 0 end);
  return jsonb_build_object('carrier',(select name from public.organizations where id=p_carrier),
    'score', greatest(0,v_score), 'compliant', v_compliant, 'authority_status', coalesce(v_authority,'unknown'),
    'safety_rating', coalesce(v_rating,'none'), 'out_of_service', coalesce(v_oos,false),
    'on_time_pct', case when v_d_n>0 then round(100.0*v_d_ot/v_d_n) else null end,
    'grade', case when greatest(0,v_score)>=85 then 'A' when v_score>=70 then 'B' when v_score>=50 then 'C' else 'D' end);
end; $function$;

revoke all on all functions in schema app_private from public, anon, authenticated;
do $$ declare fn text; begin
  for fn in select unnest(array['public.cc_upsert_carrier_safety(uuid,text,text,text,text,int,boolean)','public.cc_safety_scorecard(uuid)']) loop
    execute format('revoke execute on function %s from public, anon', fn); execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- extend the daily compliance scan to also flag driver license/medical expiry (best-effort; ignore if fleet absent)
create or replace function app_private.cron_compliance_scan()
returns void language plpgsql security definer set search_path to 'app_private, public' as $function$
declare r record;
begin
  update app_private.carrier_compliance set status='expired', updated_at=now()
    where status='valid' and expiry_date is not null and expiry_date < current_date;
  for r in select c.carrier_id, c.requirement_key, c.expiry_date, org.name
           from app_private.carrier_compliance c join public.organizations org on org.id=c.carrier_id
           where c.status='valid' and c.expiry_date is not null and c.expiry_date between current_date and current_date+30 loop
    perform app_private.emit_event('compliance.expiring','carrier',r.carrier_id::text,
      jsonb_build_object('requirement',r.requirement_key,'expiry',r.expiry_date,'carrier',r.name),
      'expiring:'||r.carrier_id::text||':'||r.requirement_key||':'||r.expiry_date::text);
  end loop;
  -- driver license/medical expiry (if fleet table exists)
  begin
    for r in select d.id, d.name, d.carrier_id, least(d.license_exp,d.medical_exp) exp
             from app_private.fleet_drivers d where d.status='active'
             and ((d.license_exp is not null and d.license_exp between current_date and current_date+30)
               or (d.medical_exp is not null and d.medical_exp between current_date and current_date+30)) loop
      perform app_private.emit_event('driver.credential_expiring','driver',r.id::text,
        jsonb_build_object('driver',r.name,'expiry',r.exp), 'driver_exp:'||r.id::text||':'||r.exp::text);
    end loop;
  exception when undefined_table then null; end;
  perform app_private.process_outbox(500);
end; $function$;

insert into app_private.automation_rules(key,name,trigger_event,condition,action_type,action_config,requires_approval) values
  ('driver_credential_renewal','Driver credential expiring -> renewal task','driver.credential_expiring','{}'::jsonb,'create_task',
     jsonb_build_object('task_type','driver_renewal','title','Driver license/medical expiring — renew','priority','normal','assignee_role','compliance_reviewer','sla_minutes',2880), false)
on conflict (key) do nothing;
