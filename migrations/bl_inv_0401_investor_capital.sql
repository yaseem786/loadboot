-- ============================================================================
-- bl_inv_0401 — Investor capital module.
--
-- WHAT THIS IS
--   LoadBoot takes investment in TRANCHES, not lump sums: the investor commits a
--   ceiling, LoadBoot raises a capital request when it needs money, the investor
--   pays, and every rupee is then tagged to the tranche that funded it and the
--   category it was spent on. This is the same ledger a VC fund admin keeps for
--   an LP (commitment / called / paid-in / unfunded), scaled to one founder.
--
-- WHY EVERY MOVEMENT IS CONFIRMED TWICE
--   The first investor is the owner's childhood friend and neighbour. Money
--   disputes between friends are almost never about dishonesty — they are about
--   two people remembering the same conversation differently. So a receipt or a
--   payout only becomes REAL when BOTH sides have tapped confirm, and a confirmed
--   row can never be edited: it is reversed with a visible correction instead.
--   That single rule is the whole point of this module.
--
-- MULTI-INVESTOR FROM DAY ONE
--   Nothing here is specific to one person. Every number hangs off an agreement,
--   and an investor only ever sees their own agreements.
--
-- SECURITY MODEL
--   Tables live in app_private and RLS is ON with NO permissive policies, so the
--   anon/authenticated roles cannot touch them directly at all. Every read and
--   write goes through a security-definer RPC that checks either
--   app_private.inv_my_investor() (the investor themself) or
--   public.has_global_permission('finance.*') (staff). An investor can never see
--   another investor's rows, and never sees carriers, loads or anything else.
--
-- MONEY
--   Amounts are numeric(14,2) in the agreement's currency (PKR for the first
--   agreement). No FX conversion is done here — if a tranche is ever paid in
--   another currency, record it in its own agreement.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────── 1. Tables

create table if not exists app_private.inv_investors (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique,                    -- auth.users.id once they log in
  name          text not null,
  email         text,
  phone         text,
  relationship  text,                           -- 'friend', 'family', 'angel', …
  notes         text,
  status        text not null default 'active'
                check (status in ('active','inactive')),
  created_at    timestamptz not null default now(),
  created_by    uuid
);

create table if not exists app_private.inv_agreements (
  id                   uuid primary key default gen_random_uuid(),
  investor_id          uuid not null references app_private.inv_investors(id) on delete restrict,
  title                text,
  currency             text not null default 'PKR',

  commitment_cap       numeric(14,2) not null check (commitment_cap > 0),

  -- What the investor gets
  payback_rate_pct     numeric(5,2) not null default 0   -- % of profit that REDUCES the balance
                       check (payback_rate_pct >= 0 and payback_rate_pct <= 100),
  permanent_share_pct  numeric(5,2) not null default 0   -- % of profit that is theirs, forever
                       check (permanent_share_pct >= 0 and permanent_share_pct <= 100),

  -- Recovery target: 'actual_funded' = they get back exactly what they actually paid in.
  -- 'fixed' = a set number in payback_fixed_amount (e.g. a 1.5x deal).
  payback_basis        text not null default 'actual_funded'
                       check (payback_basis in ('actual_funded','fixed')),
  payback_fixed_amount numeric(14,2),

  -- 'profit_share' = income only, no ownership. 'equity' = real ownership.
  -- Left null on purpose while the parties have not decided: the UI shows it as
  -- an open question rather than guessing.
  share_type           text check (share_type in ('profit_share','equity')),
  equity_vesting_mode  text default 'pro_rata'
                       check (equity_vesting_mode in ('pro_rata','upfront')),

  profit_definition    text,        -- the agreed formula, in the parties' own words
  exit_treatment       text,        -- what happens if the company is sold
  early_stop_terms     text,        -- what happens if they stop funding partway
  buyout_terms         text,

  signed_date          date,
  doc_url              text,
  status               text not null default 'active'
                       check (status in ('draft','active','recovered','closed')),
  created_at           timestamptz not null default now(),
  created_by           uuid,
  constraint inv_agr_fixed_needs_amount
    check (payback_basis <> 'fixed' or payback_fixed_amount is not null)
);
create index if not exists inv_agr_investor_idx on app_private.inv_agreements(investor_id);

-- A capital call. LoadBoot asks; the investor answers.
create table if not exists app_private.inv_requests (
  id             uuid primary key default gen_random_uuid(),
  agreement_id   uuid not null references app_private.inv_agreements(id) on delete cascade,
  seq            int  not null,
  amount         numeric(14,2) not null check (amount > 0),
  reason         text not null,
  category       text,                -- office | salary | equipment | tools | legal | relocation | misc
  needed_by      date,
  status         text not null default 'pending'
                 check (status in ('pending','declared','funded','declined','cancelled')),
  requested_at   timestamptz not null default now(),
  requested_by   uuid,
  seen_at        timestamptz,
  responded_at   timestamptz,
  decline_reason text,
  unique (agreement_id, seq)
);
create index if not exists inv_req_agr_idx on app_private.inv_requests(agreement_id, status);

-- Money that actually moved. Nothing counts until BOTH sides confirm.
create table if not exists app_private.inv_receipts (
  id                    uuid primary key default gen_random_uuid(),
  agreement_id          uuid not null references app_private.inv_agreements(id) on delete cascade,
  request_id            uuid references app_private.inv_requests(id) on delete set null,
  amount                numeric(14,2) not null check (amount <> 0),
  received_date         date not null,
  method                text,          -- bank | cash | easypaisa | jazzcash | other
  reference             text,
  proof_url             text,
  note                  text,
  declared_by_investor_at timestamptz,
  confirmed_by_staff_at   timestamptz,
  confirmed_by            uuid,
  reversal_of           uuid references app_private.inv_receipts(id),
  created_at            timestamptz not null default now(),
  created_by            uuid
);
create index if not exists inv_rcpt_agr_idx on app_private.inv_receipts(agreement_id, received_date desc);

-- Where the money went. TWO tags: which tranche paid, and what it was.
create table if not exists app_private.inv_expenses (
  id             uuid primary key default gen_random_uuid(),
  agreement_id   uuid not null references app_private.inv_agreements(id) on delete cascade,
  receipt_id     uuid references app_private.inv_receipts(id) on delete set null,  -- TAG 1
  category       text not null,                                                   -- TAG 2
  expense_date   date not null,
  amount         numeric(14,2) not null check (amount > 0),
  vendor         text,
  description    text,
  receipt_url    text,
  is_recurring   boolean not null default false,
  reversal_of    uuid references app_private.inv_expenses(id),
  created_at     timestamptz not null default now(),
  created_by     uuid
);
create index if not exists inv_exp_agr_idx on app_private.inv_expenses(agreement_id, expense_date desc);
create index if not exists inv_exp_cat_idx on app_private.inv_expenses(agreement_id, category);

-- The monthly profit figure the investor's share is calculated from.
create table if not exists app_private.inv_statements (
  id              uuid primary key default gen_random_uuid(),
  period_month    date not null unique,          -- always the 1st of the month
  revenue         numeric(14,2) not null default 0,
  expenses_total  numeric(14,2) not null default 0,
  profit          numeric(14,2) generated always as (revenue - expenses_total) stored,
  note            text,
  status          text not null default 'draft'
                  check (status in ('draft','published')),
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid
);

-- What was actually paid to the investor for a given month.
create table if not exists app_private.inv_payouts (
  id                    uuid primary key default gen_random_uuid(),
  agreement_id          uuid not null references app_private.inv_agreements(id) on delete cascade,
  statement_id          uuid references app_private.inv_statements(id) on delete set null,
  payback_portion       numeric(14,2) not null default 0 check (payback_portion >= 0),
  share_portion         numeric(14,2) not null default 0 check (share_portion >= 0),
  total                 numeric(14,2) generated always as (payback_portion + share_portion) stored,
  paid_date             date,
  method                text,
  reference             text,
  proof_url             text,
  status                text not null default 'pending'
                        check (status in ('pending','paid')),
  confirmed_by_investor_at timestamptz,
  created_at            timestamptz not null default now(),
  created_by            uuid,
  unique (agreement_id, statement_id)
);
create index if not exists inv_pay_agr_idx on app_private.inv_payouts(agreement_id, paid_date desc);

-- Only used when share_type = 'equity'.
create table if not exists app_private.inv_equity_events (
  id             uuid primary key default gen_random_uuid(),
  agreement_id   uuid not null references app_private.inv_agreements(id) on delete cascade,
  event_date     date not null,
  pct_issued     numeric(7,4) not null,
  cumulative_pct numeric(7,4) not null,
  trigger        text,
  doc_url        text,
  created_at     timestamptz not null default now(),
  created_by     uuid
);

-- ───────────────────────────────────────────────────────────── 2. Lock it down
-- RLS on, no policies: PostgREST cannot read or write these tables at all.
-- Everything goes through the security-definer RPCs below.
do $$
declare t text;
begin
  foreach t in array array['inv_investors','inv_agreements','inv_requests','inv_receipts',
                           'inv_expenses','inv_statements','inv_payouts','inv_equity_events']
  loop
    execute format('alter table app_private.%I enable row level security', t);
    execute format('alter table app_private.%I force row level security', t);
    execute format('revoke all on app_private.%I from anon, authenticated', t);
  end loop;
end $$;

-- ──────────────────────────────────────────────────────────────── 3. Helpers

create or replace function app_private.inv_is_staff()
returns boolean language sql stable security definer
set search_path to 'app_private, public' as $$
  select public.has_global_permission('finance.manage')
      or public.has_global_permission('finance.view');
$$;

create or replace function app_private.inv_can_manage()
returns boolean language sql stable security definer
set search_path to 'app_private, public' as $$
  select public.has_global_permission('finance.manage');
$$;

-- Which investor is the caller, if any.
create or replace function app_private.inv_my_investor()
returns uuid language sql stable security definer
set search_path to 'app_private, public' as $$
  select i.id from app_private.inv_investors i
   where i.user_id = auth.uid() and i.status = 'active'
   limit 1;
$$;

-- Guard: the caller may see this agreement (its own investor, or finance staff).
create or replace function app_private.inv_guard(p_agreement uuid)
returns app_private.inv_agreements language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare a app_private.inv_agreements;
begin
  select * into a from app_private.inv_agreements where id = p_agreement;
  if not found then raise exception 'agreement not found' using errcode='42704'; end if;
  if app_private.inv_is_staff() then return a; end if;
  if a.investor_id = app_private.inv_my_investor() then return a; end if;
  raise exception 'not authorized' using errcode='42501';
end $$;

-- inv_position (the single source of truth for every screen) is defined once,
-- further down, after the expense reversal rule it has to honour.


-- Split a month's profit into this agreement's two portions.
create or replace function app_private.inv_split(p_agreement uuid, p_profit numeric)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare a app_private.inv_agreements; pos jsonb; v_pay numeric; v_share numeric; v_out numeric;
begin
  select * into a from app_private.inv_agreements where id = p_agreement;
  if not found or coalesce(p_profit,0) <= 0 then
    return jsonb_build_object('payback_portion',0,'share_portion',0,'total',0);
  end if;
  pos := app_private.inv_position(p_agreement);
  v_out   := (pos->>'outstanding')::numeric;
  v_share := round(p_profit * a.permanent_share_pct / 100, 2);
  -- The payback slice stops at whatever is still owed — never overpays.
  v_pay   := least(round(p_profit * a.payback_rate_pct / 100, 2), v_out);
  return jsonb_build_object('payback_portion', v_pay, 'share_portion', v_share,
                            'total', v_pay + v_share, 'outstanding_before', v_out);
end $$;

-- ═══════════════════════════════════════════════════ 4. INVESTOR-SIDE RPCs
-- Everything the investor portal calls. Read-only except for declaring a payment
-- and confirming a payout — an investor can never edit the ledger.

create or replace function public.inv_me()
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare v_inv uuid; v_me jsonb; v_agrs jsonb;
begin
  v_inv := app_private.inv_my_investor();
  if v_inv is null then
    return jsonb_build_object('ok', false, 'reason', 'not_an_investor');
  end if;
  select jsonb_build_object('id', i.id, 'name', i.name, 'email', i.email, 'phone', i.phone)
    into v_me from app_private.inv_investors i where i.id = v_inv;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'title', a.title, 'currency', a.currency, 'status', a.status,
           'signed_date', a.signed_date, 'doc_url', a.doc_url,
           'profit_definition', a.profit_definition, 'exit_treatment', a.exit_treatment,
           'early_stop_terms', a.early_stop_terms, 'buyout_terms', a.buyout_terms,
           'position', app_private.inv_position(a.id)
         ) order by a.created_at), '[]'::jsonb)
    into v_agrs from app_private.inv_agreements a
   where a.investor_id = v_inv and a.status <> 'draft';
  return jsonb_build_object('ok', true, 'investor', v_me, 'agreements', v_agrs);
end $$;

create or replace function public.inv_my_requests(p_agreement uuid)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare a app_private.inv_agreements; v jsonb;
begin
  a := app_private.inv_guard(p_agreement);
  if app_private.inv_my_investor() = a.investor_id then
    update app_private.inv_requests set seen_at = now()
     where agreement_id = a.id and status = 'pending' and seen_at is null;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'seq', r.seq, 'amount', r.amount, 'reason', r.reason,
           'category', r.category, 'needed_by', r.needed_by, 'status', r.status,
           'requested_at', r.requested_at, 'responded_at', r.responded_at,
           'decline_reason', r.decline_reason,
           'funded', (select coalesce(sum(x.amount),0) from app_private.inv_receipts x
                       where x.request_id = r.id and x.confirmed_by_staff_at is not null)
         ) order by r.seq desc), '[]'::jsonb) into v
    from app_private.inv_requests r where r.agreement_id = a.id;
  return jsonb_build_object('ok', true, 'requests', v);
end $$;

-- "I have sent the money." Creates an UNCONFIRMED receipt — it counts for nothing
-- until staff confirm it. The investor's half of the two-sided handshake.
create or replace function public.inv_declare_payment(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare a app_private.inv_agreements; v_req uuid; v_id uuid; v_amt numeric;
begin
  a := app_private.inv_guard((p->>'agreement_id')::uuid);
  if app_private.inv_my_investor() is distinct from a.investor_id then
    raise exception 'only the investor can declare a payment' using errcode='42501';
  end if;
  v_amt := round((p->>'amount')::numeric, 2);
  if v_amt is null or v_amt <= 0 then
    raise exception 'amount must be greater than zero' using errcode='22023'; end if;
  v_req := nullif(p->>'request_id','')::uuid;
  if v_req is not null and not exists (
       select 1 from app_private.inv_requests where id = v_req and agreement_id = a.id) then
    raise exception 'request does not belong to this agreement' using errcode='42704';
  end if;
  insert into app_private.inv_receipts
    (agreement_id, request_id, amount, received_date, method, reference, proof_url, note,
     declared_by_investor_at, created_by)
  values (a.id, v_req, v_amt, coalesce((p->>'received_date')::date, current_date),
          nullif(p->>'method',''), nullif(p->>'reference',''),
          nullif(p->>'proof_url',''), nullif(p->>'note',''), now(), auth.uid())
  returning id into v_id;
  if v_req is not null then
    update app_private.inv_requests set status = 'declared', responded_at = now()
     where id = v_req and status = 'pending';
  end if;
  perform app_private.log_audit('investor.payment_declared','investor', v_id::text, null,
    'Investor declared a payment',
    jsonb_build_object('agreement', a.id, 'amount', v_amt, 'request', v_req));
  return jsonb_build_object('ok', true, 'id', v_id,
    'note', 'Recorded. It will show in your position once LoadBoot confirms receipt.');
end $$;

create or replace function public.inv_ledger(p_agreement uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare a app_private.inv_agreements; v_rcpt jsonb; v_exp jsonb; v_pay jsonb; v_cat jsonb;
begin
  a := app_private.inv_guard(p_agreement);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'amount', r.amount, 'received_date', r.received_date,
           'method', r.method, 'reference', r.reference, 'proof_url', r.proof_url,
           'note', r.note, 'declared_at', r.declared_by_investor_at,
           'confirmed_at', r.confirmed_by_staff_at,
           'state', case when r.reversal_of is not null then 'reversal'
                         when r.confirmed_by_staff_at is not null then 'confirmed'
                         else 'awaiting_confirmation' end
         ) order by r.received_date desc, r.created_at desc), '[]'::jsonb) into v_rcpt
    from app_private.inv_receipts r where r.agreement_id = a.id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'date', e.expense_date, 'category', e.category, 'amount', e.amount,
           'vendor', e.vendor, 'description', e.description, 'receipt_url', e.receipt_url,
           'recurring', e.is_recurring, 'reversed', (e.reversal_of is not null),
           'tranche', (select x.received_date from app_private.inv_receipts x where x.id = e.receipt_id)
         ) order by e.expense_date desc, e.created_at desc), '[]'::jsonb) into v_exp
    from app_private.inv_expenses e where e.agreement_id = a.id;
  select coalesce(jsonb_object_agg(cat, amt), '{}'::jsonb) into v_cat from (
    select category as cat, sum(amount) as amt
      from app_private.inv_expenses where agreement_id = a.id group by category) z;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'payback', p.payback_portion, 'share', p.share_portion,
           'total', p.total, 'paid_date', p.paid_date, 'method', p.method,
           'reference', p.reference, 'proof_url', p.proof_url, 'status', p.status,
           'confirmed_at', p.confirmed_by_investor_at,
           'month', (select s.period_month from app_private.inv_statements s where s.id = p.statement_id)
         ) order by p.created_at desc), '[]'::jsonb) into v_pay
    from app_private.inv_payouts p where p.agreement_id = a.id;
  return jsonb_build_object('ok', true, 'position', app_private.inv_position(a.id),
    'receipts', v_rcpt, 'expenses', v_exp, 'by_category', v_cat, 'payouts', v_pay);
end $$;

create or replace function public.inv_statements(p_agreement uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare a app_private.inv_agreements; v jsonb;
begin
  a := app_private.inv_guard(p_agreement);
  select coalesce(jsonb_agg(jsonb_build_object(
           'month', s.period_month, 'revenue', s.revenue, 'expenses', s.expenses_total,
           'profit', s.profit, 'note', s.note, 'published_at', s.published_at,
           'payout', (select jsonb_build_object('payback', p.payback_portion,
                        'share', p.share_portion, 'total', p.total, 'status', p.status,
                        'paid_date', p.paid_date, 'confirmed_at', p.confirmed_by_investor_at)
                        from app_private.inv_payouts p
                       where p.statement_id = s.id and p.agreement_id = a.id)
         ) order by s.period_month desc), '[]'::jsonb) into v
    from app_private.inv_statements s where s.status = 'published';
  return jsonb_build_object('ok', true, 'statements', v);
end $$;

create or replace function public.inv_confirm_payout(p_payout uuid)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare a app_private.inv_agreements; v_agr uuid;
begin
  select agreement_id into v_agr from app_private.inv_payouts where id = p_payout;
  if v_agr is null then raise exception 'payout not found' using errcode='42704'; end if;
  a := app_private.inv_guard(v_agr);
  if app_private.inv_my_investor() is distinct from a.investor_id then
    raise exception 'only the investor can confirm a payout' using errcode='42501'; end if;
  update app_private.inv_payouts
     set confirmed_by_investor_at = coalesce(confirmed_by_investor_at, now())
   where id = p_payout;
  perform app_private.log_audit('investor.payout_confirmed','investor', p_payout::text, null,
    'Investor confirmed receiving a payout', jsonb_build_object('agreement', v_agr));
  return jsonb_build_object('ok', true);
end $$;

-- ══════════════════════════════════════════════════════ 5. STAFF-SIDE RPCs

create or replace function public.cc_inv_list()
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare v jsonb;
begin
  if not app_private.inv_is_staff() then
    raise exception 'not authorized' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'investor', jsonb_build_object('id', i.id, 'name', i.name, 'email', i.email,
                         'phone', i.phone, 'relationship', i.relationship,
                         'linked', (i.user_id is not null), 'status', i.status),
           'agreements', (select coalesce(jsonb_agg(jsonb_build_object(
                             'id', a.id, 'title', a.title, 'status', a.status,
                             'currency', a.currency, 'signed_date', a.signed_date,
                             'position', app_private.inv_position(a.id)
                           ) order by a.created_at), '[]'::jsonb)
                          from app_private.inv_agreements a where a.investor_id = i.id),
           'pending_receipts', (select count(*) from app_private.inv_receipts r
                                 join app_private.inv_agreements a2 on a2.id = r.agreement_id
                                where a2.investor_id = i.id
                                  and r.declared_by_investor_at is not null
                                  and r.confirmed_by_staff_at is null)
         ) order by i.created_at), '[]'::jsonb) into v
    from app_private.inv_investors i;
  return jsonb_build_object('ok', true, 'investors', v);
end $$;

create or replace function public.cc_inv_save_investor(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare v_id uuid;
begin
  if not app_private.inv_can_manage() then
    raise exception 'not authorized' using errcode='42501'; end if;
  v_id := nullif(p->>'id','')::uuid;
  if v_id is null then
    insert into app_private.inv_investors (name, email, phone, relationship, notes, created_by)
    values (btrim(p->>'name'), nullif(p->>'email',''), nullif(p->>'phone',''),
            nullif(p->>'relationship',''), nullif(p->>'notes',''), auth.uid())
    returning id into v_id;
  else
    update app_private.inv_investors set
      name = coalesce(nullif(btrim(p->>'name'),''), name),
      email = coalesce(nullif(p->>'email',''), email),
      phone = coalesce(nullif(p->>'phone',''), phone),
      relationship = coalesce(nullif(p->>'relationship',''), relationship),
      notes = coalesce(nullif(p->>'notes',''), notes),
      status = coalesce(nullif(p->>'status',''), status)
    where id = v_id;
  end if;
  perform app_private.log_audit('investor.saved','investor', v_id::text, null,
    'Investor record saved', p);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.cc_inv_link_user(p_investor uuid, p_email text)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare v_uid uuid;
begin
  if not app_private.inv_can_manage() then
    raise exception 'not authorized' using errcode='42501'; end if;
  select id into v_uid from auth.users where lower(email) = lower(btrim(p_email)) limit 1;
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'no_account',
      'note', 'Ask them to sign up with this email first, then link.');
  end if;
  update app_private.inv_investors set user_id = v_uid, email = coalesce(email, p_email)
   where id = p_investor;
  perform app_private.log_audit('investor.user_linked','investor', p_investor::text, null,
    'Investor linked to a login', jsonb_build_object('email', p_email));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cc_inv_save_agreement(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare v_id uuid;
begin
  if not app_private.inv_can_manage() then
    raise exception 'not authorized' using errcode='42501'; end if;
  v_id := nullif(p->>'id','')::uuid;
  if v_id is null then
    insert into app_private.inv_agreements (
      investor_id, title, currency, commitment_cap, payback_rate_pct, permanent_share_pct,
      payback_basis, payback_fixed_amount, share_type, equity_vesting_mode,
      profit_definition, exit_treatment, early_stop_terms, buyout_terms,
      signed_date, doc_url, status, created_by)
    values (
      (p->>'investor_id')::uuid, nullif(p->>'title',''), coalesce(nullif(p->>'currency',''),'PKR'),
      (p->>'commitment_cap')::numeric,
      coalesce((p->>'payback_rate_pct')::numeric, 0),
      coalesce((p->>'permanent_share_pct')::numeric, 0),
      coalesce(nullif(p->>'payback_basis',''), 'actual_funded'),
      nullif(p->>'payback_fixed_amount','')::numeric,
      nullif(p->>'share_type',''),
      coalesce(nullif(p->>'equity_vesting_mode',''), 'pro_rata'),
      nullif(p->>'profit_definition',''), nullif(p->>'exit_treatment',''),
      nullif(p->>'early_stop_terms',''), nullif(p->>'buyout_terms',''),
      nullif(p->>'signed_date','')::date, nullif(p->>'doc_url',''),
      coalesce(nullif(p->>'status',''), 'active'), auth.uid())
    returning id into v_id;
  else
    update app_private.inv_agreements set
      title = coalesce(nullif(p->>'title',''), title),
      commitment_cap = coalesce(nullif(p->>'commitment_cap','')::numeric, commitment_cap),
      payback_rate_pct = coalesce(nullif(p->>'payback_rate_pct','')::numeric, payback_rate_pct),
      permanent_share_pct = coalesce(nullif(p->>'permanent_share_pct','')::numeric, permanent_share_pct),
      payback_basis = coalesce(nullif(p->>'payback_basis',''), payback_basis),
      payback_fixed_amount = coalesce(nullif(p->>'payback_fixed_amount','')::numeric, payback_fixed_amount),
      share_type = coalesce(nullif(p->>'share_type',''), share_type),
      equity_vesting_mode = coalesce(nullif(p->>'equity_vesting_mode',''), equity_vesting_mode),
      profit_definition = coalesce(nullif(p->>'profit_definition',''), profit_definition),
      exit_treatment = coalesce(nullif(p->>'exit_treatment',''), exit_treatment),
      early_stop_terms = coalesce(nullif(p->>'early_stop_terms',''), early_stop_terms),
      buyout_terms = coalesce(nullif(p->>'buyout_terms',''), buyout_terms),
      signed_date = coalesce(nullif(p->>'signed_date','')::date, signed_date),
      doc_url = coalesce(nullif(p->>'doc_url',''), doc_url),
      status = coalesce(nullif(p->>'status',''), status)
    where id = v_id;
  end if;
  perform app_private.log_audit('investor.agreement_saved','investor', v_id::text, null,
    'Investment agreement saved', p);
  return jsonb_build_object('ok', true, 'id', v_id, 'position', app_private.inv_position(v_id));
end $$;

create or replace function public.cc_inv_request(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare v_agr uuid; v_seq int; v_id uuid; v_pos jsonb; v_amt numeric;
begin
  if not app_private.inv_can_manage() then
    raise exception 'not authorized' using errcode='42501'; end if;
  v_agr := (p->>'agreement_id')::uuid;
  v_amt := round((p->>'amount')::numeric, 2);
  if v_amt is null or v_amt <= 0 then
    raise exception 'amount must be greater than zero' using errcode='22023'; end if;
  v_pos := app_private.inv_position(v_agr);
  if v_amt > (v_pos->>'unfunded')::numeric then
    raise exception 'that is more than the remaining commitment (%)', (v_pos->>'unfunded')
      using errcode='22023';
  end if;
  select coalesce(max(seq),0) + 1 into v_seq
    from app_private.inv_requests where agreement_id = v_agr;
  insert into app_private.inv_requests
    (agreement_id, seq, amount, reason, category, needed_by, requested_by)
  values (v_agr, v_seq, v_amt, btrim(p->>'reason'), nullif(p->>'category',''),
          nullif(p->>'needed_by','')::date, auth.uid())
  returning id into v_id;
  perform app_private.log_audit('investor.capital_requested','investor', v_id::text, null,
    'Capital request raised', p);
  return jsonb_build_object('ok', true, 'id', v_id, 'seq', v_seq);
end $$;

-- Staff half of the handshake. Can also record a receipt the investor never
-- declared (cash handed over in person, say).
create or replace function public.cc_inv_confirm_receipt(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare v_id uuid; v_agr uuid; v_req uuid; v_amt numeric;
begin
  if not app_private.inv_can_manage() then
    raise exception 'not authorized' using errcode='42501'; end if;
  v_id := nullif(p->>'receipt_id','')::uuid;
  if v_id is not null then
    update app_private.inv_receipts
       set confirmed_by_staff_at = coalesce(confirmed_by_staff_at, now()),
           confirmed_by = auth.uid(),
           amount = coalesce(nullif(p->>'amount','')::numeric, amount),
           method = coalesce(nullif(p->>'method',''), method),
           reference = coalesce(nullif(p->>'reference',''), reference),
           proof_url = coalesce(nullif(p->>'proof_url',''), proof_url)
     where id = v_id
     returning agreement_id, request_id into v_agr, v_req;
    if v_agr is null then raise exception 'receipt not found' using errcode='42704'; end if;
  else
    v_agr := (p->>'agreement_id')::uuid;
    v_req := nullif(p->>'request_id','')::uuid;
    v_amt := round((p->>'amount')::numeric, 2);
    if v_amt is null or v_amt <= 0 then
      raise exception 'amount must be greater than zero' using errcode='22023'; end if;
    insert into app_private.inv_receipts
      (agreement_id, request_id, amount, received_date, method, reference, proof_url, note,
       confirmed_by_staff_at, confirmed_by, created_by)
    values (v_agr, v_req, v_amt, coalesce((p->>'received_date')::date, current_date),
            nullif(p->>'method',''), nullif(p->>'reference',''), nullif(p->>'proof_url',''),
            nullif(p->>'note',''), now(), auth.uid(), auth.uid())
    returning id into v_id;
  end if;
  if v_req is not null then
    update app_private.inv_requests set status = 'funded', responded_at = now() where id = v_req;
  end if;
  perform app_private.log_audit('investor.receipt_confirmed','investor', v_id::text, null,
    'Capital receipt confirmed', p);
  return jsonb_build_object('ok', true, 'id', v_id, 'position', app_private.inv_position(v_agr));
end $$;

-- A confirmed row is never edited. It is reversed with a visible mirror entry.
create or replace function public.cc_inv_reverse_receipt(p_receipt uuid, p_reason text)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare r app_private.inv_receipts; v_id uuid;
begin
  if not app_private.inv_can_manage() then
    raise exception 'not authorized' using errcode='42501'; end if;
  select * into r from app_private.inv_receipts where id = p_receipt;
  if not found then raise exception 'receipt not found' using errcode='42704'; end if;
  if r.reversal_of is not null then
    raise exception 'that row is already a reversal' using errcode='22023'; end if;
  if exists (select 1 from app_private.inv_receipts where reversal_of = p_receipt) then
    raise exception 'that receipt has already been reversed' using errcode='22023'; end if;
  if coalesce(btrim(p_reason),'') = '' then
    raise exception 'a reversal needs a reason' using errcode='22023'; end if;
  insert into app_private.inv_receipts
    (agreement_id, request_id, amount, received_date, method, note,
     confirmed_by_staff_at, confirmed_by, reversal_of, created_by)
  values (r.agreement_id, r.request_id, -r.amount, current_date, r.method,
          'REVERSAL: ' || p_reason, now(), auth.uid(), r.id, auth.uid())
  returning id into v_id;
  perform app_private.log_audit('investor.receipt_reversed','investor', p_receipt::text, null,
    'Capital receipt reversed', jsonb_build_object('reason', p_reason, 'reversal_id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Log a spend. TWO tags, and the tranche must belong to the same agreement.
create or replace function public.cc_inv_expense(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare v_id uuid; v_agr uuid; v_rcpt uuid; v_amt numeric;
begin
  if not app_private.inv_can_manage() then
    raise exception 'not authorized' using errcode='42501'; end if;
  v_agr  := (p->>'agreement_id')::uuid;
  v_rcpt := nullif(p->>'receipt_id','')::uuid;
  v_amt  := round((p->>'amount')::numeric, 2);
  if v_amt is null or v_amt <= 0 then
    raise exception 'amount must be greater than zero' using errcode='22023'; end if;
  if coalesce(btrim(p->>'category'),'') = '' then
    raise exception 'every expense needs a category' using errcode='22023'; end if;
  if v_rcpt is not null and not exists (
       select 1 from app_private.inv_receipts where id = v_rcpt and agreement_id = v_agr) then
    raise exception 'that tranche belongs to a different agreement' using errcode='42704';
  end if;
  insert into app_private.inv_expenses
    (agreement_id, receipt_id, category, expense_date, amount, vendor, description,
     receipt_url, is_recurring, created_by)
  values (v_agr, v_rcpt, btrim(p->>'category'),
          coalesce((p->>'expense_date')::date, current_date), v_amt,
          nullif(p->>'vendor',''), nullif(p->>'description',''),
          nullif(p->>'receipt_url',''), coalesce((p->>'is_recurring')::boolean, false), auth.uid())
  returning id into v_id;
  perform app_private.log_audit('investor.expense_logged','investor', v_id::text, null,
    'Fund expense logged', p);
  return jsonb_build_object('ok', true, 'id', v_id, 'position', app_private.inv_position(v_agr));
end $$;

-- Expense amounts are CHECK > 0, so a reversal is a mirror row flagged by reversal_of
-- and inv_position subtracts it. Nothing is ever deleted.
create or replace function public.cc_inv_reverse_expense(p_expense uuid, p_reason text)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare e app_private.inv_expenses; v_id uuid;
begin
  if not app_private.inv_can_manage() then
    raise exception 'not authorized' using errcode='42501'; end if;
  select * into e from app_private.inv_expenses where id = p_expense;
  if not found then raise exception 'expense not found' using errcode='42704'; end if;
  if e.reversal_of is not null then
    raise exception 'that row is already a reversal' using errcode='22023'; end if;
  if exists (select 1 from app_private.inv_expenses where reversal_of = p_expense) then
    raise exception 'that expense has already been reversed' using errcode='22023'; end if;
  if coalesce(btrim(p_reason),'') = '' then
    raise exception 'a reversal needs a reason' using errcode='22023'; end if;
  insert into app_private.inv_expenses
    (agreement_id, receipt_id, category, expense_date, amount, vendor, description,
     reversal_of, created_by)
  values (e.agreement_id, e.receipt_id, e.category, current_date, e.amount, e.vendor,
          'REVERSAL: ' || p_reason, e.id, auth.uid())
  returning id into v_id;
  perform app_private.log_audit('investor.expense_reversed','investor', p_expense::text, null,
    'Fund expense reversed', jsonb_build_object('reason', p_reason, 'reversal_id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- THE position calculation. Single source of truth for every screen.
-- Reversal rows count as negative spend; only CONFIRMED receipts count as money in.
create or replace function app_private.inv_position(p_agreement uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare
  a app_private.inv_agreements;
  v_funded numeric(14,2); v_spent numeric(14,2); v_recovered numeric(14,2);
  v_share_paid numeric(14,2); v_target numeric(14,2); v_equity numeric(7,4);
begin
  select * into a from app_private.inv_agreements where id = p_agreement;
  if not found then return '{}'::jsonb; end if;
  select coalesce(sum(amount),0) into v_funded
    from app_private.inv_receipts
   where agreement_id = a.id and confirmed_by_staff_at is not null;
  select coalesce(sum(case when reversal_of is null then amount else -amount end),0) into v_spent
    from app_private.inv_expenses where agreement_id = a.id;
  select coalesce(sum(payback_portion),0), coalesce(sum(share_portion),0)
    into v_recovered, v_share_paid
    from app_private.inv_payouts where agreement_id = a.id and status = 'paid';
  v_target := case when a.payback_basis = 'fixed'
                   then coalesce(a.payback_fixed_amount, 0) else v_funded end;
  v_equity := case
    when a.share_type is distinct from 'equity' then null
    when a.equity_vesting_mode = 'upfront' then a.permanent_share_pct
    when a.commitment_cap > 0 then round(a.permanent_share_pct * v_funded / a.commitment_cap, 4)
    else 0 end;
  return jsonb_build_object(
    'agreement_id', a.id, 'currency', a.currency, 'commitment_cap', a.commitment_cap,
    'funded', v_funded, 'unfunded', greatest(a.commitment_cap - v_funded, 0),
    'funded_pct', case when a.commitment_cap > 0 then round(100 * v_funded / a.commitment_cap, 2) else 0 end,
    'spent', v_spent, 'fund_cash', v_funded - v_spent,
    'recovery_target', v_target, 'recovered', v_recovered,
    'outstanding', greatest(v_target - v_recovered, 0),
    'recovered_pct', case when v_target > 0 then round(100 * v_recovered / v_target, 2) else 0 end,
    'share_paid', v_share_paid, 'total_paid_out', v_recovered + v_share_paid,
    'payback_rate_pct', a.payback_rate_pct, 'permanent_share_pct', a.permanent_share_pct,
    'share_type', a.share_type, 'equity_vested_pct', v_equity,
    'phase', case when v_target > 0 and v_recovered < v_target then 'recovering' else 'permanent_share' end,
    'open_questions', (select coalesce(jsonb_agg(q), '[]'::jsonb) from (
        select 'share_type' as q where a.share_type is null
        union all select 'profit_definition' where coalesce(a.profit_definition,'') = ''
        union all select 'exit_treatment'    where coalesce(a.exit_treatment,'') = ''
        union all select 'early_stop_terms'  where coalesce(a.early_stop_terms,'') = ''
        union all select 'signed_document'   where a.signed_date is null) z)
  );
end $$;

-- Publish a month. Every active agreement's slice is computed and parked as a
-- pending payout, so nothing is worked out by hand.
create or replace function public.cc_inv_publish_month(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare v_month date; v_id uuid; v_profit numeric; a record; sp jsonb; v_n int := 0;
begin
  if not app_private.inv_can_manage() then
    raise exception 'not authorized' using errcode='42501'; end if;
  v_month := date_trunc('month', coalesce((p->>'month')::date, current_date))::date;
  insert into app_private.inv_statements (period_month, revenue, expenses_total, note,
                                          status, published_at, created_by)
  values (v_month, coalesce((p->>'revenue')::numeric, 0),
          coalesce((p->>'expenses_total')::numeric, 0), nullif(p->>'note',''),
          'published', now(), auth.uid())
  on conflict (period_month) do update set
    revenue = excluded.revenue, expenses_total = excluded.expenses_total,
    note = coalesce(excluded.note, app_private.inv_statements.note),
    status = 'published', published_at = now()
  returning id, profit into v_id, v_profit;
  for a in select id from app_private.inv_agreements where status = 'active' loop
    sp := app_private.inv_split(a.id, v_profit);
    insert into app_private.inv_payouts
      (agreement_id, statement_id, payback_portion, share_portion, created_by)
    values (a.id, v_id, (sp->>'payback_portion')::numeric, (sp->>'share_portion')::numeric, auth.uid())
    on conflict (agreement_id, statement_id) do update set
      payback_portion = case when app_private.inv_payouts.status = 'paid'
                             then app_private.inv_payouts.payback_portion else excluded.payback_portion end,
      share_portion   = case when app_private.inv_payouts.status = 'paid'
                             then app_private.inv_payouts.share_portion else excluded.share_portion end;
    v_n := v_n + 1;
  end loop;
  perform app_private.log_audit('investor.month_published','investor', v_id::text, null,
    'Monthly profit statement published',
    jsonb_build_object('month', v_month, 'profit', v_profit, 'agreements', v_n));
  return jsonb_build_object('ok', true, 'id', v_id, 'month', v_month,
    'profit', v_profit, 'payouts_staged', v_n);
end $$;

create or replace function public.cc_inv_pay(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare v_id uuid; v_agr uuid;
begin
  if not app_private.inv_can_manage() then
    raise exception 'not authorized' using errcode='42501'; end if;
  v_id := (p->>'payout_id')::uuid;
  update app_private.inv_payouts set
    payback_portion = coalesce(nullif(p->>'payback_portion','')::numeric, payback_portion),
    share_portion   = coalesce(nullif(p->>'share_portion','')::numeric, share_portion),
    paid_date = coalesce((p->>'paid_date')::date, current_date),
    method = nullif(p->>'method',''), reference = nullif(p->>'reference',''),
    proof_url = nullif(p->>'proof_url',''), status = 'paid'
  where id = v_id and status = 'pending' returning agreement_id into v_agr;
  if v_agr is null then raise exception 'payout not found or already paid' using errcode='42704'; end if;
  if (app_private.inv_position(v_agr)->>'outstanding')::numeric <= 0 then
    update app_private.inv_agreements set status = 'recovered' where id = v_agr and status = 'active';
  end if;
  perform app_private.log_audit('investor.payout_recorded','investor', v_id::text, null,
    'Investor payout recorded', p);
  return jsonb_build_object('ok', true, 'position', app_private.inv_position(v_agr));
end $$;

create or replace function public.cc_inv_detail(p_agreement uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare v jsonb; v_req jsonb; v_due jsonb; a app_private.inv_agreements;
begin
  if not app_private.inv_is_staff() then
    raise exception 'not authorized' using errcode='42501'; end if;
  select * into a from app_private.inv_agreements where id = p_agreement;
  v := public.inv_ledger(p_agreement);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'seq', r.seq, 'amount', r.amount, 'reason', r.reason,
           'category', r.category, 'status', r.status, 'requested_at', r.requested_at,
           'seen_at', r.seen_at, 'needed_by', r.needed_by) order by r.seq desc), '[]'::jsonb)
    into v_req from app_private.inv_requests r where r.agreement_id = p_agreement;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'month', s.period_month, 'payback', p.payback_portion,
           'share', p.share_portion, 'total', p.total) order by s.period_month desc), '[]'::jsonb)
    into v_due from app_private.inv_payouts p
    left join app_private.inv_statements s on s.id = p.statement_id
   where p.agreement_id = p_agreement and p.status = 'pending';
  return v || jsonb_build_object('requests', v_req, 'payouts_due', v_due,
    'agreement', jsonb_build_object('id', a.id, 'title', a.title, 'status', a.status,
      'currency', a.currency, 'commitment_cap', a.commitment_cap,
      'payback_rate_pct', a.payback_rate_pct, 'permanent_share_pct', a.permanent_share_pct,
      'payback_basis', a.payback_basis, 'share_type', a.share_type,
      'equity_vesting_mode', a.equity_vesting_mode, 'profit_definition', a.profit_definition,
      'exit_treatment', a.exit_treatment, 'early_stop_terms', a.early_stop_terms,
      'buyout_terms', a.buyout_terms, 'signed_date', a.signed_date, 'doc_url', a.doc_url));
end $$;

-- ──────────────────────────────────────────────────────────────── 6. Grants
do $$
declare f text;
begin
  foreach f in array array[
    'public.inv_me()', 'public.inv_my_requests(uuid)', 'public.inv_declare_payment(jsonb)',
    'public.inv_ledger(uuid)', 'public.inv_statements(uuid)', 'public.inv_confirm_payout(uuid)',
    'public.cc_inv_list()', 'public.cc_inv_save_investor(jsonb)', 'public.cc_inv_link_user(uuid,text)',
    'public.cc_inv_save_agreement(jsonb)', 'public.cc_inv_request(jsonb)',
    'public.cc_inv_confirm_receipt(jsonb)', 'public.cc_inv_reverse_receipt(uuid,text)',
    'public.cc_inv_expense(jsonb)', 'public.cc_inv_reverse_expense(uuid,text)',
    'public.cc_inv_publish_month(jsonb)', 'public.cc_inv_pay(jsonb)', 'public.cc_inv_detail(uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
