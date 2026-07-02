-- cwi_referral_engine.sql
-- WEB-2 — MULTI-LEVEL REFERRAL ENGINE (owner spec): referrer earns a share of LoadBoot's dispatch fee on
-- every booked trip of the client they referred, for as long as that client stays active. Chain pays up to
-- 5 levels from OUR fee (client never pays extra): L1 1.00%, L2 0.50%, L3 0.25%, L4 0.15%, L5 0.10%
-- (total ≤ 2.00% of gross — LoadBoot always keeps ≥ 3% of its 5%). 15-DAY HOLD before any commission is
-- payable. Payout marking is human-only (finance.approve) — this engine never moves money.
-- ACTIVATION: feature flag `referral_program` — staging ON, production OFF until owner + legal approve
-- (multi-level commission structures can require legal review; the code ships, the switch stays with you).
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create table if not exists app_private.referrers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  org_id uuid,                                    -- carrier/partner org when the referrer is a client; null = affiliate
  kind text not null default 'affiliate' check (kind in ('carrier','partner','affiliate')),
  code text not null unique,
  display_name text,
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now()
);

create table if not exists app_private.referral_edges (
  child_org uuid primary key,                     -- each client org can be referred exactly once, ever
  referrer_id uuid not null references app_private.referrers(id),
  claimed_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists app_private.referral_levels (
  level integer primary key check (level between 1 and 5),
  pct numeric not null check (pct >= 0)
);
insert into app_private.referral_levels(level, pct) values (1,1.00),(2,0.50),(3,0.25),(4,0.15),(5,0.10)
on conflict (level) do nothing;

create table if not exists app_private.referral_commissions (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null,
  trip_id uuid,
  source_org uuid not null,                       -- the referred client whose booked trip generated our fee
  referrer_id uuid not null references app_private.referrers(id),
  level integer not null,
  base_fee numeric not null,                      -- LoadBoot's dispatch fee on that invoice (the 5%)
  pct numeric not null,
  amount numeric not null,
  status text not null default 'accrued' check (status in ('accrued','payable','paid','void')),
  accrued_at timestamptz not null default now(),
  payable_at timestamptz not null,                -- accrued + 15-day hold
  paid_at timestamptz,
  paid_by uuid,
  unique (invoice_id, referrer_id)
);
create index if not exists referral_comm_ref_idx on app_private.referral_commissions(referrer_id, status);

-- Get-or-create MY referrer identity (any authenticated user — clients AND standalone affiliates/influencers).
create or replace function public.cc_my_referral()
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_uid uuid; v_org uuid; v_kind text; r record; v_code text;
begin
  v_uid := auth.uid(); if v_uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  v_org := app_private.my_carrier_org();
  if v_org is not null then v_kind := 'carrier';
  else v_org := app_private.my_partner_org('broker');
       v_kind := case when v_org is not null then 'partner' else 'affiliate' end; end if;
  select * into r from app_private.referrers where user_id = v_uid;
  if r.id is null then
    v_code := 'LB' || upper(substr(md5(v_uid::text || 'lb-ref'), 1, 6));
    insert into app_private.referrers(user_id, org_id, kind, code) values (v_uid, v_org, v_kind, v_code)
      on conflict (user_id) do nothing;
    select * into r from app_private.referrers where user_id = v_uid;
    perform app_private.log_audit('referral.join','referrer',r.id::text,null,v_kind,jsonb_build_object('code',r.code));
  end if;
  return jsonb_build_object('code', r.code, 'kind', r.kind, 'status', r.status,
    'link', 'https://loadboot.com/referral.html?ref=' || r.code,
    'referrals', (select count(*) from app_private.referral_edges e where e.referrer_id = r.id),
    'accrued',  coalesce((select sum(amount) from app_private.referral_commissions c where c.referrer_id=r.id and c.status='accrued'),0),
    'payable',  coalesce((select sum(amount) from app_private.referral_commissions c where c.referrer_id=r.id and c.status='payable'),0),
    'paid',     coalesce((select sum(amount) from app_private.referral_commissions c where c.referrer_id=r.id and c.status='paid'),0),
    'hold_days', 15,
    'levels', (select jsonb_agg(jsonb_build_object('level',level,'pct',pct) order by level) from app_private.referral_levels));
end; $$;
revoke execute on function public.cc_my_referral() from anon, public;
grant  execute on function public.cc_my_referral() to authenticated;

-- A client org's owner claims WHO REFERRED THEM (one time, ever; no self-referral).
create or replace function public.cc_claim_referral(p_code text)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; r record;
begin
  v_org := coalesce(app_private.my_carrier_org(), app_private.my_partner_org('broker'));
  if v_org is null then raise exception 'only carrier or broker accounts can claim a referral' using errcode='42501'; end if;
  select * into r from app_private.referrers where code = upper(trim(p_code)) and status='active';
  if r.id is null then raise exception 'referral code not found' using errcode='22023'; end if;
  if r.org_id = v_org then raise exception 'self-referral is not allowed' using errcode='22023'; end if;
  if exists (select 1 from app_private.referral_edges where child_org = v_org) then
    raise exception 'this account already has a referrer on record' using errcode='22023'; end if;
  insert into app_private.referral_edges(child_org, referrer_id, claimed_by) values (v_org, r.id, auth.uid());
  perform app_private.log_audit('referral.claim','org',v_org::text,null,'referred by '||r.code,jsonb_build_object('referrer',r.id));
  perform app_private.emit_event('referral.claimed','org',v_org::text, jsonb_build_object('code',r.code));
  return jsonb_build_object('ok',true,'referrer_code',r.code);
end; $$;
revoke execute on function public.cc_claim_referral(text) from anon, public;
grant  execute on function public.cc_claim_referral(text) to authenticated;

-- My earnings (referrer self-scope).
create or replace function public.cc_my_referral_earnings(p_limit integer default 100)
returns table(amount numeric, pct numeric, level integer, status text, accrued_at timestamptz, payable_at timestamptz, paid_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_ref uuid;
begin
  select id into v_ref from app_private.referrers where user_id = auth.uid();
  if v_ref is null then raise exception 'no referrer profile — call cc_my_referral first' using errcode='22023'; end if;
  return query select c.amount, c.pct, c.level, c.status, c.accrued_at, c.payable_at, c.paid_at
    from app_private.referral_commissions c where c.referrer_id = v_ref
    order by c.accrued_at desc limit least(greatest(coalesce(p_limit,100),1),500);
end; $$;
revoke execute on function public.cc_my_referral_earnings(integer) from anon, public;
grant  execute on function public.cc_my_referral_earnings(integer) to authenticated;

-- ACCRUAL (staff finance.manage or automation): walk the chain up to 5 levels for every fee-bearing invoice
-- not yet accrued. Deterministic; idempotent via unique(invoice_id, referrer_id). Also promotes
-- accrued→payable once the 15-day hold has passed.
create or replace function public.cc_referral_accrue()
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare inv record; v_org uuid; v_ref record; v_lvl int; v_pct numeric; v_new int:=0; v_promoted int:=0;
begin
  if not public.has_global_permission('finance.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  for inv in
    select fi.id, fi.trip_id, fi.carrier_id, fi.fee from app_private.fin_invoices fi
    where fi.status in ('sent','paid') and coalesce(fi.fee,0) > 0
      and exists (select 1 from app_private.referral_edges e where e.child_org = fi.carrier_id)
      and not exists (select 1 from app_private.referral_commissions c where c.invoice_id = fi.id)
  loop
    v_org := inv.carrier_id; v_lvl := 1;
    while v_lvl <= 5 loop
      select r.* into v_ref from app_private.referral_edges e join app_private.referrers r on r.id=e.referrer_id
        where e.child_org = v_org;
      exit when v_ref.id is null or v_ref.status <> 'active';
      select pct into v_pct from app_private.referral_levels where level = v_lvl;
      exit when v_pct is null or v_pct <= 0;
      insert into app_private.referral_commissions(invoice_id, trip_id, source_org, referrer_id, level, base_fee, pct, amount, payable_at)
        values (inv.id, inv.trip_id, inv.carrier_id, v_ref.id, v_lvl, inv.fee, v_pct,
                round(inv.fee * v_pct / 5.0, 2),          -- pct is "of gross"; our fee IS 5% of gross → amount = fee * (pct/5)
                now() + interval '15 days')
        on conflict (invoice_id, referrer_id) do nothing;
      v_new := v_new + 1;
      exit when v_ref.org_id is null;                     -- affiliates have no upline org — chain ends
      v_org := v_ref.org_id; v_lvl := v_lvl + 1;
    end loop;
  end loop;
  update app_private.referral_commissions set status='payable'
    where status='accrued' and payable_at <= now();
  get diagnostics v_promoted = row_count;
  perform app_private.log_audit('referral.accrue','system','referral',null,
    format('%s new commissions, %s promoted payable', v_new, v_promoted), null);
  return jsonb_build_object('ok',true,'new_commissions',v_new,'promoted_payable',v_promoted,
    'note','amounts come out of LoadBoot''s own fee; clients never pay extra; payout marking is human-only');
end; $$;
revoke execute on function public.cc_referral_accrue() from anon, public;
grant  execute on function public.cc_referral_accrue() to authenticated;

-- STAFF overview + human payout marking (records the payout decision; money moves outside, by you).
create or replace function public.cc_referral_overview()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public'
as $$
begin
  if not public.has_global_permission('finance.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object(
    'referrers', (select count(*) from app_private.referrers),
    'referred_orgs', (select count(*) from app_private.referral_edges),
    'accrued', coalesce((select sum(amount) from app_private.referral_commissions where status='accrued'),0),
    'payable', coalesce((select sum(amount) from app_private.referral_commissions where status='payable'),0),
    'paid', coalesce((select sum(amount) from app_private.referral_commissions where status='paid'),0),
    'top_referrers', (select coalesce(jsonb_agg(t),'[]'::jsonb) from (
       select r.code, r.kind, count(distinct e.child_org) referrals,
              coalesce(sum(c.amount) filter (where c.status in ('payable','paid')),0) earned
       from app_private.referrers r
       left join app_private.referral_edges e on e.referrer_id=r.id
       left join app_private.referral_commissions c on c.referrer_id=r.id
       group by r.id order by earned desc limit 10) t));
end; $$;
revoke execute on function public.cc_referral_overview() from anon, public;
grant  execute on function public.cc_referral_overview() to authenticated;

create or replace function public.cc_referral_mark_paid(p_referrer_code text)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_ref uuid; v_sum numeric; v_n int;
begin
  if not public.has_global_permission('finance.approve') then raise exception 'not authorized' using errcode='42501'; end if;
  select id into v_ref from app_private.referrers where code = upper(trim(p_referrer_code));
  if v_ref is null then raise exception 'referrer not found' using errcode='22023'; end if;
  -- HOLD ENFORCED: only rows already payable (accrued+15d) can be paid — never accrued rows.
  update app_private.referral_commissions set status='paid', paid_at=now(), paid_by=auth.uid()
    where referrer_id = v_ref and status='payable';
  get diagnostics v_n = row_count;
  select coalesce(sum(amount),0) into v_sum from app_private.referral_commissions
    where referrer_id=v_ref and paid_by=auth.uid() and paid_at >= now() - interval '1 minute' and status='paid';
  perform app_private.log_audit('referral.payout','referrer',v_ref::text,null,
    format('marked %s commissions paid ($%s)', v_n, v_sum), null);
  return jsonb_build_object('ok',true,'rows_paid',v_n,'amount',v_sum,
    'note','this records the payout decision; transfer the money through your normal payment rail');
end; $$;
revoke execute on function public.cc_referral_mark_paid(text) from anon, public;
grant  execute on function public.cc_referral_mark_paid(text) to authenticated;

-- Feature flag (staging ON via separate statement at apply time; production stays OFF)
insert into app_private.feature_flags(key, enabled) values ('referral_program', false)
on conflict (key) do nothing;
