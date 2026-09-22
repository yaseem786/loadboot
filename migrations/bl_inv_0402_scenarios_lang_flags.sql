-- ============================================================================
-- bl_inv_0402 — Investor module, round 2: the situations that actually happen.
--
--   • PARTIAL FUNDING  — investor commits 20 but stops at 8. Commitment is closed
--     at the funded amount; the permanent share is kept or pro-rated per the
--     agreement (early_stop_share_mode). Nothing else changes.
--   • NO PROFIT MONTH  — nothing is owed, nothing accrues. Optional loss
--     carry-forward per agreement (off by default: month-by-month, as agreed).
--   • LOSS / WIND-DOWN — company cannot continue. Unspent fund cash (and any
--     asset proceeds) go back to the investor as a capital_return payout; spent
--     money is lost; the owner owes nothing personally. Recorded, not hidden.
--   • EXIT PARTICIPATION — a % of sale proceeds without ownership ("phantom
--     equity"), so a profit-share investor still shares the upside.
--   • LANGUAGE — per-investor preferred language (en / ur_roman / ur), set in CC,
--     switchable by the investor.
--   • FLAGS — the investor can question any entry; staff answer in CC. Disputes
--     become records instead of phone calls.
--   • DECLARED-BUT-NEVER-ARRIVED receipts can be rejected with a reason.
-- Additive only. Nothing in 0401 is weakened.
-- ============================================================================

alter table app_private.inv_investors
  add column if not exists preferred_lang text not null default 'en'
    check (preferred_lang in ('en','ur_roman','ur'));

alter table app_private.inv_agreements
  add column if not exists early_stop_share_mode text not null default 'pro_rata'
    check (early_stop_share_mode in ('keep','pro_rata')),
  add column if not exists loss_carry_forward boolean not null default false,
  add column if not exists exit_participation_pct numeric(5,2)
    check (exit_participation_pct is null or (exit_participation_pct >= 0 and exit_participation_pct <= 100)),
  add column if not exists original_cap numeric(14,2),
  add column if not exists commitment_closed_at timestamptz,
  add column if not exists closed_reason text,
  add column if not exists wind_down jsonb;

alter table app_private.inv_agreements drop constraint if exists inv_agreements_status_check;
alter table app_private.inv_agreements add constraint inv_agreements_status_check
  check (status in ('draft','active','recovered','stopped_early','wound_down','closed'));

alter table app_private.inv_receipts
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_reason text;

alter table app_private.inv_payouts
  add column if not exists kind text not null default 'profit'
    check (kind in ('profit','capital_return'));

create table if not exists app_private.inv_flags (
  id            uuid primary key default gen_random_uuid(),
  agreement_id  uuid not null references app_private.inv_agreements(id) on delete cascade,
  kind          text not null check (kind in ('receipt','expense','payout','statement','agreement','other')),
  ref_id        uuid,
  note          text not null,
  status        text not null default 'open' check (status in ('open','answered','resolved')),
  answer        text,
  raised_by     uuid,
  raised_at     timestamptz not null default now(),
  answered_by   uuid,
  answered_at   timestamptz
);
create index if not exists inv_flags_agr_idx on app_private.inv_flags(agreement_id, status);
alter table app_private.inv_flags enable row level security;
alter table app_private.inv_flags force row level security;
revoke all on app_private.inv_flags from anon, authenticated;

-- ───────────────────────────────────────── position, now scenario-aware
create or replace function app_private.inv_position(p_agreement uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare
  a app_private.inv_agreements;
  v_funded numeric(14,2); v_spent numeric(14,2); v_recovered numeric(14,2);
  v_share_paid numeric(14,2); v_returned numeric(14,2); v_target numeric(14,2);
  v_equity numeric(7,4); v_eff_share numeric(7,4); v_cap numeric(14,2); v_phase text;
  v_open_flags int; v_loss_pool numeric(14,2);
begin
  select * into a from app_private.inv_agreements where id = p_agreement;
  if not found then return '{}'::jsonb; end if;

  select coalesce(sum(amount),0) into v_funded from app_private.inv_receipts
   where agreement_id = a.id and confirmed_by_staff_at is not null and rejected_at is null;
  select coalesce(sum(case when reversal_of is null then amount else -amount end),0) into v_spent
    from app_private.inv_expenses where agreement_id = a.id;
  select coalesce(sum(case when kind='profit' then payback_portion else 0 end),0),
         coalesce(sum(case when kind='profit' then share_portion else 0 end),0),
         coalesce(sum(case when kind='capital_return' then total else 0 end),0)
    into v_recovered, v_share_paid, v_returned
    from app_private.inv_payouts where agreement_id = a.id and status = 'paid';
  select count(*) into v_open_flags from app_private.inv_flags where agreement_id = a.id and status = 'open';

  -- Loss pool: when carry-forward is on, the running negative balance of published months.
  -- Scoped to months since this agreement began: a new investor never inherits older losses.
  select coalesce(-least(0, sum(profit)),0) into v_loss_pool
    from app_private.inv_statements
   where status = 'published' and period_month >= date_trunc('month', a.created_at)::date;
  if not a.loss_carry_forward then v_loss_pool := 0; end if;

  v_cap := a.commitment_cap;
  v_target := case when a.payback_basis = 'fixed' then coalesce(a.payback_fixed_amount, 0) else v_funded end;
  -- Capital returned at wind-down also counts toward what the investor got back.
  v_target := greatest(v_target - v_returned, 0);

  -- Effective permanent share: pro-rated if the commitment was closed early and the deal says so.
  v_eff_share := a.permanent_share_pct;
  if a.commitment_closed_at is not null and a.early_stop_share_mode = 'pro_rata'
     and coalesce(a.original_cap, 0) > 0 then
    v_eff_share := round(a.permanent_share_pct * least(v_funded, a.original_cap) / a.original_cap, 4);
  end if;

  v_equity := case
    when a.share_type is distinct from 'equity' then null
    when a.equity_vesting_mode = 'upfront' then v_eff_share
    when coalesce(a.original_cap, a.commitment_cap) > 0
      then round(v_eff_share * v_funded / coalesce(a.original_cap, a.commitment_cap), 4)
    else 0 end;

  v_phase := case
    when a.status = 'wound_down' then 'wound_down'
    when a.status = 'closed' then 'closed'
    when v_target > 0 and v_recovered < v_target then 'recovering'
    else 'permanent_share' end;

  return jsonb_build_object(
    'agreement_id', a.id, 'currency', a.currency, 'status', a.status,
    'commitment_cap', v_cap, 'original_cap', coalesce(a.original_cap, v_cap),
    'commitment_closed', (a.commitment_closed_at is not null), 'closed_reason', a.closed_reason,
    'funded', v_funded, 'unfunded', greatest(v_cap - v_funded, 0),
    'funded_pct', case when v_cap > 0 then round(100 * v_funded / v_cap, 2) else 0 end,
    'spent', v_spent, 'fund_cash', v_funded - v_spent - v_returned,
    'capital_returned', v_returned,
    'recovery_target', v_target, 'recovered', v_recovered,
    'outstanding', greatest(v_target - v_recovered, 0),
    'recovered_pct', case when v_target > 0 then round(100 * v_recovered / v_target, 2) else 100 end,
    'share_paid', v_share_paid, 'total_paid_out', v_recovered + v_share_paid + v_returned,
    'payback_rate_pct', a.payback_rate_pct, 'permanent_share_pct', a.permanent_share_pct,
    'effective_share_pct', v_eff_share, 'exit_participation_pct', a.exit_participation_pct,
    'share_type', a.share_type, 'equity_vested_pct', v_equity,
    'loss_carry_forward', a.loss_carry_forward, 'loss_pool', v_loss_pool,
    'early_stop_share_mode', a.early_stop_share_mode,
    'open_flags', v_open_flags, 'phase', v_phase, 'wind_down', a.wind_down,
    'open_questions', (select coalesce(jsonb_agg(q), '[]'::jsonb) from (
        select 'share_type' as q where a.share_type is null
        union all select 'profit_definition' where coalesce(a.profit_definition,'') = ''
        union all select 'exit_treatment'    where coalesce(a.exit_treatment,'') = '' and a.exit_participation_pct is null
        union all select 'early_stop_terms'  where coalesce(a.early_stop_terms,'') = ''
        union all select 'signed_document'   where a.signed_date is null) z)
  );
end $$;

-- Split honours the loss pool and the effective (possibly pro-rated) share.
create or replace function app_private.inv_split(p_agreement uuid, p_profit numeric)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare a app_private.inv_agreements; pos jsonb; v_basis numeric; v_pay numeric; v_share numeric; v_out numeric;
begin
  select * into a from app_private.inv_agreements where id = p_agreement;
  if not found then return jsonb_build_object('payback_portion',0,'share_portion',0,'total',0,'basis',0); end if;
  pos := app_private.inv_position(p_agreement);
  v_basis := coalesce(p_profit, 0);
  if a.loss_carry_forward then v_basis := v_basis - (pos->>'loss_pool')::numeric; end if;
  if v_basis <= 0 or a.status in ('wound_down','closed') then
    return jsonb_build_object('payback_portion',0,'share_portion',0,'total',0,'basis',0,
      'note', case when coalesce(p_profit,0) <= 0 then 'no_profit' when a.loss_carry_forward then 'loss_pool' else 'closed' end);
  end if;
  v_out   := (pos->>'outstanding')::numeric;
  v_share := round(v_basis * (pos->>'effective_share_pct')::numeric / 100, 2);
  v_pay   := least(round(v_basis * a.payback_rate_pct / 100, 2), v_out);
  return jsonb_build_object('payback_portion', v_pay, 'share_portion', v_share,
                            'total', v_pay + v_share, 'basis', v_basis, 'outstanding_before', v_out);
end $$;

-- ───────────────────────────────────────── receipts: cap guard + reject
-- Money above the commitment is not silently accepted: raise the cap first.
create or replace function app_private.inv_assert_cap(p_agreement uuid, p_add numeric)
returns void language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare a app_private.inv_agreements; pos jsonb;
begin
  select * into a from app_private.inv_agreements where id = p_agreement;
  if a.commitment_closed_at is not null then
    raise exception 'commitment is closed at % — reopen it (edit the agreement) before recording more money', a.commitment_cap using errcode='22023';
  end if;
  pos := app_private.inv_position(p_agreement);
  if p_add > (pos->>'unfunded')::numeric then
    raise exception 'that is more than the remaining commitment (%). Raise the commitment cap first.', (pos->>'unfunded') using errcode='22023';
  end if;
end $$;

create or replace function public.cc_inv_confirm_receipt(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare v_id uuid; v_agr uuid; v_req uuid; v_amt numeric; r app_private.inv_receipts;
begin
  if not app_private.inv_can_manage() then
    raise exception 'not authorized' using errcode='42501'; end if;
  v_id := nullif(p->>'receipt_id','')::uuid;
  if v_id is not null then
    select * into r from app_private.inv_receipts where id = v_id;
    if not found then raise exception 'receipt not found' using errcode='42704'; end if;
    if r.rejected_at is not null then raise exception 'that receipt was rejected' using errcode='22023'; end if;
    v_amt := coalesce(nullif(p->>'amount','')::numeric, r.amount);
    if r.confirmed_by_staff_at is null then perform app_private.inv_assert_cap(r.agreement_id, v_amt); end if;
    update app_private.inv_receipts
       set confirmed_by_staff_at = coalesce(confirmed_by_staff_at, now()), confirmed_by = auth.uid(),
           amount = v_amt, method = coalesce(nullif(p->>'method',''), method),
           reference = coalesce(nullif(p->>'reference',''), reference),
           proof_url = coalesce(nullif(p->>'proof_url',''), proof_url)
     where id = v_id returning agreement_id, request_id into v_agr, v_req;
  else
    v_agr := (p->>'agreement_id')::uuid; v_req := nullif(p->>'request_id','')::uuid;
    v_amt := round((p->>'amount')::numeric, 2);
    if v_amt is null or v_amt <= 0 then raise exception 'amount must be greater than zero' using errcode='22023'; end if;
    perform app_private.inv_assert_cap(v_agr, v_amt);
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
  perform app_private.log_audit('investor.receipt_confirmed','investor', v_id::text, null, 'Capital receipt confirmed', p);
  return jsonb_build_object('ok', true, 'id', v_id, 'position', app_private.inv_position(v_agr));
end $$;

create or replace function public.cc_inv_reject_receipt(p_receipt uuid, p_reason text)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare r app_private.inv_receipts;
begin
  if not app_private.inv_can_manage() then raise exception 'not authorized' using errcode='42501'; end if;
  select * into r from app_private.inv_receipts where id = p_receipt;
  if not found then raise exception 'receipt not found' using errcode='42704'; end if;
  if r.confirmed_by_staff_at is not null then
    raise exception 'already confirmed — reverse it instead' using errcode='22023'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'a rejection needs a reason' using errcode='22023'; end if;
  update app_private.inv_receipts set rejected_at = now(), rejected_reason = p_reason where id = p_receipt;
  if r.request_id is not null then
    update app_private.inv_requests set status = 'pending', responded_at = null where id = r.request_id and status = 'declared';
  end if;
  perform app_private.log_audit('investor.receipt_rejected','investor', p_receipt::text, null,
    'Declared payment rejected', jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────────────────────── partial funding: close the commitment
create or replace function public.cc_inv_close_commitment(p_agreement uuid, p_reason text)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare a app_private.inv_agreements; pos jsonb; v_funded numeric;
begin
  if not app_private.inv_can_manage() then raise exception 'not authorized' using errcode='42501'; end if;
  select * into a from app_private.inv_agreements where id = p_agreement;
  if not found then raise exception 'agreement not found' using errcode='42704'; end if;
  if a.commitment_closed_at is not null then raise exception 'already closed' using errcode='22023'; end if;
  pos := app_private.inv_position(p_agreement); v_funded := (pos->>'funded')::numeric;
  if v_funded <= 0 then raise exception 'nothing has been funded yet — cancel the agreement instead' using errcode='22023'; end if;
  update app_private.inv_agreements
     set original_cap = coalesce(original_cap, commitment_cap),
         commitment_cap = v_funded,
         commitment_closed_at = now(), closed_reason = p_reason,
         status = case when status = 'active' then 'stopped_early' else status end
   where id = p_agreement;
  update app_private.inv_requests set status = 'cancelled', responded_at = now()
   where agreement_id = p_agreement and status in ('pending','declared');
  perform app_private.log_audit('investor.commitment_closed','investor', p_agreement::text, null,
    'Commitment closed at funded amount', jsonb_build_object('funded', v_funded, 'was_cap', a.commitment_cap, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'position', app_private.inv_position(p_agreement));
end $$;

create or replace function public.cc_inv_reopen_commitment(p_agreement uuid, p_new_cap numeric)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
begin
  if not app_private.inv_can_manage() then raise exception 'not authorized' using errcode='42501'; end if;
  if coalesce(p_new_cap,0) <= 0 then raise exception 'cap must be positive' using errcode='22023'; end if;
  update app_private.inv_agreements
     set commitment_cap = p_new_cap, commitment_closed_at = null, closed_reason = null,
         status = case when status = 'stopped_early' then 'active' else status end
   where id = p_agreement;
  perform app_private.log_audit('investor.commitment_reopened','investor', p_agreement::text, null,
    'Commitment reopened', jsonb_build_object('new_cap', p_new_cap));
  return jsonb_build_object('ok', true, 'position', app_private.inv_position(p_agreement));
end $$;

-- ───────────────────────────────────────── loss: wind-down
-- Unspent fund cash + asset proceeds go back as a capital_return payout (pending
-- until actually paid). Everything spent is recorded as lost. Owner owes nothing.
create or replace function public.cc_inv_wind_down(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare v_agr uuid; pos jsonb; v_cash numeric; v_assets numeric; v_ret numeric; v_pay uuid;
begin
  if not app_private.inv_can_manage() then raise exception 'not authorized' using errcode='42501'; end if;
  v_agr := (p->>'agreement_id')::uuid;
  if coalesce(btrim(p->>'reason'),'') = '' then raise exception 'a wind-down needs a written reason' using errcode='22023'; end if;
  pos := app_private.inv_position(v_agr);
  v_cash := greatest((pos->>'fund_cash')::numeric, 0);
  v_assets := coalesce(nullif(p->>'asset_proceeds','')::numeric, 0);
  v_ret := coalesce(nullif(p->>'return_amount','')::numeric, v_cash + v_assets);
  update app_private.inv_agreements
     set status = 'wound_down', commitment_closed_at = coalesce(commitment_closed_at, now()),
         original_cap = coalesce(original_cap, commitment_cap),
         wind_down = jsonb_build_object('at', now(), 'reason', p->>'reason',
           'fund_cash_at_close', v_cash, 'asset_proceeds', v_assets, 'return_amount', v_ret,
           'spent_and_lost', (pos->>'spent')::numeric, 'recovered_before', (pos->>'recovered')::numeric)
   where id = v_agr;
  update app_private.inv_requests set status = 'cancelled', responded_at = now()
   where agreement_id = v_agr and status in ('pending','declared');
  if v_ret > 0 then
    insert into app_private.inv_payouts (agreement_id, kind, payback_portion, share_portion, created_by)
    values (v_agr, 'capital_return', v_ret, 0, auth.uid()) returning id into v_pay;
  end if;
  perform app_private.log_audit('investor.wound_down','investor', v_agr::text, null,
    'Agreement wound down', p || jsonb_build_object('return_amount', v_ret));
  return jsonb_build_object('ok', true, 'capital_return_payout', v_pay, 'return_amount', v_ret,
    'position', app_private.inv_position(v_agr));
end $$;

-- ───────────────────────────────────────── flags (investor questions an entry)
create or replace function public.inv_flag(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare a app_private.inv_agreements; v_id uuid;
begin
  a := app_private.inv_guard((p->>'agreement_id')::uuid);
  if app_private.inv_my_investor() is distinct from a.investor_id then
    raise exception 'only the investor can raise a flag' using errcode='42501'; end if;
  if coalesce(btrim(p->>'note'),'') = '' then raise exception 'write what the question is' using errcode='22023'; end if;
  insert into app_private.inv_flags (agreement_id, kind, ref_id, note, raised_by)
  values (a.id, coalesce(nullif(p->>'kind',''),'other'), nullif(p->>'ref_id','')::uuid, btrim(p->>'note'), auth.uid())
  returning id into v_id;
  perform app_private.log_audit('investor.flag_raised','investor', v_id::text, null, 'Investor questioned an entry', p);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.inv_my_flags(p_agreement uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare v jsonb;
begin
  perform app_private.inv_guard(p_agreement);
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'ref_id', f.ref_id, 'note', f.note,
           'status', f.status, 'answer', f.answer, 'raised_at', f.raised_at, 'answered_at', f.answered_at)
           order by f.raised_at desc), '[]'::jsonb) into v
    from app_private.inv_flags f where f.agreement_id = p_agreement;
  return jsonb_build_object('ok', true, 'flags', v);
end $$;

create or replace function public.cc_inv_answer_flag(p_flag uuid, p_answer text, p_resolve boolean default true)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
begin
  if not app_private.inv_can_manage() then raise exception 'not authorized' using errcode='42501'; end if;
  update app_private.inv_flags set answer = p_answer, answered_by = auth.uid(), answered_at = now(),
         status = case when p_resolve then 'resolved' else 'answered' end
   where id = p_flag;
  perform app_private.log_audit('investor.flag_answered','investor', p_flag::text, null, 'Flag answered', jsonb_build_object('answer', p_answer));
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────────────────────── language + new agreement fields
create or replace function public.cc_inv_save_investor(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare v_id uuid;
begin
  if not app_private.inv_can_manage() then raise exception 'not authorized' using errcode='42501'; end if;
  v_id := nullif(p->>'id','')::uuid;
  if v_id is null then
    insert into app_private.inv_investors (name, email, phone, relationship, notes, preferred_lang, created_by)
    values (btrim(p->>'name'), nullif(p->>'email',''), nullif(p->>'phone',''), nullif(p->>'relationship',''),
            nullif(p->>'notes',''), coalesce(nullif(p->>'preferred_lang',''),'en'), auth.uid())
    returning id into v_id;
  else
    update app_private.inv_investors set
      name = coalesce(nullif(btrim(p->>'name'),''), name), email = coalesce(nullif(p->>'email',''), email),
      phone = coalesce(nullif(p->>'phone',''), phone), relationship = coalesce(nullif(p->>'relationship',''), relationship),
      notes = coalesce(nullif(p->>'notes',''), notes), status = coalesce(nullif(p->>'status',''), status),
      preferred_lang = coalesce(nullif(p->>'preferred_lang',''), preferred_lang)
    where id = v_id;
  end if;
  perform app_private.log_audit('investor.saved','investor', v_id::text, null, 'Investor record saved', p);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- The investor may switch their own language; it is remembered.
create or replace function public.inv_set_lang(p_lang text)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
begin
  if p_lang not in ('en','ur_roman','ur') then raise exception 'unknown language' using errcode='22023'; end if;
  update app_private.inv_investors set preferred_lang = p_lang where id = app_private.inv_my_investor();
  return jsonb_build_object('ok', true, 'lang', p_lang);
end $$;

create or replace function public.cc_inv_save_agreement(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare v_id uuid;
begin
  if not app_private.inv_can_manage() then raise exception 'not authorized' using errcode='42501'; end if;
  v_id := nullif(p->>'id','')::uuid;
  if v_id is null then
    insert into app_private.inv_agreements (
      investor_id, title, currency, commitment_cap, payback_rate_pct, permanent_share_pct,
      payback_basis, payback_fixed_amount, share_type, equity_vesting_mode,
      profit_definition, exit_treatment, early_stop_terms, buyout_terms,
      early_stop_share_mode, loss_carry_forward, exit_participation_pct,
      signed_date, doc_url, status, created_by)
    values (
      (p->>'investor_id')::uuid, nullif(p->>'title',''), coalesce(nullif(p->>'currency',''),'PKR'),
      (p->>'commitment_cap')::numeric, coalesce((p->>'payback_rate_pct')::numeric, 0),
      coalesce((p->>'permanent_share_pct')::numeric, 0), coalesce(nullif(p->>'payback_basis',''), 'actual_funded'),
      nullif(p->>'payback_fixed_amount','')::numeric, nullif(p->>'share_type',''),
      coalesce(nullif(p->>'equity_vesting_mode',''), 'pro_rata'),
      nullif(p->>'profit_definition',''), nullif(p->>'exit_treatment',''),
      nullif(p->>'early_stop_terms',''), nullif(p->>'buyout_terms',''),
      coalesce(nullif(p->>'early_stop_share_mode',''), 'pro_rata'),
      coalesce((p->>'loss_carry_forward')::boolean, false),
      nullif(p->>'exit_participation_pct','')::numeric,
      nullif(p->>'signed_date','')::date, nullif(p->>'doc_url',''),
      coalesce(nullif(p->>'status',''), 'active'), auth.uid())
    returning id into v_id;
  else
    update app_private.inv_agreements set
      title = coalesce(nullif(p->>'title',''), title),
      commitment_cap = case when commitment_closed_at is null then coalesce(nullif(p->>'commitment_cap','')::numeric, commitment_cap) else commitment_cap end,
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
      early_stop_share_mode = coalesce(nullif(p->>'early_stop_share_mode',''), early_stop_share_mode),
      loss_carry_forward = coalesce((p->>'loss_carry_forward')::boolean, loss_carry_forward),
      exit_participation_pct = coalesce(nullif(p->>'exit_participation_pct','')::numeric, exit_participation_pct),
      signed_date = coalesce(nullif(p->>'signed_date','')::date, signed_date),
      doc_url = coalesce(nullif(p->>'doc_url',''), doc_url),
      status = coalesce(nullif(p->>'status',''), status)
    where id = v_id;
  end if;
  perform app_private.log_audit('investor.agreement_saved','investor', v_id::text, null, 'Investment agreement saved', p);
  return jsonb_build_object('ok', true, 'id', v_id, 'position', app_private.inv_position(v_id));
end $$;

-- ───────────────────────────────────────── reads updated for the new fields
create or replace function public.inv_me()
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare v_inv uuid; v_me jsonb; v_agrs jsonb;
begin
  v_inv := app_private.inv_my_investor();
  if v_inv is null then return jsonb_build_object('ok', false, 'reason', 'not_an_investor'); end if;
  select jsonb_build_object('id', i.id, 'name', i.name, 'email', i.email, 'phone', i.phone, 'lang', i.preferred_lang)
    into v_me from app_private.inv_investors i where i.id = v_inv;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'title', a.title, 'currency', a.currency, 'status', a.status,
           'signed_date', a.signed_date, 'doc_url', a.doc_url,
           'profit_definition', a.profit_definition, 'exit_treatment', a.exit_treatment,
           'early_stop_terms', a.early_stop_terms, 'buyout_terms', a.buyout_terms,
           'early_stop_share_mode', a.early_stop_share_mode, 'loss_carry_forward', a.loss_carry_forward,
           'exit_participation_pct', a.exit_participation_pct, 'closed_reason', a.closed_reason,
           'wind_down', a.wind_down, 'position', app_private.inv_position(a.id)
         ) order by a.created_at), '[]'::jsonb)
    into v_agrs from app_private.inv_agreements a where a.investor_id = v_inv and a.status <> 'draft';
  return jsonb_build_object('ok', true, 'investor', v_me, 'agreements', v_agrs);
end $$;

create or replace function public.inv_ledger(p_agreement uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare a app_private.inv_agreements; v_rcpt jsonb; v_exp jsonb; v_pay jsonb; v_cat jsonb;
begin
  a := app_private.inv_guard(p_agreement);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'amount', r.amount, 'received_date', r.received_date, 'method', r.method,
           'reference', r.reference, 'proof_url', r.proof_url, 'note', r.note,
           'declared_at', r.declared_by_investor_at, 'confirmed_at', r.confirmed_by_staff_at,
           'rejected_reason', r.rejected_reason,
           'state', case when r.rejected_at is not null then 'rejected'
                         when r.reversal_of is not null then 'reversal'
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
    select category as cat, sum(case when reversal_of is null then amount else -amount end) as amt
      from app_private.inv_expenses where agreement_id = a.id group by category having sum(case when reversal_of is null then amount else -amount end) > 0) z;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'kind', p.kind, 'payback', p.payback_portion, 'share', p.share_portion, 'total', p.total,
           'paid_date', p.paid_date, 'method', p.method, 'reference', p.reference, 'proof_url', p.proof_url,
           'status', p.status, 'confirmed_at', p.confirmed_by_investor_at,
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
           'payout', (select jsonb_build_object('id', p.id, 'payback', p.payback_portion, 'share', p.share_portion,
                        'total', p.total, 'status', p.status, 'paid_date', p.paid_date, 'confirmed_at', p.confirmed_by_investor_at)
                        from app_private.inv_payouts p where p.statement_id = s.id and p.agreement_id = a.id and p.kind = 'profit')
         ) order by s.period_month desc), '[]'::jsonb) into v
    from app_private.inv_statements s where s.status = 'published' and s.period_month >= coalesce(date_trunc('month', a.created_at)::date, s.period_month);
  return jsonb_build_object('ok', true, 'statements', v);
end $$;

create or replace function public.cc_inv_detail(p_agreement uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare v jsonb; v_req jsonb; v_due jsonb; v_flags jsonb; a app_private.inv_agreements; i app_private.inv_investors;
begin
  if not app_private.inv_is_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  select * into a from app_private.inv_agreements where id = p_agreement;
  select * into i from app_private.inv_investors where id = a.investor_id;
  v := public.inv_ledger(p_agreement);
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'seq', r.seq, 'amount', r.amount, 'reason', r.reason,
           'category', r.category, 'status', r.status, 'requested_at', r.requested_at, 'seen_at', r.seen_at, 'needed_by', r.needed_by)
           order by r.seq desc), '[]'::jsonb) into v_req from app_private.inv_requests r where r.agreement_id = p_agreement;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'month', s.period_month, 'payback', p.payback_portion,
           'share', p.share_portion, 'total', p.total) order by p.created_at desc), '[]'::jsonb) into v_due
    from app_private.inv_payouts p left join app_private.inv_statements s on s.id = p.statement_id
   where p.agreement_id = p_agreement and p.status = 'pending';
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'ref_id', f.ref_id, 'note', f.note, 'status', f.status,
           'answer', f.answer, 'raised_at', f.raised_at) order by f.raised_at desc), '[]'::jsonb) into v_flags
    from app_private.inv_flags f where f.agreement_id = p_agreement;
  return v || jsonb_build_object('requests', v_req, 'payouts_due', v_due, 'flags', v_flags,
    'investor', jsonb_build_object('id', i.id, 'name', i.name, 'lang', i.preferred_lang, 'linked', i.user_id is not null),
    'agreement', jsonb_build_object('id', a.id, 'investor_id', a.investor_id, 'title', a.title, 'status', a.status,
      'currency', a.currency, 'commitment_cap', a.commitment_cap, 'original_cap', a.original_cap,
      'payback_rate_pct', a.payback_rate_pct, 'permanent_share_pct', a.permanent_share_pct,
      'payback_basis', a.payback_basis, 'payback_fixed_amount', a.payback_fixed_amount, 'share_type', a.share_type,
      'equity_vesting_mode', a.equity_vesting_mode, 'profit_definition', a.profit_definition,
      'exit_treatment', a.exit_treatment, 'early_stop_terms', a.early_stop_terms, 'buyout_terms', a.buyout_terms,
      'early_stop_share_mode', a.early_stop_share_mode, 'loss_carry_forward', a.loss_carry_forward,
      'exit_participation_pct', a.exit_participation_pct, 'commitment_closed_at', a.commitment_closed_at,
      'closed_reason', a.closed_reason, 'wind_down', a.wind_down, 'signed_date', a.signed_date, 'doc_url', a.doc_url));
end $$;

-- Publish month: carry-forward aware (inv_split reads the loss pool), and only for
-- agreements still active or recovering — a wound-down agreement earns nothing.
create or replace function public.cc_inv_publish_month(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare v_month date; v_id uuid; v_profit numeric; a record; sp jsonb; v_n int := 0;
begin
  if not app_private.inv_can_manage() then raise exception 'not authorized' using errcode='42501'; end if;
  v_month := date_trunc('month', coalesce((p->>'month')::date, current_date))::date;
  insert into app_private.inv_statements (period_month, revenue, expenses_total, note, status, published_at, created_by)
  values (v_month, coalesce((p->>'revenue')::numeric, 0), coalesce((p->>'expenses_total')::numeric, 0),
          nullif(p->>'note',''), 'published', now(), auth.uid())
  on conflict (period_month) do update set
    revenue = excluded.revenue, expenses_total = excluded.expenses_total,
    note = coalesce(excluded.note, app_private.inv_statements.note), status = 'published', published_at = now()
  returning id, profit into v_id, v_profit;
  for a in select id from app_private.inv_agreements where status in ('active','stopped_early','recovered') loop
    sp := app_private.inv_split(a.id, v_profit);
    insert into app_private.inv_payouts (agreement_id, statement_id, kind, payback_portion, share_portion, created_by)
    values (a.id, v_id, 'profit', (sp->>'payback_portion')::numeric, (sp->>'share_portion')::numeric, auth.uid())
    on conflict (agreement_id, statement_id) do update set
      payback_portion = case when app_private.inv_payouts.status = 'paid' then app_private.inv_payouts.payback_portion else excluded.payback_portion end,
      share_portion   = case when app_private.inv_payouts.status = 'paid' then app_private.inv_payouts.share_portion else excluded.share_portion end;
    -- A zero payout is auto-marked paid so it never sits as "due": nothing was owed.
    update app_private.inv_payouts set status = 'paid', paid_date = current_date, method = 'none', reference = 'no profit — nothing owed'
     where agreement_id = a.id and statement_id = v_id and status = 'pending' and total = 0;
    v_n := v_n + 1;
  end loop;
  perform app_private.log_audit('investor.month_published','investor', v_id::text, null,
    'Monthly profit statement published', jsonb_build_object('month', v_month, 'profit', v_profit, 'agreements', v_n));
  return jsonb_build_object('ok', true, 'id', v_id, 'month', v_month, 'profit', v_profit, 'payouts_staged', v_n);
end $$;

-- ───────────────────────────────────────── grants
do $$
declare f text;
begin
  foreach f in array array[
    'public.cc_inv_reject_receipt(uuid,text)', 'public.cc_inv_close_commitment(uuid,text)',
    'public.cc_inv_reopen_commitment(uuid,numeric)', 'public.cc_inv_wind_down(jsonb)',
    'public.inv_flag(jsonb)', 'public.inv_my_flags(uuid)', 'public.cc_inv_answer_flag(uuid,text,boolean)',
    'public.inv_set_lang(text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
