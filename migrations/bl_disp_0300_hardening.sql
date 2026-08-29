-- bl_disp_0300 — Dispatcher program hardening (from the 29 Aug deep audit; docs/DISPATCHER-PORTAL-AUDIT.md §8).
-- Additive + in-place replacements. STAGING first, then PROD. Every replaced function keeps its signature
-- (ACLs survive) unless noted; new functions are granted at the bottom.
--
-- P0 fixes in this file
--  1. Revocation: disp_is_assigned() also requires the dispatcher profile to be trial/verified/active, and
--     cc_dispatcher_decide(suspend|reject) pauses/ends every active assignment. (Suspended dispatchers could
--     still log bookings, read carrier docs and message the carrier.)
--  2. Notifications that reach a phone: app_private.disp_notify() writes the in-app row AND queues an email
--     (sys_email → Resend) to the dispatcher / carrier owner / dispatch@loadboot.com. Wired into: RC received,
--     booking logged with RC, approve/reject, cancel, thread messages (staff now alerted), assign (carrier now
--     told), decide transitions, commission approved/paid, trial default.
--  3. Trial defaults: decide('trial') sets trial_start=today, trial_end=+10 working days when null; returns a
--     warning when commission_pct is 0 so the CC opens the terms form.
--  4. Booking integrity: dispatcher_booking_update takes a row lock; RC can only be replaced before approval;
--     gross/miles edits recompute below_min; cancel needs a reason, is dispatcher-allowed only before pickup,
--     alerts staff and cancels the linked trip; status moves record to_status; dispatched/delivered flip the
--     truck availability (loaded → empty at destination).
--  5. Approval integrity: below-min needs a written reason; duplicate RC number, overlapping approved load on
--     the same truck, pickup already in the past, and missing driver are refused with a readable message;
--     commission % is frozen on the booking at approval; the RC is registered as a carrier document
--     (type rate_con) so the carrier and CC can open it; carrier is notified + system thread message.
--  6. Internal-board requests (dispatcher_request_book) now create a dispatcher_bookings row and are linked
--     to the trip when the broker approves — so the approval gate, queue, KPIs and commission cover them.
--  7. Feed: last_event_at + trip_status per booking, effective_min_rpm per truck, availability updated_by_role,
--     unread from a proper reads table (no more sop mutation), min_rate_note, drops owner_user_id/vin/salary.
--  8. Carrier side: carrier_my_dispatcher returns the SOP (carrier's own rules), dispatcher phone/hours, and
--     hides "trial"; new carrier_my_dispatcher_bookings(), carrier_dispatcher_ack(), carrier_dispatcher_pause(),
--     carrier_booking_ack().
--  9. Staff: cc_dispatcher_queue() (all bookings awaiting action with ages), commission payout fields +
--     cc_dispatcher_commission_pay(), audit rows on every staff decision.
-- 10. Hygiene: broker_contacts unique per dispatcher+name, dispatcher_post_truck availability lookup scoped by
--     org, eld_hos_ingest execute only for service_role, timeline/thread never expose e-mails.

-- ================================================================ schema
alter table app_private.dispatcher_assignments
  add column if not exists carrier_ack_at timestamptz,
  add column if not exists carrier_ack_by uuid;

alter table app_private.dispatcher_bookings
  add column if not exists commission_pct numeric(5,2),
  add column if not exists stops jsonb,
  add column if not exists cancel_reason text,
  add column if not exists source text not null default 'external';   -- external (DAT/Truckstop) | loadboot (internal board)

alter table app_private.dispatcher_booking_events
  add column if not exists to_status text;

alter table app_private.dispatcher_commission
  add column if not exists paid_amount numeric(12,2),
  add column if not exists paid_currency text,
  add column if not exists fx_rate numeric(12,4),
  add column if not exists payout_ref text,
  add column if not exists payout_method text,
  add column if not exists paid_by uuid;

create table if not exists app_private.dispatcher_thread_reads (
  assignment_id uuid not null references app_private.dispatcher_assignments(id) on delete cascade,
  user_id       uuid not null,
  read_at       timestamptz not null default now(),
  primary key (assignment_id, user_id)
);
alter table app_private.dispatcher_thread_reads enable row level security;

create table if not exists app_private.dispatcher_terms_log (
  id uuid primary key default gen_random_uuid(),
  dispatcher_user_id uuid not null,
  commission_pct numeric(5,2), trial_start date, trial_end date,
  set_by uuid, set_at timestamptz not null default now(), note text
);
alter table app_private.dispatcher_terms_log enable row level security;

-- broker book: one row per dispatcher + broker name (dedupe first, keep the newest)
delete from app_private.broker_contacts b using app_private.broker_contacts b2
 where b.dispatcher_user_id = b2.dispatcher_user_id and lower(b.broker) = lower(b2.broker) and b.created_at < b2.created_at;
create unique index if not exists broker_contacts_uniq on app_private.broker_contacts(dispatcher_user_id, lower(broker));

-- backfill to_status on existing status events (note starts with the status word)
update app_private.dispatcher_booking_events e set to_status = split_part(e.note, ':', 1)
 where e.kind = 'status' and e.to_status is null and split_part(e.note, ':', 1) in ('dispatched','picked_up','delivered','invoiced','paid','cancelled');

-- ================================================================ helpers
create or replace function app_private.disp_is_assigned(p_org uuid)
returns boolean language sql stable security definer set search_path = app_private, public as $$
  select exists (
    select 1 from app_private.dispatcher_assignments a
      join app_private.dispatcher_profiles p on p.user_id = a.dispatcher_user_id
     where a.dispatcher_user_id = auth.uid() and a.carrier_org_id = p_org and a.status = 'active'
       and p.status in ('trial','verified','active'));
$$;

-- in-app row + optional e-mail. p_user null + p_role 'staff' → staff in-app + dispatch@loadboot.com
create or replace function app_private.disp_notify(p_user uuid, p_role text, p_template text, p_title text, p_body text, p_url text default null, p_email boolean default true)
returns void language plpgsql security definer set search_path = app_private, public as $$
declare v_email text; v_html text;
begin
  begin
    if p_user is not null then
      insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
      values ('user','in_app', p_template, jsonb_build_object('user', p_user, 'title', p_title, 'body', p_body, 'tone', case when p_template like '%exception%' or p_template like '%cancel%' or p_template like '%reject%' then 'danger' when p_template like '%approved%' then 'success' else 'info' end, 'url', coalesce(p_url, case p_role when 'dispatcher' then '/app/agent/#dashboard' when 'carrier' then '/app/carrier/' else '/app/command-center/#dispatchers' end)), 'sent', now());
    else
      insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
      values ('staff','in_app', p_template, jsonb_build_object('title', p_title, 'body', p_body, 'tone', case when p_template like '%exception%' or p_template like '%cancel%' then 'danger' else 'info' end, 'url', coalesce(p_url, '/app/command-center/#dispatchers')), 'sent', now());
    end if;
  exception when others then null; end;
  if not p_email then return; end if;
  begin
    if p_user is not null then select u.email into v_email from auth.users u where u.id = p_user;
    else v_email := 'dispatch@loadboot.com'; end if;
    if v_email is null then return; end if;
    v_html := '<div style="font-family:Inter,Arial,sans-serif;max-width:560px"><h2 style="margin:0 0 8px">' || p_title || '</h2><p style="line-height:1.6">' || replace(p_body, E'\n', '<br>') || '</p>'
           || '<p><a href="https://loadboot.com' || coalesce(p_url, case p_role when 'dispatcher' then '/app/agent/' when 'carrier' then '/app/carrier/' else '/app/command-center/#dispatchers' end) || '" style="background:#0883F7;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Open LoadBoot</a></p>'
           || '<p style="color:#8ea2c3;font-size:12px">LoadBoot dispatch · this is a transactional notice for an active assignment.</p></div>';
    perform app_private.sys_email(v_email, p_template, 'LoadBoot: ' || p_title, v_html, p_body, p_template || ':' || coalesce(p_user::text,'staff') || ':' || extract(epoch from now())::bigint::text);
  exception when others then null; end;
end $$;

create or replace function app_private.disp_audit(p_action text, p_target_type text, p_target_id text, p_org uuid, p_summary text, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = app_private, public as $$
begin
  begin perform app_private.log_audit(p_action, p_target_type, p_target_id, p_org, p_summary, coalesce(p_detail,'{}'::jsonb), null); exception when others then null; end;
end $$;

-- effective minimum $/mi for a truck under an assignment: truck floor → SOP floor → owner profile floor
create or replace function app_private.disp_effective_min(p_truck uuid, p_org uuid)
returns numeric language sql stable security definer set search_path = app_private, public as $$
  select coalesce(
    (select t.min_rpm from app_private.fleet_trucks t where t.id = p_truck),
    (select nullif(substring(a.sop->>'min_rate' from '^\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:/\s*mi(?:le)?)?\s*$'), '')::numeric
       from app_private.dispatcher_assignments a where a.carrier_org_id = p_org and a.status = 'active' limit 1),
    (select pr.min_rpm from public.organizations o join public.profiles pr on pr.id = o.owner_user_id where o.id = p_org));
$$;

-- +N working days (Mon–Fri)
create or replace function app_private.add_working_days(p_from date, p_days int)
returns date language plpgsql immutable as $$
declare d date := p_from; n int := 0;
begin
  while n < p_days loop d := d + 1; if extract(isodow from d) < 6 then n := n + 1; end if; end loop;
  return d;
end $$;

-- ================================================================ staff: decide / terms / assign / unassign
create or replace function public.cc_dispatcher_decide(p_user uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_new text; v_old text; v_pct numeric; v_ts date; v_te date; v_warn text; v_name text;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select status, commission_pct, trial_start, trial_end, full_name into v_old, v_pct, v_ts, v_te, v_name from app_private.dispatcher_profiles where user_id = p_user;
  if v_old is null then return jsonb_build_object('error','not a dispatcher'); end if;
  v_new := case p_action
    when 'screening' then 'screening' when 'skills_test' then 'skills_test' when 'trial' then 'trial'
    when 'verify' then 'verified' when 'activate' then 'active' when 'reject' then 'rejected' when 'suspend' then 'suspended'
    when 'reinstate' then case when v_te is not null and v_te >= current_date then 'trial' else 'verified' end
    else null end;
  if v_new is null then return jsonb_build_object('error','bad action'); end if;
  update app_private.dispatcher_profiles
     set status = v_new, review_note = coalesce(p_note, review_note), reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now(),
         trial_start = case when v_new = 'trial' and trial_start is null then current_date else trial_start end,
         trial_end   = case when v_new = 'trial' and trial_end is null then app_private.add_working_days(current_date, 10) else trial_end end
   where user_id = p_user;
  if v_new = 'trial' and coalesce(v_pct, 0) = 0 then v_warn := 'commission_pct is 0 — set the trial terms now or every delivered load pays the dispatcher nothing'; end if;
  -- revocation: suspended / rejected dispatchers lose every active assignment (feed, docs, thread, bookings)
  if v_new in ('suspended','rejected') then
    update app_private.dispatcher_assignments set status = case when v_new = 'suspended' then 'paused' else 'ended' end,
           ended_at = case when v_new = 'rejected' then now() else ended_at end, end_reason = coalesce(p_note, 'dispatcher ' || v_new), updated_at = now()
     where dispatcher_user_id = p_user and status = 'active';
    insert into app_private.dispatcher_messages(assignment_id, carrier_org_id, sender_role, body)
      select a.id, a.carrier_org_id, 'system', 'LoadBoot has ' || (case when v_new = 'suspended' then 'paused' else 'ended' end) || ' this dispatcher assignment. LoadBoot dispatch covers your truck until a replacement is assigned.'
        from app_private.dispatcher_assignments a where a.dispatcher_user_id = p_user and a.status in ('paused','ended') and a.updated_at > now() - interval '5 seconds';
  elsif v_new = 'trial' and v_old = 'suspended' then
    update app_private.dispatcher_assignments set status = 'active', updated_at = now() where dispatcher_user_id = p_user and status = 'paused';
  end if;
  perform app_private.disp_notify(p_user, 'dispatcher', 'dispatcher.status.' || v_new,
    case v_new when 'trial' then 'Your trial starts — open your workspace' when 'verified' then 'You are verified' when 'active' then 'You are active' when 'rejected' then 'Application closed' when 'suspended' then 'Access paused' when 'skills_test' then 'Next step: skills test' else 'Application update' end,
    coalesce(p_note, 'Status: ' || v_new || '.'), '/app/agent/#dashboard', v_new in ('trial','verified','active','rejected','suspended'));
  perform app_private.disp_audit('dispatcher.decide.' || p_action, 'dispatcher', p_user::text, null, coalesce(v_name,'dispatcher') || ': ' || v_old || ' → ' || v_new, jsonb_build_object('note', p_note));
  return jsonb_build_object('ok', true, 'status', v_new, 'warning', v_warn);
end $$;

create or replace function public.cc_dispatcher_set_terms(p_user uuid, p_commission_pct numeric, p_trial_start date default null, p_trial_end date default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_ts date; v_te date;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if p_commission_pct is null or p_commission_pct < 0 or p_commission_pct > 5 then
    return jsonb_build_object('error','commission must be between 0 and 5 percent (LoadBoot fee is 5%)');
  end if;
  if p_trial_start is not null and p_trial_end is not null and p_trial_end < p_trial_start then return jsonb_build_object('error','trial end is before trial start'); end if;
  update app_private.dispatcher_profiles
     set commission_pct = p_commission_pct, trial_start = coalesce(p_trial_start, trial_start), trial_end = coalesce(p_trial_end, trial_end), updated_at = now()
   where user_id = p_user returning trial_start, trial_end into v_ts, v_te;
  if not found then return jsonb_build_object('error','not a dispatcher'); end if;
  insert into app_private.dispatcher_terms_log(dispatcher_user_id, commission_pct, trial_start, trial_end, set_by) values (p_user, p_commission_pct, v_ts, v_te, auth.uid());
  perform app_private.disp_notify(p_user, 'dispatcher', 'dispatcher.terms', 'Your terms were updated',
    'Commission ' || p_commission_pct || '% of gross on every load delivered' || case when v_ts is not null then ' · trial ' || v_ts || ' → ' || coalesce(v_te::text, '?') else '' end || '. Open Money in your workspace to see it per load.', '/app/agent/#dashboard', true);
  perform app_private.disp_audit('dispatcher.terms', 'dispatcher', p_user::text, null, 'terms set: ' || p_commission_pct || '% ' || coalesce(v_ts::text,'') || '→' || coalesce(v_te::text,''), jsonb_build_object('pct', p_commission_pct));
  return jsonb_build_object('ok', true, 'trial_start', v_ts, 'trial_end', v_te);
end $$;

create or replace function public.cc_dispatcher_assign(p_dispatcher uuid, p_carrier_org uuid, p_sop jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_id uuid; v_kind text; v_dstatus text; v_dname text; v_cname text; v_owner uuid;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select kind, name, owner_user_id into v_kind, v_cname, v_owner from public.organizations where id = p_carrier_org;
  if v_kind is null then return jsonb_build_object('error','carrier not found'); end if;
  select status, full_name into v_dstatus, v_dname from app_private.dispatcher_profiles where user_id = p_dispatcher;
  if v_dstatus is null then return jsonb_build_object('error','not a dispatcher'); end if;
  if v_dstatus not in ('trial','verified','active') then return jsonb_build_object('error','dispatcher must be in trial, verified or active before assignment'); end if;
  begin
    insert into app_private.dispatcher_assignments (dispatcher_user_id, carrier_org_id, sop, assigned_by)
    values (p_dispatcher, p_carrier_org, coalesce(p_sop,'{}'::jsonb) - 'disp_read_at', auth.uid()) returning id into v_id;
  exception when unique_violation then return jsonb_build_object('error','this carrier already has an active dispatcher'); end;
  update app_private.dispatcher_profiles set status = 'active', updated_at = now() where user_id = p_dispatcher and status = 'verified';
  perform app_private.disp_notify(p_dispatcher, 'dispatcher', 'dispatcher.assigned', 'New carrier assigned: ' || coalesce(v_cname,'carrier'),
    'Open your workspace for the truck, the carrier''s rules (SOP) and the booking tools. First message in the shared thread should be yours.', '/app/agent/#dashboard', true);
  perform app_private.disp_notify(v_owner, 'carrier', 'dispatcher.assigned.carrier', 'Your LoadBoot dispatcher: ' || coalesce(v_dname,'assigned'),
    coalesce(v_dname,'Your dispatcher') || ' now finds and books loads under your MC. They can see your truck specs, driver names and phones, and your approved authority, COI, W-9 and NOA — never your bank details. Every load is approved by LoadBoot before your driver moves. Open your dashboard to review and confirm.', '/app/carrier/', true);
  insert into app_private.dispatcher_messages(assignment_id, carrier_org_id, sender_role, body)
    values (v_id, p_carrier_org, 'system', 'Assignment created. This thread is shared by the dispatcher, the carrier and LoadBoot staff. Nothing moves until LoadBoot approves the rate confirmation.');
  perform app_private.disp_audit('dispatcher.assign', 'assignment', v_id::text, p_carrier_org, coalesce(v_dname,'dispatcher') || ' → ' || coalesce(v_cname,'carrier'), jsonb_build_object('sop', p_sop));
  return jsonb_build_object('ok', true, 'assignment', v_id);
end $$;

create or replace function public.cc_dispatcher_unassign(p_assignment uuid, p_reason text default null, p_pause boolean default false)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_a record; v_open int; v_owner uuid;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select * into v_a from app_private.dispatcher_assignments where id = p_assignment;
  if v_a.id is null then return jsonb_build_object('error','assignment not found'); end if;
  select count(*) into v_open from app_private.dispatcher_bookings b where b.carrier_org_id = v_a.carrier_org_id and b.dispatcher_user_id = v_a.dispatcher_user_id and b.status in ('approved','dispatched','picked_up');
  if v_open > 0 and not p_pause and coalesce(p_reason,'') not ilike '%force%' then
    return jsonb_build_object('error', v_open || ' load(s) are moving under this assignment — finish or cancel them first, or add "force" to the reason to end anyway');
  end if;
  update app_private.dispatcher_assignments set status = case when p_pause then 'paused' else 'ended' end,
    ended_at = case when p_pause then null else now() end, end_reason = p_reason, updated_at = now() where id = p_assignment;
  select owner_user_id into v_owner from public.organizations where id = v_a.carrier_org_id;
  insert into app_private.dispatcher_messages(assignment_id, carrier_org_id, sender_role, body)
    values (p_assignment, v_a.carrier_org_id, 'system', 'LoadBoot has ' || (case when p_pause then 'paused' else 'ended' end) || ' this assignment' || coalesce(': ' || p_reason, '') || '.');
  perform app_private.disp_notify(v_a.dispatcher_user_id, 'dispatcher', 'dispatcher.unassigned', 'Assignment ' || (case when p_pause then 'paused' else 'ended' end), coalesce(p_reason, 'LoadBoot ' || (case when p_pause then 'paused' else 'ended' end) || ' your carrier assignment.'), '/app/agent/#dashboard', true);
  perform app_private.disp_notify(v_owner, 'carrier', 'dispatcher.unassigned.carrier', 'Dispatcher assignment ' || (case when p_pause then 'paused' else 'ended' end), 'LoadBoot dispatch covers your truck directly until a replacement is assigned.', '/app/carrier/', true);
  perform app_private.disp_audit('dispatcher.unassign', 'assignment', p_assignment::text, v_a.carrier_org_id, (case when p_pause then 'paused' else 'ended' end) || coalesce(': ' || p_reason, ''), jsonb_build_object('open_loads', v_open));
  return jsonb_build_object('ok', true, 'open_loads', v_open);
end $$;

-- ================================================================ dispatcher: feed
create or replace function public.dispatcher_workspace_feed()
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_prof record; v_out jsonb;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  select * into v_prof from app_private.dispatcher_profiles where user_id = v_uid;
  if v_prof.user_id is null then return jsonb_build_object('error','not a dispatcher'); end if;
  if v_prof.status not in ('trial','verified','active') then
    return jsonb_build_object('error','workspace opens once your trial starts', 'status', v_prof.status);
  end if;
  select jsonb_build_object(
    'now', now(),
    'profile', jsonb_build_object('full_name', v_prof.full_name, 'status', v_prof.status,
       'commission_pct', v_prof.commission_pct, 'trial_start', v_prof.trial_start, 'trial_end', v_prof.trial_end, 'currency', v_prof.currency),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'carrier_org_id', a.carrier_org_id, 'status', a.status, 'sop', coalesce(a.sop,'{}'::jsonb) - 'disp_read_at', 'assigned_at', a.assigned_at,
        'carrier_ack_at', a.carrier_ack_at,
        'carrier', (select jsonb_build_object('name', o.name, 'mc', p.mc, 'dot', p.dot, 'phone', p.phone, 'whatsapp', p.whatsapp,
                        'email', p.email, 'contact_name', p.contact_name, 'home_base', p.home_base, 'min_rpm', p.min_rpm,
                        'max_deadhead', p.max_deadhead, 'avoid_states', p.avoid_states, 'weekend_ok', p.weekend_ok,
                        'factoring_company', p.factoring_company, 'factoring_status', p.factoring_status, 'broker_visible', o.broker_visible)
                    from public.organizations o left join public.profiles p on p.id = o.owner_user_id where o.id = a.carrier_org_id),
        'trucks', coalesce((select jsonb_agg(jsonb_build_object(
              'id', t.id, 'unit_no', t.unit_no, 'equipment', t.equipment, 'status', t.status,
              'make', t.vin_make, 'model', t.vin_model, 'year', t.vin_year, 'gvwr', t.vin_gvwr,
              'payload_lbs', t.payload_lbs, 'cargo_len_in', t.cargo_len_in, 'cargo_width_in', t.cargo_width_in, 'cargo_height_in', t.cargo_height_in,
              'deck_height_in', t.deck_height_in, 'dock_high', t.dock_high, 'liftgate', t.liftgate, 'liftgate_cap_lbs', t.liftgate_cap_lbs,
              'has_pallet_jack', t.has_pallet_jack, 'has_ramp', t.has_ramp, 'has_straps', t.has_straps, 'has_chains', t.has_chains, 'has_tarps', t.has_tarps,
              'has_etrack', t.has_etrack, 'has_load_bars', t.has_load_bars, 'has_blankets', t.has_blankets, 'pallet_positions', t.pallet_positions,
              'temp_control', t.temp_control, 'hazmat_placarded', t.hazmat_placarded, 'team_driven', t.team_driven,
              'trailer_type', t.trailer_type, 'trailer_len_ft', t.trailer_len_ft,
              'domicile_city', t.domicile_city, 'domicile_state', t.domicile_state, 'domicile_zip', t.domicile_zip,
              'min_rpm', t.min_rpm, 'effective_min_rpm', app_private.disp_effective_min(t.id, a.carrier_org_id), 'max_radius_miles', t.max_radius_miles, 'home_time', t.home_time,
              'spec_note', t.spec_note, 'capacity_note', t.capacity_note, 'inspection_exp', t.inspection_exp,
              'last_gps', (select jsonb_build_object('lat', tr.last_lat, 'lng', tr.last_lng, 'at', tr.last_loc_at) from app_private.trips tr where tr.truck_id = t.id and tr.last_lat is not null order by tr.last_loc_at desc nulls last limit 1),
              'availability', (select (to_jsonb(av) - 'truck_id' - 'carrier_id') || jsonb_build_object('updated_by_role',
                   case when av.updated_by is null then 'eld' when av.updated_by = v_uid then 'dispatcher'
                        when exists (select 1 from app_private.dispatcher_profiles dp where dp.user_id = av.updated_by) then 'dispatcher'
                        when app_private.disp_is_staff_user(av.updated_by) then 'staff' else 'carrier' end)
                 from app_private.truck_availability av where av.truck_id = t.id)
            ) order by t.unit_no)
          from app_private.fleet_trucks t where t.carrier_id = a.carrier_org_id and coalesce(t.status,'active') not in ('inactive','retired')), '[]'::jsonb),
        'drivers', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'phone', d.phone, 'status', d.status) order by d.name)
          from app_private.fleet_drivers d where d.carrier_id = a.carrier_org_id and coalesce(d.status,'active') <> 'inactive'), '[]'::jsonb),
        'documents', coalesce((select jsonb_agg(jsonb_build_object('id', dc.id, 'type', dc.type, 'file_name', dc.file_name, 'file_path', dc.file_path, 'status', dc.status, 'created_at', dc.created_at) order by dc.type)
          from public.documents dc
          where dc.status = 'approved' and dc.type in ('authority','insurance','w9','noa')
            and (dc.carrier_id = a.carrier_org_id or dc.carrier_id = (select o2.owner_user_id from public.organizations o2 where o2.id = a.carrier_org_id))), '[]'::jsonb),
        'unread', (select count(*) from app_private.dispatcher_messages m where m.assignment_id = a.id and m.sender_role <> 'dispatcher'
                     and m.created_at > coalesce((select r.read_at from app_private.dispatcher_thread_reads r where r.assignment_id = a.id and r.user_id = v_uid), a.assigned_at)),
        'last_message', (select jsonb_build_object('role', m.sender_role, 'body', left(m.body, 120), 'at', m.created_at) from app_private.dispatcher_messages m where m.assignment_id = a.id order by m.created_at desc limit 1)
      ) order by a.assigned_at desc)
      from app_private.dispatcher_assignments a where a.dispatcher_user_id = v_uid and a.status = 'active'), '[]'::jsonb),
    'bookings', coalesce((select jsonb_agg((to_jsonb(b) || jsonb_build_object(
        'last_event_at', (select max(e.created_at) from app_private.dispatcher_booking_events e where e.booking_id = b.id and e.kind in ('check_call','status','eta')),
        'trip_status', (select tr.status from app_private.trips tr where tr.id = b.trip_id),
        'pod_count', (select count(*) from app_private.document_files df where df.owner_type = 'trip' and df.owner_id = b.trip_id::text and df.kind = 'pod'),
        'carrier_ack', (select e.note from app_private.dispatcher_booking_events e where e.booking_id = b.id and e.kind = 'decision' and e.note like 'Carrier %' order by e.created_at desc limit 1)
      )) order by b.created_at desc)
      from (select * from app_private.dispatcher_bookings b where b.dispatcher_user_id = v_uid order by b.created_at desc limit 300) b), '[]'::jsonb),
    'commission', jsonb_build_object(
      'rows', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'booking_id', c.booking_id, 'gross', c.gross, 'pct', c.pct, 'amount', c.amount,
                  'status', c.status, 'created_at', c.created_at, 'paid_at', c.paid_at, 'paid_amount', c.paid_amount, 'paid_currency', c.paid_currency, 'fx_rate', c.fx_rate, 'payout_ref', c.payout_ref, 'note', c.note,
                  'lane', (select b.origin || ' → ' || b.destination from app_private.dispatcher_bookings b where b.id = c.booking_id)) order by c.created_at desc)
                from app_private.dispatcher_commission c where c.dispatcher_user_id = v_uid), '[]'::jsonb),
      'pending', coalesce((select sum(amount) from app_private.dispatcher_commission where dispatcher_user_id = v_uid and status = 'draft'),0),
      'approved', coalesce((select sum(amount) from app_private.dispatcher_commission where dispatcher_user_id = v_uid and status = 'approved'),0),
      'paid', coalesce((select sum(amount) from app_private.dispatcher_commission where dispatcher_user_id = v_uid and status = 'paid'),0)),
    'brokers', coalesce((select jsonb_agg((to_jsonb(bc) || jsonb_build_object(
        'bookings', (select count(*) from app_private.dispatcher_bookings b where b.dispatcher_user_id = v_uid and lower(b.broker) = lower(bc.broker)),
        'gross', (select coalesce(sum(gross),0) from app_private.dispatcher_bookings b where b.dispatcher_user_id = v_uid and lower(b.broker) = lower(bc.broker) and b.status not in ('cancelled','rejected'))
      )) order by bc.broker) from app_private.broker_contacts bc where bc.dispatcher_user_id = v_uid), '[]'::jsonb),
    'kpi', (select jsonb_build_object(
        'bookings_7d', count(*) filter (where created_at > now() - interval '7 days'),
        'delivered_7d', count(*) filter (where status in ('delivered','invoiced','paid') and updated_at > now() - interval '7 days'),
        'gross_7d', coalesce(sum(gross) filter (where status not in ('cancelled','rejected') and created_at > now() - interval '7 days'),0),
        'gross_total', coalesce(sum(gross) filter (where status not in ('cancelled','rejected')),0),
        'avg_rpm', round(avg(case when miles > 0 and status not in ('cancelled','rejected') then gross / miles end)::numeric, 2),
        'active', count(*) filter (where status in ('approved','dispatched','picked_up')),
        'awaiting_rc', count(*) filter (where status = 'pending_rc'),
        'awaiting_approval', count(*) filter (where status = 'rc_received'))
      from app_private.dispatcher_bookings where dispatcher_user_id = v_uid)
  ) into v_out;
  return v_out;
end $$;

-- staff-membership check for an arbitrary uid (feed labels who touched availability)
create or replace function app_private.disp_is_staff_user(p_uid uuid)
returns boolean language sql stable security definer set search_path = app_private, public as $$
  select exists (select 1 from app_private.staff_members s where s.user_id = p_uid and s.status = 'active');
$$;

-- ================================================================ dispatcher: availability (partial update, validated, role-aware)
create or replace function public.dispatcher_set_availability(p_truck uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid; v_role text; v_cur record; v_status text; v_hos numeric; v_empty timestamptz; v_home timestamptz; v_disp uuid;
begin
  select carrier_id into v_org from app_private.fleet_trucks where id = p_truck;
  if v_org is null then return jsonb_build_object('error','truck not found'); end if;
  v_role := app_private.disp_role_for(v_org);
  if v_role is null then return jsonb_build_object('error','not authorized'); end if;
  select * into v_cur from app_private.truck_availability where truck_id = p_truck;
  v_status := coalesce(nullif(p->>'status',''), v_cur.status, 'empty');
  if v_status not in ('empty','loaded','off','maintenance') then return jsonb_build_object('error','bad status'); end if;
  v_hos := case when p ? 'hos_drive_left_h' then nullif(p->>'hos_drive_left_h','')::numeric else v_cur.hos_drive_left_h end;
  if v_hos is not null and (v_hos < 0 or v_hos > 14) then return jsonb_build_object('error','drive hours left must be between 0 and 14'); end if;
  v_empty := case when p ? 'empty_at' then nullif(p->>'empty_at','')::timestamptz else v_cur.empty_at end;
  v_home  := case when p ? 'must_be_home_by' then nullif(p->>'must_be_home_by','')::timestamptz else v_cur.must_be_home_by end;
  if v_empty is not null and v_home is not null and v_home < v_empty then return jsonb_build_object('error','"must be home by" is before "empty from"'); end if;
  -- a dispatcher may not overwrite driver details the carrier already set
  if v_role = 'dispatcher' and v_cur.driver_name is not null and v_cur.updated_by is not null and not exists (select 1 from app_private.dispatcher_profiles dp where dp.user_id = v_cur.updated_by)
     and (coalesce(p->>'driver_name','') <> '' and p->>'driver_name' is distinct from v_cur.driver_name) then
    return jsonb_build_object('error','the carrier set the driver — ask them in the thread to change it');
  end if;
  insert into app_private.truck_availability as ta (truck_id, carrier_id, status, empty_at, empty_location, empty_zip, must_be_home_by, home_location,
      overnight_weekdays, overnight_weekends, hos_drive_left_h, hos_note, driver_name, driver_phone, note, updated_by, updated_at)
  values (p_truck, v_org, v_status, v_empty,
      case when p ? 'empty_location' then nullif(p->>'empty_location','') else v_cur.empty_location end,
      case when p ? 'empty_zip' then nullif(p->>'empty_zip','') else v_cur.empty_zip end,
      v_home,
      case when p ? 'home_location' then nullif(p->>'home_location','') else v_cur.home_location end,
      case when p ? 'overnight_weekdays' then coalesce((p->>'overnight_weekdays')::boolean, true) else coalesce(v_cur.overnight_weekdays, true) end,
      case when p ? 'overnight_weekends' then coalesce((p->>'overnight_weekends')::boolean, false) else coalesce(v_cur.overnight_weekends, false) end,
      v_hos,
      case when p ? 'hos_drive_left_h' and v_hos is distinct from v_cur.hos_drive_left_h then 'entered by ' || v_role || ' ' || to_char(now() at time zone 'America/New_York', 'Mon DD HH24:MI') || ' ET' else v_cur.hos_note end,
      case when p ? 'driver_name' then nullif(p->>'driver_name','') else v_cur.driver_name end,
      case when p ? 'driver_phone' then nullif(p->>'driver_phone','') else v_cur.driver_phone end,
      case when p ? 'note' then nullif(p->>'note','') else v_cur.note end,
      auth.uid(), now())
  on conflict (truck_id) do update set
      status = excluded.status, empty_at = excluded.empty_at, empty_location = excluded.empty_location, empty_zip = excluded.empty_zip,
      must_be_home_by = excluded.must_be_home_by, home_location = excluded.home_location,
      overnight_weekdays = excluded.overnight_weekdays, overnight_weekends = excluded.overnight_weekends,
      hos_drive_left_h = excluded.hos_drive_left_h, hos_note = excluded.hos_note,
      driver_name = excluded.driver_name, driver_phone = excluded.driver_phone, note = excluded.note,
      updated_by = auth.uid(), updated_at = now();
  -- carrier updated → tell the dispatcher (in-app only; it happens daily)
  if v_role = 'carrier' then
    select a.dispatcher_user_id into v_disp from app_private.dispatcher_assignments a where a.carrier_org_id = v_org and a.status = 'active' limit 1;
    if v_disp is not null then
      perform app_private.disp_notify(v_disp, 'dispatcher', 'dispatcher.availability', 'Carrier updated truck ' || coalesce((select unit_no from app_private.fleet_trucks where id = p_truck), ''),
        upper(v_status) || coalesce(' · empty at ' || (p->>'empty_location'), '') || coalesce(' · home by ' || to_char(v_home at time zone 'America/New_York', 'Mon DD HH24:MI') || ' ET', ''), '/app/agent/#dashboard', false);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'role', v_role);
end $$;

-- ================================================================ dispatcher: log booking (stops, duplicate RC, internal source)
create or replace function public.dispatcher_log_booking(p jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_org uuid := nullif(p->>'carrier_org_id','')::uuid; v_truck uuid := nullif(p->>'truck_id','')::uuid;
        v_id uuid; v_min numeric; v_gross numeric; v_miles int; v_below boolean := false; v_status text; v_pu timestamptz; v_warn text[] := '{}';
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  if not app_private.disp_is_assigned(v_org) then return jsonb_build_object('error','you are not assigned to this carrier'); end if;
  if v_truck is not null and not exists (select 1 from app_private.fleet_trucks where id = v_truck and carrier_id = v_org) then
    return jsonb_build_object('error','truck does not belong to this carrier'); end if;
  if coalesce(p->>'broker','') = '' or coalesce(p->>'origin','') = '' or coalesce(p->>'destination','') = '' then
    return jsonb_build_object('error','broker, origin and destination are required'); end if;
  v_gross := nullif(p->>'gross','')::numeric; v_miles := nullif(p->>'miles','')::int;
  if v_gross is null or v_gross <= 0 then return jsonb_build_object('error','gross rate is required'); end if;
  v_pu := nullif(p->>'pickup_at','')::timestamptz;
  if v_pu is not null and v_pu < now() - interval '12 hours' then return jsonb_build_object('error','pickup time is in the past — check the date (times are Eastern)'); end if;
  if coalesce(p->>'rc_number','') <> '' and exists (select 1 from app_private.dispatcher_bookings b where b.carrier_org_id = v_org and lower(b.rc_number) = lower(p->>'rc_number') and b.status not in ('cancelled','rejected')) then
    return jsonb_build_object('error','a booking with RC # ' || (p->>'rc_number') || ' already exists for this carrier'); end if;
  v_min := app_private.disp_effective_min(v_truck, v_org);
  if v_min is not null and v_miles is not null and v_miles > 0 and (v_gross / v_miles) < v_min then v_below := true; end if;
  if v_truck is not null and v_pu is not null and exists (select 1 from app_private.dispatcher_bookings b where b.truck_id = v_truck and b.status in ('approved','dispatched','picked_up')
       and tstzrange(b.pickup_at, coalesce(b.delivery_at, b.pickup_at + interval '1 day')) && tstzrange(v_pu, coalesce(nullif(p->>'delivery_at','')::timestamptz, v_pu + interval '1 day'))) then
    v_warn := v_warn || 'another approved load overlaps this truck in that window';
  end if;
  v_status := case when coalesce(p->>'rc_doc_path','') <> '' then 'rc_received' else 'pending_rc' end;
  insert into app_private.dispatcher_bookings (dispatcher_user_id, carrier_org_id, truck_id, broker, broker_mc, broker_rep, broker_phone, broker_email,
      origin, destination, pickup_at, delivery_at, miles, deadhead, gross, commodity, weight_lbs, equipment,
      rc_number, rc_doc_path, rc_doc_name, rc_received_at, status, below_min, notes, stops, source, load_id)
  values (v_uid, v_org, v_truck, p->>'broker', nullif(p->>'broker_mc',''), p->>'broker_rep', p->>'broker_phone', p->>'broker_email',
      p->>'origin', p->>'destination', v_pu, nullif(p->>'delivery_at','')::timestamptz,
      v_miles, nullif(p->>'deadhead','')::int, v_gross, p->>'commodity', nullif(p->>'weight_lbs','')::int, p->>'equipment',
      nullif(p->>'rc_number',''), nullif(p->>'rc_doc_path',''), p->>'rc_doc_name', case when coalesce(p->>'rc_doc_path','') <> '' then now() end,
      v_status, v_below, p->>'notes', case when jsonb_typeof(p->'stops') = 'array' then p->'stops' end, coalesce(nullif(p->>'source',''), 'external'), nullif(p->>'load_id','')::uuid)
  returning id into v_id;
  insert into app_private.dispatcher_booking_events (booking_id, kind, note, created_by)
    values (v_id, 'created', 'Booking logged by dispatcher' || case when v_below then ' — BELOW carrier minimum rate, needs a reason to approve' else '' end || case when array_length(v_warn,1) > 0 then ' — ' || array_to_string(v_warn, '; ') else '' end, v_uid);
  if v_status = 'rc_received' then
    insert into app_private.dispatcher_booking_events (booking_id, kind, note, created_by) values (v_id, 'rc', 'Rate confirmation attached: ' || coalesce(p->>'rc_doc_name',''), v_uid);
  end if;
  insert into app_private.broker_contacts as bc (dispatcher_user_id, broker, mc, rep, phone, email, last_contact_at, last_outcome)
    values (v_uid, p->>'broker', nullif(p->>'broker_mc',''), nullif(p->>'broker_rep',''), nullif(p->>'broker_phone',''), nullif(p->>'broker_email',''), now(), 'booked')
  on conflict (dispatcher_user_id, lower(broker)) do update set last_contact_at = now(), last_outcome = 'booked', updated_at = now(),
    mc = coalesce(excluded.mc, bc.mc), rep = coalesce(excluded.rep, bc.rep), phone = coalesce(excluded.phone, bc.phone), email = coalesce(excluded.email, bc.email);
  perform app_private.disp_notify(null, 'staff', case when v_status = 'rc_received' then 'dispatcher.rc_received' else 'dispatcher.booking.logged' end,
    (case when v_status = 'rc_received' then 'RC in — approve: ' else 'Booking logged (no RC yet): ' end) || (p->>'origin') || ' → ' || (p->>'destination'),
    (p->>'broker') || ' · $' || v_gross::text || coalesce(' · ' || v_miles || ' mi', '') || case when v_below then ' · BELOW MIN RATE' else '' end || coalesce(' · pickup ' || to_char(v_pu at time zone 'America/New_York', 'Dy Mon DD HH24:MI') || ' ET', '') || case when array_length(v_warn,1) > 0 then E'\n⚠ ' || array_to_string(v_warn, '; ') else '' end,
    '/app/command-center/#dispatchers?booking=' || v_id::text, v_status = 'rc_received');
  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status, 'below_min', v_below, 'warnings', to_jsonb(v_warn));
end $$;

-- ================================================================ dispatcher: booking update (locked, guarded, mirrored)
create or replace function public.dispatcher_booking_update(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_b record; v_to text := p->>'status'; v_ok boolean := false; v_staff boolean := app_private.disp_is_staff(); v_min numeric; v_dest text;
begin
  select * into v_b from app_private.dispatcher_bookings where id = p_id for update;
  if v_b.id is null then return jsonb_build_object('error','booking not found'); end if;
  if v_b.dispatcher_user_id <> v_uid and not v_staff then return jsonb_build_object('error','not authorized'); end if;
  if v_b.status in ('cancelled','rejected','paid') and not v_staff then return jsonb_build_object('error','booking is ' || v_b.status); end if;
  -- attach / replace RC — only before approval (after approval the RC on file is the one the trip was built on)
  if coalesce(p->>'rc_doc_path','') <> '' then
    if v_b.status not in ('pending_rc','rc_received') and not v_staff then return jsonb_build_object('error','the rate confirmation is locked once LoadBoot approved the load — message LoadBoot if the broker re-issued it'); end if;
    update app_private.dispatcher_bookings set rc_doc_path = p->>'rc_doc_path', rc_doc_name = p->>'rc_doc_name',
       rc_number = coalesce(nullif(p->>'rc_number',''), rc_number), rc_received_at = now(),
       status = case when status = 'pending_rc' then 'rc_received' else status end where id = p_id;
    insert into app_private.dispatcher_booking_events (booking_id, kind, note, created_by) values (p_id, 'rc', 'Rate confirmation attached: ' || coalesce(p->>'rc_doc_name',''), v_uid);
    if v_b.status = 'pending_rc' then
      perform app_private.disp_notify(null, 'staff', 'dispatcher.rc_received', 'RC in — approve: ' || v_b.origin || ' → ' || v_b.destination,
        v_b.broker || ' · $' || v_b.gross::text || case when v_b.below_min then ' · BELOW MIN RATE' else '' end || coalesce(' · pickup ' || to_char(v_b.pickup_at at time zone 'America/New_York', 'Dy Mon DD HH24:MI') || ' ET', ''),
        '/app/command-center/#dispatchers?booking=' || p_id::text, true);
    end if;
    v_ok := true;
  end if;
  -- editable fields while not yet approved (recompute the rate floor flag)
  if v_b.status in ('pending_rc','rc_received') and (p ? 'gross' or p ? 'miles' or p ? 'pickup_at' or p ? 'delivery_at' or p ? 'notes' or p ? 'stops' or p ? 'commodity' or p ? 'weight_lbs' or p ? 'broker_rep' or p ? 'broker_phone' or p ? 'broker_email' or p ? 'rc_number') then
    update app_private.dispatcher_bookings set
      gross = coalesce(nullif(p->>'gross','')::numeric, gross), miles = coalesce(nullif(p->>'miles','')::int, miles),
      pickup_at = coalesce(nullif(p->>'pickup_at','')::timestamptz, pickup_at), delivery_at = coalesce(nullif(p->>'delivery_at','')::timestamptz, delivery_at),
      notes = coalesce(p->>'notes', notes), commodity = coalesce(p->>'commodity', commodity), weight_lbs = coalesce(nullif(p->>'weight_lbs','')::int, weight_lbs),
      broker_rep = coalesce(p->>'broker_rep', broker_rep), broker_phone = coalesce(p->>'broker_phone', broker_phone), broker_email = coalesce(p->>'broker_email', broker_email),
      rc_number = coalesce(nullif(p->>'rc_number',''), rc_number),
      stops = case when jsonb_typeof(p->'stops') = 'array' then p->'stops' else stops end
     where id = p_id;
    v_min := app_private.disp_effective_min(v_b.truck_id, v_b.carrier_org_id);
    update app_private.dispatcher_bookings b set below_min = coalesce((v_min is not null and coalesce(b.miles,0) > 0 and (b.gross / nullif(b.miles,0)) < v_min), false) where b.id = p_id;
    insert into app_private.dispatcher_booking_events (booking_id, kind, note, created_by) values (p_id, 'note', 'Booking edited: ' || (select string_agg(k, ', ') from jsonb_object_keys(p) k where k <> 'status'), v_uid);
    v_ok := true;
  end if;
  if v_to is not null then
    if v_to = 'cancelled' then
      if v_b.status in ('delivered','invoiced','paid') then return jsonb_build_object('error','delivered loads cannot be cancelled'); end if;
      if v_b.status = 'picked_up' and not v_staff then return jsonb_build_object('error','the freight is on the truck — only LoadBoot can cancel now. Log an Exception and message LoadBoot.'); end if;
      if coalesce(btrim(p->>'note'),'') = '' then return jsonb_build_object('error','a reason is required to cancel'); end if;
      update app_private.dispatcher_bookings set status = 'cancelled', cancel_reason = p->>'note', decision_note = coalesce(decision_note, p->>'note') where id = p_id;
      insert into app_private.dispatcher_booking_events (booking_id, kind, note, to_status, created_by) values (p_id, 'status', 'Cancelled: ' || (p->>'note'), 'cancelled', v_uid);
      if v_b.trip_id is not null then
        begin
          update app_private.trips set status = 'cancelled', cancel_reason = 'dispatcher: ' || (p->>'note'), cancelled_by = 'carrier' where id = v_b.trip_id and status in ('planned','dispatched');
          insert into app_private.trip_events (trip_id, kind, note, created_by) values (v_b.trip_id, 'note', 'Cancelled by dispatcher: ' || (p->>'note'), v_uid);
        exception when others then null; end;
      end if;
      if v_b.status in ('approved','dispatched','picked_up') then
        update app_private.truck_availability set status = 'empty', updated_at = now() where truck_id = v_b.truck_id and status = 'loaded';
      end if;
      perform app_private.disp_notify(null, 'staff', 'dispatcher.booking.cancelled', 'Booking cancelled: ' || v_b.origin || ' → ' || v_b.destination,
        v_b.broker || ' · $' || v_b.gross::text || ' · was ' || v_b.status || E'\nReason: ' || (p->>'note'), '/app/command-center/#dispatchers?booking=' || p_id::text, v_b.status in ('approved','dispatched','picked_up'));
      if v_b.status in ('approved','dispatched','picked_up') then
        perform app_private.disp_notify((select owner_user_id from public.organizations where id = v_b.carrier_org_id), 'carrier', 'dispatcher.booking.cancelled.carrier',
          'Load cancelled: ' || v_b.origin || ' → ' || v_b.destination, 'Your dispatcher cancelled this load. Reason: ' || (p->>'note') || '. Your truck is marked empty again.', '/app/carrier/', true);
      end if;
      v_ok := true;
    elsif (v_b.status, v_to) in (('approved','dispatched'), ('dispatched','picked_up'), ('picked_up','delivered')) then
      update app_private.dispatcher_bookings set status = v_to where id = p_id;
      insert into app_private.dispatcher_booking_events (booking_id, kind, note, location, to_status, created_by)
        values (p_id, 'status', v_to || coalesce(': ' || (p->>'note'), ''), p->>'location', v_to, v_uid);
      if v_b.trip_id is not null then
        begin
          insert into app_private.trip_events (trip_id, kind, note, location, created_by)
            values (v_b.trip_id, 'note', 'Dispatcher: ' || v_to || coalesce(' — ' || (p->>'note'), ''), p->>'location', v_uid);
          if v_to = 'dispatched' then update app_private.trips set status = 'dispatched', dispatched_at = coalesce(dispatched_at, now()) where id = v_b.trip_id and status = 'planned'; end if;
        exception when others then null; end;
      end if;
      -- truck availability follows the load
      if v_to = 'dispatched' then
        update app_private.truck_availability set status = 'loaded', updated_at = now() where truck_id = v_b.truck_id;
      elsif v_to = 'delivered' then
        v_dest := v_b.destination;
        insert into app_private.truck_availability as ta (truck_id, carrier_id, status, empty_at, empty_location, updated_by, updated_at)
          values (v_b.truck_id, v_b.carrier_org_id, 'empty', now(), v_dest, v_uid, now())
        on conflict (truck_id) do update set status = 'empty', empty_at = now(), empty_location = v_dest, updated_by = v_uid, updated_at = now();
      end if;
      v_ok := true;
    elsif not v_ok then
      return jsonb_build_object('error', 'cannot move from ' || v_b.status || ' to ' || v_to || (case when v_to = 'approved' then ' — approval is done by LoadBoot' else '' end));
    end if;
  end if;
  if not v_ok then return jsonb_build_object('error','nothing to update'); end if;
  return jsonb_build_object('ok', true, 'status', (select status from app_private.dispatcher_bookings where id = p_id));
end $$;

-- events: guard status, ETA vs delivery late-risk note
create or replace function public.dispatcher_booking_event(p_booking uuid, p_kind text, p_note text, p_location text default null, p_eta timestamptz default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_b record; v_id uuid; v_late text := '';
begin
  select * into v_b from app_private.dispatcher_bookings where id = p_booking;
  if v_b.id is null then return jsonb_build_object('error','booking not found'); end if;
  if app_private.disp_role_for(v_b.carrier_org_id) is null and v_b.dispatcher_user_id <> auth.uid() then return jsonb_build_object('error','not authorized'); end if;
  if p_kind not in ('check_call','note','exception','eta') then return jsonb_build_object('error','bad kind'); end if;
  if v_b.status in ('cancelled','rejected') and p_kind <> 'note' then return jsonb_build_object('error','booking is ' || v_b.status); end if;
  if p_eta is not null and v_b.delivery_at is not null and p_eta > v_b.delivery_at + interval '30 minutes' then
    v_late := ' — ETA ' || round(extract(epoch from (p_eta - v_b.delivery_at))/3600, 1) || ' h after the delivery appointment';
  end if;
  insert into app_private.dispatcher_booking_events (booking_id, kind, note, location, eta_at, created_by)
    values (p_booking, p_kind, coalesce(p_note,'') || v_late, p_location, p_eta, auth.uid()) returning id into v_id;
  if v_b.trip_id is not null then
    begin
      insert into app_private.trip_events (trip_id, kind, note, location, created_by)
        values (v_b.trip_id, 'note', '[' || p_kind || '] ' || coalesce(p_note,'') || v_late, p_location, auth.uid());
    exception when others then null; end;
  end if;
  if p_kind = 'exception' or v_late <> '' then
    perform app_private.disp_notify(null, 'staff', 'dispatcher.booking.exception', (case when p_kind = 'exception' then 'Exception on ' else 'Late risk on ' end) || v_b.origin || ' → ' || v_b.destination,
      coalesce(p_note,'') || v_late || coalesce(E'\nAt: ' || p_location, ''), '/app/command-center/#dispatchers?booking=' || p_booking::text, true);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.dispatcher_booking_timeline(p_booking uuid)
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select case when exists (select 1 from app_private.dispatcher_bookings b where b.id = p_booking
                             and (b.dispatcher_user_id = auth.uid() or app_private.disp_role_for(b.carrier_org_id) is not null))
    then coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'note', e.note, 'location', e.location, 'eta_at', e.eta_at, 'to_status', e.to_status, 'created_at', e.created_at,
                     'by', case when app_private.disp_is_staff_user(e.created_by) then 'LoadBoot' else coalesce((select dp.full_name from app_private.dispatcher_profiles dp where dp.user_id = e.created_by), (select nullif(pr.contact_name,'') from public.profiles pr where pr.id = e.created_by), 'carrier') end) order by e.created_at)
                   from app_private.dispatcher_booking_events e where e.booking_id = p_booking), '[]'::jsonb)
    else jsonb_build_object('error','not authorized') end;
$$;

-- ================================================================ staff: approve / reject (guards, frozen pct, RC → carrier document, carrier notified)
create or replace function public.cc_dispatcher_booking_decide(p_id uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_b record; v_load uuid; v_trip uuid; v_truck text; v_drv record; v_pct numeric; v_owner uuid; v_dup text; v_aid uuid; v_cname text;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select * into v_b from app_private.dispatcher_bookings where id = p_id for update;
  if v_b.id is null then return jsonb_build_object('error','booking not found'); end if;
  select owner_user_id, name into v_owner, v_cname from public.organizations where id = v_b.carrier_org_id;
  if p_action = 'approve' then
    if v_b.status not in ('pending_rc','rc_received') then return jsonb_build_object('error','already ' || v_b.status); end if;
    if v_b.rc_doc_path is null then return jsonb_build_object('error','no rate confirmation attached — ask the dispatcher for the RC first'); end if;
    if v_b.below_min and coalesce(btrim(p_note),'') = '' then return jsonb_build_object('error','this load is below the carrier''s minimum rate — write the reason you are approving it (the carrier sees it)'); end if;
    if v_b.pickup_at is null then return jsonb_build_object('error','pickup time is missing — ask the dispatcher to edit the booking'); end if;
    if v_b.pickup_at < now() - interval '2 hours' then return jsonb_build_object('error','pickup time is already in the past (' || to_char(v_b.pickup_at at time zone 'America/New_York', 'Mon DD HH24:MI') || ' ET) — have the dispatcher correct it'); end if;
    if v_b.rc_number is not null and exists (select 1 from app_private.dispatcher_bookings x where x.id <> p_id and x.carrier_org_id = v_b.carrier_org_id and lower(x.rc_number) = lower(v_b.rc_number) and x.status not in ('cancelled','rejected')) then
      return jsonb_build_object('error','RC # ' || v_b.rc_number || ' is already on another active booking for this carrier'); end if;
    select x.origin || ' → ' || x.destination || ' (' || to_char(x.pickup_at at time zone 'America/New_York', 'Mon DD HH24:MI') || ' ET)' into v_dup
      from app_private.dispatcher_bookings x where x.id <> p_id and x.truck_id = v_b.truck_id and x.status in ('approved','dispatched','picked_up')
       and tstzrange(x.pickup_at, coalesce(x.delivery_at, x.pickup_at + interval '1 day')) && tstzrange(v_b.pickup_at, coalesce(v_b.delivery_at, v_b.pickup_at + interval '1 day')) limit 1;
    if v_dup is not null and coalesce(p_note,'') not ilike '%override%' then return jsonb_build_object('error','this truck already has an approved load in that window: ' || v_dup || ' — add "override" to the note to approve anyway'); end if;
    select unit_no into v_truck from app_private.fleet_trucks where id = v_b.truck_id;
    select driver_name, driver_phone into v_drv from app_private.truck_availability where truck_id = v_b.truck_id;
    if v_drv.driver_name is null then return jsonb_build_object('error','no driver on unit ' || coalesce(v_truck,'?') || ' — the carrier (or dispatcher) must set the driver name on the truck first'); end if;
    select coalesce(commission_pct,0) into v_pct from app_private.dispatcher_profiles where user_id = v_b.dispatcher_user_id;
    if v_b.load_id is null then
      insert into public.loads(origin, destination, equipment, rate, miles, commodity, pickup_date, delivery_date, broker, status, source_type, source_provider, notes, created_by, assigned_to)
        values (v_b.origin, v_b.destination, v_b.equipment, v_b.gross, v_b.miles, v_b.commodity,
                (v_b.pickup_at at time zone 'America/New_York')::date, (v_b.delivery_at at time zone 'America/New_York')::date,
                v_b.broker, 'booked', 'staff_entered', 'dispatcher', 'Logged by dispatcher; RC ' || coalesce(v_b.rc_number,''), auth.uid(), v_owner)
        returning id into v_load;
    else v_load := v_b.load_id; end if;
    if v_b.trip_id is null then
      begin
        insert into app_private.trips(load_id, carrier_id, driver_name, driver_phone, truck_no, truck_id, rate, miles, scheduled_pickup, scheduled_delivery, created_by)
          values (v_load, v_b.carrier_org_id, v_drv.driver_name, v_drv.driver_phone, v_truck, v_b.truck_id, v_b.gross, v_b.miles, v_b.pickup_at, v_b.delivery_at, auth.uid())
          returning id into v_trip;
      exception when others then
        if v_b.load_id is null then delete from public.loads where id = v_load; end if;
        insert into app_private.dispatcher_booking_events (booking_id, kind, note, created_by) values (p_id, 'decision', 'Approval blocked: ' || sqlerrm, auth.uid());
        return jsonb_build_object('error', 'Cannot create the trip: ' || sqlerrm);
      end;
      insert into app_private.trip_stops(trip_id, kind, sort, location, scheduled_at) values
        (v_trip, 'pickup', 1, v_b.origin, v_b.pickup_at), (v_trip, 'delivery', 2, v_b.destination, v_b.delivery_at);
      insert into app_private.trip_events(trip_id, kind, to_status, note, created_by) values (v_trip, 'status', 'planned', 'trip created from dispatcher booking ' || v_b.id::text, auth.uid());
    else v_trip := v_b.trip_id; end if;
    update app_private.dispatcher_bookings set status = 'approved', load_id = v_load, trip_id = v_trip, approved_by = auth.uid(), approved_at = now(), decision_note = p_note, commission_pct = v_pct where id = p_id;
    insert into app_private.dispatcher_booking_events (booking_id, kind, note, to_status, created_by) values (p_id, 'decision', 'Approved by LoadBoot' || coalesce(': ' || p_note, ''), 'approved', auth.uid());
    -- register the RC as a carrier document so the carrier and CC can open it (the file stays where it was uploaded)
    begin
      insert into public.documents (carrier_id, type, status, file_name, file_path, source, source_note, uploaded_by, review_note, reviewed_at)
      values (v_owner, 'rate_con', 'approved', coalesce(v_b.rc_doc_name, 'Rate confirmation ' || coalesce(v_b.rc_number,'')), v_b.rc_doc_path, 'dispatcher',
              'Rate confirmation for ' || v_b.origin || ' → ' || v_b.destination || ' (' || v_b.broker || coalesce(', RC ' || v_b.rc_number, '') || ') — logged by the dispatcher, approved by LoadBoot', auth.uid(), 'Approved with the dispatcher booking ' || p_id::text, now());
    exception when others then null; end;
    select a.id into v_aid from app_private.dispatcher_assignments a where a.carrier_org_id = v_b.carrier_org_id and a.dispatcher_user_id = v_b.dispatcher_user_id and a.status = 'active' limit 1;
    if v_aid is not null then
      insert into app_private.dispatcher_messages(assignment_id, carrier_org_id, sender_role, body)
        values (v_aid, v_b.carrier_org_id, 'system', 'LoadBoot approved: ' || v_b.origin || ' → ' || v_b.destination || ' · ' || v_b.broker || ' · $' || v_b.gross::text || ' · pickup ' || to_char(v_b.pickup_at at time zone 'America/New_York', 'Dy Mon DD HH24:MI') || ' ET · driver ' || coalesce(v_drv.driver_name,'?') || coalesce(' · ' || p_note, '') || '. Dispatcher: send the driver the pickup details and mark Dispatched.');
    end if;
    perform app_private.disp_notify(v_b.dispatcher_user_id, 'dispatcher', 'dispatcher.booking.approved', 'Booking approved — dispatch the driver', v_b.origin || ' → ' || v_b.destination || ' · pickup ' || to_char(v_b.pickup_at at time zone 'America/New_York', 'Dy Mon DD HH24:MI') || ' ET' || coalesce(E'\nLoadBoot note: ' || p_note, ''), '/app/agent/#dashboard', true);
    perform app_private.disp_notify(v_owner, 'carrier', 'dispatcher.booking.approved.carrier', 'Load approved for your truck: ' || v_b.origin || ' → ' || v_b.destination,
      v_b.broker || ' · $' || v_b.gross::text || coalesce(' · ' || v_b.miles || ' mi', '') || ' · pickup ' || to_char(v_b.pickup_at at time zone 'America/New_York', 'Dy Mon DD HH24:MI') || ' ET · driver ' || coalesce(v_drv.driver_name,'?') || case when v_b.below_min then E'\nNote: this rate is below your minimum — LoadBoot reason: ' || coalesce(p_note,'') else '' end || E'\nThe rate confirmation is in your Documents. Reply in the dispatcher thread if anything is wrong.', '/app/carrier/', true);
    perform app_private.disp_audit('dispatcher.booking.approve', 'booking', p_id::text, v_b.carrier_org_id, 'approved ' || v_b.origin || ' → ' || v_b.destination || ' $' || v_b.gross::text, jsonb_build_object('load', v_load, 'trip', v_trip, 'below_min', v_b.below_min, 'note', p_note, 'pct', v_pct));
    return jsonb_build_object('ok', true, 'load', v_load, 'trip', v_trip);
  elsif p_action = 'reject' then
    if coalesce(btrim(p_note),'') = '' then return jsonb_build_object('error','write the reason — the dispatcher sees it'); end if;
    update app_private.dispatcher_bookings set status = 'rejected', decision_note = p_note where id = p_id and status in ('pending_rc','rc_received');
    if not found then return jsonb_build_object('error','cannot reject in status ' || v_b.status); end if;
    insert into app_private.dispatcher_booking_events (booking_id, kind, note, to_status, created_by) values (p_id, 'decision', 'Rejected by LoadBoot: ' || p_note, 'rejected', auth.uid());
    perform app_private.disp_notify(v_b.dispatcher_user_id, 'dispatcher', 'dispatcher.booking.rejected', 'Booking not approved', v_b.origin || ' → ' || v_b.destination || E'\n' || p_note, '/app/agent/#dashboard', true);
    perform app_private.disp_audit('dispatcher.booking.reject', 'booking', p_id::text, v_b.carrier_org_id, 'rejected: ' || p_note, '{}'::jsonb);
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('error','bad action — invoiced/paid now follow the trip, not this button');
end $$;

-- ================================================================ commission: frozen pct, payout record, audit, notify
create or replace function app_private.disp_booking_commission_trg()
returns trigger language plpgsql security definer set search_path = app_private, public as $$
declare v_pct numeric;
begin
  if new.status in ('delivered','invoiced','paid') then
    v_pct := new.commission_pct;
    if v_pct is null then select coalesce(commission_pct,0) into v_pct from app_private.dispatcher_profiles where user_id = new.dispatcher_user_id; end if;
    insert into app_private.dispatcher_commission (booking_id, dispatcher_user_id, carrier_org_id, gross, pct, amount)
      values (new.id, new.dispatcher_user_id, new.carrier_org_id, new.gross, v_pct, round(new.gross * v_pct / 100, 2))
      on conflict (booking_id) do update
        set gross = excluded.gross, pct = excluded.pct, amount = excluded.amount
      where app_private.dispatcher_commission.status = 'draft';
  elsif new.status in ('cancelled','rejected') then
    update app_private.dispatcher_commission set status = 'void', note = coalesce(note,'') || ' voided: booking ' || new.status where booking_id = new.id and status in ('draft','approved');
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.cc_dispatcher_commission_status(p_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_c record;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if p_status not in ('approved','void','draft') then return jsonb_build_object('error','use cc_dispatcher_commission_pay to mark paid'); end if;
  select * into v_c from app_private.dispatcher_commission where id = p_id for update;
  if v_c.id is null then return jsonb_build_object('error','not found'); end if;
  if v_c.status = 'paid' then return jsonb_build_object('error','already paid — cannot change'); end if;
  if p_status = 'void' and coalesce(btrim(p_note),'') = '' then return jsonb_build_object('error','write why this commission is voided'); end if;
  update app_private.dispatcher_commission set status = p_status, note = coalesce(p_note, note),
     approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
     approved_at = case when p_status = 'approved' then now() else approved_at end where id = p_id;
  if p_status = 'approved' then
    perform app_private.disp_notify(v_c.dispatcher_user_id, 'dispatcher', 'dispatcher.commission.approved', 'Commission approved: $' || v_c.amount::text, (select origin || ' → ' || destination from app_private.dispatcher_bookings where id = v_c.booking_id) || ' · ' || v_c.pct || '% of $' || v_c.gross::text, '/app/agent/#dashboard', false);
  end if;
  perform app_private.disp_audit('dispatcher.commission.' || p_status, 'commission', p_id::text, v_c.carrier_org_id, '$' || v_c.amount::text || ' → ' || p_status || coalesce(': ' || p_note, ''), '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cc_dispatcher_commission_pay(p_ids uuid[], p jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_n int; v_user uuid; v_total numeric;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if coalesce(p->>'payout_ref','') = '' then return jsonb_build_object('error','payout reference (transfer id / receipt) is required'); end if;
  if coalesce(p->>'paid_currency','') = '' or nullif(p->>'paid_amount','')::numeric is null then return jsonb_build_object('error','paid amount and currency are required (what actually left the account)'); end if;
  update app_private.dispatcher_commission set status = 'paid', paid_at = now(), paid_by = auth.uid(),
     paid_amount = nullif(p->>'paid_amount','')::numeric, paid_currency = upper(p->>'paid_currency'), fx_rate = nullif(p->>'fx_rate','')::numeric,
     payout_ref = p->>'payout_ref', payout_method = p->>'payout_method', note = coalesce(nullif(p->>'note',''), note)
   where id = any(p_ids) and status = 'approved';
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('error','nothing paid — only approved lines can be paid'); end if;
  select dispatcher_user_id, sum(amount) into v_user, v_total from app_private.dispatcher_commission where id = any(p_ids) group by dispatcher_user_id limit 1;
  perform app_private.disp_notify(v_user, 'dispatcher', 'dispatcher.commission.paid', 'Commission paid: $' || v_total::text || ' (' || v_n || ' load' || case when v_n = 1 then '' else 's' end || ')',
    'Sent ' || (p->>'paid_amount') || ' ' || upper(p->>'paid_currency') || coalesce(' @ ' || (p->>'fx_rate'), '') || ' · ref ' || (p->>'payout_ref') || coalesce(' · ' || (p->>'payout_method'), '') || '. See Money in your workspace.', '/app/agent/#dashboard', true);
  perform app_private.disp_audit('dispatcher.commission.paid', 'dispatcher', v_user::text, null, v_n || ' lines, $' || v_total::text || ' → ' || (p->>'paid_amount') || ' ' || upper(p->>'paid_currency') || ' ref ' || (p->>'payout_ref'), p);
  return jsonb_build_object('ok', true, 'paid', v_n, 'total_usd', v_total);
end $$;

-- ================================================================ thread: reads table, staff alerted, no e-mails leaked
create or replace function public.dispatcher_thread_list(p_assignment uuid, p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare v_a record; v_role text;
begin
  select * into v_a from app_private.dispatcher_assignments where id = p_assignment;
  if v_a.id is null then return jsonb_build_object('error','not found'); end if;
  v_role := app_private.disp_role_for(v_a.carrier_org_id);
  if v_role is null then return jsonb_build_object('error','not authorized'); end if;
  return jsonb_build_object('role', v_role, 'status', v_a.status, 'participants', jsonb_build_object(
      'dispatcher', (select full_name from app_private.dispatcher_profiles where user_id = v_a.dispatcher_user_id),
      'carrier', (select coalesce(nullif(p.contact_name,''), o.name) from public.organizations o left join public.profiles p on p.id = o.owner_user_id where o.id = v_a.carrier_org_id),
      'staff', 'LoadBoot dispatch'),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'role', m.sender_role, 'body', m.body, 'at', m.created_at, 'mine', m.sender_user = auth.uid(),
      'by', case m.sender_role when 'staff' then 'LoadBoot' when 'system' then 'LoadBoot' when 'dispatcher' then (select full_name from app_private.dispatcher_profiles where user_id = m.sender_user)
            else (select coalesce(nullif(pr.contact_name,''), 'Carrier') from public.profiles pr where pr.id = m.sender_user) end) order by m.created_at)
    from (select * from app_private.dispatcher_messages where assignment_id = p_assignment order by created_at desc limit p_limit) m), '[]'::jsonb));
end $$;

create or replace function public.dispatcher_thread_mark_read(p_assignment uuid)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_a record;
begin
  select * into v_a from app_private.dispatcher_assignments where id = p_assignment;
  if v_a.id is null or app_private.disp_role_for(v_a.carrier_org_id) is null then return jsonb_build_object('error','not authorized'); end if;
  insert into app_private.dispatcher_thread_reads(assignment_id, user_id, read_at) values (p_assignment, auth.uid(), now())
  on conflict (assignment_id, user_id) do update set read_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.dispatcher_thread_send(p_assignment uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_a record; v_role text; v_id uuid; v_owner uuid; v_from text; v_urgent boolean;
begin
  if coalesce(btrim(p_body),'') = '' then return jsonb_build_object('error','empty message'); end if;
  if length(p_body) > 4000 then return jsonb_build_object('error','message is longer than 4000 characters'); end if;
  select * into v_a from app_private.dispatcher_assignments where id = p_assignment;
  if v_a.id is null then return jsonb_build_object('error','not found'); end if;
  if v_a.status <> 'active' and not app_private.disp_is_staff() then return jsonb_build_object('error','this assignment is ' || v_a.status); end if;
  v_role := app_private.disp_role_for(v_a.carrier_org_id);
  if v_role is null then return jsonb_build_object('error','not authorized'); end if;
  insert into app_private.dispatcher_messages (assignment_id, carrier_org_id, sender_user, sender_role, body)
    values (p_assignment, v_a.carrier_org_id, auth.uid(), v_role, p_body) returning id into v_id;
  insert into app_private.dispatcher_thread_reads(assignment_id, user_id, read_at) values (p_assignment, auth.uid(), now()) on conflict (assignment_id, user_id) do update set read_at = now();
  select owner_user_id into v_owner from public.organizations where id = v_a.carrier_org_id;
  v_from := case v_role when 'dispatcher' then coalesce((select full_name from app_private.dispatcher_profiles where user_id = auth.uid()), 'your dispatcher') when 'staff' then 'LoadBoot' else 'the carrier' end;
  v_urgent := p_body ~* '(urgent|breakdown|accident|refus|cancel|detention|late|emergency|police|damage)';
  if v_role <> 'dispatcher' then
    perform app_private.disp_notify(v_a.dispatcher_user_id, 'dispatcher', 'dispatcher.thread', 'Message from ' || v_from, left(p_body, 300), '/app/agent/#dashboard', true);
  end if;
  if v_role <> 'carrier' and v_owner is not null then
    perform app_private.disp_notify(v_owner, 'carrier', 'dispatcher.thread', 'Message from ' || v_from, left(p_body, 300), '/app/carrier/', true);
  end if;
  if v_role <> 'staff' then
    perform app_private.disp_notify(null, 'staff', case when v_urgent then 'dispatcher.thread.exception' else 'dispatcher.thread' end,
      (case when v_urgent then 'URGENT thread message from ' else 'Thread: ' end) || v_from || ' · ' || (select name from public.organizations where id = v_a.carrier_org_id), left(p_body, 300), '/app/command-center/#dispatchers?assignment=' || p_assignment::text, v_urgent);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'role', v_role);
end $$;

-- ================================================================ carrier side
create or replace function public.carrier_my_dispatcher()
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select coalesce((select jsonb_agg(jsonb_build_object('assignment_id', a.id, 'carrier_org_id', a.carrier_org_id, 'assigned_at', a.assigned_at, 'status', a.status,
      'carrier_ack_at', a.carrier_ack_at, 'sop', coalesce(a.sop,'{}'::jsonb) - 'disp_read_at',
      'dispatcher', jsonb_build_object('name', dp.full_name, 'phone', dp.phone, 'country', dp.country,
          'hours', coalesce(dp.skills->>'timezone',''), 'us_hours', coalesce((dp.skills->>'us_hours_overlap')::boolean, false),
          'label', case when dp.status in ('trial','verified','active') then 'LoadBoot dispatcher' else 'LoadBoot dispatcher (paused)' end),
      'unread', (select count(*) from app_private.dispatcher_messages m where m.assignment_id = a.id and m.sender_role <> 'carrier'
                   and m.created_at > coalesce((select r.read_at from app_private.dispatcher_thread_reads r where r.assignment_id = a.id and r.user_id = auth.uid()), a.assigned_at)),
      'trucks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'unit_no', t.unit_no, 'equipment', t.equipment,
                    'availability', (select (to_jsonb(av) - 'truck_id' - 'carrier_id') || jsonb_build_object('updated_by_role',
                        case when av.updated_by is null then 'eld' when exists (select 1 from app_private.dispatcher_profiles dp2 where dp2.user_id = av.updated_by) then 'dispatcher'
                             when app_private.disp_is_staff_user(av.updated_by) then 'loadboot' else 'you' end)
                      from app_private.truck_availability av where av.truck_id = t.id)) order by t.unit_no)
                  from app_private.fleet_trucks t where t.carrier_id = a.carrier_org_id and coalesce(t.status,'active') not in ('inactive','retired')), '[]'::jsonb)))
    from app_private.dispatcher_assignments a join app_private.dispatcher_profiles dp on dp.user_id = a.dispatcher_user_id
    where a.status in ('active','paused') and app_private.disp_is_carrier_member(a.carrier_org_id)), '[]'::jsonb);
$$;

-- loads the dispatcher booked under my MC (no commission fields, no dispatcher-private notes)
create or replace function public.carrier_my_dispatcher_bookings(p_limit int default 100)
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'status', b.status, 'broker', b.broker, 'broker_mc', b.broker_mc, 'origin', b.origin, 'destination', b.destination,
      'pickup_at', b.pickup_at, 'delivery_at', b.delivery_at, 'miles', b.miles, 'gross', b.gross, 'commodity', b.commodity, 'weight_lbs', b.weight_lbs, 'equipment', b.equipment,
      'rc_number', b.rc_number, 'rc_doc_path', case when b.status in ('approved','dispatched','picked_up','delivered','invoiced','paid') then b.rc_doc_path end,
      'below_min', b.below_min, 'decision_note', case when b.status <> 'rejected' then b.decision_note end, 'stops', b.stops, 'trip_id', b.trip_id, 'created_at', b.created_at, 'approved_at', b.approved_at,
      'truck', (select unit_no from app_private.fleet_trucks t where t.id = b.truck_id),
      'carrier_ack', (select e.note from app_private.dispatcher_booking_events e where e.booking_id = b.id and e.kind = 'decision' and e.note like 'Carrier %' order by e.created_at desc limit 1)) order by b.created_at desc)
    from (select * from app_private.dispatcher_bookings b where app_private.disp_is_carrier_member(b.carrier_org_id) and b.status <> 'rejected' order by b.created_at desc limit p_limit) b), '[]'::jsonb);
$$;

create or replace function public.carrier_dispatcher_ack(p_assignment uuid)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_a record;
begin
  select * into v_a from app_private.dispatcher_assignments where id = p_assignment;
  if v_a.id is null or not app_private.disp_is_carrier_member(v_a.carrier_org_id) then return jsonb_build_object('error','not authorized'); end if;
  update app_private.dispatcher_assignments set carrier_ack_at = now(), carrier_ack_by = auth.uid(), updated_at = now() where id = p_assignment;
  insert into app_private.dispatcher_messages(assignment_id, carrier_org_id, sender_role, body) values (p_assignment, v_a.carrier_org_id, 'system', 'The carrier confirmed the dispatcher assignment.');
  perform app_private.disp_audit('dispatcher.carrier_ack', 'assignment', p_assignment::text, v_a.carrier_org_id, 'carrier confirmed the dispatcher assignment', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

-- carrier pauses his dispatcher (or asks to resume) — LoadBoot is told immediately
create or replace function public.carrier_dispatcher_pause(p_assignment uuid, p_pause boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_a record; v_name text;
begin
  select * into v_a from app_private.dispatcher_assignments where id = p_assignment;
  if v_a.id is null or not app_private.disp_is_carrier_member(v_a.carrier_org_id) then return jsonb_build_object('error','not authorized'); end if;
  if p_pause and coalesce(btrim(p_reason),'') = '' then return jsonb_build_object('error','tell LoadBoot why (one line is enough)'); end if;
  update app_private.dispatcher_assignments set status = case when p_pause then 'paused' else 'active' end, end_reason = case when p_pause then 'carrier: ' || p_reason else end_reason end, updated_at = now() where id = p_assignment;
  select name into v_name from public.organizations where id = v_a.carrier_org_id;
  insert into app_private.dispatcher_messages(assignment_id, carrier_org_id, sender_role, body) values (p_assignment, v_a.carrier_org_id, 'system',
    case when p_pause then 'The carrier PAUSED this dispatcher assignment: ' || p_reason || '. No new loads until LoadBoot and the carrier resume it.' else 'The carrier resumed the dispatcher assignment.' end);
  perform app_private.disp_notify(null, 'staff', case when p_pause then 'dispatcher.paused_by_carrier.exception' else 'dispatcher.resumed_by_carrier' end,
    coalesce(v_name,'Carrier') || (case when p_pause then ' PAUSED their dispatcher' else ' resumed their dispatcher' end), coalesce(p_reason,''), '/app/command-center/#dispatchers?assignment=' || p_assignment::text, p_pause);
  perform app_private.disp_notify(v_a.dispatcher_user_id, 'dispatcher', 'dispatcher.paused_by_carrier', (case when p_pause then 'Assignment paused by the carrier' else 'Assignment resumed' end), coalesce(p_reason, ''), '/app/agent/#dashboard', true);
  perform app_private.disp_audit('dispatcher.carrier_pause', 'assignment', p_assignment::text, v_a.carrier_org_id, (case when p_pause then 'paused' else 'resumed' end) || coalesce(': ' || p_reason, ''), '{}'::jsonb);
  return jsonb_build_object('ok', true, 'status', case when p_pause then 'paused' else 'active' end);
end $$;

-- carrier acknowledges an approved load ("got it" / "problem") — a problem alerts LoadBoot + the dispatcher
create or replace function public.carrier_booking_ack(p_booking uuid, p_ok boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_b record;
begin
  select * into v_b from app_private.dispatcher_bookings where id = p_booking;
  if v_b.id is null or not app_private.disp_is_carrier_member(v_b.carrier_org_id) then return jsonb_build_object('error','not authorized'); end if;
  if v_b.status not in ('approved','dispatched') then return jsonb_build_object('error','load is ' || v_b.status); end if;
  if not p_ok and coalesce(btrim(p_note),'') = '' then return jsonb_build_object('error','say what the problem is'); end if;
  insert into app_private.dispatcher_booking_events (booking_id, kind, note, created_by) values (p_booking, 'decision', case when p_ok then 'Carrier confirmed the load' else 'Carrier flagged a PROBLEM: ' || p_note end || coalesce(case when p_ok then ' — ' || nullif(p_note,'') end, ''), auth.uid());
  if not p_ok then
    perform app_private.disp_notify(null, 'staff', 'dispatcher.booking.exception', 'Carrier problem on ' || v_b.origin || ' → ' || v_b.destination, p_note, '/app/command-center/#dispatchers?booking=' || p_booking::text, true);
    perform app_private.disp_notify(v_b.dispatcher_user_id, 'dispatcher', 'dispatcher.booking.exception', 'Carrier flagged a problem: ' || v_b.origin || ' → ' || v_b.destination, p_note, '/app/agent/#dashboard', true);
  else
    perform app_private.disp_notify(v_b.dispatcher_user_id, 'dispatcher', 'dispatcher.booking.ack', 'Carrier confirmed: ' || v_b.origin || ' → ' || v_b.destination, coalesce(p_note, 'Driver is go.'), '/app/agent/#dashboard', false);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ================================================================ staff: cross-dispatcher queue
create or replace function public.cc_dispatcher_queue()
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select case when not app_private.disp_is_staff() then jsonb_build_object('error','not authorized') else jsonb_build_object(
    'awaiting_approval', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'dispatcher', (select full_name from app_private.dispatcher_profiles where user_id = b.dispatcher_user_id), 'dispatcher_user_id', b.dispatcher_user_id,
        'carrier', (select name from public.organizations where id = b.carrier_org_id), 'lane', b.origin || ' → ' || b.destination, 'broker', b.broker, 'gross', b.gross, 'miles', b.miles,
        'pickup_at', b.pickup_at, 'below_min', b.below_min, 'rc_received_at', b.rc_received_at, 'rc_doc_path', b.rc_doc_path, 'rc_doc_name', b.rc_doc_name,
        'age_min', round(extract(epoch from (now() - coalesce(b.rc_received_at, b.created_at)))/60), 'hours_to_pickup', round(extract(epoch from (b.pickup_at - now()))/3600, 1),
        'driver_set', exists (select 1 from app_private.truck_availability av where av.truck_id = b.truck_id and av.driver_name is not null)) order by b.pickup_at nulls last)
      from app_private.dispatcher_bookings b where b.status = 'rc_received'), '[]'::jsonb),
    'awaiting_rc', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'dispatcher', (select full_name from app_private.dispatcher_profiles where user_id = b.dispatcher_user_id), 'carrier', (select name from public.organizations where id = b.carrier_org_id),
        'lane', b.origin || ' → ' || b.destination, 'broker', b.broker, 'gross', b.gross, 'pickup_at', b.pickup_at, 'age_min', round(extract(epoch from (now() - b.created_at))/60)) order by b.pickup_at nulls last)
      from app_private.dispatcher_bookings b where b.status = 'pending_rc'), '[]'::jsonb),
    'moving', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'dispatcher', (select full_name from app_private.dispatcher_profiles where user_id = b.dispatcher_user_id), 'carrier', (select name from public.organizations where id = b.carrier_org_id),
        'lane', b.origin || ' → ' || b.destination, 'status', b.status, 'trip_id', b.trip_id, 'delivery_at', b.delivery_at,
        'last_touch_min', round(extract(epoch from (now() - coalesce((select max(e.created_at) from app_private.dispatcher_booking_events e where e.booking_id = b.id and e.kind in ('check_call','status','eta')), b.updated_at)))/60)) order by b.delivery_at nulls last)
      from app_private.dispatcher_bookings b where b.status in ('approved','dispatched','picked_up')), '[]'::jsonb),
    'unread_threads', coalesce((select jsonb_agg(jsonb_build_object('assignment_id', a.id, 'carrier', (select name from public.organizations where id = a.carrier_org_id), 'dispatcher_user_id', a.dispatcher_user_id,
        'unread', (select count(*) from app_private.dispatcher_messages m where m.assignment_id = a.id and m.sender_role in ('dispatcher','carrier') and m.created_at > coalesce((select r.read_at from app_private.dispatcher_thread_reads r where r.assignment_id = a.id and r.user_id = auth.uid()), a.assigned_at))))
      from app_private.dispatcher_assignments a where a.status = 'active'), '[]'::jsonb),
    'commission_to_approve', (select count(*) from app_private.dispatcher_commission where status = 'draft'),
    'commission_to_pay', (select count(*) from app_private.dispatcher_commission where status = 'approved'),
    'trials_ending', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', p.full_name, 'trial_end', p.trial_end, 'days_left', p.trial_end - current_date))
      from app_private.dispatcher_profiles p where p.status = 'trial' and p.trial_end is not null and p.trial_end <= current_date + 3), '[]'::jsonb)) end;
$$;

-- ================================================================ KPIs: to_status, per-truck, trial window from profile
create or replace function app_private.disp_kpis(p_user uuid, p_days int default 30)
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  with b as (
    select * from app_private.dispatcher_bookings
     where dispatcher_user_id = p_user and created_at > now() - make_interval(days => p_days)
  ), moving as (
    select b.id, b.status, b.updated_at, b.delivery_at, b.trip_id,
           (select count(*) from app_private.dispatcher_booking_events e where e.booking_id = b.id and e.kind = 'check_call') as calls,
           (select min(e.created_at) from app_private.dispatcher_booking_events e where e.booking_id = b.id and e.kind = 'status' and e.to_status = 'dispatched') as dispatched_at,
           coalesce((select t.delivered_at from app_private.trips t where t.id = b.trip_id),
                    (select min(e.created_at) from app_private.dispatcher_booking_events e where e.booking_id = b.id and e.kind = 'status' and e.to_status = 'delivered')) as delivered_at,
           (select max(e.created_at) - min(e.created_at) from app_private.dispatcher_booking_events e where e.booking_id = b.id and e.kind in ('rc','created')) as rc_turnaround
      from b
  ), trucks as (
    select count(distinct t.id) as n from app_private.dispatcher_assignments a join app_private.fleet_trucks t on t.carrier_id = a.carrier_org_id
     where a.dispatcher_user_id = p_user and a.status = 'active' and coalesce(t.status,'active') not in ('inactive','retired')
  )
  select jsonb_build_object(
    'days', p_days, 'trucks', (select n from trucks),
    'bookings', (select count(*) from b),
    'delivered', (select count(*) from b where status in ('delivered','invoiced','paid')),
    'cancelled', (select count(*) from b where status in ('cancelled','rejected')),
    'gross', coalesce((select sum(gross) from b where status not in ('cancelled','rejected')), 0),
    'avg_rpm', (select round(avg(gross / miles)::numeric, 2) from b where miles > 0 and status not in ('cancelled','rejected')),
    'deadhead_pct', (select round(100.0 * sum(coalesce(deadhead,0)) / nullif(sum(coalesce(miles,0) + coalesce(deadhead,0)),0)) from b where status not in ('cancelled','rejected')),
    'below_min_share', (select round(100.0 * count(*) filter (where below_min) / nullif(count(*),0)) from b),
    'on_time_pct', (select round(100.0 * count(*) filter (where delivered_at <= delivery_at + interval '30 minutes') / nullif(count(*) filter (where delivered_at is not null and delivery_at is not null),0)) from moving),
    'check_calls_per_load', (select round(avg(calls)::numeric, 1) from moving where dispatched_at is not null),
    'rc_attach_rate', (select round(100.0 * count(*) filter (where rc_doc_path is not null) / nullif(count(*),0)) from b),
    'rc_turnaround_h', (select round(avg(extract(epoch from rc_turnaround))/3600, 1) from moving where rc_turnaround is not null),
    'brokers_used', (select count(distinct lower(broker)) from b),
    'loads_per_week', (select round(count(*)::numeric / greatest(p_days / 7.0, 1), 1) from b where status not in ('cancelled','rejected')),
    'loads_per_week_per_truck', (select round(count(*)::numeric / greatest(p_days / 7.0, 1) / greatest((select n from trucks), 1), 2) from b where status not in ('cancelled','rejected')),
    'gross_per_truck_week', (select round(coalesce(sum(gross),0) / greatest(p_days / 7.0, 1) / greatest((select n from trucks), 1)) from b where status not in ('cancelled','rejected'))
  );
$$;

-- ================================================================ internal board requests → real bookings
create or replace function public.dispatcher_request_book(p_org uuid, p_load uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v jsonb; v_uid uuid := auth.uid(); v_l record; v_bid uuid;
begin
  begin perform app_private.disp_act_as(p_org); exception when others then return jsonb_build_object('error', sqlerrm); end;
  begin
    v := public.cc_request_book_load(p_load, coalesce(p_note, '') || ' [requested by dispatcher]');
  exception when others then return jsonb_build_object('error', sqlerrm); end;
  if v ? 'error' then return v; end if;
  select * into v_l from public.loads where id = p_load;
  if v_l.id is not null and not exists (select 1 from app_private.dispatcher_bookings b where b.load_id = p_load and b.dispatcher_user_id = v_uid) then
    insert into app_private.dispatcher_bookings (dispatcher_user_id, carrier_org_id, broker, origin, destination, pickup_at, delivery_at, miles, gross, commodity, equipment, status, notes, source, load_id, rc_number)
    values (v_uid, p_org, coalesce(v_l.broker, 'LoadBoot board'), v_l.origin, v_l.destination, v_l.pickup_date::timestamptz, v_l.delivery_date::timestamptz, v_l.miles, coalesce(v_l.rate,0), v_l.commodity, v_l.equipment,
            'pending_rc', 'Requested on the LoadBoot board' || coalesce(' — ' || p_note, ''), 'loadboot', p_load, 'LB-' || left(p_load::text, 8))
    returning id into v_bid;
    insert into app_private.dispatcher_booking_events (booking_id, kind, note, created_by) values (v_bid, 'created', 'Requested on the LoadBoot board — becomes Approved when the broker accepts', v_uid);
  end if;
  perform app_private.disp_audit('dispatcher.book_request', 'load', p_load::text, p_org, 'dispatcher requested load for carrier', jsonb_build_object('dispatcher', v_uid, 'result', v, 'booking', v_bid));
  return v || jsonb_build_object('booking', v_bid);
end $$;

-- when the broker accepts and the carrier engine creates the trip, link + approve the internal booking
create or replace function app_private.disp_link_internal_trip()
returns trigger language plpgsql security definer set search_path = app_private, public as $$
declare v_b record;
begin
  select * into v_b from app_private.dispatcher_bookings b where b.load_id = new.load_id and b.trip_id is null and b.source = 'loadboot' and b.status in ('pending_rc','rc_received') limit 1;
  if v_b.id is not null then
    update app_private.dispatcher_bookings set trip_id = new.id, status = 'approved', approved_at = now(), truck_id = coalesce(truck_id, new.truck_id), gross = coalesce(nullif(new.rate,0), gross),
      commission_pct = (select coalesce(commission_pct,0) from app_private.dispatcher_profiles where user_id = v_b.dispatcher_user_id), decision_note = 'LoadBoot board load — broker accepted the request'
     where id = v_b.id;
    insert into app_private.dispatcher_booking_events (booking_id, kind, note, to_status, created_by) values (v_b.id, 'decision', 'Broker accepted on the LoadBoot board — approved', 'approved', new.created_by);
    perform app_private.disp_notify(v_b.dispatcher_user_id, 'dispatcher', 'dispatcher.booking.approved', 'Board load accepted — dispatch the driver', v_b.origin || ' → ' || v_b.destination, '/app/agent/#dashboard', true);
  end if;
  return new;
end $$;
drop trigger if exists disp_link_internal_trip on app_private.trips;
create trigger disp_link_internal_trip after insert on app_private.trips for each row execute function app_private.disp_link_internal_trip();

-- ================================================================ hygiene
-- dispatcher_post_truck: availability lookup must be scoped to the org acting
do $$
declare src text;
begin
  src := pg_get_functiondef('public.dispatcher_post_truck(uuid, jsonb)'::regprocedure);
  if position('where truck_id = (v_p->>''truck_id'')::uuid;' in src) > 0 then
    src := replace(src, 'where truck_id = (v_p->>''truck_id'')::uuid;', 'where truck_id = (v_p->>''truck_id'')::uuid and carrier_id = p_org;');
    execute src;
  end if;
end $$;

-- the poller runs with the service role; a signed-in user has no business calling the ingest with a guessed token
revoke execute on function public.eld_hos_ingest(uuid, jsonb) from authenticated;

-- carrier may open the rate confirmation registered as his document (file lives in the dispatcher's folder)
drop policy if exists doc_read_by_documents_row on storage.objects;
create policy doc_read_by_documents_row on storage.objects for select to authenticated
  using (bucket_id = 'documents' and exists (select 1 from public.documents d where d.file_path = name and d.carrier_id = auth.uid() and d.status = 'approved'));

-- ================================================================ grants
revoke all on function public.cc_dispatcher_commission_pay(uuid[], jsonb) from public, anon;
revoke all on function public.dispatcher_thread_mark_read(uuid) from public, anon;
revoke all on function public.carrier_my_dispatcher_bookings(int) from public, anon;
revoke all on function public.carrier_dispatcher_ack(uuid) from public, anon;
revoke all on function public.carrier_dispatcher_pause(uuid, boolean, text) from public, anon;
revoke all on function public.carrier_booking_ack(uuid, boolean, text) from public, anon;
revoke all on function public.cc_dispatcher_queue() from public, anon;
revoke all on function app_private.disp_notify(uuid, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function app_private.disp_audit(text, text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function app_private.disp_effective_min(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.disp_is_staff_user(uuid) from public, anon, authenticated;
revoke all on function app_private.add_working_days(date, int) from public, anon, authenticated;
grant execute on function public.cc_dispatcher_commission_pay(uuid[], jsonb), public.dispatcher_thread_mark_read(uuid), public.carrier_my_dispatcher_bookings(int),
  public.carrier_dispatcher_ack(uuid), public.carrier_dispatcher_pause(uuid, boolean, text), public.carrier_booking_ack(uuid, boolean, text), public.cc_dispatcher_queue() to authenticated;
