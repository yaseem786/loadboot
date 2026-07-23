-- bl_ref_0142 — Referral goes STRAIGHT: remove the "active chain / pair" requirement.
-- Before: level-1 commissions only accrued if referrer_pair_active() (a referred CARRIER
--   plus referred demand). Now: a referrer earns 1% whenever ANY party they referred
--   (broker, shipper OR carrier) completes a transaction (a fin_invoice with a fee) —
--   no pairing required. Levels 2-5 overrides were already ungated. referrer_pair_active()
--   is left in place (unused) so this is fully reversible.
-- Applied to STAGING first.
create or replace function app_private.referral_accrue_core()
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $function$
declare inv record; v_ref app_private.referrers; v_lvl int; v_pct numeric; v_new int:=0; v_ins int; v_promoted int:=0;
begin
  for inv in
    select fi.id, fi.trip_id, fi.carrier_id as src_org, fi.fee from app_private.fin_invoices fi
    where fi.status in ('sent','paid') and coalesce(fi.fee,0) > 0
      and exists (select 1 from app_private.referral_edges e where e.child_org = fi.carrier_id)
  loop
    select r.* into v_ref from app_private.referral_edges e join app_private.referrers r on r.id=e.referrer_id where e.child_org = inv.src_org limit 1;
    v_lvl := 1;
    while v_lvl <= 5 and v_ref.id is not null and v_ref.status = 'active' loop
      select pct into v_pct from app_private.referral_levels where level = v_lvl;
      exit when v_pct is null or v_pct <= 0;
      insert into app_private.referral_commissions(invoice_id, trip_id, source_org, referrer_id, level, base_fee, pct, amount, payable_at)
        values (inv.id, inv.trip_id, inv.src_org, v_ref.id, v_lvl, inv.fee, v_pct,
                round(inv.fee * v_pct / 5.0, 2), now() + interval '15 days')
        on conflict (invoice_id, referrer_id) do nothing;
      get diagnostics v_ins = row_count; v_new := v_new + v_ins;
      v_ref := app_private.referral_next(v_ref); v_lvl := v_lvl + 1;
    end loop;
  end loop;
  for inv in
    select fi.id, fi.trip_id, l.broker_org as src_org, fi.fee
      from app_private.fin_invoices fi
      join app_private.trips t on t.id = fi.trip_id
      join public.loads l on l.id = t.load_id
    where fi.status in ('sent','paid') and coalesce(fi.fee,0) > 0 and l.broker_org is not null
      and exists (select 1 from app_private.referral_edges e where e.child_org = l.broker_org)
  loop
    select r.* into v_ref from app_private.referral_edges e join app_private.referrers r on r.id=e.referrer_id where e.child_org = inv.src_org limit 1;
    v_lvl := 1;
    while v_lvl <= 5 and v_ref.id is not null and v_ref.status = 'active' loop
      select pct into v_pct from app_private.referral_levels where level = v_lvl;
      exit when v_pct is null or v_pct <= 0;
      insert into app_private.referral_commissions(invoice_id, trip_id, source_org, referrer_id, level, base_fee, pct, amount, payable_at)
        values (inv.id, inv.trip_id, inv.src_org, v_ref.id, v_lvl, inv.fee, v_pct,
                round(inv.fee * v_pct / 5.0, 2), now() + interval '15 days')
        on conflict (invoice_id, referrer_id) do nothing;
      get diagnostics v_ins = row_count; v_new := v_new + v_ins;
      v_ref := app_private.referral_next(v_ref); v_lvl := v_lvl + 1;
    end loop;
  end loop;
  update app_private.referral_commissions set status='payable'
    where status='accrued' and payable_at <= now();
  get diagnostics v_promoted = row_count;
  perform app_private.log_audit('referral.accrue','system','referral',null,
    format('%s new commissions, %s promoted payable', v_new, v_promoted), null);
  return jsonb_build_object('ok',true,'new_commissions',v_new,'promoted_payable',v_promoted);
end; $function$;