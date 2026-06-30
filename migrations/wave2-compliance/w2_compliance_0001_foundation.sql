-- WAVE 2 — CARRIER ONBOARDING & COMPLIANCE foundation.
-- Builds ON TOP OF existing public.organizations (kind='carrier') + public.documents.
-- Adds a compliance layer: a requirement catalog, per-carrier onboarding applications,
-- and per-carrier/per-requirement compliance records (with expiry tracking).
-- All writes go through RBAC-gated, audited SECURITY DEFINER RPCs. Onboarding + expiry
-- emit domain events into the Automation Core, which creates review/renewal tasks and a
-- human-approval gate task. Feature-flagged (compliance_enabled, default OFF).
-- Production-safe additive: no existing table is altered or dropped.
-- Applied to STAGING as ledger name w2_compliance_0001_foundation.
-- DOWN: drop public cc_compliance_*/cc_*_onboarding/cc_set_compliance/cc_scan_expiring fns,
--   app_private.carrier_compliance, app_private.carrier_onboarding,
--   app_private.compliance_requirements, app_private.carrier_mandatory_ok, the compliance.*
--   permission rows. The compliance_enabled flag + the 3 automation rules may stay.

-- ============================================================ permissions
insert into app_private.permissions(key,description) values
  ('compliance.view',null),('compliance.verify',null),('compliance.approve',null),('compliance.manage',null)
on conflict (key) do nothing;
do $$ declare m record; begin
  for m in select * from (values
    ('owner',              array['compliance.view','compliance.verify','compliance.approve','compliance.manage']::text[]),
    ('operations_admin',   array['compliance.view','compliance.verify','compliance.approve','compliance.manage']::text[]),
    ('compliance_reviewer',array['compliance.view','compliance.verify']::text[]),
    ('auditor',            array['compliance.view']::text[])
  ) as t(rk, perms) loop
    insert into app_private.role_permissions(role_id,permission_id)
      select r.id,p.id from app_private.roles r, app_private.permissions p
      where r.key=m.rk and p.key=any(m.perms)
    on conflict do nothing;
  end loop;
end $$;

-- ============================================================ tables
create table if not exists app_private.compliance_requirements (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  doc_type text,                              -- maps to public.documents.type
  requires_expiry boolean not null default false,
  mandatory boolean not null default true,
  sort int not null default 0,
  active boolean not null default true
);

create table if not exists app_private.carrier_onboarding (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references public.organizations(id) on delete cascade,
  stage text not null default 'submitted'
    check (stage in ('submitted','docs_review','compliance_check','approved','rejected')),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  decision_note text,
  created_by uuid,
  unique(carrier_id)
);

create table if not exists app_private.carrier_compliance (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references public.organizations(id) on delete cascade,
  requirement_key text not null references app_private.compliance_requirements(key) on delete cascade,
  status text not null default 'missing'
    check (status in ('missing','pending','valid','expired','rejected')),
  document_id uuid references public.documents(id) on delete set null,
  effective_date date,
  expiry_date date,
  verified_by uuid,
  verified_at timestamptz,
  note text,
  updated_at timestamptz not null default now(),
  unique(carrier_id, requirement_key)
);
create index if not exists carrier_compliance_carrier_idx on app_private.carrier_compliance(carrier_id);
create index if not exists carrier_compliance_expiry_idx on app_private.carrier_compliance(expiry_date) where status='valid';

alter table app_private.compliance_requirements enable row level security;
alter table app_private.carrier_onboarding enable row level security;
alter table app_private.carrier_compliance enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;

-- ============================================================ seed requirement catalog
insert into app_private.compliance_requirements(key,name,doc_type,requires_expiry,mandatory,sort) values
  ('mc_authority', 'MC/DOT Operating Authority',          'authority', false, true,  1),
  ('insurance_coi','Certificate of Insurance (Auto Liability $1M)','insurance', true,  true,  2),
  ('w9',           'W-9 Tax Form',                        'w9',        false, true,  3),
  ('mcs150',       'MCS-150 (Biennial Update)',           'mcs150',    true,  true,  4),
  ('safety_rating','FMCSA Safety Rating',                 'safety',    false, false, 5)
on conflict (key) do nothing;

-- ============================================================ internal helper
-- A carrier is "mandatory-complete" when every active mandatory requirement has a
-- compliance record that is 'valid' and not past its expiry date.
create or replace function app_private.carrier_mandatory_ok(p_carrier uuid)
returns boolean language sql stable security definer set search_path to 'app_private, public' as $function$
  select not exists (
    select 1 from app_private.compliance_requirements r
    where r.active and r.mandatory
      and not exists (
        select 1 from app_private.carrier_compliance c
        where c.carrier_id=p_carrier and c.requirement_key=r.key
          and c.status='valid' and (c.expiry_date is null or c.expiry_date >= current_date)
      )
  );
$function$;

-- ============================================================ RPCs (RBAC-gated, audited)
-- overview KPIs
create or replace function public.cc_compliance_overview()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin
  if not public.has_global_permission('compliance.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object(
    'in_onboarding', (select count(*) from app_private.carrier_onboarding where stage in ('submitted','docs_review','compliance_check')),
    'approved',      (select count(*) from app_private.carrier_onboarding where stage='approved'),
    'rejected',      (select count(*) from app_private.carrier_onboarding where stage='rejected'),
    'pending_checks',(select count(*) from app_private.carrier_compliance where status in ('missing','pending')),
    'expiring_30',   (select count(*) from app_private.carrier_compliance where status='valid' and expiry_date is not null and expiry_date between current_date and current_date + 30),
    'expired',       (select count(*) from app_private.carrier_compliance where status='valid' and expiry_date is not null and expiry_date < current_date)
  );
end; $function$;

-- list carriers in onboarding with a compliance summary
create or replace function public.cc_list_onboarding(p_stage text default null, p_search text default null, p_limit int default 200)
returns table (carrier_id uuid, carrier_name text, stage text, submitted_at timestamptz,
               mandatory_total int, mandatory_valid int, expiring int, mandatory_ok boolean)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_limit int := least(greatest(coalesce(p_limit,200),1),500);
begin
  if not public.has_global_permission('compliance.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query
    select o.carrier_id, org.name, o.stage, o.submitted_at,
      (select count(*)::int from app_private.compliance_requirements r where r.active and r.mandatory),
      (select count(*)::int from app_private.compliance_requirements r
         join app_private.carrier_compliance c on c.requirement_key=r.key and c.carrier_id=o.carrier_id
         where r.active and r.mandatory and c.status='valid' and (c.expiry_date is null or c.expiry_date>=current_date)),
      (select count(*)::int from app_private.carrier_compliance c
         where c.carrier_id=o.carrier_id and c.status='valid' and c.expiry_date is not null and c.expiry_date between current_date and current_date+30),
      app_private.carrier_mandatory_ok(o.carrier_id)
    from app_private.carrier_onboarding o
    join public.organizations org on org.id=o.carrier_id
    where (p_stage is null or o.stage=p_stage)
      and (p_search is null or org.name ilike '%'||p_search||'%')
    order by o.submitted_at desc
    limit v_limit;
end; $function$;

-- full compliance detail for one carrier (requirement checklist + onboarding stage)
create or replace function public.cc_get_carrier_compliance(p_carrier uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare j jsonb; v_name text; v_stage text; v_submitted timestamptz; v_decided timestamptz; v_note text;
begin
  if not public.has_global_permission('compliance.view') then raise exception 'not authorized' using errcode='42501'; end if;
  select name into v_name from public.organizations where id=p_carrier;
  if v_name is null then raise exception 'carrier not found' using errcode='22023'; end if;
  select stage,submitted_at,decided_at,decision_note into v_stage,v_submitted,v_decided,v_note
    from app_private.carrier_onboarding where carrier_id=p_carrier;
  select coalesce(jsonb_agg(jsonb_build_object(
            'key',r.key,'name',r.name,'doc_type',r.doc_type,'mandatory',r.mandatory,
            'requires_expiry',r.requires_expiry,
            'status',coalesce(c.status,'missing'),
            'expiry_date',c.expiry_date,'effective_date',c.effective_date,
            'verified_at',c.verified_at,'note',c.note,'document_id',c.document_id
          ) order by r.sort), '[]'::jsonb)
    into j
    from app_private.compliance_requirements r
    left join app_private.carrier_compliance c on c.requirement_key=r.key and c.carrier_id=p_carrier
    where r.active;
  return jsonb_build_object(
    'carrier_id',p_carrier,'carrier_name',v_name,
    'stage',coalesce(v_stage,'not_started'),'submitted_at',v_submitted,'decided_at',v_decided,'decision_note',v_note,
    'mandatory_ok',app_private.carrier_mandatory_ok(p_carrier),
    'requirements',j
  );
end; $function$;

-- begin onboarding: create the application + seed compliance rows; emits carrier.onboarding_started
create or replace function public.cc_start_onboarding(p_carrier uuid)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid; v_name text;
begin
  if not public.has_global_permission('compliance.verify') then raise exception 'not authorized' using errcode='42501'; end if;
  select name into v_name from public.organizations where id=p_carrier and kind='carrier';
  if v_name is null then raise exception 'carrier not found' using errcode='22023'; end if;
  insert into app_private.carrier_onboarding(carrier_id,stage,created_by)
    values (p_carrier,'submitted',auth.uid())
  on conflict (carrier_id) do update set stage=case when app_private.carrier_onboarding.stage in ('approved','rejected')
       then app_private.carrier_onboarding.stage else 'submitted' end
  returning id into v_id;
  -- seed a compliance row (status missing) for every active requirement
  insert into app_private.carrier_compliance(carrier_id,requirement_key,status)
    select p_carrier, r.key, 'missing' from app_private.compliance_requirements r where r.active
  on conflict (carrier_id,requirement_key) do nothing;
  perform app_private.log_audit('compliance.onboarding.start','carrier',p_carrier::text,null,
     format('onboarding started: %s',v_name), jsonb_build_object('carrier',v_name));
  perform app_private.emit_event('carrier.onboarding_started','carrier',p_carrier::text,
     jsonb_build_object('carrier',v_name), 'onboard_start:'||p_carrier::text);
  return v_id;
end; $function$;

-- verify/set one requirement; recomputes; emits carrier.compliance_complete when all mandatory valid
create or replace function public.cc_set_compliance(p_carrier uuid, p_requirement_key text, p_status text,
                                                    p_expiry date default null, p_note text default null)
returns text language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_req app_private.compliance_requirements; v_final text; v_name text;
begin
  if not public.has_global_permission('compliance.verify') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_status not in ('missing','pending','valid','expired','rejected') then raise exception 'invalid status' using errcode='22023'; end if;
  select * into v_req from app_private.compliance_requirements where key=p_requirement_key and active;
  if v_req.key is null then raise exception 'unknown requirement' using errcode='22023'; end if;
  select name into v_name from public.organizations where id=p_carrier and kind='carrier';
  if v_name is null then raise exception 'carrier not found' using errcode='22023'; end if;
  -- a 'valid' record whose expiry is already past is recorded as 'expired'
  v_final := case when p_status='valid' and p_expiry is not null and p_expiry < current_date then 'expired' else p_status end;
  insert into app_private.carrier_compliance(carrier_id,requirement_key,status,expiry_date,note,verified_by,verified_at,updated_at)
    values (p_carrier,p_requirement_key,v_final,p_expiry,p_note,auth.uid(),now(),now())
  on conflict (carrier_id,requirement_key) do update
    set status=excluded.status, expiry_date=excluded.expiry_date, note=excluded.note,
        verified_by=excluded.verified_by, verified_at=now(), updated_at=now();
  -- advance the workflow into compliance_check once verification begins
  update app_private.carrier_onboarding set stage='compliance_check'
    where carrier_id=p_carrier and stage in ('submitted','docs_review');
  perform app_private.log_audit('compliance.set','carrier',p_carrier::text,null,
     format('%s -> %s',p_requirement_key,v_final),
     jsonb_build_object('requirement',p_requirement_key,'status',v_final,'expiry',p_expiry));
  perform app_private.emit_event('compliance.updated','carrier',p_carrier::text,
     jsonb_build_object('requirement',p_requirement_key,'status',v_final));
  -- when the carrier becomes mandatory-complete, raise the human-approval gate event
  if app_private.carrier_mandatory_ok(p_carrier) then
    perform app_private.emit_event('carrier.compliance_complete','carrier',p_carrier::text,
       jsonb_build_object('carrier',v_name), 'compliance_complete:'||p_carrier::text);
  end if;
  return v_final;
end; $function$;

-- approval gate: approve/reject onboarding (requires compliance.approve; approve blocked unless mandatory-complete)
create or replace function public.cc_decide_onboarding(p_carrier uuid, p_decision text, p_note text default null)
returns text language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_name text; v_exists boolean;
begin
  if not public.has_global_permission('compliance.approve') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_decision not in ('approve','reject') then raise exception 'invalid decision' using errcode='22023'; end if;
  select true into v_exists from app_private.carrier_onboarding where carrier_id=p_carrier;
  if not coalesce(v_exists,false) then raise exception 'onboarding not found' using errcode='22023'; end if;
  select name into v_name from public.organizations where id=p_carrier;
  if p_decision='approve' and not app_private.carrier_mandatory_ok(p_carrier) then
    raise exception 'mandatory compliance incomplete' using errcode='22023';
  end if;
  update app_private.carrier_onboarding
    set stage=case when p_decision='approve' then 'approved' else 'rejected' end,
        decided_at=now(), decided_by=auth.uid(), decision_note=p_note
    where carrier_id=p_carrier;
  perform app_private.log_audit('compliance.onboarding.'||p_decision,'carrier',p_carrier::text,null,
     format('onboarding %s: %s',p_decision,coalesce(v_name,'')), jsonb_build_object('decision',p_decision,'note',p_note));
  perform app_private.emit_event('carrier.onboarding_'||p_decision,'carrier',p_carrier::text,
     jsonb_build_object('carrier',v_name));
  return p_decision;
end; $function$;

-- scheduled scan: mark past-due 'valid' rows expired; emit compliance.expiring for the next p_days window
create or replace function public.cc_scan_expiring(p_days int default 30)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_window int := least(greatest(coalesce(p_days,30),1),365); v_expired int; v_expiring int; r record;
begin
  if not public.has_global_permission('compliance.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  -- flip already-past 'valid' records to 'expired'
  with upd as (
    update app_private.carrier_compliance set status='expired', updated_at=now()
    where status='valid' and expiry_date is not null and expiry_date < current_date returning carrier_id
  ) select count(*) into v_expired from upd;
  -- emit an 'expiring' event per record inside the window (dedupe by carrier+requirement+expiry)
  v_expiring := 0;
  for r in
    select c.carrier_id, c.requirement_key, c.expiry_date, org.name
    from app_private.carrier_compliance c join public.organizations org on org.id=c.carrier_id
    where c.status='valid' and c.expiry_date is not null and c.expiry_date between current_date and current_date+v_window
  loop
    perform app_private.emit_event('compliance.expiring','carrier',r.carrier_id::text,
      jsonb_build_object('requirement',r.requirement_key,'expiry',r.expiry_date,'carrier',r.name),
      'expiring:'||r.carrier_id::text||':'||r.requirement_key||':'||r.expiry_date::text);
    v_expiring := v_expiring + 1;
  end loop;
  perform app_private.log_audit('compliance.scan','system',null,null,
     format('scan: %s expired, %s expiring within %s days',v_expired,v_expiring,v_window),
     jsonb_build_object('expired',v_expired,'expiring',v_expiring,'window',v_window));
  return jsonb_build_object('expired',v_expired,'expiring',v_expiring,'window_days',v_window);
end; $function$;

-- ============================================================ grants (deny-by-default; execute to authenticated only)
revoke all on all functions in schema app_private from public, anon, authenticated;
do $$ declare fn text; begin
  for fn in select unnest(array[
    'public.cc_compliance_overview()',
    'public.cc_list_onboarding(text,text,int)',
    'public.cc_get_carrier_compliance(uuid)',
    'public.cc_start_onboarding(uuid)',
    'public.cc_set_compliance(uuid,text,text,date,text)',
    'public.cc_decide_onboarding(uuid,text,text)',
    'public.cc_scan_expiring(int)'
  ]) loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- ============================================================ feature flag + automation rules
insert into app_private.feature_flags(key,enabled,description,environment,audience)
  values ('compliance_enabled',false,'Enable the Carrier Onboarding & Compliance module','all','staff')
on conflict (key) do nothing;

insert into app_private.automation_rules(key,name,trigger_event,condition,action_type,action_config,requires_approval) values
  ('onboarding_started_review','Carrier onboarding -> compliance review task','carrier.onboarding_started','{}'::jsonb,'create_task',
     jsonb_build_object('task_type','onboarding_review','title','Review carrier onboarding & documents','priority','high','assignee_role','compliance_reviewer','sla_minutes',2880), false),
  ('compliance_expiring_renewal','Compliance expiring -> renewal task','compliance.expiring','{}'::jsonb,'create_task',
     jsonb_build_object('task_type','doc_renewal','title','Compliance document expiring — request renewal','priority','normal','assignee_role','operations_admin','sla_minutes',1440), false),
  ('compliance_complete_approval','Compliance complete -> onboarding approval (human gate)','carrier.compliance_complete','{}'::jsonb,'create_task',
     jsonb_build_object('task_type','onboarding_approval','title','Approve carrier onboarding','priority','high','assignee_role','operations_admin','sla_minutes',1440), true)
on conflict (key) do nothing;
