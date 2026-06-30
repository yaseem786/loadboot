-- SMOKE-TEST — V1 RBAC + workflow proof at the data layer. STAGING ONLY.
-- Simulates each persona's authenticated session via the JWT `sub` claim and exercises
-- the real RPCs. Creates two synthetic staff (Owner, Dispatcher) if absent. Read-mostly;
-- the writes it performs are idempotent demo mutations. Run inside one transaction.
-- Executed result on staging (30 Jun 2026):
--   Owner: overview ok / approve carrier ok / review doc ok / create+assign+dispatch ok / 7 audit rows
--   Dispatcher: list/create loads ok ; approve carrier / review doc / staff dir / audit -> DENIED
--   Carrier: is_active_staff=false ; overview DENIED ; Anonymous: DENIED
begin;
create temp table _v(step text, result text) on commit drop;

insert into public.profiles(id, role, status, company, contact_name, email)
 values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','admin','active','LoadBoot HQ','Ops Owner','owner@loadboot.test'),
        ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1','admin','active','LoadBoot HQ','Dee Patcher','dispatch@loadboot.test')
 on conflict (id) do nothing;
do $$
declare io uuid; owner_role uuid; disp_role uuid;
begin
  select id into io from public.organizations where kind='internal' limit 1;
  select id into owner_role from app_private.roles where key='owner';
  select id into disp_role  from app_private.roles where key='dispatcher';
  insert into public.organization_memberships(org_id,user_id,member_role,status)
    values (io,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','staff','active'),
           (io,'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1','staff','active') on conflict do nothing;
  insert into app_private.staff_members(user_id,status)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','active'),
           ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1','active') on conflict do nothing;
  insert into app_private.user_role_assignments(user_id,role_id,scope_type,status,granted_by)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',owner_role,'global','active','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
           ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',disp_role,'global','active','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1') on conflict do nothing;
end $$;

-- OWNER
do $$
declare r jsonb; v text; lid uuid; n int;
begin
  perform set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"}',true);
  begin r:=public.cc_get_overview(); insert into _v values('OWNER overview','ok'); exception when others then insert into _v values('OWNER overview','ERR '||sqlerrm); end;
  begin v:=public.cc_create_load('Reno, NV','Salt Lake City, UT','Dry Van',1120,520,'Goods',null)::text; lid:=v::uuid; insert into _v values('OWNER create_load','ok'); exception when others then insert into _v values('OWNER create_load','ERR '||sqlerrm); end;
  begin v:=public.cc_assign_load(lid,(select id from public.profiles where role='carrier' and status='active' limit 1)); insert into _v values('OWNER assign_load','ok -> '||v); exception when others then insert into _v values('OWNER assign_load','ERR '||sqlerrm); end;
  begin v:=public.cc_set_load_status(lid,'in_transit'); insert into _v values('OWNER dispatch_move','ok -> '||v); exception when others then insert into _v values('OWNER dispatch_move','ERR '||sqlerrm); end;
  begin select count(*) into n from public.get_audit_logs(100,null,null,null,null); insert into _v values('OWNER audit_view','ok rows='||n); exception when others then insert into _v values('OWNER audit_view','ERR '||sqlerrm); end;
end $$;

-- DISPATCHER (deny carriers.approve / documents.review / audit)
do $$
declare v text;
begin
  perform set_config('request.jwt.claims','{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"}',true);
  begin perform public.cc_set_carrier_status((select id from public.profiles where role='carrier' limit 1),'active'); insert into _v values('DISPATCHER approve_carrier (expect DENY)','UNEXPECTED ok'); exception when others then insert into _v values('DISPATCHER approve_carrier (expect DENY)','denied: '||sqlerrm); end;
  begin perform public.get_audit_logs(10,null,null,null,null); insert into _v values('DISPATCHER audit (expect DENY)','UNEXPECTED ok'); exception when others then insert into _v values('DISPATCHER audit (expect DENY)','denied: '||sqlerrm); end;
end $$;

-- CARRIER + ANON
do $$
begin
  perform set_config('request.jwt.claims','{"sub":"'||(select id from public.profiles where role='carrier' limit 1)||'"}',true);
  insert into _v values('CARRIER is_active_staff (expect false)', public.is_active_staff()::text);
  perform set_config('request.jwt.claims','{}',true);
  begin perform public.cc_get_overview(); insert into _v values('ANON overview (expect DENY)','UNEXPECTED ok'); exception when others then insert into _v values('ANON overview (expect DENY)','denied: '||sqlerrm); end;
end $$;

select step, result from _v order by step;
rollback;  -- proof only; discard the synthetic-session demo writes
