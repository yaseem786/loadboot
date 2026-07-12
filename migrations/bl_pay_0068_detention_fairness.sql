-- bl_pay_0068 — DETENTION FAIRNESS + DISPUTE ORDER (owner review findings):
-- 1) 800m-geofence egress GRACE: exit ke 10 min free — facility ne 2h ke andar release
--    kiya to gate se nikalne ka waqt detention NAHI banta.
-- 2) Billing in 30-min blocks (industry norm), auto-file sirf >= 30 min par (no $1 junk claims),
--    detention capped at 6 billed hours/dwell (industry daily caps $200–400).
-- 3) DETENTION XOR LAYOVER: past-free hold >= 24h => LAYOVER only (per-day), warna detention
--    only — dono kabhi ek saath nahi.
-- 4) Har stop track hota hai (pickup/delivery/extra) — extra stop par stop_off flat fee
--    auto-file + wahi detention/layover logic us stop par bhi.
-- 5) Dispute ka sahi waqt: broker claim par sirf APPROVE/REJECT karta hai; DISPUTE carrier
--    ka haq hai jab APPROVED raqam waqt par pay na ho (pay_dispute).

insert into app_private.rate_standards(key, label, value, unit, version)
values
  ('detention_exit_grace_min', 'Geofence exit grace (not billed)', '10', 'min', 1),
  ('detention_cap_hours', 'Max billed detention per stop', '6', 'hours', 1),
  ('layover_after_hours', 'Hold becomes layover after', '24', 'hours', 1)
on conflict (key) do nothing;

-- one brain for "how much is this hold worth": grace → 30-min blocks → cap → or layover
create or replace function app_private.detention_bill(p_trip uuid, p_raw_past_free_min int)
 returns jsonb language plpgsql stable
 set search_path to 'app_private, public'
as $$
declare v_grace int := coalesce((select case when value ~ '^[0-9]+$' then value::int end from app_private.rate_standards where key='detention_exit_grace_min'), 10);
        v_cap_h int := coalesce((select case when value ~ '^[0-9]+$' then value::int end from app_private.rate_standards where key='detention_cap_hours'), 6);
        v_lay_h int := coalesce((select case when value ~ '^[0-9]+$' then value::int end from app_private.rate_standards where key='layover_after_hours'), 24);
        v_det_rate numeric := coalesce(app_private.claim_rate(p_trip, 'detention_per_hr'), 60);
        v_lay_rate numeric := coalesce(app_private.claim_rate(p_trip, 'layover_per_day'), 250);
        v_net int; v_billed int; v_days int;
begin
  v_net := greatest(coalesce(p_raw_past_free_min, 0) - v_grace, 0);
  if v_net >= v_lay_h * 60 then
    v_days := greatest(round(v_net / 1440.0)::int, 1);  -- 24.8h = 1 day, 36h+ = 2 (broker-fair rounding)
    return jsonb_build_object('kind', 'layover', 'layover_days', v_days,
      'amount', round(v_days * v_lay_rate, 2),
      'calc', 'held ' || round(v_net/60.0, 1) || 'h past free time (>= ' || v_lay_h || 'h) => LAYOVER: ' || v_days || ' day(s) × $' || v_lay_rate || '/day — detention does not apply (rate card agreed at posting)');
  elsif v_net >= 30 then
    v_billed := least((v_net / 30) * 30, v_cap_h * 60);
    return jsonb_build_object('kind', 'detention', 'detention_minutes', v_billed,
      'amount', round(v_billed / 60.0 * v_det_rate, 2),
      'calc', (v_billed / 60) || 'h ' || (v_billed % 60) || 'm billed (30-min blocks, ' || v_grace || ' min exit grace deducted, capped at ' || v_cap_h || 'h) × $' || v_det_rate || '/hr (rate card agreed at posting)');
  else
    return jsonb_build_object('kind', 'none', 'amount', 0,
      'calc', 'held ' || greatest(coalesce(p_raw_past_free_min,0),0) || ' min past free — under the ' || v_grace || '-min exit grace + 30-min minimum, not billable');
  end if;
end; $$;

-- claim_compute: detention/layover branches now route through detention_bill
create or replace function app_private.claim_compute(p_trip uuid, p_kind text, p_evidence jsonb, p_manual numeric default null)
 returns jsonb language plpgsql stable
 set search_path to 'app_private, public'
as $$
declare v_min int; v_rate numeric; v_days int; v_amt numeric := 0; v_calc text := ''; v_bill jsonb;
begin
  if p_kind = 'detention' then
    -- evidence detention_minutes = ALREADY-BILLED minutes (from the trigger); otherwise live raw dwell
    if nullif(p_evidence->>'detention_minutes','') is not null then
      v_min := (p_evidence->>'detention_minutes')::int;
      v_rate := coalesce(app_private.claim_rate(p_trip, 'detention_per_hr'), 60);
      v_amt := round(v_min / 60.0 * v_rate, 2);
      v_calc := coalesce(nullif(p_evidence->>'calc',''), (v_min / 60) || 'h ' || (v_min % 60) || 'm billed × $' || v_rate || '/hr (rate card agreed at posting)');
    else
      v_bill := app_private.detention_bill(p_trip,
        (select coalesce(sum(greatest(round(extract(epoch from (coalesce(d.departed_at, now()) - d.arrived_at))/60)::int - coalesce(d.free_minutes,0), 0)), 0)
           from app_private.trip_dwell_events d where d.trip_id = p_trip and d.arrived_at is not null));
      v_amt := (v_bill->>'amount')::numeric; v_calc := v_bill->>'calc';
    end if;
  elsif p_kind = 'layover' then
    v_rate := coalesce(app_private.claim_rate(p_trip, 'layover_per_day'), 250);
    v_days := greatest(coalesce(nullif(p_evidence->>'layover_days','')::int, 1), 1);
    v_amt := v_days * v_rate;
    v_calc := coalesce(nullif(p_evidence->>'calc',''), v_days || ' day(s) × $' || v_rate || '/day (rate card agreed at posting)');
  elsif p_kind = 'tonu' then
    v_rate := coalesce(app_private.claim_rate(p_trip, 'tonu'), 250);
    v_amt := v_rate; v_calc := 'flat TONU rate $' || v_rate || ' (rate card agreed at posting)';
  elsif p_kind = 'driver_assist' then
    v_rate := coalesce(app_private.claim_rate(p_trip, 'driver_assist'), 75);
    v_amt := v_rate; v_calc := 'flat driver-assist rate $' || v_rate || ' (rate card agreed at posting)';
  elsif p_kind = 'stop_off' then
    v_rate := coalesce(app_private.claim_rate(p_trip, 'stop_off'), 50);
    v_amt := v_rate; v_calc := 'flat extra-stop rate $' || v_rate || ' (rate card agreed at posting)';
  elsif p_kind = 'lumper' then
    v_amt := coalesce(p_manual, 0); v_calc := 'lumper receipt total — reimbursed with the receipt attached';
  else
    v_amt := coalesce(p_manual, 0); v_calc := 'amount entered by carrier — dispatch verifies against evidence';
  end if;
  return jsonb_build_object('amount', coalesce(v_amt, 0), 'calc', v_calc);
end; $$;

-- auto-trigger: grace + increments + XOR layover + extra-stop stop_off — never both
create or replace function app_private.trg_auto_detention()
 returns trigger language plpgsql
 set search_path to 'app_private', 'public'
as $function$
declare v_raw int; v_bill jsonb; v_kind text;
begin
  if new.departed_at is not null and old.departed_at is null then
    v_raw := greatest(floor(extract(epoch from (new.departed_at - new.arrived_at))/60)::int - new.free_minutes, 0);
    v_bill := app_private.detention_bill(new.trip_id, v_raw);
    v_kind := v_bill->>'kind';
    if v_kind in ('detention','layover') and not exists (
      select 1 from app_private.trip_accessorials
      where trip_id = new.trip_id and kind in ('detention','layover') and (evidence->>'dwell_id')::uuid = new.id
    ) then
      insert into app_private.trip_accessorials(trip_id, kind, amount, billable, note, created_by, status, evidence)
        values (new.trip_id, v_kind, (v_bill->>'amount')::numeric, false,
          'Auto-detected: held ' || v_raw || ' min past free time at ' || new.stop_type ||
          case when v_kind = 'layover' then ' — long hold, filed as LAYOVER (no detention)' else '' end,
          new.created_by, 'requested',
          app_private.trip_evidence_snapshot(new.trip_id) || jsonb_build_object(
            'dwell_id', new.id, 'raw_past_free_min', v_raw, 'auto', true, 'calc', v_bill->>'calc')
          || case when v_kind = 'detention' then jsonb_build_object('detention_minutes', (v_bill->>'detention_minutes')::int)
                  else jsonb_build_object('layover_days', (v_bill->>'layover_days')::int) end);
      begin
        insert into app_private.notifications(recipient_role, channel, template_key, payload)
          values ('staff', 'inapp', 'ops.accessorial.requested',
            jsonb_build_object('trip', new.trip_id, 'kind', v_kind, 'raw_minutes', v_raw, 'auto', true));
      exception when others then null; end;
    end if;
    -- extra stop (not pickup/delivery): flat stop-off files itself once per dwell
    if new.stop_type not in ('pickup','delivery') and not exists (
      select 1 from app_private.trip_accessorials
      where trip_id = new.trip_id and kind = 'stop_off' and (evidence->>'dwell_id')::uuid = new.id
    ) then
      insert into app_private.trip_accessorials(trip_id, kind, amount, billable, note, created_by, status, evidence)
        select new.trip_id, 'stop_off', (c2->>'amount')::numeric, false,
          'Auto-detected: extra stop served (' || new.stop_type || ')', new.created_by, 'requested',
          app_private.trip_evidence_snapshot(new.trip_id) || jsonb_build_object('dwell_id', new.id, 'auto', true, 'calc', c2->>'calc')
        from (select app_private.claim_compute(new.trip_id, 'stop_off', '{}'::jsonb) c2) z;
    end if;
  end if;
  return new;
end; $function$;

-- carrier's DISPUTE — the right one: approved money that never arrived
create or replace function public.pay_dispute(p_kind text, p_ref uuid, p_note text default null)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private', 'public'
as $$
declare t record; l record; a record; v_payee uuid; v_broker uuid; v_label text;
begin
  if p_kind = 'claim' then
    select * into a from app_private.trip_accessorials where id = p_ref;
    if a is null or a.broker_status is distinct from 'approved' then raise exception 'only approved, unpaid claims can be disputed' using errcode='22023'; end if;
    select * into t from app_private.trips where id = a.trip_id;
  elsif p_kind = 'freight' then
    select * into t from app_private.trips where id = p_ref;
    if t is null or t.status not in ('delivered','invoiced') then raise exception 'freight can be disputed after delivery' using errcode='22023'; end if;
  else
    raise exception 'kind must be claim or freight' using errcode='22023';
  end if;
  select * into l from public.loads where id = t.load_id;
  v_payee := t.carrier_id; v_broker := l.broker_org;
  if app_private.my_carrier_org() is distinct from v_payee then raise exception 'not authorized' using errcode='42501'; end if;
  update app_private.pay_transfers set status = 'disputed', note = coalesce(p_note, note)
   where kind = p_kind and ref_id = p_ref;
  v_label := case when p_kind = 'claim' then 'claim payment' else 'freight payment' end;
  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload)
      values ('staff', 'inapp', 'pay.dispute',
        jsonb_build_object('kind', p_kind, 'ref', p_ref, 'trip', t.id, 'note', p_note, 'carrier', v_payee, 'broker', v_broker));
  exception when others then null; end;
  begin
    perform app_private.notify_partner(v_broker, '⚠ Non-payment dispute filed',
      'The carrier reports the approved ' || v_label || ' has not arrived. ' || coalesce(p_note,'') ||
      ' LoadBoot support is reviewing — settle it or upload the payment receipt to resolve.', 'urgent', '/app/partner/#invoices');
  exception when others then null; end;
  perform app_private.log_audit('pay.dispute', 'trip', t.id::text, null, 'carrier disputed unpaid ' || v_label, jsonb_build_object('kind', p_kind, 'ref', p_ref));
  return jsonb_build_object('ok', true, 'note', 'Dispute filed — LoadBoot support and the broker are both notified. Keep the trip documents handy.');
end; $$;
revoke all on function public.pay_dispute(text, uuid, text) from public;
grant execute on function public.pay_dispute(text, uuid, text) to authenticated;

notify pgrst, 'reload schema';
