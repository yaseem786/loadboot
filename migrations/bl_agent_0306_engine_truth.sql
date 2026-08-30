-- bl_agent_0306_engine_truth
-- 29 Aug 2026 — agent/referral earnings engine, four correctness fixes.
-- Audit: docs/AGENT-PORTAL-AUDIT-2026-08-29.md. referral_commissions was EMPTY on prod
-- (no commission has ever accrued), so there is no historical data to migrate — these
-- fixes change future behaviour only.
--
-- 1. THE PROMISE IS A % OF GROSS; THE ENGINE PAID A % OF THE FEE/5.
--    Every agent-facing document (AGENT-PROGRAM.md, agents.html, the upline email in
--    agent_claim_upline: "level-2 override (0.50% of gross)") promises pct-of-GROSS.
--    The engine computed round(fee * pct / 5.0, 2) — correct ONLY while fee is exactly
--    5% of gross. fin_invoices carries gross AND fee_pct; any discounted or flat-fee
--    invoice would silently shortchange (or overpay) every level of the chain.
--    Now: base = coalesce(gross, fee*100/fee_pct), amount = round(base * pct/100, 2).
--
-- 2. AN INACTIVE MID-CHAIN NODE STOPPED THE WHOLE UPLINE WALK.
--    while ... v_ref.status='active' exited the loop at the first pending/suspended
--    referrer, so every ACTIVE upline ABOVE that node earned nothing — their recruiting
--    work silently wasted. Now the walk continues past inactive nodes (they still
--    consume their level, so nobody's percentage changes); only active nodes get rows.
--    The skipped node itself is healed by the rescan the day it activates.
--
-- 3. PAIR-ACTIVATION: HOLD, DON'T DISCARD (and enforce it where it was missing).
--    The program's pair rule was enforced at INSERT time in the agent-loads path only —
--    a not-yet-paired agent's loads produced nothing visible, and the core paths never
--    enforced the rule at all (a single-sided chain would have been PAID, contradicting
--    the published terms). Now every earned row is INSERTED immediately (visible in the
--    agent's ledger as accrued — the network-marketing motivation loop), and the pair
--    rule gates PROMOTION to payable instead, only for referrers with an approved agent
--    profile (the agent program); plain referral-program affiliates are unaffected.
--
-- 4. CLAWBACK + REVIVAL.
--    An invoice that left sent/paid after accrual kept its commissions payable — money
--    out on a load that was voided. Unpaid commissions now go to 'void' with their
--    invoice, and revive to 'accrued' if the invoice comes back (paid rows are never
--    touched — clawing back paid money is a human decision).
--
-- Real-time: fire_referral_accrue (AFTER INSERT/UPDATE OF status on fin_invoices) now
-- calls referral_accrue_all() instead of referral_accrue_core(), so the agent-loads
-- path accrues the moment the invoice lands instead of waiting for the 30-min cron.
-- The cron stays as the date-based promoter and safety net.
--
-- NOT touched: any dispatcher_* function, table, or policy (bl_disp_*).

create or replace function app_private.referral_accrue_core()
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $fn$
declare inv record; v_ref app_private.referrers; v_lvl int; v_pct numeric;
        v_base numeric; v_new int := 0; v_ins int; v_promoted int := 0;
        v_voided int := 0; v_revived int := 0;
begin
  -- carrier-side chains
  for inv in
    select fi.id, fi.trip_id, fi.carrier_id as src_org, fi.fee, fi.fee_pct, fi.gross
      from app_private.fin_invoices fi
     where fi.status in ('sent','paid') and coalesce(fi.fee,0) > 0
       and exists (select 1 from app_private.referral_edges e where e.child_org = fi.carrier_id)
  loop
    -- bl_agent_0306 fix 1: the promised base is GROSS. Reconstruct it from the fee only
    -- when the invoice predates the gross column.
    v_base := coalesce(inv.gross, case when coalesce(inv.fee_pct,0) > 0 then inv.fee * 100.0 / inv.fee_pct end);
    continue when v_base is null or v_base <= 0;
    select r.* into v_ref from app_private.referral_edges e
      join app_private.referrers r on r.id = e.referrer_id
     where e.child_org = inv.src_org limit 1;
    v_lvl := 1;
    -- bl_agent_0306 fix 2: walk past inactive nodes instead of stopping the chain.
    while v_lvl <= 5 and v_ref.id is not null loop
      select pct into v_pct from app_private.referral_levels where level = v_lvl;
      exit when v_pct is null or v_pct <= 0;
      if v_ref.status = 'active' then
        insert into app_private.referral_commissions(invoice_id, trip_id, source_org, referrer_id, level, base_fee, pct, amount, payable_at)
        values (inv.id, inv.trip_id, inv.src_org, v_ref.id, v_lvl, inv.fee, v_pct,
                round(v_base * v_pct / 100.0, 2), now() + interval '15 days')
        on conflict (invoice_id, referrer_id) do nothing;
        get diagnostics v_ins = row_count; v_new := v_new + v_ins;
      end if;
      v_ref := app_private.referral_next(v_ref); v_lvl := v_lvl + 1;
    end loop;
  end loop;

  -- broker-side chains
  for inv in
    select fi.id, fi.trip_id, l.broker_org as src_org, fi.fee, fi.fee_pct, fi.gross
      from app_private.fin_invoices fi
      join app_private.trips t on t.id = fi.trip_id
      join public.loads l on l.id = t.load_id
     where fi.status in ('sent','paid') and coalesce(fi.fee,0) > 0 and l.broker_org is not null
       and exists (select 1 from app_private.referral_edges e where e.child_org = l.broker_org)
  loop
    v_base := coalesce(inv.gross, case when coalesce(inv.fee_pct,0) > 0 then inv.fee * 100.0 / inv.fee_pct end);
    continue when v_base is null or v_base <= 0;
    select r.* into v_ref from app_private.referral_edges e
      join app_private.referrers r on r.id = e.referrer_id
     where e.child_org = inv.src_org limit 1;
    v_lvl := 1;
    while v_lvl <= 5 and v_ref.id is not null loop
      select pct into v_pct from app_private.referral_levels where level = v_lvl;
      exit when v_pct is null or v_pct <= 0;
      if v_ref.status = 'active' then
        insert into app_private.referral_commissions(invoice_id, trip_id, source_org, referrer_id, level, base_fee, pct, amount, payable_at)
        values (inv.id, inv.trip_id, inv.src_org, v_ref.id, v_lvl, inv.fee, v_pct,
                round(v_base * v_pct / 100.0, 2), now() + interval '15 days')
        on conflict (invoice_id, referrer_id) do nothing;
        get diagnostics v_ins = row_count; v_new := v_new + v_ins;
      end if;
      v_ref := app_private.referral_next(v_ref); v_lvl := v_lvl + 1;
    end loop;
  end loop;

  -- bl_agent_0306 fix 4: clawback + revival (paid rows are never touched).
  update app_private.referral_commissions c set status = 'void'
   where c.status in ('accrued','payable')
     and exists (select 1 from app_private.fin_invoices fi
                  where fi.id = c.invoice_id and fi.status not in ('sent','paid'));
  get diagnostics v_voided = row_count;
  update app_private.referral_commissions c set status = 'accrued'
   where c.status = 'void'
     and exists (select 1 from app_private.fin_invoices fi
                  where fi.id = c.invoice_id and fi.status in ('sent','paid'));
  get diagnostics v_revived = row_count;

  -- bl_agent_0306 fix 3: pair rule gates PROMOTION (agent-program referrers only).
  update app_private.referral_commissions c set status = 'payable'
   where c.status = 'accrued' and c.payable_at <= now()
     and (not exists (select 1 from app_private.agent_profiles ap
                       join app_private.referrers r on r.user_id = ap.user_id
                      where r.id = c.referrer_id and ap.status = 'approved')
          or app_private.referrer_pair_active(c.referrer_id));
  get diagnostics v_promoted = row_count;

  perform app_private.log_audit('referral.accrue','system','referral',null,
    format('%s new, %s promoted, %s voided, %s revived', v_new, v_promoted, v_voided, v_revived), null);
  return jsonb_build_object('ok',true,'new_commissions',v_new,'promoted_payable',v_promoted,
                            'voided',v_voided,'revived',v_revived);
end; $fn$;

create or replace function app_private.referral_accrue_agent_loads()
returns integer language plpgsql security definer set search_path to 'app_private, public'
as $fn$
declare inv record; v_pct numeric; v_base numeric; v_new int := 0; v_ins int;
begin
  select pct into v_pct from app_private.referral_levels where level = 1;
  if coalesce(v_pct, 0) <= 0 then return 0; end if;
  for inv in
    select fi.id, fi.trip_id, l.broker_org as src_org, fi.fee, fi.fee_pct, fi.gross, r.id as ref_id
      from app_private.fin_invoices fi
      join app_private.trips t on t.id = fi.trip_id
      join public.loads l on l.id = t.load_id
      join public.organizations o on o.id = l.broker_org and o.kind <> 'carrier'
      join app_private.referrers r on r.user_id = o.owner_user_id and r.status = 'active'
      join app_private.agent_profiles ap on ap.user_id = r.user_id and ap.status = 'approved'
    where fi.status in ('sent','paid') and coalesce(fi.fee,0) > 0
      and not exists (select 1 from app_private.referral_commissions c
                       where c.invoice_id = fi.id and c.referrer_id = r.id)
  loop
    -- bl_agent_0306: pair gate REMOVED from insert time — the row lands immediately as
    -- accrued (the agent SEES their work), and the pair rule holds it at promotion.
    v_base := coalesce(inv.gross, case when coalesce(inv.fee_pct,0) > 0 then inv.fee * 100.0 / inv.fee_pct end);
    continue when v_base is null or v_base <= 0;
    insert into app_private.referral_commissions(invoice_id, trip_id, source_org, referrer_id, level, base_fee, pct, amount, payable_at)
    values (inv.id, inv.trip_id, inv.src_org, inv.ref_id, 1, inv.fee, v_pct,
            round(v_base * v_pct / 100.0, 2), now() + interval '15 days')
    on conflict (invoice_id, referrer_id) do nothing;
    get diagnostics v_ins = row_count; v_new := v_new + v_ins;
  end loop;
  return v_new;
end; $fn$;

-- Real-time: the invoice trigger now runs the WHOLE engine, not just the core paths.
create or replace function app_private.fire_referral_accrue()
returns trigger language plpgsql security definer set search_path to 'app_private, public'
as $fn$
begin
  if new.status in ('sent','paid') and coalesce(new.fee,0) > 0 then
    begin perform app_private.referral_accrue_all(); exception when others then null; end;
  end if;
  return new;
end; $fn$;
