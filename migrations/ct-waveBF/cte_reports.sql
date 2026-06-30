-- CONTROL TOWER WAVE E — Reports center. Flag: reports_enabled. Staging + production.
insert into app_private.permissions(key,description) values ('reports.view',null) on conflict (key) do nothing;
do $$ declare m record; begin
  for m in select * from (values ('owner',array['reports.view']::text[]),('operations_admin',array['reports.view']::text[]),('auditor',array['reports.view']::text[]),('marketing',array['reports.view']::text[])) as t(rk,perms) loop
    insert into app_private.role_permissions(role_id,permission_id) select r.id,p.id from app_private.roles r, app_private.permissions p where r.key=m.rk and p.key=any(m.perms) on conflict do nothing;
  end loop; end $$;

create or replace function public.cc_report(p_kind text, p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_d int := least(greatest(coalesce(p_days,30),1),365); v_from timestamptz; cols jsonb; rows jsonb; title text;
begin
  if not public.has_global_permission('reports.view') then raise exception 'not authorized' using errcode='42501'; end if;
  v_from := now()-(v_d||' days')::interval;
  if p_kind = 'finance' then
    title := 'Finance — invoices by status';
    cols := '[{"key":"status","label":"Status"},{"key":"invoices","label":"Invoices"},{"key":"gross","label":"Gross"},{"key":"fee","label":"Dispatch fee"}]'::jsonb;
    select coalesce(jsonb_agg(jsonb_build_object('status',status,'invoices',c,'gross',g,'fee',f) order by f desc),'[]'::jsonb) into rows
      from (select status, count(*) c, coalesce(sum(gross),0) g, coalesce(sum(fee),0) f from app_private.fin_invoices group by status) x;
  elsif p_kind = 'carriers' then
    title := 'Carriers — status, compliance & activity';
    cols := '[{"key":"name","label":"Carrier"},{"key":"status","label":"Status"},{"key":"compliant","label":"Compliant"},{"key":"trips","label":"Trips"},{"key":"fees_paid","label":"Fees paid"}]'::jsonb;
    select coalesce(jsonb_agg(jsonb_build_object('name',org.name,'status',org.status,'compliant',app_private.carrier_mandatory_ok(org.id),'trips',(select count(*) from app_private.trips t where t.carrier_id=org.id),'fees_paid',(select coalesce(sum(fee),0) from app_private.fin_invoices i where i.carrier_id=org.id and i.status='paid')) order by org.name),'[]'::jsonb) into rows
      from public.organizations org where org.kind='carrier';
  elsif p_kind = 'trips' then
    title := 'Operations — trips by status';
    cols := '[{"key":"status","label":"Status"},{"key":"trips","label":"Trips"},{"key":"miles","label":"Total miles"}]'::jsonb;
    select coalesce(jsonb_agg(jsonb_build_object('status',status,'trips',c,'miles',m) order by c desc),'[]'::jsonb) into rows
      from (select status, count(*) c, coalesce(sum(miles),0) m from app_private.trips group by status) x;
  elsif p_kind = 'sales' then
    title := 'Sales — leads by status';
    cols := '[{"key":"status","label":"Status"},{"key":"leads","label":"Leads"},{"key":"value","label":"Pipeline value"}]'::jsonb;
    select coalesce(jsonb_agg(jsonb_build_object('status',status,'leads',c,'value',v) order by c desc),'[]'::jsonb) into rows
      from (select status, count(*) c, coalesce(sum(value),0) v from app_private.crm_leads group by status) x;
  elsif p_kind = 'web' then
    title := 'Website — sessions by source';
    cols := '[{"key":"source","label":"Source"},{"key":"sessions","label":"Sessions"},{"key":"conversions","label":"Conversions"}]'::jsonb;
    select coalesce(jsonb_agg(jsonb_build_object('source',source_class,'sessions',c,'conversions',cv) order by c desc),'[]'::jsonb) into rows
      from (select source_class, count(*) c, count(*) filter (where converted) cv from app_private.web_sessions where first_seen>=v_from and not is_bot and not is_internal group by source_class) x;
  elsif p_kind = 'compliance' then
    title := 'Compliance — carrier mandatory status';
    cols := '[{"key":"name","label":"Carrier"},{"key":"stage","label":"Stage"},{"key":"mandatory_ok","label":"Mandatory OK"}]'::jsonb;
    select coalesce(jsonb_agg(jsonb_build_object('name',org.name,'stage',coalesce(o.stage,'not_started'),'mandatory_ok',app_private.carrier_mandatory_ok(org.id)) order by org.name),'[]'::jsonb) into rows
      from public.organizations org left join app_private.carrier_onboarding o on o.carrier_id=org.id where org.kind='carrier';
  else
    raise exception 'unknown report kind' using errcode='22023';
  end if;
  return jsonb_build_object('kind',p_kind,'title',title,'days',v_d,'columns',cols,'rows',rows);
end; $function$;

revoke all on function public.cc_report(text,int) from public, anon;
grant execute on function public.cc_report(text,int) to authenticated;
insert into app_private.feature_flags(key,enabled,description,environment,audience) values ('reports_enabled',false,'Enable the Reports center','all','staff') on conflict (key) do nothing;
