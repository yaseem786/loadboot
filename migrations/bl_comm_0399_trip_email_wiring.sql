-- ============================================================================
-- bl_comm_0399 — Pack A (Loads & trips): wire the 14 planned trip emails.
-- Applied to STAGING and PRODUCTION on 22 Sep 2026.
--
-- CORRECTION to claude/EMAIL-WIRING-PLAN-0399.md section 7: POD and the
-- detention clock already exist. POD  = app_private.document_files
-- (owner_type='trip', kind='pod'); arrival/departure = app_private.trip_dwell_events
-- (cc_trip_arrive / cc_trip_arrive_gps / cc_trip_depart, already in api.js).
-- So this migration creates NO new state tables. Send history and every cap /
-- stop condition are read back out of app_private.message_deliveries by
-- idempotency_key, which sys_email already writes and de-duplicates on.
--
-- Every key here is switched to send_mode='test' — real mail only after the
-- owner flips it to Live in Command Center -> Email catalog.
-- ============================================================================

-- ---------------------------------------------------------------- helpers --

create or replace function app_private.trip_mail_ctx(p_trip uuid)
returns jsonb
language sql stable
set search_path to 'app_private', 'public'
as $$
  select jsonb_build_object(
    'trip',           t.id,
    'load',           t.load_id,
    'lane',           coalesce(l.origin,'?') || ' -> ' || coalesce(l.destination,'?'),
    'status',         t.status,
    'driver',         coalesce(t.driver_name,''),
    'truck',          coalesce(t.truck_no,''),
    'sched_pickup',   t.scheduled_pickup,
    'sched_delivery', t.scheduled_delivery,
    'delivered_at',   t.delivered_at,
    'carrier_org',    t.carrier_id,
    'broker_org',     l.broker_org,
    'carrier_email',  cp.email,
    'broker_email',   bp.email,
    'demo',           coalesce(cg.is_demo,false) or coalesce(bg.is_demo,false)
  )
  from app_private.trips t
  left join public.loads         l  on l.id  = t.load_id
  left join public.organizations cg on cg.id = t.carrier_id
  left join public.profiles      cp on cp.id = cg.owner_user_id
  left join public.organizations bg on bg.id = l.broker_org
  left join public.profiles      bp on bp.id = bg.owner_user_id
  where t.id = p_trip;
$$;

comment on function app_private.trip_mail_ctx(uuid) is
  'bl_comm_0399 — recipients + lane for one trip. demo=true means never mail.';

create or replace function app_private.mail_sent_count(p_key text, p_prefix text)
returns integer
language sql stable
set search_path to 'app_private', 'public'
as $$
  select count(*)::int
    from app_private.message_deliveries
   where template_key = p_key
     and idempotency_key like p_prefix || '%';
$$;

comment on function app_private.mail_sent_count(text,text) is
  'bl_comm_0399 — how many times this email already went out under an idem prefix. This is what enforces every cap; message_deliveries is the only send history.';

create or replace function app_private.trip_mail_html(p_head text, p_lane text, p_body text)
returns text
language sql immutable
as $$
  select '<h2>' || p_head || '</h2>'
      || '<p style="font-weight:600;margin:0 0 12px">' || coalesce(p_lane,'') || '</p>'
      || coalesce(p_body,'');
$$;

create or replace function app_private.trip_mail(
  p_trip uuid, p_key text, p_side text,
  p_subject text, p_html text, p_idem text)
returns boolean
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $$
declare c jsonb; v_to text;
begin
  c := app_private.trip_mail_ctx(p_trip);
  if c is null then return false; end if;
  if coalesce((c->>'demo')::boolean,false) then return false; end if;

  v_to := case when p_side = 'broker' then c->>'broker_email' else c->>'carrier_email' end;
  if coalesce(btrim(coalesce(v_to,'')),'') = '' then return false; end if;

  begin
    perform app_private.sys_email(v_to, p_key, p_subject, p_html, null,
                                  p_idem || ':' || left(p_side,1));
  exception when others then
    return false;
  end;
  return true;
end $$;

comment on function app_private.trip_mail(uuid,text,text,text,text,text) is
  'bl_comm_0399 — one trip email to one side (carrier|broker). Demo orgs are skipped. Never raises.';

-- ------------------------------------------------------- event senders ----

-- POD reviewed (approved / rejected) -----------------------------------------
create or replace function app_private.trg_comm_pod_reviewed()
returns trigger
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $$
declare c jsonb; v_trip uuid;
begin
  if new.kind is distinct from 'pod' then return new; end if;
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('approved','rejected') then return new; end if;

  begin v_trip := new.owner_id::uuid; exception when others then return new; end;
  if new.owner_type is distinct from 'trip' then return new; end if;

  c := app_private.trip_mail_ctx(v_trip);
  if c is null then return new; end if;

  if new.status = 'approved' then
    perform app_private.trip_mail(v_trip, 'tx.pod_approved', 'carrier',
      'POD approved - ' || (c->>'lane'),
      app_private.trip_mail_html('Your POD is approved', c->>'lane',
        '<p>We have accepted the proof of delivery for this trip. Nothing else is needed from you'
        || ' - the invoice for this load can now be raised.</p>'),
      'podrev:' || new.id::text || ':a');
  else
    perform app_private.trip_mail(v_trip, 'tx.pod_rejected', 'carrier',
      'POD needs correcting - ' || (c->>'lane'),
      app_private.trip_mail_html('Your POD could not be accepted', c->>'lane',
        '<p><strong>Reason:</strong> '
        || coalesce(nullif(btrim(coalesce(new.review_note,'')),''), 'no reason recorded')
        || '</p><p>Please upload a corrected proof of delivery from the trip screen.'
        || ' The invoice stays on hold until an acceptable POD is on file.</p>'),
      'podrev:' || new.id::text || ':r');
  end if;
  return new;
end $$;

drop trigger if exists comm_pod_reviewed on app_private.document_files;
create trigger comm_pod_reviewed
  after update on app_private.document_files
  for each row execute function app_private.trg_comm_pod_reviewed();

-- Detention opened (an arrival is recorded) ----------------------------------
create or replace function app_private.trg_comm_dwell_arrived()
returns trigger
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $$
declare c jsonb; v_free text; v_ends text; v_stop text;
begin
  if new.arrived_at is null then return new; end if;
  c := app_private.trip_mail_ctx(new.trip_id);
  if c is null then return new; end if;

  v_stop := coalesce(new.stop_type,'stop');
  v_free := coalesce(new.free_minutes,120)::text;
  v_ends := to_char(new.arrived_at + (coalesce(new.free_minutes,120) || ' minutes')::interval,
                    'YYYY-MM-DD HH24:MI') || ' UTC';

  perform app_private.trip_mail(new.trip_id, 'tx.detention_opened', 'carrier',
    'Arrival recorded at ' || v_stop || ' - ' || (c->>'lane'),
    app_private.trip_mail_html('Detention clock started', c->>'lane',
      '<p>We logged your arrival at the <strong>' || v_stop || '</strong> on '
      || to_char(new.arrived_at,'YYYY-MM-DD HH24:MI') || ' UTC.</p>'
      || '<p>Free time on this stop is <strong>' || v_free || ' minutes</strong> and ends at '
      || v_ends || '. Mark departure as soon as you roll - detention is only billable'
      || ' with an arrival and a departure on file.</p>'),
    'detopen:' || new.id::text);

  perform app_private.trip_mail(new.trip_id, 'tx.detention_opened', 'broker',
    'Carrier arrived at ' || v_stop || ' - ' || (c->>'lane'),
    app_private.trip_mail_html('Carrier has arrived', c->>'lane',
      '<p>The carrier arrived at the <strong>' || v_stop || '</strong> on '
      || to_char(new.arrived_at,'YYYY-MM-DD HH24:MI') || ' UTC. Free time is '
      || v_free || ' minutes and ends at ' || v_ends || '.</p>'
      || '<p>If the facility can load or unload before then, no detention accrues.</p>'),
    'detopen:' || new.id::text);

  return new;
end $$;

drop trigger if exists comm_dwell_arrived on app_private.trip_dwell_events;
create trigger comm_dwell_arrived
  after insert on app_private.trip_dwell_events
  for each row execute function app_private.trg_comm_dwell_arrived();

-- Trip exception logged (breakdown / accident / everything else) --------------
create or replace function app_private.trg_comm_trip_exception()
returns trigger
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $$
declare c jsonb; v_key text; v_head text; v_desc text;
begin
  c := app_private.trip_mail_ctx(new.trip_id);
  if c is null then return new; end if;

  v_key := case new.kind
             when 'breakdown' then 'tx.trip_breakdown'
             when 'accident'  then 'tx.trip_accident'
             else 'tx.trip_exception_update' end;
  v_head := case new.kind
             when 'breakdown' then 'Breakdown reported on this load'
             when 'accident'  then 'Accident reported on this load'
             when 'weather'   then 'Weather delay on this load'
             when 'missed_appointment' then 'Appointment missed on this load'
             when 'delay'     then 'Delay reported on this load'
             else 'Update on this load' end;
  v_desc := coalesce(nullif(btrim(coalesce(new.description,'')),''), 'No further detail was recorded.');

  perform app_private.trip_mail(new.trip_id, v_key, 'carrier',
    v_head || ' - ' || (c->>'lane'),
    app_private.trip_mail_html(v_head, c->>'lane',
      '<p>' || v_desc || '</p><p>Our dispatch desk is on it. Reply to this email if anything'
      || ' in the detail above is wrong.</p>'),
    'tripexc:' || new.id::text);

  perform app_private.trip_mail(new.trip_id, v_key, 'broker',
    v_head || ' - ' || (c->>'lane'),
    app_private.trip_mail_html(v_head, c->>'lane',
      '<p>' || v_desc || '</p><p>We will send an update as soon as the position changes.'
      || ' Reply to this email if you need the appointment moved.</p>'),
    'tripexc:' || new.id::text);

  return new;
end $$;

drop trigger if exists comm_trip_exception on app_private.trip_exceptions;
create trigger comm_trip_exception
  after insert on app_private.trip_exceptions
  for each row execute function app_private.trg_comm_trip_exception();

-- Accessorial added: lumper / TONU / layover ---------------------------------
-- (detention accessorials are deliberately silent here - the detention mails
--  are driven by trip_dwell_events so the two paths cannot double-send.)
create or replace function app_private.trg_comm_accessorial()
returns trigger
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $$
declare c jsonb; v_key text; v_head text; v_amt text; v_note text;
begin
  v_key := case new.kind
             when 'lumper'  then 'tx.load_lumper_request'
             when 'tonu'    then 'tx.load_tonu'
             when 'layover' then 'tx.trip_layover'
             else null end;
  if v_key is null then return new; end if;

  c := app_private.trip_mail_ctx(new.trip_id);
  if c is null then return new; end if;

  v_amt  := case when coalesce(new.amount,0) > 0
                 then '<p><strong>Amount:</strong> $' || to_char(new.amount,'FM999999990.00') || '</p>'
                 else '' end;
  v_note := case when coalesce(btrim(coalesce(new.note,'')),'') <> ''
                 then '<p>' || new.note || '</p>' else '' end;

  if new.kind = 'tonu' then
    v_head := 'Truck order not used (TONU)';
    perform app_private.trip_mail(new.trip_id, v_key, 'carrier',
      'TONU logged - ' || (c->>'lane'),
      app_private.trip_mail_html(v_head, c->>'lane',
        '<p>This load was cancelled on the pickup date after you were dispatched, so a'
        || ' truck-order-not-used charge has been logged in your favour.</p>' || v_amt || v_note
        || '<p>It will appear on your next settlement once it is approved.</p>'),
      'acc:' || new.id::text);
    perform app_private.trip_mail(new.trip_id, v_key, 'broker',
      'TONU logged - ' || (c->>'lane'),
      app_private.trip_mail_html(v_head, c->>'lane',
        '<p>This load was cancelled on the pickup date after the carrier was dispatched,'
        || ' so a TONU has been logged against it.</p>' || v_amt || v_note
        || '<p>Reply to this email if you dispute the charge.</p>'),
      'acc:' || new.id::text);

  elsif new.kind = 'lumper' then
    v_head := 'Lumper fee on this load';
    perform app_private.trip_mail(new.trip_id, v_key, 'carrier',
      'Lumper fee logged - ' || (c->>'lane'),
      app_private.trip_mail_html(v_head, c->>'lane',
        '<p>A lumper fee has been logged against this load. Keep the receipt - reimbursement'
        || ' needs it.</p>' || v_amt || v_note),
      'acc:' || new.id::text);
    perform app_private.trip_mail(new.trip_id, v_key, 'broker',
      'Lumper reimbursement request - ' || (c->>'lane'),
      app_private.trip_mail_html('Lumper reimbursement request', c->>'lane',
        '<p>The facility charged a lumper fee on this load and we are requesting'
        || ' reimbursement.</p>' || v_amt || v_note
        || '<p>The receipt is attached to the trip in your portal.</p>'),
      'acc:' || new.id::text);

  else
    v_head := 'Layover on this load';
    perform app_private.trip_mail(new.trip_id, v_key, 'carrier',
      'Layover logged - ' || (c->>'lane'),
      app_private.trip_mail_html(v_head, c->>'lane',
        '<p>A layover has been logged on this load.</p>' || v_amt || v_note),
      'acc:' || new.id::text);
    perform app_private.trip_mail(new.trip_id, v_key, 'broker',
      'Layover logged - ' || (c->>'lane'),
      app_private.trip_mail_html(v_head, c->>'lane',
        '<p>The truck is on layover for this load.</p>' || v_amt || v_note
        || '<p>Reply to this email if the appointment can be pulled forward.</p>'),
      'acc:' || new.id::text);
  end if;

  return new;
end $$;

drop trigger if exists comm_accessorial on app_private.trip_accessorials;
create trigger comm_accessorial
  after insert on app_private.trip_accessorials
  for each row execute function app_private.trg_comm_accessorial();

-- ------------------------------------------------------------- the cron ----
-- Everything time-based: POD chase, delivery reminder, check-in nudge,
-- stale tracking, detention accrual. Runs every 15 minutes.

create or replace function app_private.cron_trip_comm()
returns integer
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $$
declare r record; c jsonb; n int := 0; v_stage int; v_hrs numeric; v_idem text; v_n int;
begin
  ---------------------------------------------------------------- POD chase --
  -- 4h / 12h / 24h after delivery while no POD has been submitted.
  for r in
    select t.id, t.delivered_at
      from app_private.trips t
     where t.status = 'delivered'
       and t.delivered_at is not null
       and t.delivered_at > now() - interval '7 days'
       and not exists (
             select 1 from app_private.document_files d
              where d.owner_type = 'trip' and d.owner_id = t.id::text
                and d.kind = 'pod' and coalesce(d.status,'pending') in ('pending','approved'))
  loop
    v_hrs := extract(epoch from (now() - r.delivered_at)) / 3600.0;
    v_stage := case when v_hrs >= 24 then 3 when v_hrs >= 12 then 2 when v_hrs >= 4 then 1 else 0 end;
    continue when v_stage = 0;
    v_idem := 'podchase:' || r.id::text || ':' || v_stage::text;
    continue when app_private.mail_sent_count('tx.pod_required', v_idem) > 0;

    c := app_private.trip_mail_ctx(r.id);
    continue when c is null;

    if app_private.trip_mail(r.id, 'tx.pod_required', 'carrier',
        case v_stage when 3 then 'POD still missing (24h) - ' when 2 then 'POD reminder - '
                     else 'POD needed - ' end || (c->>'lane'),
        app_private.trip_mail_html(
          case v_stage when 3 then 'We still have no POD for this load'
                       when 2 then 'Still waiting on your POD'
                       else 'Proof of delivery needed' end,
          c->>'lane',
          '<p>This load was delivered on '
          || to_char(r.delivered_at,'YYYY-MM-DD HH24:MI') || ' UTC and we have no proof of'
          || ' delivery on file yet. Upload it from the trip screen in your portal.</p>'
          || case v_stage
               when 3 then '<p><strong>This load is now flagged to our desk.</strong> The invoice'
                        || ' cannot be raised and payment cannot start until the POD is in.</p>'
               when 2 then '<p>The invoice for this load is on hold until the POD is in.</p>'
               else '<p>Getting it in early is what keeps payment on schedule.</p>' end),
        v_idem)
    then n := n + 1; end if;
  end loop;

  ------------------------------------------------------- delivery reminder --
  -- 12h before the scheduled delivery, once per trip.
  for r in
    select t.id
      from app_private.trips t
     where t.status in ('dispatched','in_transit')
       and t.delivered_at is null
       and t.scheduled_delivery is not null
       and t.scheduled_delivery between now() and now() + interval '12 hours'
  loop
    v_idem := 'delivrem:' || r.id::text;
    continue when app_private.mail_sent_count('tx.trip_delivery_reminder', v_idem) > 0;
    c := app_private.trip_mail_ctx(r.id);
    continue when c is null;

    if app_private.trip_mail(r.id, 'tx.trip_delivery_reminder', 'carrier',
        'Delivery due in under 12 hours - ' || (c->>'lane'),
        app_private.trip_mail_html('Delivery is coming up', c->>'lane',
          '<p>Scheduled delivery: <strong>'
          || to_char((c->>'sched_delivery')::timestamptz,'YYYY-MM-DD HH24:MI') || ' UTC</strong>.</p>'
          || '<p>Two things save a claim later: mark arrival when you reach the receiver, and'
          || ' upload the signed POD before you leave the dock.</p>'),
        v_idem)
    then n := n + 1; end if;
  end loop;

  -------------------------------------------------------- check-in reminder --
  -- In transit and silent for 24h. Once a day, hard cap of 3 per trip.
  for r in
    select t.id
      from app_private.trips t
     where t.status = 'in_transit'
       and coalesce(t.started_at, t.dispatched_at, t.created_at) < now() - interval '24 hours'
       and not exists (select 1 from app_private.trip_events e
                        where e.trip_id = t.id and e.created_at > now() - interval '24 hours')
       and not exists (select 1 from app_private.trip_locations p
                        where p.trip_id = t.id and p.created_at > now() - interval '24 hours')
  loop
    continue when app_private.mail_sent_count('tx.trip_checkin_reminder',
                                              'checkin:' || r.id::text || ':') >= 3;
    v_idem := 'checkin:' || r.id::text || ':' || to_char(now() at time zone 'utc','YYYYMMDD');
    continue when app_private.mail_sent_count('tx.trip_checkin_reminder', v_idem) > 0;
    c := app_private.trip_mail_ctx(r.id);
    continue when c is null;

    if app_private.trip_mail(r.id, 'tx.trip_checkin_reminder', 'carrier',
        'Check call needed - ' || (c->>'lane'),
        app_private.trip_mail_html('We need a check call', c->>'lane',
          '<p>We have had no position update on this load for 24 hours. Post a quick check call'
          || ' from the trip screen - where the truck is and the ETA is enough.</p>'
          || '<p>Brokers ask us for this, and a silent truck is the fastest way to lose the'
          || ' next load from the same customer.</p>'),
        v_idem)
    then n := n + 1; end if;
  end loop;

  --------------------------------------------------------- tracking stale ---
  -- Consent given but the last ping is older than 6h. Once per stale spell:
  -- the idem carries the last ping, so a fresh ping opens a new spell.
  for r in
    select t.id, t.last_loc_at
      from app_private.trips t
     where t.status = 'in_transit'
       and coalesce(t.location_consent,false)
       and t.last_loc_at is not null
       and t.last_loc_at < now() - interval '6 hours'
  loop
    v_idem := 'trackstale:' || r.id::text || ':'
              || extract(epoch from r.last_loc_at)::bigint::text;
    continue when app_private.mail_sent_count('tx.tracking_stale_warning', v_idem) > 0;
    c := app_private.trip_mail_ctx(r.id);
    continue when c is null;

    if app_private.trip_mail(r.id, 'tx.tracking_stale_warning', 'carrier',
        'Tracking has stopped reporting - ' || (c->>'lane'),
        app_private.trip_mail_html('We have lost tracking on this load', c->>'lane',
          '<p>The last position we received was '
          || to_char(r.last_loc_at,'YYYY-MM-DD HH24:MI') || ' UTC. You agreed to share'
          || ' tracking on this load, so the broker is expecting a live position.</p>'
          || '<p>Open the trip screen in the LoadBoot app and leave it running, or post a'
          || ' manual check call instead.</p>'),
        v_idem)
    then n := n + 1; end if;
  end loop;

  -------------------------------------------------------- detention accrual --
  -- Free time gone, still no departure. Hourly, cap 6 per arrival.
  for r in
    select d.id, d.trip_id, d.stop_type, d.arrived_at, coalesce(d.free_minutes,120) free_minutes
      from app_private.trip_dwell_events d
      join app_private.trips t on t.id = d.trip_id
     where d.departed_at is null
       and d.arrived_at > now() - interval '3 days'
       and t.status in ('dispatched','in_transit','delivered')
       and now() > d.arrived_at + (coalesce(d.free_minutes,120) || ' minutes')::interval
  loop
    v_n := least(6, floor(extract(epoch from
             (now() - (r.arrived_at + (r.free_minutes || ' minutes')::interval))) / 3600.0)::int + 1);
    v_idem := 'detwarn:' || r.id::text || ':' || v_n::text;
    continue when app_private.mail_sent_count('tx.detention_warning', v_idem) > 0;
    c := app_private.trip_mail_ctx(r.trip_id);
    continue when c is null;

    v_hrs := round(extract(epoch from
               (now() - (r.arrived_at + (r.free_minutes || ' minutes')::interval))) / 3600.0, 1);

    if app_private.trip_mail(r.trip_id, 'tx.detention_warning', 'carrier',
        'Detention is accruing - ' || (c->>'lane'),
        app_private.trip_mail_html('Detention is accruing', c->>'lane',
          '<p>Free time at the <strong>' || coalesce(r.stop_type,'stop')
          || '</strong> ran out and no departure has been recorded. Detention has been'
          || ' accruing for about <strong>' || v_hrs::text || ' hours</strong>.</p>'
          || '<p>Mark departure the moment you roll. Detention is only billable with both'
          || ' timestamps on file.</p>'),
        v_idem)
    then n := n + 1; end if;

    perform app_private.trip_mail(r.trip_id, 'tx.detention_warning', 'broker',
        'Detention is accruing - ' || (c->>'lane'),
        app_private.trip_mail_html('Detention is accruing', c->>'lane',
          '<p>The carrier arrived at the <strong>' || coalesce(r.stop_type,'stop')
          || '</strong> on ' || to_char(r.arrived_at,'YYYY-MM-DD HH24:MI') || ' UTC. Free time of '
          || r.free_minutes::text || ' minutes is gone and the truck is still on the dock -'
          || ' about <strong>' || v_hrs::text || ' hours</strong> of detention so far.</p>'
          || '<p>If the facility can release the truck now, that stops the clock.</p>'),
        v_idem);
  end loop;

  return n;
end $$;

comment on function app_private.cron_trip_comm() is
  'bl_comm_0399 — every 15 min: POD chase 4/12/24h, delivery reminder -12h, check-in nudge (1/day cap 3), stale tracking (6h, once per spell), detention accrual (hourly cap 6). Caps read from message_deliveries.';

select cron.unschedule('lb-trip-comm') where exists (select 1 from cron.job where jobname='lb-trip-comm');
select cron.schedule('lb-trip-comm', '*/15 * * * *', $c$select app_private.cron_trip_comm();$c$);

-- --------------------------------------------------------- catalog rows ----
-- status planned -> live, honest cadence/cap/stop, and every one starts in TEST.

update app_private.email_catalog c set
  status          = 'live',
  send_mode       = 'test',
  send_mode_note  = 'bl_comm_0399 — wired 22 Sep 2026, starts in Test until the owner flips it to Live',
  send_mode_at    = now(),
  cc_deep_link    = '#/trips',
  trigger_type    = v.trigger_type,
  trigger_source  = v.trigger_source,
  cadence         = v.cadence,
  cap_note        = v.cap_note,
  stop_condition  = v.stop_condition,
  audience_role   = v.audience_role,
  preference_group= 'load_ops',
  unsub_allowed   = true,
  updated_at      = now()
from (values
 ('tx.pod_required','cron','app_private.cron_trip_comm() — POD chase',
  '4h, 12h and 24h after delivery','3 per trip, one per stage',
  'a POD row exists for the trip (pending or approved)','carrier'),
 ('tx.pod_approved','event','app_private.trg_comm_pod_reviewed() on document_files',
  'on approval','once per POD document','n/a — single event','carrier'),
 ('tx.pod_rejected','event','app_private.trg_comm_pod_reviewed() on document_files',
  'on rejection','once per POD document','n/a — single event','carrier'),
 ('tx.trip_delivery_reminder','cron','app_private.cron_trip_comm() — delivery reminder',
  '12h before scheduled delivery','once per trip','trip delivered or cancelled','carrier'),
 ('tx.trip_checkin_reminder','cron','app_private.cron_trip_comm() — check-in nudge',
  'once a day while in transit and silent for 24h','3 per trip',
  'any trip event or position ping in the last 24h','carrier'),
 ('tx.tracking_stale_warning','cron','app_private.cron_trip_comm() — stale tracking',
  'last ping older than 6h','once per stale spell','a fresh position ping','carrier'),
 ('tx.detention_opened','event','app_private.trg_comm_dwell_arrived() on trip_dwell_events',
  'when an arrival is recorded','once per arrival','n/a — single event','carrier,broker'),
 ('tx.detention_warning','cron','app_private.cron_trip_comm() — detention accrual',
  'hourly once free time is gone','6 per arrival','departure recorded','carrier,broker'),
 ('tx.load_tonu','event','app_private.trg_comm_accessorial() on trip_accessorials (kind=tonu)',
  'when a TONU is logged','once per accessorial','n/a — single event','carrier,broker'),
 ('tx.load_lumper_request','event','app_private.trg_comm_accessorial() on trip_accessorials (kind=lumper)',
  'when a lumper fee is logged','once per accessorial','n/a — single event','carrier,broker'),
 ('tx.trip_layover','event','app_private.trg_comm_accessorial() on trip_accessorials (kind=layover)',
  'when a layover is logged','once per accessorial','n/a — single event','carrier,broker'),
 ('tx.trip_breakdown','event','app_private.trg_comm_trip_exception() on trip_exceptions (kind=breakdown)',
  'when the exception is logged','once per exception','n/a — single event','carrier,broker'),
 ('tx.trip_accident','event','app_private.trg_comm_trip_exception() on trip_exceptions (kind=accident)',
  'when the exception is logged','once per exception','n/a — single event','carrier,broker'),
 ('tx.trip_exception_update','event','app_private.trg_comm_trip_exception() on trip_exceptions (weather, missed_appointment, delay, other)',
  'when the exception is logged','once per exception','n/a — single event','carrier,broker')
) as v(key, trigger_type, trigger_source, cadence, cap_note, stop_condition, audience_role)
where c.key = v.key;

select app_private.email_catalog_sync();
