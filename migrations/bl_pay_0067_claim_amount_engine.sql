-- bl_pay_0067 — CLAIM AMOUNT ENGINE: every claim carries a REAL dollar amount, computed
-- live from the rate card agreed at load posting (loads.accessorials overrides) with
-- LoadBoot rate_standards as the fallback — plus a human-readable "calc" breakdown.
-- Fixes: auto-detention/TONU filed with $0/null; carrier claims filed with $0.
-- Adds: driver_assist + stop_off claim kinds; lumper takes the receipt total.

-- numeric rate with per-load override (loads.accessorials ->> key beats rate_standards)
create or replace function app_private.claim_rate(p_trip uuid, p_key text)
 returns numeric language sql stable
 set search_path to 'app_private, public'
as $$
  select coalesce(
    (select case when (l.accessorials->>p_key) ~ '^[0-9]+(\.[0-9]+)?$' then (l.accessorials->>p_key)::numeric end
       from app_private.trips t join public.loads l on l.id = t.load_id where t.id = p_trip),
    (select case when value ~ '^[0-9]+(\.[0-9]+)?$' then value::numeric end
       from app_private.rate_standards where key = p_key));
$$;

-- amount + human breakdown for any claim kind (real-time: open dwells count up to now())
create or replace function app_private.claim_compute(p_trip uuid, p_kind text, p_evidence jsonb, p_manual numeric default null)
 returns jsonb language plpgsql stable
 set search_path to 'app_private, public'
as $$
declare v_min int; v_rate numeric; v_days int; v_amt numeric := 0; v_calc text := '';
begin
  if p_kind = 'detention' then
    v_rate := coalesce(app_private.claim_rate(p_trip, 'detention_per_hr'), 60);
    v_min := coalesce(nullif(p_evidence->>'detention_minutes','')::int,
      (select coalesce(sum(greatest(round(extract(epoch from (coalesce(d.departed_at, now()) - d.arrived_at))/60)::int - coalesce(d.free_minutes,0), 0)), 0)
         from app_private.trip_dwell_events d where d.trip_id = p_trip and d.arrived_at is not null));
    v_amt := round(v_min / 60.0 * v_rate, 2);
    v_calc := (v_min / 60) || 'h ' || (v_min % 60) || 'm past free time × $' || v_rate || '/hr (rate card agreed at posting)';
  elsif p_kind = 'layover' then
    v_rate := coalesce(app_private.claim_rate(p_trip, 'layover_per_day'), 250);
    v_days := greatest(coalesce(nullif(p_evidence->>'layover_days','')::int, 1), 1);
    v_amt := v_days * v_rate;
    v_calc := v_days || ' day(s) × $' || v_rate || '/day (rate card agreed at posting)';
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

-- auto-detention now files with the REAL computed amount + calc
create or replace function app_private.trg_auto_detention()
 returns trigger language plpgsql
 set search_path to 'app_private', 'public'
as $function$
declare v_det int; v_cc jsonb;
begin
  if new.departed_at is not null and old.departed_at is null then
    v_det := greatest(floor(extract(epoch from (new.departed_at - new.arrived_at))/60)::int - new.free_minutes, 0);
    if v_det > 0 and not exists (
      select 1 from app_private.trip_accessorials
      where trip_id = new.trip_id and kind = 'detention' and (evidence->>'dwell_id')::uuid = new.id
    ) then
      v_cc := app_private.claim_compute(new.trip_id, 'detention', jsonb_build_object('detention_minutes', v_det));
      insert into app_private.trip_accessorials(trip_id, kind, amount, billable, note, created_by, status, evidence)
        values (new.trip_id, 'detention', (v_cc->>'amount')::numeric, false,
          'Auto-detected: ' || v_det || ' min past free time at ' || new.stop_type, new.created_by, 'requested',
          app_private.trip_evidence_snapshot(new.trip_id) || jsonb_build_object('dwell_id', new.id, 'detention_minutes', v_det, 'auto', true, 'calc', v_cc->>'calc'));
      begin
        insert into app_private.notifications(recipient_role, channel, template_key, payload)
          values ('staff', 'inapp', 'ops.accessorial.requested',
            jsonb_build_object('trip', new.trip_id, 'kind', 'detention', 'minutes', v_det, 'auto', true));
      exception when others then null; end;
    end if;
  end if;
  return new;
end; $function$;

-- auto-TONU now files with the flat rate-card amount + calc
create or replace function app_private.trg_auto_tonu()
 returns trigger language plpgsql
 set search_path to 'app_private', 'public'
as $function$
declare v_cc jsonb;
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and coalesce(new.cancelled_by,'') not in ('carrier','broker')
     and (old.status in ('dispatched','in_transit') or new.started_at is not null
          or exists (select 1 from app_private.trip_dwell_events d where d.trip_id = new.id and d.stop_type = 'pickup'))
     and not exists (select 1 from app_private.trip_accessorials a where a.trip_id = new.id and a.kind = 'tonu') then
    v_cc := app_private.claim_compute(new.id, 'tonu', '{}'::jsonb);
    insert into app_private.trip_accessorials(trip_id, kind, amount, billable, note, created_by, status, evidence)
      values (new.id, 'tonu', (v_cc->>'amount')::numeric, false,
        'Auto-detected: load cancelled after truck was committed (TONU review)', new.created_by, 'requested',
        app_private.trip_evidence_snapshot(new.id) || jsonb_build_object('auto', true, 'cancelled_from', old.status, 'calc', v_cc->>'calc'));
    begin insert into app_private.notifications(recipient_role, channel, template_key, payload)
      values ('staff', 'inapp', 'ops.accessorial.requested', jsonb_build_object('trip', new.id, 'kind', 'tonu', 'auto', true));
    exception when others then null; end;
  end if;
  return new;
end; $function$;

-- carrier claim filing: real amounts, new kinds, lumper takes the receipt total
drop function if exists public.cc_carrier_request_accessorial(uuid, text, text);
create or replace function public.cc_carrier_request_accessorial(p_trip uuid, p_kind text, p_note text default null, p_amount numeric default null)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private', 'public'
as $function$
declare v_id uuid; v_ev jsonb; v_cc jsonb;
begin
  if p_kind not in ('detention','layover','tonu','lumper','driver_assist','stop_off','other') then
    raise exception 'kind must be detention, layover, tonu, lumper, driver_assist, stop_off or other' using errcode='22023';
  end if;
  if not app_private.can_touch_trip(p_trip) then raise exception 'not authorized' using errcode='42501'; end if;
  if p_kind in ('lumper','other') and coalesce(p_amount, 0) <= 0 then
    raise exception 'enter the receipt total (dollar amount) for this claim' using errcode='22023';
  end if;
  v_ev := app_private.trip_evidence_snapshot(p_trip);
  v_cc := app_private.claim_compute(p_trip, p_kind, v_ev, p_amount);
  insert into app_private.trip_accessorials(trip_id, kind, amount, billable, note, created_by, status, evidence)
    values (p_trip, p_kind, (v_cc->>'amount')::numeric, false, p_note, auth.uid(), 'requested', v_ev || jsonb_build_object('calc', v_cc->>'calc'))
    returning id into v_id;
  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload)
      values ('staff', 'inapp', 'ops.accessorial.requested',
        jsonb_build_object('trip', p_trip, 'kind', p_kind, 'accessorial', v_id, 'note', p_note, 'amount', v_cc->>'amount'));
  exception when others then null; end;
  begin
    perform app_private.notify_partner(l2.broker_org, '💰 New ' || p_kind || ' claim on your load',
      coalesce(p_note,'') || '  Amount $' || (v_cc->>'amount') || ' per the agreed rate card. GPS arrive/depart evidence attached — review and approve or dispute in your portal.', 'warning', '/app/partner/#claims')
    from (select 1) z, app_private.trips t2 join public.loads l2 on l2.id = t2.load_id where t2.id = p_trip;
  exception when others then null; end;
  perform app_private.log_audit('dispatch.accessorial.request','trip',p_trip::text,null, p_kind || ' claim filed by carrier', jsonb_build_object('id', v_id));
  perform app_private.emit_event('trip.accessorial.requested','trip',p_trip::text, jsonb_build_object('kind', p_kind, 'id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'requested', 'amount', (v_cc->>'amount')::numeric, 'calc', v_cc->>'calc', 'evidence', v_ev,
    'note', 'Claim filed at $' || (v_cc->>'amount') || ' (' || (v_cc->>'calc') || ') with your GPS arrive/depart evidence.');
end; $function$;
revoke all on function public.cc_carrier_request_accessorial(uuid, text, text, numeric) from public;
grant execute on function public.cc_carrier_request_accessorial(uuid, text, text, numeric) to authenticated;

-- backfill: every $0/null claim gets its computed amount + calc
update app_private.trip_accessorials a
   set amount = (app_private.claim_compute(a.trip_id, a.kind, a.evidence, nullif(coalesce(a.amount,0),0))->>'amount')::numeric,
       evidence = coalesce(a.evidence, '{}'::jsonb) || jsonb_build_object('calc', app_private.claim_compute(a.trip_id, a.kind, a.evidence, nullif(coalesce(a.amount,0),0))->>'calc')
 where coalesce(a.amount, 0) = 0 and a.status <> 'rejected';

notify pgrst, 'reload schema';
