-- CONTROL TOWER WAVE B — entity 360. Read-only aggregation over already-proven data.
-- Carrier 360 ties together profile + compliance + safety + documents + fleet + trips +
-- finance + an audit timeline on one page. The carrier identity is split (profiles for
-- onboarding/docs, organizations for compliance/finance/trips); cc_carrier_360 accepts
-- EITHER id and resolves via organizations.owner_user_id. Flag: entity360_enabled.
-- Applied to staging + production.
create or replace function public.cc_entity_audit(p_target_type text, p_target_id text, p_org uuid default null, p_limit int default 60)
returns table(occurred_at timestamptz, action text, summary text, actor_is_staff boolean)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_l int := least(greatest(coalesce(p_limit,60),1),200);
begin
  if not public.is_active_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  return query select a.occurred_at,a.action,a.summary,a.actor_is_staff from app_private.audit_logs a
    where (p_target_id is not null and a.target_type=p_target_type and a.target_id=p_target_id)
       or (p_org is not null and a.target_org_id=p_org)
    order by a.occurred_at desc limit v_l;
end; $function$;

create or replace function public.cc_carrier_360(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_org uuid; v_prof uuid; v_name text; v_status text;
begin
  if not public.has_global_permission('carriers.view') then raise exception 'not authorized' using errcode='42501'; end if;
  -- accept either the carrier organization id OR the carrier profile id (owner_user_id)
  select id,name,status,owner_user_id into v_org,v_name,v_status,v_prof
    from public.organizations where kind='carrier' and (id=p_org or owner_user_id=p_org) limit 1;
  if v_org is null then raise exception 'carrier not found' using errcode='22023'; end if;
  return jsonb_build_object(
    'id',v_org,'name',v_name,'status',v_status,'profile_id',v_prof,
    'profile',(select to_jsonb(pr) from public.profiles pr where pr.id=v_prof),
    'compliance_ok',app_private.carrier_mandatory_ok(v_org),
    'onboarding',(select to_jsonb(o) from app_private.carrier_onboarding o where o.carrier_id=v_org),
    'safety',(select to_jsonb(s) from app_private.carrier_safety s where s.carrier_id=v_org),
    'documents',coalesce((select jsonb_agg(jsonb_build_object('type',d.type,'file_name',d.file_name,'status',d.status,'created_at',d.created_at) order by d.created_at desc) from public.documents d where d.carrier_id=v_prof),'[]'::jsonb),
    'drivers',coalesce((select jsonb_agg(jsonb_build_object('name',dr.name,'phone',dr.phone,'license_exp',dr.license_exp,'medical_exp',dr.medical_exp,'status',dr.status) order by dr.created_at desc) from app_private.fleet_drivers dr where dr.carrier_id=v_org),'[]'::jsonb),
    'trips_summary',(select jsonb_build_object('total',count(*),'active',count(*) filter (where status in ('planned','dispatched','in_transit')),'delivered',count(*) filter (where status in ('delivered','invoiced'))) from app_private.trips where carrier_id=v_org),
    'recent_trips',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'status',t.status,'rate',t.rate,'scheduled_delivery',t.scheduled_delivery,'delivered_at',t.delivered_at) order by t.created_at desc) from (select * from app_private.trips where carrier_id=v_org order by created_at desc limit 10) t),'[]'::jsonb),
    'finance',jsonb_build_object(
       'invoices',(select count(*) from app_private.fin_invoices where carrier_id=v_org),
       'fees_paid',(select coalesce(sum(fee),0) from app_private.fin_invoices where carrier_id=v_org and status='paid'),
       'fees_outstanding',(select coalesce(sum(fee),0) from app_private.fin_invoices where carrier_id=v_org and status='sent'),
       'settlements_pending',(select count(*) from app_private.fin_settlements where carrier_id=v_org and status in ('pending','approved'))),
    'open_tasks',(select count(*) from app_private.automation_tasks where related_type='carrier' and related_id=v_org::text and status='open'),
    'timeline',coalesce((select jsonb_agg(jsonb_build_object('at',occurred_at,'action',action,'summary',summary) order by occurred_at desc) from (select * from app_private.audit_logs where target_org_id=v_org or (target_type='carrier' and target_id=v_org::text) order by occurred_at desc limit 20) tl),'[]'::jsonb)
  );
end; $function$;

revoke all on function public.cc_entity_audit(text,text,uuid,int) from public, anon;
revoke all on function public.cc_carrier_360(uuid) from public, anon;
grant execute on function public.cc_entity_audit(text,text,uuid,int) to authenticated;
grant execute on function public.cc_carrier_360(uuid) to authenticated;
insert into app_private.feature_flags(key,enabled,description,environment,audience) values ('entity360_enabled',false,'Enable clickable entity 360 record pages','all','staff') on conflict (key) do nothing;
