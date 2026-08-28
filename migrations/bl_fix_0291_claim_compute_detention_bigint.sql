-- bl_fix_0291 — app_private.claim_compute: the detention auto-path passed sum(int) (= bigint) to
-- detention_bill(uuid, integer) → "function app_private.detention_bill(uuid, bigint) does not exist".
-- Every carrier detention claim that did not carry an explicit detention_minutes failed with a 500.
-- Found 28 Aug while wiring dispatcher trip tools; identical bytes on prod. One cast, nothing else.
-- Applied on STAGING 28 Aug. Apply to PROD.
create or replace function app_private.claim_compute(p_trip uuid, p_kind text, p_evidence jsonb, p_manual numeric default null::numeric)
returns jsonb language plpgsql stable set search_path = app_private, public as $$
declare v_min int; v_rate numeric; v_days int; v_amt numeric := 0; v_calc text := ''; v_bill jsonb;
begin
  if p_kind = 'detention' then
    if nullif(p_evidence->>'detention_minutes','') is not null then
      v_min := (p_evidence->>'detention_minutes')::int;
      v_rate := coalesce(app_private.claim_rate(p_trip, 'detention_per_hr'), 60);
      v_amt := round(v_min / 60.0 * v_rate, 2);
      v_calc := coalesce(nullif(p_evidence->>'calc',''), (v_min / 60) || 'h ' || (v_min % 60) || 'm billed × $' || v_rate || '/hr (rate card agreed at posting)');
    else
      v_bill := app_private.detention_bill(p_trip,
        (select coalesce(sum(greatest(round(extract(epoch from (coalesce(d.departed_at, now()) - d.arrived_at))/60)::int - coalesce(d.free_minutes,0), 0)), 0)::int
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
