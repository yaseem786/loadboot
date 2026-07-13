-- bl_agent_0072 — AGENT PROGRAM engine upgrade (pair-based chains):
-- 1) PAIR RULE: a referrer's commissions accrue only once their chain is ACTIVE =
--    they have referred at least one CARRIER org AND one BROKER/SHIPPER org.
--    (Single-side referrals stay visible as "pending chain" — nothing accrues.)
-- 2) BROKER-SIDE EARNING: commissions now also accrue when a referred BROKER's load
--    delivers (same money source: the carrier's 5% fee invoice on that trip —
--    LoadBoot's own fee funds it; clients never pay extra; level-1 = 1% of gross).
--    One commission per (invoice, referrer) stays enforced by the unique index.
-- 3) agent_chain_status(): the agent dashboard feed — every referred org with side,
--    activity counts and commission totals, plus pair-active state.

create or replace function app_private.referrer_pair_active(p_ref uuid)
 returns boolean language sql stable
 set search_path to 'app_private, public'
as $$
  select exists (select 1 from app_private.referral_edges e join public.organizations o on o.id = e.child_org
                  where e.referrer_id = p_ref and o.kind = 'carrier')
     and exists (select 1 from app_private.referral_edges e join public.organizations o on o.id = e.child_org
                  where e.referrer_id = p_ref and o.kind <> 'carrier');
$$;

create or replace function app_private.referral_accrue_core()
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $function$
declare inv record; v_org uuid; v_ref record; v_lvl int; v_pct numeric; v_new int:=0; v_promoted int:=0;
begin
  -- CARRIER-side chains (referred carrier pays the fee invoice)
  for inv in
    select fi.id, fi.trip_id, fi.carrier_id as src_org, fi.fee from app_private.fin_invoices fi
    where fi.status in ('sent','paid') and coalesce(fi.fee,0) > 0
      and exists (select 1 from app_private.referral_edges e where e.child_org = fi.carrier_id)
  loop
    v_org := inv.src_org; v_lvl := 1;
    while v_lvl <= 5 loop
      select r.* into v_ref from app_private.referral_edges e join app_private.referrers r on r.id=e.referrer_id
        where e.child_org = v_org;
      exit when v_ref.id is null or v_ref.status <> 'active';
      select pct into v_pct from app_private.referral_levels where level = v_lvl;
      exit when v_pct is null or v_pct <= 0;
      if app_private.referrer_pair_active(v_ref.id) then
        insert into app_private.referral_commissions(invoice_id, trip_id, source_org, referrer_id, level, base_fee, pct, amount, payable_at)
          values (inv.id, inv.trip_id, inv.src_org, v_ref.id, v_lvl, inv.fee, v_pct,
                  round(inv.fee * v_pct / 5.0, 2), now() + interval '15 days')
          on conflict (invoice_id, referrer_id) do nothing;
        v_new := v_new + 1;
      end if;
      exit when v_ref.org_id is null;
      v_org := v_ref.org_id; v_lvl := v_lvl + 1;
    end loop;
  end loop;
  -- BROKER-side chains (referred broker's load delivered; fee comes from that trip's carrier invoice)
  for inv in
    select fi.id, fi.trip_id, l.broker_org as src_org, fi.fee
      from app_private.fin_invoices fi
      join app_private.trips t on t.id = fi.trip_id
      join public.loads l on l.id = t.load_id
    where fi.status in ('sent','paid') and coalesce(fi.fee,0) > 0 and l.broker_org is not null
      and exists (select 1 from app_private.referral_edges e where e.child_org = l.broker_org)
  loop
    v_org := inv.src_org; v_lvl := 1;
    while v_lvl <= 5 loop
      select r.* into v_ref from app_private.referral_edges e join app_private.referrers r on r.id=e.referrer_id
        where e.child_org = v_org;
      exit when v_ref.id is null or v_ref.status <> 'active';
      select pct into v_pct from app_private.referral_levels where level = v_lvl;
      exit when v_pct is null or v_pct <= 0;
      if app_private.referrer_pair_active(v_ref.id) then
        insert into app_private.referral_commissions(invoice_id, trip_id, source_org, referrer_id, level, base_fee, pct, amount, payable_at)
          values (inv.id, inv.trip_id, inv.src_org, v_ref.id, v_lvl, inv.fee, v_pct,
                  round(inv.fee * v_pct / 5.0, 2), now() + interval '15 days')
          on conflict (invoice_id, referrer_id) do nothing;
        v_new := v_new + 1;
      end if;
      exit when v_ref.org_id is null;
      v_org := v_ref.org_id; v_lvl := v_lvl + 1;
    end loop;
  end loop;
  update app_private.referral_commissions set status='payable'
    where status='accrued' and payable_at <= now();
  get diagnostics v_promoted = row_count;
  perform app_private.log_audit('referral.accrue','system','referral',null,
    format('%s new commissions, %s promoted payable', v_new, v_promoted), null);
  return jsonb_build_object('ok',true,'new_commissions',v_new,'promoted_payable',v_promoted,
    'note','pair-gated; broker+carrier sides; amounts come out of LoadBoot''s own fee — clients never pay extra');
end; $function$;

-- ---------- the agent's LIVE chain feed ----------
create or replace function public.agent_chain_status()
 returns jsonb language plpgsql stable security definer
 set search_path to 'app_private, public'
as $$
declare v_ref record;
begin
  select r.* into v_ref from app_private.referrers r
   where r.user_id = auth.uid() or (r.org_id is not null and r.org_id in (app_private.my_carrier_org(), app_private.my_partner_org()))
   order by r.created_at limit 1;
  if v_ref.id is null then return jsonb_build_object('has_code', false); end if;
  return jsonb_build_object(
    'has_code', true, 'code', v_ref.code,
    'link', 'https://loadboot.com/?ref=' || v_ref.code,
    'pair_active', app_private.referrer_pair_active(v_ref.id),
    'referred', coalesce((select jsonb_agg(jsonb_build_object(
        'org', o.name, 'side', case when o.kind = 'carrier' then 'carrier' else 'broker/shipper' end,
        'status', o.status, 'joined_at', e.created_at,
        'loads_posted', (select count(*) from public.loads l where l.broker_org = o.id),
        'trips_delivered', (select count(*) from app_private.trips t where (t.carrier_id = o.id or exists (select 1 from public.loads l2 where l2.id = t.load_id and l2.broker_org = o.id)) and t.status in ('delivered','invoiced')),
        'your_earnings', coalesce((select sum(c.amount) from app_private.referral_commissions c where c.referrer_id = v_ref.id and c.source_org = o.id), 0)
      ) order by e.created_at desc)
      from app_private.referral_edges e join public.organizations o on o.id = e.child_org
      where e.referrer_id = v_ref.id), '[]'::jsonb),
    'totals', (select jsonb_build_object(
        'accrued', coalesce(sum(amount) filter (where status = 'accrued'), 0),
        'payable', coalesce(sum(amount) filter (where status = 'payable'), 0),
        'paid', coalesce(sum(amount) filter (where status = 'paid'), 0))
      from app_private.referral_commissions where referrer_id = v_ref.id));
end; $$;
revoke all on function public.agent_chain_status() from public;
grant execute on function public.agent_chain_status() to authenticated;

notify pgrst, 'reload schema';
