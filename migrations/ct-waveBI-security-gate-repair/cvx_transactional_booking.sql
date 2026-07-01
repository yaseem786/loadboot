-- cvx_transactional_booking.sql
-- Increments 48 + 49 — TRANSACTIONAL first-valid-acceptance booking + booking checklist / rate confirmation.
-- When a carrier accepts an offer, one atomic transaction: locks the load, validates load+offer versions,
-- re-runs hard eligibility, selects ONE winning acceptance, expires every other open offer, creates the
-- assignment + trip exactly once (double-booking blocked by lock + unique active-trip index), seeds the
-- broker+carrier booking checklist (incl. rate confirmation), emits events, writes audit.
-- No load is ever assigned because a frontend button was hidden/shown — every guard is server-side.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

-- version snapshot on offers (stale-acceptance guard)
alter table app_private.load_offers add column if not exists load_version integer;

-- capture load version at send time
create or replace function public.cc_offer_send(p_load uuid, p_carriers uuid[], p_rate numeric default null, p_expiry_minutes integer default 60)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_sent int:=0; v_skipped int:=0; c uuid; v_ok boolean; v_rate numeric; v_exp timestamptz; v_ver int;
begin
  if not public.has_global_permission('dispatch.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  select version into v_ver from public.loads where id=p_load;
  if v_ver is null then raise exception 'load not found' using errcode='22023'; end if;
  v_rate := coalesce(p_rate, (select rate from public.loads where id=p_load));
  v_exp := now() + (greatest(coalesce(p_expiry_minutes,60),5) || ' minutes')::interval;
  foreach c in array coalesce(p_carriers, array[]::uuid[]) loop
    select eligible into v_ok from public.cc_match_eligibility(p_load) el where el.carrier_id=c;
    if coalesce(v_ok,false) then
      insert into app_private.load_offers(load_id,carrier_id,offered_rate,expiry_at,status,created_by,score,load_version)
        select p_load, c, v_rate, v_exp, 'sent', auth.uid(),
          (select score from public.cc_match_rank(p_load) r where r.carrier_id=c), v_ver
      on conflict (load_id,carrier_id) do update set offered_rate=excluded.offered_rate, expiry_at=excluded.expiry_at,
          status='sent', sent_at=now(), responded_at=null, decline_reason=null, counter_rate=null,
          load_version=excluded.load_version, updated_at=now();
      v_sent := v_sent + 1;
      perform app_private.emit_event('offer.created','load_offer',p_load::text, jsonb_build_object('load',p_load,'carrier',c,'rate',v_rate));
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;
  perform app_private.log_audit('offer.send','load',p_load::text,null,format('offer wave: %s sent, %s skipped (ineligible)',v_sent,v_skipped),null);
  return jsonb_build_object('sent',v_sent,'skipped_ineligible',v_skipped,'expiry_at',v_exp);
end; $$;
revoke execute on function public.cc_offer_send(uuid, uuid[], numeric, integer) from anon, public;
grant  execute on function public.cc_offer_send(uuid, uuid[], numeric, integer) to authenticated;

-- Internal eligibility (no permission gate — booking runs AS THE CARRIER, so it cannot call the staff-gated
-- public RPC). Same logic as cc_match_eligibility; the public function is now a staff-gated wrapper over this.
create or replace function app_private.match_eligibility(p_load uuid)
returns table(carrier_id uuid, carrier text, eligible boolean, hard_fails text[], missing_data text[],
  compliant boolean, trucks integer, active_trips integer, available_trucks integer,
  drivers integer, available_drivers integer, equipment_match text)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_equip text;
begin
  if not exists (select 1 from public.loads where id=p_load) then raise exception 'load not found' using errcode='22023'; end if;
  select equipment into v_equip from public.loads where id=p_load;
  return query
  with c as (
    select o.id, o.name, coalesce(o.status,'') ostatus,
      app_private.carrier_mandatory_ok(o.id) compliant,
      (select count(*) from app_private.fleet_trucks t where t.carrier_id=o.id and coalesce(t.status,'active')<>'inactive')::int trucks,
      (select count(*) from app_private.fleet_trucks t where t.carrier_id=o.id and coalesce(t.status,'active')<>'inactive'
          and (v_equip is null or lower(trim(t.equipment))=lower(trim(v_equip))))::int equip_trucks,
      (select count(*) from app_private.fleet_drivers d where d.carrier_id=o.id)::int drivers,
      (select count(*) from app_private.fleet_drivers d where d.carrier_id=o.id and coalesce(d.status,'active')='active'
          and (d.license_exp is null or d.license_exp>=current_date) and (d.medical_exp is null or d.medical_exp>=current_date))::int avail_drivers,
      (select count(*) from app_private.trips t where t.carrier_id=o.id and t.status in ('planned','dispatched','in_transit'))::int active_trips
    from public.organizations o where o.kind='carrier' and coalesce(o.status,'') <> 'archived'
  )
  select c.id, c.name,
    (coalesce(array_length(e.hf,1),0)=0) as eligible,
    e.hf, e.md, c.compliant, c.trucks, c.active_trips, greatest(c.trucks - c.active_trips, 0) as available_trucks,
    c.drivers, c.avail_drivers,
    (case when v_equip is null then 'unknown' when c.trucks=0 then 'unknown' when c.equip_trucks>0 then 'match' else 'no_match' end) as equipment_match
  from c
  cross join lateral (
    select
      (case when c.ostatus<>'active' then array['carrier not active ('||c.ostatus||')'] else '{}'::text[] end)
      || (case when not c.compliant then array['compliance / authority / insurance incomplete'] else '{}'::text[] end)
      || (case when c.trucks>0 and c.active_trips>=c.trucks then array['no available truck (all on active trips)'] else '{}'::text[] end)
      || (case when v_equip is not null and c.trucks>0 and c.equip_trucks=0 then array['no compatible equipment for '||v_equip] else '{}'::text[] end)
      || (case when c.drivers>0 and c.avail_drivers=0 then array['no available driver (license/medical current)'] else '{}'::text[] end)
        as hf,
      (case when c.trucks=0 then array['no trucks on file'] else '{}'::text[] end)
      || (case when c.drivers=0 then array['no drivers on file'] else '{}'::text[] end)
        as md
  ) e
  order by eligible desc, c.compliant desc, c.name;
end; $$;

create or replace function public.cc_match_eligibility(p_load uuid)
returns table(carrier_id uuid, carrier text, eligible boolean, hard_fails text[], missing_data text[],
  compliant boolean, trucks integer, active_trips integer, available_trucks integer,
  drivers integer, available_drivers integer, equipment_match text)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
begin
  if not public.has_global_permission('dispatch.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select * from app_private.match_eligibility(p_load);
end; $$;
revoke execute on function public.cc_match_eligibility(uuid) from anon, public;
grant  execute on function public.cc_match_eligibility(uuid) to authenticated;

-- Internal: the atomic booking. Caller must already own the offer row lock.
create or replace function app_private.book_accepted_offer(p_offer uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare o record; l record; v_ok boolean; v_trip uuid;
begin
  select * into o from app_private.load_offers where id=p_offer;
  -- 1. lock the load (serializes competing acceptances)
  select * into l from public.loads where id=o.load_id for update;
  if l.id is null then raise exception 'load not found' using errcode='22023'; end if;
  -- 2. load must still be open for booking
  if l.status not in ('available','offered','matching','approved_for_matching') then
    raise exception 'load is no longer available (status %)', l.status using errcode='55006'; end if;
  -- 3. stale-acceptance guard: load version must match the version offered
  if o.load_version is not null and o.load_version <> l.version then
    raise exception 'load changed since the offer was sent (v% -> v%) — offer is stale', o.load_version, l.version using errcode='55006'; end if;
  -- 4. re-check hard eligibility at acceptance (internal — runs as the carrier)
  select eligible into v_ok from app_private.match_eligibility(o.load_id) el where el.carrier_id=o.carrier_id;
  if not coalesce(v_ok,false) then
    raise exception 'carrier is no longer eligible for this load' using errcode='55006'; end if;
  -- 5. winning acceptance: mark this offer accepted, expire every other open offer
  update app_private.load_offers set status='accepted', responded_at=now(), updated_at=now() where id=p_offer;
  update app_private.load_offers set status='expired', updated_at=now()
    where load_id=o.load_id and id<>p_offer and status in ('sent','viewed','countered');
  -- 6. book the load + create the trip exactly once (unique active-trip index is the backstop)
  update public.loads set status='booked', version=version+1 where id=o.load_id;
  insert into app_private.trips(load_id,carrier_id,status,rate,miles,created_by)
    values (o.load_id, o.carrier_id, 'planned', coalesce(o.offered_rate,l.rate), l.miles, auth.uid())
    returning id into v_trip;
  -- 7. booking checklist (Inc 49): broker docs + carrier docs incl rate confirmation + assignment
  perform app_private.seed_load_checklist('load', o.load_id, jsonb_build_array(
    jsonb_build_object('doc_key','rate_confirmation','label','Rate confirmation (broker)','required_from','broker'),
    jsonb_build_object('doc_key','pickup_number','label','Pickup number','required_from','broker'),
    jsonb_build_object('doc_key','delivery_number','label','Delivery number','required_from','broker'),
    jsonb_build_object('doc_key','facility_instructions','label','Facility instructions','required_from','broker'),
    jsonb_build_object('doc_key','signed_rate_confirmation','label','Signed rate confirmation (carrier)','required_from','carrier'),
    jsonb_build_object('doc_key','driver_assignment','label','Assigned driver + phone','required_from','carrier'),
    jsonb_build_object('doc_key','truck_trailer','label','Truck & trailer numbers','required_from','carrier'),
    jsonb_build_object('doc_key','tracking_method','label','Tracking method selected','required_from','carrier')));
  -- 8. events + audit
  perform app_private.emit_event('offer.accepted','load_offer',p_offer::text, jsonb_build_object('load',o.load_id,'carrier',o.carrier_id));
  perform app_private.emit_event('load.assigned','load',o.load_id::text, jsonb_build_object('load',o.load_id,'carrier',o.carrier_id,'trip',v_trip));
  perform app_private.emit_event('trip.created','trip',v_trip::text, jsonb_build_object('trip',v_trip,'load',o.load_id,'carrier',o.carrier_id));
  perform app_private.emit_event('booking.document_requested','load',o.load_id::text, jsonb_build_object('load',o.load_id,'docs',8));
  perform app_private.log_audit('load.book','load',o.load_id::text,null,'transactional booking: offer accepted, trip created, checklist generated',
    jsonb_build_object('offer',p_offer,'carrier',o.carrier_id,'trip',v_trip));
  return jsonb_build_object('booked',true,'trip',v_trip,'load',o.load_id);
end; $$;

-- Carrier respond — accept now performs the full transactional booking.
create or replace function public.cc_offer_respond(p_offer uuid, p_action text, p_reason text default null, p_counter numeric default null, p_message text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; o record; v_book jsonb;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  select * into o from app_private.load_offers where id=p_offer for update;
  if o.id is null or o.carrier_id<>v_org then raise exception 'offer not found' using errcode='42501'; end if;
  if o.status in ('accepted','declined','expired') then raise exception 'offer is already %', o.status using errcode='22023'; end if;
  if o.expiry_at is not null and o.expiry_at < now() then
    update app_private.load_offers set status='expired', updated_at=now() where id=p_offer;
    raise exception 'offer has expired' using errcode='22023'; end if;
  if p_action='view' then
    update app_private.load_offers set viewed_at=coalesce(viewed_at,now()), status=case when status='sent' then 'viewed' else status end, updated_at=now() where id=p_offer;
  elsif p_action='accept' then
    v_book := app_private.book_accepted_offer(p_offer);
    perform app_private.emit_event('offer.responded','load_offer',p_offer::text, jsonb_build_object('offer',p_offer,'carrier',v_org,'action','accept'));
    return jsonb_build_object('ok',true,'action','accept') || v_book;
  elsif p_action='decline' then
    update app_private.load_offers set status='declined', responded_at=now(), decline_reason=p_reason, updated_at=now() where id=p_offer;
  elsif p_action='counter' then
    update app_private.load_offers set status='countered', responded_at=now(), counter_rate=p_counter, message=p_message, updated_at=now() where id=p_offer;
  else raise exception 'invalid action' using errcode='22023'; end if;
  perform app_private.emit_event('offer.responded','load_offer',p_offer::text, jsonb_build_object('offer',p_offer,'carrier',v_org,'action',p_action));
  return jsonb_build_object('ok',true,'action',p_action);
end; $$;
revoke execute on function public.cc_offer_respond(uuid, text, text, numeric, text) from anon, public;
grant  execute on function public.cc_offer_respond(uuid, text, text, numeric, text) to authenticated;

-- Booking status (staff or the booked carrier): trip + checklist progress in one read.
create or replace function public.cc_booking_status(p_load uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; l record; v_trip jsonb; v_docs jsonb;
begin
  select * into l from public.loads where id=p_load;
  if l.id is null then raise exception 'load not found' using errcode='22023'; end if;
  if not public.is_active_staff() then
    v_org := app_private.my_carrier_org();
    if v_org is null or not exists (select 1 from app_private.trips t where t.load_id=p_load and t.carrier_id=v_org) then
      raise exception 'not authorized' using errcode='42501'; end if;
  end if;
  select to_jsonb(x) into v_trip from (select t.id,t.status,t.carrier_id,t.driver_name,t.truck_no,t.trailer_no,t.scheduled_pickup,t.scheduled_delivery
    from app_private.trips t where t.load_id=p_load order by t.created_at desc limit 1) x;
  select coalesce(jsonb_agg(jsonb_build_object('doc_key',c.doc_key,'label',c.label,'required_from',c.required_from,'status',c.status) order by c.required_from, c.label),'[]'::jsonb)
    into v_docs from app_private.load_document_checklist c where c.subject_type='load' and c.subject_id=p_load;
  return jsonb_build_object('load',p_load,'status',l.status,'trip',v_trip,'checklist',v_docs,
    'checklist_complete', not exists (select 1 from app_private.load_document_checklist c
      where c.subject_type='load' and c.subject_id=p_load and c.status in ('required','rejected','expired')));
end; $$;
revoke execute on function public.cc_booking_status(uuid) from anon, public;
grant  execute on function public.cc_booking_status(uuid) to authenticated;
