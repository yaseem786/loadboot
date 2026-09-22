-- ============================================================================
-- bl_inv_0406 — Investor module, round 4 ("nothing left out"):
--   • GROWTH v2     — verified vs unverified carriers, broker statuses, dispatchers,
--                     30-day daily series, nightly snapshots (history by day / month),
--                     traffic figures the owner enters from Search Console / Analytics.
--   • PLAN          — where the money goes and why (settings 'plan'), how income is
--                     earned ('revenue_model'), traffic ('traffic').
--   • UPDATES       — owner posts progress notes (daily / weekly / milestone).
--   • NOTIFICATIONS — in-app feed + premium e-mail for every event that touches the
--                     investor (request, expense, statement, payout, document, proposal
--                     decision, question answered, update). Triggers, not RPC edits.
--   • AUDIT         — the investor can read the full audit trail of their agreement.
-- Additive only. Requires pg_cron (present on both projects).
-- ============================================================================
create table if not exists app_private.inv_growth_daily (
  day      date primary key,
  metrics  jsonb not null,
  taken_at timestamptz not null default now()
);
alter table app_private.inv_growth_daily enable row level security;

create table if not exists app_private.inv_updates (
  id            uuid primary key default gen_random_uuid(),
  agreement_id  uuid references app_private.inv_agreements(id) on delete cascade,  -- null = every investor
  kind          text not null default 'note' check (kind in ('daily','weekly','milestone','note')),
  title         text not null,
  body          text not null,
  send_email    boolean not null default true,
  created_by    uuid,
  created_at    timestamptz not null default now()
);
alter table app_private.inv_updates enable row level security;

create table if not exists app_private.inv_notifications (
  id           uuid primary key default gen_random_uuid(),
  investor_id  uuid not null references app_private.inv_investors(id) on delete cascade,
  agreement_id uuid,
  kind         text not null,
  title        text not null,
  body         text,
  ref_kind     text, ref_id text,
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);
alter table app_private.inv_notifications enable row level security;
create index if not exists inv_notifications_inv_idx on app_private.inv_notifications(investor_id, read_at, created_at desc);

-- ───────────────────────────── settings: more keys
create or replace function public.cc_inv_settings_set(p_key text, p_value jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
begin
  if not app_private.inv_can_manage() then raise exception 'not authorized' using errcode='42501'; end if;
  if p_key not in ('payment_instructions','fx','forecast','vendors','links','plan','revenue_model','traffic') then
    raise exception 'unknown setting' using errcode='22023'; end if;
  insert into app_private.inv_settings (key, value, updated_by) values (p_key, coalesce(p_value,'{}'::jsonb), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  perform app_private.log_audit('investor.setting_saved','investor', p_key, null, 'Investor setting saved', p_value);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.inv_settings()
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
begin
  if app_private.inv_my_investor() is null and not app_private.inv_is_staff() then
    raise exception 'not authorized' using errcode='42501'; end if;
  return (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from app_private.inv_settings
           where key in ('payment_instructions','fx','forecast','links','plan','revenue_model','traffic'));
end $$;

-- ───────────────────────────── growth v2 (counts only — never names)
create or replace function app_private.inv_growth_metrics()
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare r jsonb;
begin
  r := jsonb_build_object(
    'carriers_total',      (select count(*) from public.organizations where kind = 'carrier' and coalesce(is_demo,false) = false),
    'carriers_verified',   (select count(*) from app_private.carrier_onboarding where stage = 'approved'),
    'carriers_in_review',  (select count(*) from app_private.carrier_onboarding where stage in ('submitted','docs_review','compliance_check')),
    'carriers_unverified', (select count(*) from public.organizations o where o.kind = 'carrier' and coalesce(o.is_demo,false) = false
                              and not exists (select 1 from app_private.carrier_onboarding c where c.carrier_id = o.id and c.stage in ('approved','submitted','docs_review','compliance_check'))),
    'carriers_active',     (select count(*) from public.organizations where kind = 'carrier' and status = 'active' and coalesce(is_demo,false) = false),
    'carriers_assigned',   (select count(distinct carrier_org_id) from app_private.dispatcher_assignments where status = 'active'),
    'dispatchers_active',  (select count(distinct dispatcher_user_id) from app_private.dispatcher_assignments where status = 'active'),
    'brokers_total',       (select count(*) from public.organizations where kind = 'broker' and coalesce(is_demo,false) = false),
    'brokers_active',      (select count(*) from public.organizations where kind = 'broker' and status = 'active' and coalesce(is_demo,false) = false),
    'brokers_pending',     (select count(*) from public.organizations where kind = 'broker' and status = 'pending' and coalesce(is_demo,false) = false),
    'brokers_identity_verified', (select count(*) from app_private.broker_identity where verified_at is not null),
    'brokers_authority_passed',  (select count(*) from app_private.broker_screenings where last_outcome = 'pass' or outcome = 'pass'),
    'shippers_total',      (select count(*) from public.organizations where kind = 'shipper' and coalesce(is_demo,false) = false),
    'trucks_active',       (select count(*) from app_private.fleet_trucks where status = 'active'),
    'loads_available',     (select count(*) from public.loads where status = 'available'),
    'loads_booked',        (select count(*) from public.loads where status in ('booked','in_transit')),
    'loads_delivered',     (select count(*) from public.loads where status = 'delivered'),
    'trips_in_transit',    (select count(*) from app_private.trips where status = 'in_transit'),
    'trips_delivered',     (select count(*) from app_private.trips where status in ('delivered','invoiced')),
    'trips_delivered_30d', (select count(*) from app_private.trips where status in ('delivered','invoiced') and delivered_at >= now() - interval '30 days'),
    'fees_collected_total',(select coalesce(sum(fee),0) from app_private.fin_invoices where status = 'paid'),
    'fees_collected_30d',  (select coalesce(sum(fee),0) from app_private.fin_invoices where status = 'paid' and coalesce(paid_at, created_at) >= now() - interval '30 days'),
    'fees_outstanding',    (select coalesce(sum(fee),0) from app_private.fin_invoices where status = 'sent'),
    'gross_moved_30d',     (select coalesce(sum(gross),0) from app_private.fin_invoices where coalesce(paid_at, created_at) >= now() - interval '30 days' and status <> 'void'),
    'as_of', now());
  return r;
end $$;

create or replace function public.inv_growth()
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare r jsonb;
begin
  if app_private.inv_my_investor() is null and not app_private.inv_is_staff() then
    raise exception 'not authorized' using errcode='42501'; end if;
  r := app_private.inv_growth_metrics();
  r := r || jsonb_build_object(
    'carriers_by_month', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'n', n) order by m), '[]'::jsonb) from (
        select date_trunc('month', created_at)::date as m, count(*) as n from public.organizations
         where kind = 'carrier' and coalesce(is_demo,false) = false and created_at >= date_trunc('month', now()) - interval '5 months' group by 1) z),
    'trips_by_month', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'n', n) order by m), '[]'::jsonb) from (
        select date_trunc('month', coalesce(delivered_at, created_at))::date as m, count(*) as n from app_private.trips
         where status in ('delivered','invoiced') and coalesce(delivered_at, created_at) >= date_trunc('month', now()) - interval '5 months' group by 1) z),
    'carriers_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d), '[]'::jsonb) from (
        select d::date, (select count(*) from public.organizations o where o.kind = 'carrier' and coalesce(o.is_demo,false) = false and o.created_at::date = d::date) as n
          from generate_series((now() - interval '29 days')::date, now()::date, '1 day') d) z),
    'trips_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d), '[]'::jsonb) from (
        select d::date, (select count(*) from app_private.trips t where t.status in ('delivered','invoiced') and t.delivered_at::date = d::date) as n
          from generate_series((now() - interval '29 days')::date, now()::date, '1 day') d) z),
    'fees_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d), '[]'::jsonb) from (
        select d::date, (select coalesce(sum(fee),0) from app_private.fin_invoices f where f.status = 'paid' and coalesce(f.paid_at, f.created_at)::date = d::date) as n
          from generate_series((now() - interval '29 days')::date, now()::date, '1 day') d) z),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'm', metrics) order by day), '[]'::jsonb)
                  from (select day, metrics from app_private.inv_growth_daily order by day desc limit 90) h),
    'traffic', (select value from app_private.inv_settings where key = 'traffic'));
  return r;
end $$;

-- nightly snapshot (history by day → by month in the portal)
create or replace function app_private.inv_snapshot_growth()
returns void language plpgsql security definer set search_path to 'app_private, public' as $$
begin
  insert into app_private.inv_growth_daily (day, metrics) values (current_date, app_private.inv_growth_metrics())
  on conflict (day) do update set metrics = excluded.metrics, taken_at = now();
end $$;
select cron.unschedule('lb-inv-growth-snapshot') where exists (select 1 from cron.job where jobname = 'lb-inv-growth-snapshot');
select cron.schedule('lb-inv-growth-snapshot', '10 0 * * *', $$select app_private.inv_snapshot_growth();$$);
select app_private.inv_snapshot_growth();

-- ───────────────────────────── premium e-mail shell (real logo + tagline)
create or replace function app_private.inv_email_html(p_title text, p_intro text, p_rows jsonb, p_cta_label text, p_cta_url text)
returns text language plpgsql immutable as $$
declare v_rows text := ''; r jsonb;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_rows := v_rows || '<tr><td style="padding:8px 0;border-bottom:1px solid #E6EDF5;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#64748B;width:42%">' || coalesce(r->>'k','') ||
              '</td><td style="padding:8px 0;border-bottom:1px solid #E6EDF5;font-size:14px;font-weight:700;color:#10223B">' || coalesce(r->>'v','') || '</td></tr>';
  end loop;
  return '<!doctype html><html><body style="margin:0;background:#EEF2F7;font-family:Arial,Helvetica,sans-serif">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF2F7;padding:28px 12px"><tr><td align="center">'
    || '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(16,34,59,.08)">'
    || '<tr><td style="background:#10223B;padding:22px 28px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>'
    || '<td style="padding-right:14px;border-right:3px solid #FC5305"><a href="https://loadboot.com" style="text-decoration:none"><img src="https://loadboot.com/email-logo-white-2x.png" width="124" height="30" alt="LoadBoot" style="display:block;border:0"></a></td>'
    || '<td style="padding-left:14px"><div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#4FA9FF">The Operating System for Trucking</div><div style="font-size:12px;color:#A5B6CD;margin-top:2px">Investor Portal</div></td></tr></table></td></tr>'
    || '<tr><td style="padding:28px 28px 8px"><h1 style="margin:0 0 8px;font-size:20px;color:#10223B">' || coalesce(p_title,'') || '</h1>'
    || '<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155">' || coalesce(p_intro,'') || '</p>'
    || case when v_rows <> '' then '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 16px">' || v_rows || '</table>' else '' end
    || case when p_cta_url is not null then '<a href="' || p_cta_url || '" style="display:inline-block;background:#0883F7;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;font-size:14px">' || coalesce(p_cta_label,'Open the portal') || '</a>' else '' end
    || '</td></tr>'
    || '<tr><td style="padding:16px 28px 26px;font-size:12px;color:#94A3B8;line-height:1.6">This is a record notice from your private LoadBoot Investor Portal. The portal record is the record. Replies are not read — raise a question inside the portal.<br>LoadBoot LLC · <a href="https://loadboot.com" style="color:#0883F7;text-decoration:none">loadboot.com</a></td></tr>'
    || '</table></td></tr></table></body></html>';
end $$;

insert into app_private.email_catalog (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, preference_group, unsub_allowed, status, cc_deep_link)
values ('investor.notice', 'Investor portal notice', 'Every event that touches an investor''s money or agreement: capital request, expense, statement, payout, document, proposal decision, answered question, owner update.', 'T', 'investor', 'event', 'app_private.inv_notify (triggers on inv_* tables)', 'per event', null, false, 'live', '/investors')
on conflict (key) do update set name = excluded.name, purpose = excluded.purpose, class = excluded.class, audience_role = excluded.audience_role, trigger_type = excluded.trigger_type, trigger_source = excluded.trigger_source, status = 'live';

-- ───────────────────────────── notify (in-app + e-mail)
create or replace function app_private.inv_notify(p_investor uuid, p_agreement uuid, p_kind text, p_title text, p_body text, p_ref_kind text, p_ref_id text, p_rows jsonb default '[]'::jsonb)
returns void language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_email text; v_name text;
begin
  if p_investor is null then return; end if;
  insert into app_private.inv_notifications (investor_id, agreement_id, kind, title, body, ref_kind, ref_id)
  values (p_investor, p_agreement, p_kind, p_title, p_body, p_ref_kind, p_ref_id);
  select email, name into v_email, v_name from app_private.inv_investors where id = p_investor;
  if v_email is not null then
    begin
      perform app_private.sys_email(v_email, 'investor.notice', 'LoadBoot · ' || p_title,
        app_private.inv_email_html(p_title, coalesce(p_body,''), p_rows, 'Open the portal', 'https://loadboot.com/app/investor/'),
        p_title || E'\n\n' || coalesce(p_body,'') || E'\n\nhttps://loadboot.com/app/investor/',
        'inv:' || p_kind || ':' || coalesce(p_ref_id, gen_random_uuid()::text));
    exception when others then null; -- e-mail must never break the money record
    end;
  end if;
end $$;

create or replace function app_private.inv_investor_of(p_agreement uuid) returns uuid language sql stable security definer
set search_path to 'app_private, public' as $$ select investor_id from app_private.inv_agreements where id = p_agreement $$;

-- triggers: one per event
create or replace function app_private.trg_inv_notify() returns trigger language plpgsql security definer
set search_path to 'app_private, public' as $$
declare v_inv uuid; v_cur text;
begin
  if tg_table_name = 'inv_updates' then
    if new.agreement_id is null then
      insert into app_private.inv_notifications (investor_id, agreement_id, kind, title, body, ref_kind, ref_id)
        select i.id, null, 'update', new.title, new.body, 'update', new.id::text from app_private.inv_investors i where i.status = 'active';
      if new.send_email then
        perform app_private.sys_email(i.email, 'investor.notice', 'LoadBoot · ' || new.title,
          app_private.inv_email_html(new.title, new.body, '[]'::jsonb, 'Open the portal', 'https://loadboot.com/app/investor/'), new.title || E'\n\n' || new.body, 'inv:update:' || new.id::text || ':' || i.id::text)
        from app_private.inv_investors i where i.status = 'active' and i.email is not null;
      end if;
    else
      perform app_private.inv_notify(app_private.inv_investor_of(new.agreement_id), new.agreement_id, 'update', new.title, new.body, 'update', new.id::text);
    end if;
    return new;
  end if;
  v_inv := app_private.inv_investor_of(new.agreement_id);
  select currency into v_cur from app_private.inv_agreements where id = new.agreement_id;
  if tg_table_name = 'inv_requests' and tg_op = 'INSERT' then
    perform app_private.inv_notify(v_inv, new.agreement_id, 'request', 'Capital request #' || new.seq || ' — ' || v_cur || ' ' || to_char(new.amount, 'FM999,999,999'),
      coalesce(new.reason,''), 'request', new.id::text, jsonb_build_array(jsonb_build_object('k','Amount','v', v_cur || ' ' || to_char(new.amount,'FM999,999,999')), jsonb_build_object('k','For','v', coalesce(new.reason,''))));
  elsif tg_table_name = 'inv_expenses' and tg_op = 'INSERT' and new.reversal_of is null then
    perform app_private.inv_notify(v_inv, new.agreement_id, 'expense', 'Expense recorded — ' || v_cur || ' ' || to_char(new.amount,'FM999,999,999'),
      coalesce(new.vendor,'') || case when new.description is not null then ' · ' || new.description else '' end || ' (' || new.category || ')', 'expense', new.id::text,
      jsonb_build_array(jsonb_build_object('k','Amount','v', v_cur || ' ' || to_char(new.amount,'FM999,999,999')), jsonb_build_object('k','Paid to','v', coalesce(new.vendor,'—')), jsonb_build_object('k','Category','v', new.category)));
  elsif tg_table_name = 'inv_receipts' and tg_op = 'UPDATE' and new.confirmed_by_staff_at is not null and old.confirmed_by_staff_at is null then
    perform app_private.inv_notify(v_inv, new.agreement_id, 'receipt', 'Payment confirmed — ' || v_cur || ' ' || to_char(new.amount,'FM999,999,999'),
      'LoadBoot confirmed receiving your payment of ' || to_char(new.received_date, 'DD Mon YYYY') || '. It now counts toward your funded amount.', 'receipt', new.id::text);
  elsif tg_table_name = 'inv_receipts' and tg_op = 'UPDATE' and new.rejected_at is not null and old.rejected_at is null then
    perform app_private.inv_notify(v_inv, new.agreement_id, 'receipt', 'Declared payment not found', coalesce(new.rejected_reason,''), 'receipt', new.id::text);
  elsif tg_table_name = 'inv_payouts' and tg_op = 'UPDATE' and new.status = 'paid' and old.status is distinct from 'paid' then
    perform app_private.inv_notify(v_inv, new.agreement_id, 'payout', 'Payout sent — ' || v_cur || ' ' || to_char(new.total,'FM999,999,999'),
      'Please confirm in the portal once it reaches you.', 'payout', new.id::text);
  elsif tg_table_name = 'inv_agreement_docs' and tg_op = 'INSERT' then
    perform app_private.inv_notify(v_inv, new.agreement_id, 'document', 'Agreement version ' || new.version || ' published', 'Read it in the portal and sign when you are ready.', 'document', new.id::text);
  elsif tg_table_name = 'inv_amendments' and tg_op = 'UPDATE' and new.status in ('accepted','declined') and old.status = 'proposed' then
    perform app_private.inv_notify(v_inv, new.agreement_id, 'amendment', 'Your proposal was ' || new.status, coalesce(new.decision_note,''), 'amendment', new.id::text);
  elsif tg_table_name = 'inv_flags' and tg_op = 'UPDATE' and new.answer is not null and old.answer is null then
    perform app_private.inv_notify(v_inv, new.agreement_id, 'flag', 'Your question was answered', new.answer, 'flag', new.id::text);
  end if;
  return new;
end $$;

-- statement published → each agreement gets a payout row at publish time → tell the investor
create or replace function app_private.trg_inv_notify_payout_insert() returns trigger language plpgsql security definer
set search_path to 'app_private, public' as $$
declare v_inv uuid; v_cur text; v_month date; v_profit numeric;
begin
  v_inv := app_private.inv_investor_of(new.agreement_id);
  select currency into v_cur from app_private.inv_agreements where id = new.agreement_id;
  select period_month, profit into v_month, v_profit from app_private.inv_statements where id = new.statement_id;
  perform app_private.inv_notify(v_inv, new.agreement_id, 'statement',
    case when new.kind = 'capital_return' then 'Capital return recorded' else 'Statement published — ' || to_char(coalesce(v_month, current_date), 'Mon YYYY') end,
    case when new.kind = 'capital_return' then 'Unspent money is being returned to you: ' || v_cur || ' ' || to_char(new.total,'FM999,999,999')
         when coalesce(new.total,0) > 0 then 'Profit ' || v_cur || ' ' || to_char(coalesce(v_profit,0),'FM999,999,999') || ' · your payout ' || v_cur || ' ' || to_char(new.total,'FM999,999,999')
         else 'No profit this month — nothing is owed and nothing piles up.' end,
    'statement', new.statement_id::text,
    jsonb_build_array(jsonb_build_object('k','Month','v', to_char(coalesce(v_month, current_date), 'Month YYYY')), jsonb_build_object('k','Profit','v', v_cur || ' ' || to_char(coalesce(v_profit,0),'FM999,999,999')), jsonb_build_object('k','Your payout','v', v_cur || ' ' || to_char(coalesce(new.total,0),'FM999,999,999'))));
  return new;
end $$;

drop trigger if exists inv_notify_requests on app_private.inv_requests;
create trigger inv_notify_requests after insert on app_private.inv_requests for each row execute function app_private.trg_inv_notify();
drop trigger if exists inv_notify_expenses on app_private.inv_expenses;
create trigger inv_notify_expenses after insert on app_private.inv_expenses for each row execute function app_private.trg_inv_notify();
drop trigger if exists inv_notify_receipts on app_private.inv_receipts;
create trigger inv_notify_receipts after update on app_private.inv_receipts for each row execute function app_private.trg_inv_notify();
drop trigger if exists inv_notify_payouts on app_private.inv_payouts;
create trigger inv_notify_payouts after update on app_private.inv_payouts for each row execute function app_private.trg_inv_notify();
drop trigger if exists inv_notify_payouts_ins on app_private.inv_payouts;
create trigger inv_notify_payouts_ins after insert on app_private.inv_payouts for each row execute function app_private.trg_inv_notify_payout_insert();
drop trigger if exists inv_notify_docs on app_private.inv_agreement_docs;
create trigger inv_notify_docs after insert on app_private.inv_agreement_docs for each row execute function app_private.trg_inv_notify();
drop trigger if exists inv_notify_amendments on app_private.inv_amendments;
create trigger inv_notify_amendments after update on app_private.inv_amendments for each row execute function app_private.trg_inv_notify();
drop trigger if exists inv_notify_flags on app_private.inv_flags;
create trigger inv_notify_flags after update on app_private.inv_flags for each row execute function app_private.trg_inv_notify();
drop trigger if exists inv_notify_updates on app_private.inv_updates;
create trigger inv_notify_updates after insert on app_private.inv_updates for each row execute function app_private.trg_inv_notify();

-- ───────────────────────────── RPCs: notifications, updates, audit
create or replace function public.inv_notifications(p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare v_inv uuid;
begin
  v_inv := app_private.inv_my_investor();
  if v_inv is null then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object('ok', true,
    'unread', (select count(*) from app_private.inv_notifications where investor_id = v_inv and read_at is null),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'ref_kind', n.ref_kind, 'ref_id', n.ref_id,
                'agreement_id', n.agreement_id, 'created_at', n.created_at, 'read_at', n.read_at) order by n.created_at desc), '[]'::jsonb)
              from (select * from app_private.inv_notifications where investor_id = v_inv order by created_at desc limit greatest(1, least(p_limit, 200))) n));
end $$;

create or replace function public.inv_mark_read(p_ids uuid[] default null)
returns jsonb language plpgsql volatile security definer set search_path to 'app_private, public' as $$
declare v_inv uuid;
begin
  v_inv := app_private.inv_my_investor();
  if v_inv is null then raise exception 'not authorized' using errcode='42501'; end if;
  update app_private.inv_notifications set read_at = now()
   where investor_id = v_inv and read_at is null and (p_ids is null or id = any(p_ids));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.inv_updates(p_agreement uuid, p_limit int default 30)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
begin
  perform app_private.inv_guard(p_agreement);
  return jsonb_build_object('ok', true, 'updates', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'title', u.title, 'body', u.body, 'created_at', u.created_at) order by u.created_at desc), '[]'::jsonb)
    from (select * from app_private.inv_updates where agreement_id is null or agreement_id = p_agreement order by created_at desc limit greatest(1, least(p_limit, 200))) u));
end $$;

create or replace function public.cc_inv_post_update(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path to 'app_private, public' as $$
declare v_id uuid;
begin
  if not app_private.inv_can_manage() then raise exception 'not authorized' using errcode='42501'; end if;
  if coalesce(btrim(p->>'title'),'') = '' or coalesce(btrim(p->>'body'),'') = '' then raise exception 'title and body are required' using errcode='22023'; end if;
  insert into app_private.inv_updates (agreement_id, kind, title, body, send_email, created_by)
  values (nullif(p->>'agreement_id','')::uuid, coalesce(nullif(p->>'kind',''),'note'), btrim(p->>'title'), btrim(p->>'body'), coalesce((p->>'send_email')::boolean, true), auth.uid())
  returning id into v_id;
  perform app_private.log_audit('investor.update_posted','investor', v_id::text, null, 'Investor update posted: ' || btrim(p->>'title'), p);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.cc_inv_updates(p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
begin
  if not app_private.inv_is_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object('ok', true, 'updates', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'title', u.title, 'body', u.body, 'agreement_id', u.agreement_id, 'created_at', u.created_at) order by u.created_at desc), '[]'::jsonb)
    from (select * from app_private.inv_updates order by created_at desc limit greatest(1, least(p_limit, 200))) u));
end $$;

-- full audit trail of one agreement, readable by its investor
create or replace function public.inv_audit(p_agreement uuid, p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare a app_private.inv_agreements;
begin
  a := app_private.inv_guard(p_agreement);
  return jsonb_build_object('ok', true, 'events', (select coalesce(jsonb_agg(jsonb_build_object('at', l.occurred_at, 'action', l.action, 'summary', l.summary,
      'by', case when l.actor_is_staff then 'LoadBoot' when l.actor_id is not null then 'Investor' else 'System' end,
      'detail', l.detail - 'raw') order by l.occurred_at desc), '[]'::jsonb)
    from (select * from app_private.audit_logs l where l.target_type = 'investor'
            and (l.target_id = p_agreement::text or l.detail->>'agreement' = p_agreement::text or l.detail->>'agreement_id' = p_agreement::text
                 or l.target_id in (select id::text from app_private.inv_requests where agreement_id = p_agreement)
                 or l.target_id in (select id::text from app_private.inv_receipts where agreement_id = p_agreement)
                 or l.target_id in (select id::text from app_private.inv_expenses where agreement_id = p_agreement)
                 or l.target_id in (select id::text from app_private.inv_payouts where agreement_id = p_agreement)
                 or l.target_id in (select id::text from app_private.inv_agreement_docs where agreement_id = p_agreement)
                 or l.target_id in (select id::text from app_private.inv_amendments where agreement_id = p_agreement)
                 or l.target_id in (select id::text from app_private.inv_flags where agreement_id = p_agreement))
          order by l.occurred_at desc limit greatest(1, least(p_limit, 500))) l));
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.cc_inv_settings_set(text,jsonb)', 'public.inv_settings()', 'public.inv_growth()',
    'public.inv_notifications(int)', 'public.inv_mark_read(uuid[])', 'public.inv_updates(uuid,int)',
    'public.cc_inv_post_update(jsonb)', 'public.cc_inv_updates(int)', 'public.inv_audit(uuid,int)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
