-- WAVE 5 — FINANCE foundation.
-- Dispatch-fee invoicing + carrier settlements. LoadBoot charges a flat 5% dispatch fee:
-- an invoice carries gross (load/trip rate), fee (5%), net. Delivered trips become invoiceable
-- (the trip.delivered automation already raises an invoice-ready task). Invoices are bundled
-- into carrier settlements; PAYING OUT a settlement is a high-risk action gated behind
-- finance.approve AND a human-approval automation task. All writes go through RBAC-gated,
-- audited SECURITY DEFINER RPCs. Feature-flagged (finance_enabled, default OFF). Additive.
-- Applied to STAGING as ledger name w5_finance_0001_foundation.
-- DOWN: drop public cc_finance_*/cc_*_invoice/cc_*_settlement fns + app_private.fin_invoices,
--   fin_settlements + finance.* permission rows.

insert into app_private.permissions(key,description) values
  ('finance.view',null),('finance.manage',null),('finance.approve',null)
on conflict (key) do nothing;
do $$ declare m record; begin
  for m in select * from (values
    ('owner',            array['finance.view','finance.manage','finance.approve']::text[]),
    ('finance',          array['finance.view','finance.manage','finance.approve']::text[]),
    ('operations_admin', array['finance.view','finance.manage']::text[]),
    ('auditor',          array['finance.view']::text[])
  ) as t(rk, perms) loop
    insert into app_private.role_permissions(role_id,permission_id)
      select r.id,p.id from app_private.roles r, app_private.permissions p
      where r.key=m.rk and p.key=any(m.perms)
    on conflict do nothing;
  end loop;
end $$;

create table if not exists app_private.fin_settlements (
  id uuid primary key default gen_random_uuid(),
  settlement_no text unique not null,
  carrier_id uuid references public.organizations(id) on delete set null,
  period_start date, period_end date,
  gross numeric not null default 0, fee numeric not null default 0, net numeric not null default 0,
  status text not null default 'pending' check (status in ('pending','approved','paid','void')),
  created_by uuid, created_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz, paid_at timestamptz);

create table if not exists app_private.fin_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text unique not null,
  carrier_id uuid references public.organizations(id) on delete set null,
  load_id uuid references public.loads(id) on delete set null,
  trip_id uuid references app_private.trips(id) on delete set null,
  gross numeric not null default 0, fee_pct numeric not null default 5,
  fee numeric not null default 0, net numeric not null default 0,
  status text not null default 'draft' check (status in ('draft','sent','paid','void')),
  issued_at timestamptz, due_at date, paid_at timestamptz,
  settlement_id uuid references app_private.fin_settlements(id) on delete set null,
  created_by uuid, created_at timestamptz not null default now());
create index if not exists fin_invoices_status_idx on app_private.fin_invoices(status, created_at desc);
create index if not exists fin_invoices_carrier_idx on app_private.fin_invoices(carrier_id);

alter table app_private.fin_invoices enable row level security;
alter table app_private.fin_settlements enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;

create or replace function public.cc_finance_overview()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin
  if not public.has_global_permission('finance.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object(
    'draft',            (select count(*) from app_private.fin_invoices where status='draft'),
    'outstanding_fee',  (select coalesce(sum(fee),0) from app_private.fin_invoices where status='sent'),
    'paid_fee',         (select coalesce(sum(fee),0) from app_private.fin_invoices where status='paid'),
    'overdue',          (select count(*) from app_private.fin_invoices where status='sent' and due_at is not null and due_at < current_date),
    'invoices_total',   (select count(*) from app_private.fin_invoices),
    'settlements_pending',(select count(*) from app_private.fin_settlements where status in ('pending','approved')));
end; $function$;

create or replace function public.cc_list_invoices(p_status text default null, p_search text default null, p_limit int default 200)
returns table (id uuid, invoice_no text, carrier text, origin text, destination text, gross numeric, fee numeric, net numeric, status text, due_at date, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_limit int := least(greatest(coalesce(p_limit,200),1),500);
begin
  if not public.has_global_permission('finance.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query
    select i.id,i.invoice_no,org.name,l.origin,l.destination,i.gross,i.fee,i.net,i.status,i.due_at,i.created_at
    from app_private.fin_invoices i
    left join public.organizations org on org.id=i.carrier_id
    left join public.loads l on l.id=i.load_id
    where (p_status is null or i.status=p_status)
      and (p_search is null or i.invoice_no ilike '%'||p_search||'%' or org.name ilike '%'||p_search||'%')
    order by i.created_at desc limit v_limit;
end; $function$;

create or replace function public.cc_get_invoice(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare j jsonb;
begin
  if not public.has_global_permission('finance.view') then raise exception 'not authorized' using errcode='42501'; end if;
  select jsonb_build_object('id',i.id,'invoice_no',i.invoice_no,'carrier',org.name,'carrier_id',i.carrier_id,
    'origin',l.origin,'destination',l.destination,'gross',i.gross,'fee_pct',i.fee_pct,'fee',i.fee,'net',i.net,
    'status',i.status,'issued_at',i.issued_at,'due_at',i.due_at,'paid_at',i.paid_at,'settlement_no',s.settlement_no)
    into j from app_private.fin_invoices i
    left join public.organizations org on org.id=i.carrier_id
    left join public.loads l on l.id=i.load_id
    left join app_private.fin_settlements s on s.id=i.settlement_id
    where i.id=p_invoice;
  if j is null then raise exception 'invoice not found' using errcode='22023'; end if;
  return j;
end; $function$;

-- create a dispatch-fee invoice from a delivered/invoiced trip (gross=rate, fee=5%, net=gross-fee)
create or replace function public.cc_create_invoice(p_trip uuid, p_due_days int default 15)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid; v_no text; t record; v_gross numeric; v_fee numeric;
begin
  if not public.has_global_permission('finance.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  select id,load_id,carrier_id,rate,status into t from app_private.trips where id=p_trip;
  if t.id is null then raise exception 'trip not found' using errcode='22023'; end if;
  if t.status not in ('delivered','invoiced') then raise exception 'trip not delivered yet' using errcode='22023'; end if;
  if exists (select 1 from app_private.fin_invoices where trip_id=p_trip and status<>'void') then
    raise exception 'invoice already exists for this trip' using errcode='22023'; end if;
  v_gross := coalesce(t.rate,0); v_fee := round(v_gross * 0.05, 2);
  v_no := 'INV-'||to_char(now(),'YYYY')||'-'||lpad(((select count(*) from app_private.fin_invoices)+1)::text,5,'0');
  insert into app_private.fin_invoices(invoice_no,carrier_id,load_id,trip_id,gross,fee_pct,fee,net,status,issued_at,due_at,created_by)
    values (v_no,t.carrier_id,t.load_id,p_trip,v_gross,5,v_fee,v_gross-v_fee,'draft',now(),(current_date + coalesce(p_due_days,15)),auth.uid())
    returning id into v_id;
  perform app_private.log_audit('finance.invoice.create','fin_invoice',v_id::text,null,format('invoice %s for %s',v_no,v_gross), jsonb_build_object('invoice_no',v_no,'gross',v_gross,'fee',v_fee));
  perform app_private.emit_event('invoice.created','fin_invoice',v_id::text, jsonb_build_object('invoice_no',v_no,'fee',v_fee), 'invoice_create:'||v_id::text);
  return v_id;
end; $function$;

create or replace function public.cc_set_invoice_status(p_invoice uuid, p_status text)
returns text language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_cur text;
begin
  if not public.has_global_permission('finance.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_status not in ('draft','sent','paid','void') then raise exception 'invalid status' using errcode='22023'; end if;
  select status into v_cur from app_private.fin_invoices where id=p_invoice;
  if v_cur is null then raise exception 'invoice not found' using errcode='22023'; end if;
  update app_private.fin_invoices set status=p_status, paid_at=case when p_status='paid' then now() else paid_at end where id=p_invoice;
  perform app_private.log_audit('finance.invoice.status','fin_invoice',p_invoice::text,null,format('%s -> %s',v_cur,p_status), jsonb_build_object('from',v_cur,'to',p_status));
  perform app_private.emit_event('invoice.'||p_status,'fin_invoice',p_invoice::text, jsonb_build_object('status',p_status));
  return p_status;
end; $function$;

-- bundle a carrier's unpaid 'sent' invoices in a period into a settlement; raises the payout-approval gate
create or replace function public.cc_create_settlement(p_carrier uuid, p_period_start date, p_period_end date)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_id uuid; v_no text; v_gross numeric; v_fee numeric; v_net numeric; v_cnt int;
begin
  if not public.has_global_permission('finance.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  select count(*), coalesce(sum(gross),0), coalesce(sum(fee),0), coalesce(sum(net),0)
    into v_cnt, v_gross, v_fee, v_net
    from app_private.fin_invoices
    where carrier_id=p_carrier and status='sent' and settlement_id is null
      and (p_period_start is null or created_at::date >= p_period_start)
      and (p_period_end is null or created_at::date <= p_period_end);
  if v_cnt = 0 then raise exception 'no unpaid invoices to settle for this carrier/period' using errcode='22023'; end if;
  v_no := 'STL-'||to_char(now(),'YYYY')||'-'||lpad(((select count(*) from app_private.fin_settlements)+1)::text,4,'0');
  insert into app_private.fin_settlements(settlement_no,carrier_id,period_start,period_end,gross,fee,net,status,created_by)
    values (v_no,p_carrier,p_period_start,p_period_end,v_gross,v_fee,v_net,'pending',auth.uid()) returning id into v_id;
  update app_private.fin_invoices set settlement_id=v_id
    where carrier_id=p_carrier and status='sent' and settlement_id is null
      and (p_period_start is null or created_at::date >= p_period_start)
      and (p_period_end is null or created_at::date <= p_period_end);
  perform app_private.log_audit('finance.settlement.create','fin_settlement',v_id::text,null,format('settlement %s: %s invoices, net %s',v_no,v_cnt,v_net), jsonb_build_object('settlement_no',v_no,'net',v_net,'invoices',v_cnt));
  perform app_private.emit_event('settlement.created','fin_settlement',v_id::text, jsonb_build_object('settlement_no',v_no,'net',v_net), 'settlement_create:'||v_id::text);
  return v_id;
end; $function$;

-- approve or pay a settlement; PAYING OUT requires finance.approve (high-risk human gate)
create or replace function public.cc_decide_settlement(p_settlement uuid, p_decision text)
returns text language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_cur text; r record;
begin
  if not public.has_global_permission('finance.approve') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_decision not in ('approve','pay','void') then raise exception 'invalid decision' using errcode='22023'; end if;
  select status into v_cur from app_private.fin_settlements where id=p_settlement;
  if v_cur is null then raise exception 'settlement not found' using errcode='22023'; end if;
  if p_decision='approve' then
    update app_private.fin_settlements set status='approved', approved_by=auth.uid(), approved_at=now() where id=p_settlement and status='pending';
  elsif p_decision='pay' then
    if v_cur not in ('pending','approved') then raise exception 'settlement not payable' using errcode='22023'; end if;
    update app_private.fin_settlements set status='paid', paid_at=now(), approved_by=coalesce(approved_by,auth.uid()), approved_at=coalesce(approved_at,now()) where id=p_settlement;
    -- mark each bundled invoice paid and emit invoice.paid so downstream automation fires
    for r in select id from app_private.fin_invoices where settlement_id=p_settlement and status='sent' loop
      update app_private.fin_invoices set status='paid', paid_at=now() where id=r.id;
      perform app_private.emit_event('invoice.paid','fin_invoice',r.id::text, jsonb_build_object('via','settlement','settlement',p_settlement));
    end loop;
  else
    update app_private.fin_settlements set status='void' where id=p_settlement;
    update app_private.fin_invoices set settlement_id=null where settlement_id=p_settlement;
  end if;
  perform app_private.log_audit('finance.settlement.'||p_decision,'fin_settlement',p_settlement::text,null,format('settlement %s -> %s',v_cur,p_decision), jsonb_build_object('decision',p_decision));
  perform app_private.emit_event('settlement.'||p_decision,'fin_settlement',p_settlement::text, jsonb_build_object('decision',p_decision));
  return p_decision;
end; $function$;

create or replace function public.cc_list_settlements(p_status text default null, p_limit int default 200)
returns table (id uuid, settlement_no text, carrier text, period_start date, period_end date, gross numeric, fee numeric, net numeric, status text, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_limit int := least(greatest(coalesce(p_limit,200),1),500);
begin
  if not public.has_global_permission('finance.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select s.id,s.settlement_no,org.name,s.period_start,s.period_end,s.gross,s.fee,s.net,s.status,s.created_at
    from app_private.fin_settlements s left join public.organizations org on org.id=s.carrier_id
    where (p_status is null or s.status=p_status) order by s.created_at desc limit v_limit;
end; $function$;

revoke all on all functions in schema app_private from public, anon, authenticated;
do $$ declare fn text; begin
  for fn in select unnest(array[
    'public.cc_finance_overview()','public.cc_list_invoices(text,text,int)','public.cc_get_invoice(uuid)',
    'public.cc_create_invoice(uuid,int)','public.cc_set_invoice_status(uuid,text)',
    'public.cc_create_settlement(uuid,date,date)','public.cc_decide_settlement(uuid,text)',
    'public.cc_list_settlements(text,int)']) loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

insert into app_private.feature_flags(key,enabled,description,environment,audience)
  values ('finance_enabled',false,'Enable the Finance module','all','staff')
on conflict (key) do nothing;
insert into app_private.automation_rules(key,name,trigger_event,condition,action_type,action_config,requires_approval) values
  ('settlement_payout_approval','Settlement created -> payout approval (human gate)','settlement.created','{}'::jsonb,'create_task',
     jsonb_build_object('task_type','settlement_payout','title','Review & approve carrier settlement payout','priority','high','assignee_role','finance','sla_minutes',1440), true),
  ('invoice_paid_notify','Invoice paid -> finance notification','invoice.paid','{}'::jsonb,'notify',
     jsonb_build_object('assignee_role','finance','channel','in_app','template_key','invoice_paid'), false)
on conflict (key) do nothing;
