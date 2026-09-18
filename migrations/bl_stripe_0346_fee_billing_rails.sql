-- bl_stripe_0346 — Stripe rails for the LoadBoot fee invoice + owner approval queue.
--
-- WHAT THIS DOES (all additive; the existing settlement engine is untouched):
--   1. Stripe columns on app_private.fin_invoices (+ customer map, webhook event log, outbound queue)
--   2. Two feature flags, BOTH OFF by default, so applying this migration changes NOTHING until
--      the owner turns them on:
--        fee_invoice_approval_queue  — hold auto-invoices at 'draft' for owner review
--        stripe_fee_billing_enabled  — create a Stripe invoice (hosted pay page, ACH + card)
--   3. app_private.fee_invoice_notify() — the carrier-facing in-app + email notice, extracted out of
--      the delivery trigger so the trigger, the approve RPC and the Stripe worker all send the
--      SAME premium email exactly once (idempotency key feeinv:<invoice_no>).
--   4. auto_invoice_on_delivery() patched: net-15 -> net-30 (matches loadboot.com, the dispatch
--      agreement and the Stripe account), and holds at 'draft' when the approval queue flag is on.
--   5. CC RPCs: cc_fee_invoice_queue / cc_fee_invoice_approve / cc_fee_invoice_reject
--      + cc_fee_invoice_stripe_sync for the edge function.
--
-- STAGING FIRST. Verify the anon-executable SECURITY DEFINER surface after applying
-- (docs/audit-2026-09/anon-secdef-baseline.md) — this migration adds NO anon-executable functions.

-- ─────────────────────────────────────────────────────────────── 1. schema
alter table app_private.fin_invoices
  add column if not exists stripe_invoice_id text,
  add column if not exists stripe_status     text,
  add column if not exists hosted_url        text,
  add column if not exists pdf_url           text,
  add column if not exists approved_at       timestamptz,
  add column if not exists approved_by       uuid,
  add column if not exists sent_at           timestamptz,
  add column if not exists void_reason       text;

create unique index if not exists fin_invoices_stripe_id_uidx
  on app_private.fin_invoices(stripe_invoice_id) where stripe_invoice_id is not null;
create index if not exists fin_invoices_status_idx on app_private.fin_invoices(status, due_at);

create table if not exists app_private.lb_stripe_customers(
  org_id             uuid primary key references public.organizations(id) on delete cascade,
  stripe_customer_id text not null unique,
  email              text,
  created_at         timestamptz not null default now()
);

-- every webhook Stripe delivers, exactly once (Stripe retries; this is the idempotency gate)
create table if not exists app_private.lb_stripe_events(
  event_id     text primary key,
  type         text not null,
  payload      jsonb,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);

-- outbound work. NEVER call Stripe from inside a trigger — enqueue here, a worker drains it.
create table if not exists app_private.lb_stripe_queue(
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references app_private.fin_invoices(id) on delete cascade,
  op         text not null check (op in ('create_invoice','void_invoice')),
  attempts   int  not null default 0,
  last_error text,
  run_after  timestamptz not null default now(),
  done_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists lb_stripe_queue_pending_idx
  on app_private.lb_stripe_queue(run_after) where done_at is null;

-- ─────────────────────────────────────────────────────────────── 2. flags (both OFF)
insert into app_private.feature_flags(key, enabled, description, environment, audience)
select 'fee_invoice_approval_queue', false,
       'Hold auto fee invoices at draft for owner approval instead of sending on delivery',
       'all', 'staff'
where not exists (select 1 from app_private.feature_flags where key='fee_invoice_approval_queue');

insert into app_private.feature_flags(key, enabled, description, environment, audience)
select 'stripe_fee_billing_enabled', false,
       'Create a Stripe invoice (hosted ACH + card pay page) when a fee invoice is sent',
       'all', 'staff'
where not exists (select 1 from app_private.feature_flags where key='stripe_fee_billing_enabled');

create or replace function app_private.lb_flag(p_key text)
 returns boolean language sql stable
 set search_path to 'app_private, public'
as $$ select coalesce((select enabled from app_private.feature_flags where key = p_key), false) $$;

-- ─────────────────────────────────────────────────────────────── 3. the one carrier notice
-- Sends the in-app notification + the premium fee-invoice email for ONE invoice.
-- Safe to call more than once: sys_email idempotency key feeinv:<invoice_no> de-dupes the email.
create or replace function app_private.fee_invoice_notify(p_invoice uuid)
 returns void language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare i record; v_email text; v_owner uuid; v_pay_url text; v_due text; v_rail text;
begin
  select * into i from app_private.fin_invoices where id = p_invoice;
  if i.id is null or i.status <> 'sent' then return; end if;

  select o.owner_user_id, u.email into v_owner, v_email
    from public.organizations o left join auth.users u on u.id = o.owner_user_id
   where o.id = i.carrier_id;

  v_due  := to_char(coalesce(i.due_at, current_date + 30), 'Mon DD, YYYY');
  -- Stripe hosted page when we have one, otherwise the carrier portal (manual transfer rail)
  v_pay_url := coalesce(i.hosted_url, 'https://loadboot.com/app/carrier/#finance');
  v_rail := case when i.hosted_url is not null
                 then 'Pay by bank transfer (ACH) or card — it posts to your account automatically.'
                 else 'Transfer with memo <b>' || i.invoice_no || '</b>, attach the receipt, LoadBoot confirms and it flips to PAID.' end;

  begin
    insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
    select v_owner, 'in_app', 'fee.invoice_due', jsonb_build_object(
      'title', '🧾 Dispatch fee invoice ' || i.invoice_no || ' — $' || i.fee || ' due',
      'body',  'Your load delivered — LoadBoot''s 5% service fee ($' || i.fee || ' on $' || i.gross ||
               ' gross) is due by ' || v_due || '.',
      'tone', 'info', 'url', '/app/carrier/#finance')
    , 'sent', now()
    where v_owner is not null;
  exception when others then null; end;

  begin
    if v_email is not null then
      perform app_private.sys_email(
        v_email, 'fee.invoice_due',
        'LoadBoot: invoice ' || i.invoice_no || ' — $' || i.fee || ' dispatch fee due (net 30)',
        '<div style="font-family:Inter,Arial,sans-serif"><h2>🧾 Invoice ' || i.invoice_no || '</h2>'
        || '<p>Your load delivered — LoadBoot''s flat 5% service fee is now due.</p>'
        || '<table style="border-collapse:collapse;font-size:14px">'
        || '<tr><td style="padding:4px 14px 4px 0;color:#666">Load gross</td><td><b>$' || i.gross || '</b></td></tr>'
        || '<tr><td style="padding:4px 14px 4px 0;color:#666">Dispatch fee (5%)</td><td><b>$' || i.fee || '</b></td></tr>'
        || '<tr><td style="padding:4px 14px 4px 0;color:#666">Due</td><td><b>' || v_due || '</b></td></tr></table>'
        || '<p style="margin:18px 0"><a href="' || v_pay_url || '" style="background:#0883F7;color:#fff;'
        || 'padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Pay invoice</a></p>'
        || '<p style="color:#666;font-size:13px">' || v_rail || '</p></div>',
        null, 'feeinv:' || i.invoice_no);
    end if;
  exception when others then null; end;
end; $$;
revoke all on function app_private.fee_invoice_notify(uuid) from public;

-- ─────────────────────────────────────────────────────────────── 4. the delivery trigger
-- CHANGED vs the live version: net-15 -> net-30, and the approval-queue hold.
-- Everything else (invoice_no, 5% maths, audit, emit_event) is byte-for-byte the same.
create or replace function app_private.auto_invoice_on_delivery()
 returns trigger language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare v_no text; v_gross numeric; v_fee numeric; v_hold boolean; v_status text; v_id uuid;
begin
  if new.status='delivered' and (old.status is distinct from 'delivered')
     and not exists (select 1 from app_private.fin_invoices where trip_id=new.id and status<>'void') then
    v_gross := coalesce(new.rate,0); v_fee := round(v_gross*0.05,2);
    v_no := 'INV-'||to_char(now(),'YYYY')||'-'||lpad(((select count(*) from app_private.fin_invoices)+1)::text,5,'0');
    v_hold := app_private.lb_flag('fee_invoice_approval_queue');
    v_status := case when v_hold then 'draft' else 'sent' end;

    insert into app_private.fin_invoices(invoice_no,carrier_id,load_id,trip_id,gross,fee_pct,fee,net,status,issued_at,due_at,created_by,sent_at)
      values (v_no,new.carrier_id,new.load_id,new.id,v_gross,5,v_fee,v_gross-v_fee,v_status,now(),current_date+30,new.created_by,
              case when v_hold then null else now() end)
      returning id into v_id;

    perform app_private.log_audit('finance.invoice.auto','fin_invoice',new.id::text,null,
      format('auto-invoice %s %s on delivery', v_no, case when v_hold then 'drafted (awaiting approval)' else 'issued' end),
      jsonb_build_object('invoice_no',v_no,'fee',v_fee,'held',v_hold));
    perform app_private.emit_event('invoice.created','fin_invoice',new.id::text,
      jsonb_build_object('invoice_no',v_no,'auto',true,'held',v_hold), 'auto_invoice:'||new.id::text);

    if not v_hold then
      if app_private.lb_flag('stripe_fee_billing_enabled') then
        insert into app_private.lb_stripe_queue(invoice_id, op) values (v_id, 'create_invoice');
      else
        perform app_private.fee_invoice_notify(v_id);
      end if;
    end if;
  end if;
  return new;
end; $$;

-- ─────────────────────────────────────────────────────────────── 5. Command Center RPCs
-- What is waiting for the owner's eyes.
create or replace function public.cc_fee_invoice_queue()
 returns jsonb language plpgsql stable security definer
 set search_path to 'app_private, public'
as $$
declare v jsonb;
begin
  if not (public.has_global_permission('finance.manage') or public.has_global_permission('finance.view')) then
    raise exception 'not authorized' using errcode='42501'; end if;
  select coalesce(jsonb_agg(x order by x->>'delivered_at' desc nulls last), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'id', i.id, 'invoice_no', i.invoice_no, 'gross', i.gross, 'fee', i.fee, 'fee_pct', i.fee_pct,
      'due_at', i.due_at, 'created_at', i.created_at,
      'carrier', (select name from public.organizations o where o.id = i.carrier_id),
      'carrier_id', i.carrier_id,
      'lane', coalesce(l.origin,'?') || ' → ' || coalesce(l.destination,'?'),
      'delivered_at', t.delivered_at,
      'rate', t.rate
    ) x
    from app_private.fin_invoices i
    left join public.loads l on l.id = i.load_id
    left join app_private.trips t on t.id = i.trip_id
    where i.status = 'draft'
  ) s;
  return jsonb_build_object('pending', v, 'count', jsonb_array_length(v));
end; $$;
revoke all on function public.cc_fee_invoice_queue() from public;
grant execute on function public.cc_fee_invoice_queue() to authenticated;

-- Approve = this is the moment the carrier hears from us.
create or replace function public.cc_fee_invoice_approve(p_invoice uuid, p_note text default null)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare i record; v_stripe boolean;
begin
  if not public.has_global_permission('finance.manage') then
    raise exception 'not authorized' using errcode='42501'; end if;
  select * into i from app_private.fin_invoices where id = p_invoice for update;
  if i.id is null then raise exception 'invoice not found' using errcode='22023'; end if;
  if i.status <> 'draft' then
    raise exception 'only draft invoices can be approved — this one is %', i.status using errcode='22023'; end if;

  update app_private.fin_invoices
     set status='sent', approved_at=now(), approved_by=auth.uid(), sent_at=now(),
         issued_at=coalesce(issued_at, now()), due_at = current_date + 30
   where id = p_invoice;

  perform app_private.log_audit('finance.invoice.approve','fin_invoice',p_invoice::text,null,
    format('fee invoice %s approved and sent', i.invoice_no),
    jsonb_build_object('invoice_no',i.invoice_no,'fee',i.fee,'note',p_note));

  v_stripe := app_private.lb_flag('stripe_fee_billing_enabled');
  if v_stripe then
    -- worker creates the Stripe invoice, writes hosted_url, then calls the notice
    insert into app_private.lb_stripe_queue(invoice_id, op) values (p_invoice, 'create_invoice');
  else
    perform app_private.fee_invoice_notify(p_invoice);
  end if;

  return jsonb_build_object('ok', true, 'invoice_no', i.invoice_no, 'stripe', v_stripe);
end; $$;
revoke all on function public.cc_fee_invoice_approve(uuid,text) from public;
grant execute on function public.cc_fee_invoice_approve(uuid,text) to authenticated;

-- Reject = something is wrong with the load/rate; void it, nothing reaches the carrier.
create or replace function public.cc_fee_invoice_reject(p_invoice uuid, p_reason text)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare i record;
begin
  if not public.has_global_permission('finance.manage') then
    raise exception 'not authorized' using errcode='42501'; end if;
  if coalesce(btrim(p_reason),'') = '' then
    raise exception 'a reason is required to void an invoice' using errcode='22023'; end if;
  select * into i from app_private.fin_invoices where id = p_invoice for update;
  if i.id is null then raise exception 'invoice not found' using errcode='22023'; end if;
  if i.status <> 'draft' then
    raise exception 'only draft invoices can be rejected — this one is %', i.status using errcode='22023'; end if;

  update app_private.fin_invoices set status='void', void_reason=p_reason where id = p_invoice;
  perform app_private.log_audit('finance.invoice.reject','fin_invoice',p_invoice::text,null,
    format('fee invoice %s voided before sending: %s', i.invoice_no, p_reason),
    jsonb_build_object('invoice_no',i.invoice_no,'reason',p_reason));
  return jsonb_build_object('ok', true, 'invoice_no', i.invoice_no);
end; $$;
revoke all on function public.cc_fee_invoice_reject(uuid,text) from public;
grant execute on function public.cc_fee_invoice_reject(uuid,text) to authenticated;

-- Called by the stripe-worker / stripe-webhook edge functions with the service role.
create or replace function public.cc_fee_invoice_stripe_sync(
  p_invoice uuid, p_stripe_id text, p_hosted text default null, p_pdf text default null,
  p_stripe_status text default null, p_notify boolean default false)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
begin
  update app_private.fin_invoices
     set stripe_invoice_id = coalesce(p_stripe_id, stripe_invoice_id),
         hosted_url        = coalesce(p_hosted, hosted_url),
         pdf_url           = coalesce(p_pdf, pdf_url),
         stripe_status     = coalesce(p_stripe_status, stripe_status)
   where id = p_invoice;
  if p_notify then perform app_private.fee_invoice_notify(p_invoice); end if;
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.cc_fee_invoice_stripe_sync(uuid,text,text,text,text,boolean) from public;
grant execute on function public.cc_fee_invoice_stripe_sync(uuid,text,text,text,text,boolean) to service_role;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────── 6. CLOSE THE ANON DOOR
-- Supabase's default privileges grant EXECUTE on new public functions to anon/authenticated.
-- `revoke ... from public` does NOT remove those. Without these lines the anon-executable
-- SECURITY DEFINER count goes 32 -> 36. Verified back at 32 after applying.
revoke all on function public.cc_fee_invoice_queue() from anon;
revoke all on function public.cc_fee_invoice_approve(uuid,text) from anon;
revoke all on function public.cc_fee_invoice_reject(uuid,text) from anon;
revoke all on function public.cc_fee_invoice_stripe_sync(uuid,text,text,text,text,boolean) from anon;
revoke all on function public.cc_fee_invoice_stripe_sync(uuid,text,text,text,text,boolean) from authenticated;

-- ─────────────────────────────────────────────────────────────── 7. paid / unpaid (webhook only)
-- Stripe is the ONLY source of truth for "paid". ACH is delayed-notification: a carrier clicking
-- Pay does not mean funds moved, and a debit can be returned for up to 60 days.
create or replace function public.cc_fee_invoice_mark_paid(
  p_stripe_invoice_id text, p_paid_at timestamptz default now(),
  p_method text default 'stripe', p_payment_ref text default null)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare i record; v_owner uuid; v_email text;
begin
  select * into i from app_private.fin_invoices where stripe_invoice_id = p_stripe_invoice_id for update;
  if i.id is null then return jsonb_build_object('ok', false, 'reason', 'unknown stripe invoice'); end if;
  if i.status = 'paid' then return jsonb_build_object('ok', true, 'already', true); end if;

  update app_private.fin_invoices set status='paid', paid_at=p_paid_at, stripe_status='paid' where id = i.id;

  if not exists (select 1 from app_private.pay_transfers where kind='platform_fee' and ref_id=i.id) then
    insert into app_private.pay_transfers(kind, ref_id, payer_org, payee_org, amount, status, method,
                                          payment_ref, sent_at, received_at)
    values ('platform_fee', i.id, i.carrier_id, null, i.fee, 'received', p_method,
            coalesce(p_payment_ref, p_stripe_invoice_id), p_paid_at, p_paid_at);
  else
    update app_private.pay_transfers
       set status='received', received_at=p_paid_at, method=p_method,
           payment_ref=coalesce(p_payment_ref, p_stripe_invoice_id)
     where kind='platform_fee' and ref_id=i.id;
  end if;

  perform app_private.log_audit('finance.invoice.paid','fin_invoice',i.id::text,null,
    format('fee invoice %s paid via %s', i.invoice_no, p_method),
    jsonb_build_object('invoice_no',i.invoice_no,'fee',i.fee,'stripe_invoice',p_stripe_invoice_id));

  begin
    select o.owner_user_id, u.email into v_owner, v_email
      from public.organizations o left join auth.users u on u.id=o.owner_user_id where o.id=i.carrier_id;
    insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
    select v_owner, 'in_app', 'fee.invoice_paid', jsonb_build_object(
      'title', 'Invoice ' || i.invoice_no || ' paid',
      'body',  'We received your $' || i.fee || ' dispatch fee. Thank you.',
      'tone', 'success', 'url', '/app/carrier/#finance'), 'sent', now()
    where v_owner is not null;
    if v_email is not null then
      perform app_private.sys_email(v_email, 'fee.invoice_paid',
        'LoadBoot: invoice ' || i.invoice_no || ' paid',
        '<div style="font-family:Inter,Arial,sans-serif"><h2>Invoice ' || i.invoice_no || ' — paid</h2>'
        || '<p>We received your $' || i.fee || ' dispatch fee. Nothing further is owed on this load.</p></div>',
        null, 'feepaid:' || i.invoice_no);
    end if;
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'invoice_no', i.invoice_no);
end; $$;

create or replace function public.cc_fee_invoice_mark_unpaid(
  p_stripe_invoice_id text, p_reason text default null, p_stripe_status text default 'payment_failed')
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare i record;
begin
  select * into i from app_private.fin_invoices where stripe_invoice_id = p_stripe_invoice_id for update;
  if i.id is null then return jsonb_build_object('ok', false, 'reason', 'unknown stripe invoice'); end if;
  update app_private.fin_invoices set status='sent', paid_at=null, stripe_status=p_stripe_status where id=i.id;
  update app_private.pay_transfers set status='failed', note=coalesce(p_reason,'stripe payment failed')
   where kind='platform_fee' and ref_id=i.id;
  perform app_private.log_audit('finance.invoice.payment_failed','fin_invoice',i.id::text,null,
    format('fee invoice %s payment failed: %s', i.invoice_no, coalesce(p_reason,'unknown')),
    jsonb_build_object('invoice_no',i.invoice_no,'stripe_status',p_stripe_status));
  return jsonb_build_object('ok', true, 'invoice_no', i.invoice_no);
end; $$;

-- ─────────────────────────────────────────────────────────────── 8. worker/webhook RPC surface
-- The edge functions talk ONLY through these. app_private is NOT exposed to PostgREST — keep it so.
create or replace function public.cc_stripe_queue_take(p_limit int default 20)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare v jsonb;
begin
  with claimed as (
    update app_private.lb_stripe_queue q set attempts = q.attempts + 1
     where q.id in (select id from app_private.lb_stripe_queue
                     where done_at is null and run_after <= now()
                     order by created_at limit p_limit for update skip locked)
    returning q.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'job_id', c.id, 'op', c.op, 'attempts', c.attempts,
    'invoice_id', i.id, 'invoice_no', i.invoice_no, 'fee', i.fee, 'gross', i.gross,
    'fee_pct', i.fee_pct, 'due_at', i.due_at, 'stripe_invoice_id', i.stripe_invoice_id,
    'carrier_id', i.carrier_id,
    'carrier_name', (select name from public.organizations o where o.id = i.carrier_id),
    'carrier_email', (select u.email from public.organizations o
                        join auth.users u on u.id = o.owner_user_id where o.id = i.carrier_id),
    'stripe_customer_id', (select s.stripe_customer_id from app_private.lb_stripe_customers s
                            where s.org_id = i.carrier_id),
    'lane', coalesce((select coalesce(l.origin,'?')||' -> '||coalesce(l.destination,'?')
                        from public.loads l where l.id = i.load_id), 'delivered load')
  )), '[]'::jsonb) into v
  from claimed c join app_private.fin_invoices i on i.id = c.invoice_id;
  return v;
end; $$;

create or replace function public.cc_stripe_queue_finish(
  p_job uuid, p_error text default null, p_max_attempts int default 5)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare j record;
begin
  select * into j from app_private.lb_stripe_queue where id = p_job for update;
  if j.id is null then return jsonb_build_object('ok', false); end if;
  if p_error is null then
    update app_private.lb_stripe_queue set done_at = now(), last_error = null where id = p_job;
    return jsonb_build_object('ok', true, 'done', true);
  end if;
  update app_private.lb_stripe_queue
     set last_error = p_error,
         run_after  = now() + (power(2, least(j.attempts, 6)) * interval '1 minute'),
         done_at    = case when j.attempts >= p_max_attempts then now() else null end
   where id = p_job;
  if j.attempts >= p_max_attempts then
    perform app_private.log_audit('finance.stripe.job_dead','fin_invoice', j.invoice_id::text, null,
      format('Stripe job gave up after %s attempts: %s', j.attempts, p_error),
      jsonb_build_object('job', p_job, 'error', p_error));
  end if;
  return jsonb_build_object('ok', true, 'dead', j.attempts >= p_max_attempts);
end; $$;

create or replace function public.cc_stripe_customer_put(p_org uuid, p_customer text, p_email text default null)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
begin
  insert into app_private.lb_stripe_customers(org_id, stripe_customer_id, email)
  values (p_org, p_customer, p_email)
  on conflict (org_id) do update set stripe_customer_id = excluded.stripe_customer_id,
                                     email = coalesce(excluded.email, app_private.lb_stripe_customers.email);
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.cc_stripe_event_seen(p_event text, p_type text, p_payload jsonb default null)
 returns boolean language plpgsql security definer
 set search_path to 'app_private, public'
as $$
begin
  insert into app_private.lb_stripe_events(event_id, type, payload) values (p_event, p_type, p_payload);
  return true;
exception when unique_violation then return false;
end; $$;

create or replace function public.cc_stripe_event_done(p_event text, p_error text default null)
 returns void language sql security definer
 set search_path to 'app_private, public'
as $$ update app_private.lb_stripe_events
        set processed_at = case when p_error is null then now() else processed_at end, error = p_error
      where event_id = p_event $$;

create or replace function public.cc_fee_invoice_stripe_status(p_stripe_invoice_id text, p_status text)
 returns void language sql security definer
 set search_path to 'app_private, public'
as $$ update app_private.fin_invoices set stripe_status = p_status
      where stripe_invoice_id = p_stripe_invoice_id $$;

-- service_role ONLY for every function in sections 7 and 8
do $grants$
declare f text;
begin
  foreach f in array array[
    'public.cc_fee_invoice_mark_paid(text,timestamptz,text,text)',
    'public.cc_fee_invoice_mark_unpaid(text,text,text)',
    'public.cc_stripe_queue_take(int)',
    'public.cc_stripe_queue_finish(uuid,text,int)',
    'public.cc_stripe_customer_put(uuid,text,text)',
    'public.cc_stripe_event_seen(text,text,jsonb)',
    'public.cc_stripe_event_done(text,text)',
    'public.cc_fee_invoice_stripe_status(text,text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('revoke all on function %s from authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $grants$;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────── APPLIED
-- STAGING (snslhvmkjusozgjelghi): applied 2026-09-14 in parts a–g.
--   anon-executable SECURITY DEFINER count: 32 before -> 32 after  ✓ (baseline held)
--   both feature flags verified OFF; draft/approve path tested inside a rolled-back transaction.
-- PRODUCTION (rwscphuhpjoudvljvmdk): NOT applied yet — owner test on staging first.
