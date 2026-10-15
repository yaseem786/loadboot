-- bl_acct_0550 — "carrier exit hold" (15 Oct 2026)
--
-- When someone files an account-deletion request, every LoadBoot touchpoint aimed at them stops, and any dispatcher
-- working their carrier is released with a detailed, REASON-FREE e-mail. Inventory + design: docs/ACCOUNT-EXIT-HOLD-0550.md.
--
-- What this file does (STAGING first; prod is run by the owner from the same file):
--   1. app_private.comm_holds (one row per request × held org; user-only row when no org is held) +
--      comm_on_hold(user, org, email, phone) + comm_hold_summary(request).
--      Held orgs = orgs the requester OWNS, or where nobody else active (non-driver) speaks for the org. A driver or an
--      office member deleting their own login holds only themselves, never their employer's account.
--   2. app_private.on_account_deletion_requested(request): holds; for each held org's active/paused dispatcher
--      assignment: end it (end_reason 'loadboot: carrier exit'), withdraw the dispatcher's open posts, cancel bookings
--      still in pending_rc (cancel_reason 'loadboot: carrier exit'), revoke contact release, system thread line;
--      dispatcher gets in-app + e-mail (dispatcher.assignment.ended.carrier_exit, email_kit); staff get a summary.
--      Bookings already past pending_rc (rc_received / approved / dispatched / picked_up) are NOT touched — freight that
--      is moving is listed for staff instead. Idempotent: a request that already has holds is not re-applied.
--      Riley plans not yet dialled for the org / its numbers are cancelled.
--   3. Called at the end of request_account_deletion (never fails the request); public.cc_account_exit_hold_apply for
--      requests filed before this file (NOT run automatically — request #16 is the owner's call).
--   4. Lift: cancel_account_deletion and a staff reject lift the hold + staff notice. Assignments are not restored.
--   5. Enforcement, fail-closed, essential mail exempt (account_critical, billing, staff_internal):
--        sys_email (email_blocked_log code carrier_exit_hold) · BEFORE INSERT guards on message_deliveries (raw
--        inserters that bypass sys_email), push_outbox, wa_auto_outbox, riley_call_plans, doc_sms_queue · doc_sms_sweep
--        reason 'Account closing — no texts.' · retell_dial refuses a held number/org (inbound untouched) ·
--        dispatcher_post_load refuses a held target org.
--   6. Reason never leaks: cc_dispatcher_360 / cc_dispatcher_activity show 'Ended by LoadBoot'; disp_trial_stats ignores
--      bookings cancelled by the exit hold (an ended assignment already drops out of the trial's carrier count).
--   7. CC: cc_account_deletions rows carry exit_hold (summary of what was done + timestamps).
-- Anchors are replaced in live definitions (identical md5 on staging and prod on 15 Oct); any missing anchor aborts.
-- Anon-executable SECURITY DEFINER surface in public: UNCHANGED (asserted at the end).

-- ======================================================================= 1. registry
create table if not exists app_private.comm_holds (
  id bigserial primary key,
  request_id bigint references app_private.account_deletion_requests(id) on delete set null,
  user_id uuid not null,
  org_id uuid,
  kind text not null default 'deletion' check (kind in ('deletion')),
  emails text[] not null default '{}',
  phones text[] not null default '{}',
  started_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_note text,
  note text,
  actions jsonb not null default '{}'::jsonb
);
create unique index if not exists comm_holds_req_org on app_private.comm_holds (request_id, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists comm_holds_live_user on app_private.comm_holds (user_id) where lifted_at is null;
create index if not exists comm_holds_live_org on app_private.comm_holds (org_id) where lifted_at is null;
alter table app_private.comm_holds enable row level security;
revoke all on app_private.comm_holds from public, anon, authenticated;
comment on table app_private.comm_holds is 'bl_acct_0550: carrier exit hold — while lifted_at is null nothing non-essential reaches this user/org/email/phone.';

create or replace function app_private.comm_on_hold(p_user uuid default null, p_org uuid default null, p_email text default null, p_phone text default null)
returns boolean language plpgsql stable security definer set search_path = app_private, public as $$
declare v_mail text := lower(btrim(coalesce(p_email, ''))); v_ph text;
begin
  if not exists (select 1 from app_private.comm_holds where lifted_at is null) then return false; end if;
  if p_phone is not null then begin v_ph := app_private.dial_e164(p_phone); exception when others then v_ph := null; end; end if;
  return exists (
    select 1 from app_private.comm_holds h
     where h.lifted_at is null
       and ((p_user is not null and h.user_id = p_user)
         or (p_org is not null and h.org_id = p_org)
         or (v_mail <> '' and v_mail = any(h.emails))
         or (v_ph is not null and v_ph = any(h.phones))
         or (p_user is not null and h.org_id is not null and exists (
               select 1 from public.organization_memberships m where m.org_id = h.org_id and m.user_id = p_user and m.status = 'active'))));
end $$;
revoke all on function app_private.comm_on_hold(uuid, uuid, text, text) from public, anon, authenticated;

create or replace function app_private.comm_hold_summary(p_request bigint)
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select case when count(*) = 0 then jsonb_build_object('applied', false)
         else jsonb_build_object('applied', true, 'started_at', min(h.started_at),
           'lifted_at', max(h.lifted_at) filter (where h.lifted_at is not null),
           'live', bool_or(h.lifted_at is null), 'lifted_note', max(h.lifted_note),
           'holds', jsonb_agg(jsonb_build_object('org_id', h.org_id, 'org', (select o.name from public.organizations o where o.id = h.org_id),
                     'started_at', h.started_at, 'lifted_at', h.lifted_at, 'emails', cardinality(h.emails), 'phones', cardinality(h.phones),
                     'actions', h.actions) order by h.id)) end
    from app_private.comm_holds h where h.request_id = p_request;
$$;
revoke all on function app_private.comm_hold_summary(bigint) from public, anon, authenticated;

-- ======================================================================= 2. catalog (§6)
insert into app_private.email_catalog (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note, stop_condition,
                                       preference_group, unsub_allowed, status, cc_deep_link)
values
 ('dispatcher.assignment.ended.carrier_exit', 'Assignment ended by LoadBoot (carrier released)',
  'LoadBoot ended the dispatcher''s assignment with a carrier: carrier name, assignment dates, what was ended (assignment, posted loads, pending bookings), the no-contact rule, that the carrier no longer counts against the dispatcher, next step. Never carries or hints at the reason.',
  'T', 'dispatcher', 'event', 'app_private.on_account_deletion_requested', 'per ended assignment', 'one per assignment (idempotency exitend:<assignment>)', null,
  'account_critical', false, 'live', '#/dispatchers'),
 ('account.exit_hold.applied', 'Exit hold applied (staff)',
  'Staff summary after a deletion request: holds placed, assignments ended, posts withdrawn, bookings cancelled, Riley plans cancelled, moving freight left for a person.',
  'S', 'staff', 'event', 'app_private.on_account_deletion_requested → app_private.disp_notify', 'per request', 'one per request', null,
  'staff_internal', false, 'live', '#/deletions'),
 ('account.exit_hold.lifted', 'Exit hold lifted (staff)',
  'The requester cancelled (or staff rejected) the deletion request; the hold is lifted and nothing was restored — reassign by hand if wanted.',
  'S', 'staff', 'event', 'app_private.comm_hold_lift → app_private.disp_notify', 'per lift', 'one per request', null,
  'staff_internal', false, 'live', '#/deletions')
on conflict (key) do update set name = excluded.name, purpose = excluded.purpose, class = excluded.class, audience_role = excluded.audience_role,
  trigger_type = excluded.trigger_type, trigger_source = excluded.trigger_source, cadence = excluded.cadence, cap_note = excluded.cap_note,
  stop_condition = excluded.stop_condition, preference_group = excluded.preference_group, unsub_allowed = excluded.unsub_allowed,
  status = excluded.status, cc_deep_link = excluded.cc_deep_link;

-- ======================================================================= 3. apply
create or replace function app_private.on_account_deletion_requested(p_request_id bigint)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare r app_private.account_deletion_requests; v_orgs uuid[]; v_emails text[]; v_phones text[]; o uuid; a record;
  v_nl int; v_nb int; v_nmov int; v_nrp int := 0; v_na int := 0; v_tl int := 0; v_tb int := 0; v_tm int := 0;
  v_org_name text; v_first text; v_mail text; v_html text; v_txt text; v_acts jsonb; v_list jsonb; v_lines text := '';
begin
  select * into r from app_private.account_deletion_requests where id = p_request_id;
  if not found then return jsonb_build_object('error', 'request not found'); end if;
  if r.status <> 'requested' then return jsonb_build_object('error', 'request is ' || r.status); end if;
  if exists (select 1 from app_private.comm_holds where request_id = p_request_id) then
    return jsonb_build_object('ok', true, 'already_applied', true, 'summary', app_private.comm_hold_summary(p_request_id));
  end if;

  -- orgs this person speaks for: owned, or nobody else active (non-driver) on the account
  select coalesce(array_agg(distinct x.org_id), '{}') into v_orgs from (
    select o2.id org_id from public.organizations o2 where o2.owner_user_id = r.user_id
    union
    select m.org_id from public.organization_memberships m
     where m.user_id = r.user_id and m.status = 'active'
       and (m.member_role = 'owner' or not exists (select 1 from public.organization_memberships m2
             where m2.org_id = m.org_id and m2.status = 'active' and m2.user_id <> r.user_id and coalesce(m2.member_role, '') <> 'driver'))) x;

  select coalesce(array_agg(distinct e) filter (where e is not null and e <> ''), '{}') into v_emails from (
    select lower(btrim(r.email)) e
    union select lower(btrim(u.email)) from auth.users u where u.id = r.user_id
    union select lower(btrim(u.email)) from public.organization_memberships m join auth.users u on u.id = m.user_id
     where m.org_id = any(v_orgs) and m.status = 'active') s;
  select coalesce(array_agg(distinct ph) filter (where ph is not null), '{}') into v_phones from (
    select app_private.dial_e164(coalesce(p.phone, '')) ph from public.profiles p
     where p.id = r.user_id or p.id in (select m.user_id from public.organization_memberships m where m.org_id = any(v_orgs) and m.status = 'active')
    union select app_private.dial_e164(coalesce(u.raw_user_meta_data->>'phone', '')) from auth.users u
     where u.id = r.user_id or u.id in (select m.user_id from public.organization_memberships m where m.org_id = any(v_orgs) and m.status = 'active')) s;

  -- the hold goes in FIRST, so every trigger below (assignment → WhatsApp, etc.) already sees it
  if cardinality(v_orgs) = 0 then
    insert into app_private.comm_holds (request_id, user_id, org_id, emails, phones, note)
    values (p_request_id, r.user_id, null, v_emails, v_phones, 'deletion request #' || p_request_id);
  else
    insert into app_private.comm_holds (request_id, user_id, org_id, emails, phones, note)
    select p_request_id, r.user_id, x, v_emails, v_phones, 'deletion request #' || p_request_id from unnest(v_orgs) x;
  end if;

  -- Riley: nothing not yet dialled goes out to this account or its numbers
  update app_private.riley_call_plans
     set status = 'cancelled', error = 'Account closing — no calls.', closed_at = now(), updated_at = now()
   where status in ('planning','ready','scheduled') and (org_id = any(v_orgs) or to_number = any(v_phones));
  get diagnostics v_nrp = row_count;
  update app_private.riley_call_plans set followup_status = 'dismissed', updated_at = now()
   where followup_status in ('pending','thinking','proposed') and (org_id = any(v_orgs) or to_number = any(v_phones));

  -- anything already waiting in a queue (the guards only see new rows / status changes)
  update app_private.message_deliveries d
     set status = 'suppressed', failure_reason = 'carrier exit hold', meta = coalesce(d.meta, '{}'::jsonb) || jsonb_build_object('exit_hold', true), updated_at = now()
   where d.status in ('queued','scheduled')
     and coalesce(nullif(d.meta->>'preference_group', ''), (select c.preference_group from app_private.email_catalog c where c.key = d.template_key), '')
         not in ('account_critical','billing','staff_internal')
     and (d.recipient_user = r.user_id
       or d.recipient_user in (select m.user_id from public.organization_memberships m where m.org_id = any(v_orgs) and m.status = 'active')
       or lower(btrim(coalesce(d.recipient_email, ''))) = any(v_emails)
       or app_private.dial_e164(coalesce(d.recipient_phone, '')) = any(v_phones));
  update app_private.doc_sms_queue set status = 'skipped', reason = 'Account closing — no texts.', updated_at = now()
   where status in ('collecting','pending','ready') and (org_id = any(v_orgs) or user_id = r.user_id or to_number = any(v_phones));
  update app_private.wa_auto_outbox set status = 'skipped', note = 'Account closing — no messages.', updated_at = now()
   where status in ('pending','held') and carrier_org_id = any(v_orgs);
  update app_private.push_outbox set sent_at = now(), result = jsonb_build_object('skipped', 'carrier exit hold')
   where sent_at is null and (user_id = r.user_id or user_id in (select m.user_id from public.organization_memberships m where m.org_id = any(v_orgs) and m.status = 'active'));

  foreach o in array v_orgs loop
    select name into v_org_name from public.organizations where id = o;
    v_list := '[]'::jsonb;
    for a in select * from app_private.dispatcher_assignments where carrier_org_id = o and status in ('active','paused') loop
      update public.loads set status = 'withdrawn', expires_at = least(coalesce(expires_at, now()), now()),
             details = coalesce(details, '{}'::jsonb) || jsonb_build_object('withdrawn', jsonb_build_object('at', now(), 'by', null, 'by_role', 'LoadBoot', 'reason', 'Assignment ended by LoadBoot'))
       where source_type = 'dispatcher' and target_carrier_org = o and created_by = a.dispatcher_user_id and status = 'available';
      get diagnostics v_nl = row_count;

      with c as (
        update app_private.dispatcher_bookings
           set status = 'cancelled', cancel_reason = 'loadboot: carrier exit',
               decision_note = coalesce(nullif(decision_note, '') || ' · ', '') || 'Cancelled by LoadBoot: the assignment was ended.', updated_at = now()
         where carrier_org_id = o and dispatcher_user_id = a.dispatcher_user_id and status = 'pending_rc'
        returning id, load_id),
      l as (
        update public.loads l set status = 'cancelled',
               details = coalesce(l.details, '{}'::jsonb) || jsonb_build_object('cancelled', jsonb_build_object('at', now(), 'by_role', 'LoadBoot', 'reason', 'Assignment ended by LoadBoot'))
          from c where l.id = c.load_id and l.status = 'carrier_accepted'
        returning l.id)
      select count(*) into v_nb from c;
      select count(*) into v_nmov from app_private.dispatcher_bookings
       where carrier_org_id = o and dispatcher_user_id = a.dispatcher_user_id and status in ('rc_received','approved','dispatched','picked_up');

      update app_private.dispatcher_assignments
         set status = 'ended', ended_at = now(), end_reason = 'loadboot: carrier exit',
             contact_release_note = case when contact_released_at is not null then 'contact details withdrawn: assignment ended by LoadBoot' else contact_release_note end,
             contact_released_at = null, contact_released_by = null, updated_at = now()
       where id = a.id;

      insert into app_private.dispatcher_messages (assignment_id, carrier_org_id, sender_role, body)
      values (a.id, o, 'system', 'LoadBoot ended this assignment. Please do not contact this carrier again by any channel.');

      perform app_private.disp_notify(a.dispatcher_user_id, 'dispatcher', 'dispatcher.assignment.ended.carrier_exit',
        'Assignment ended by LoadBoot',
        'LoadBoot ended your assignment with ' || coalesce(v_org_name, 'this carrier') || '. Do not contact this carrier by any channel — if they reach out, forward it to LoadBoot. Details are in your e-mail.',
        '/app/agent/#dashboard', false);

      select coalesce(nullif(initcap(split_part(trim(dp.full_name), ' ', 1)), ''), 'there'), u.email into v_first, v_mail
        from auth.users u left join app_private.dispatcher_profiles dp on dp.user_id = u.id where u.id = a.dispatcher_user_id;
      if v_mail is not null then
        v_html := app_private.email_kit(jsonb_build_object(
          'eyebrow', jsonb_build_object('text', 'Assignment ended', 'tone', 'neutral'),
          'title', 'Your assignment with ' || coalesce(v_org_name, 'this carrier') || ' has ended',
          'intro_html', 'Hi ' || app_private.h_esc(v_first) || ' — LoadBoot has ended your dispatch assignment with <b>' || app_private.h_esc(coalesce(v_org_name, 'this carrier'))
                        || '</b>, effective today. This was LoadBoot''s decision and it is final. You do not need to do anything for this carrier.',
          'facts', jsonb_build_array(
            jsonb_build_object('k', 'Carrier', 'v', coalesce(v_org_name, '—')),
            jsonb_build_object('k', 'Assigned', 'v', to_char(coalesce(a.assigned_at, a.created_at), 'Mon FMDD, YYYY') || ' → ' || to_char(now(), 'Mon FMDD, YYYY')),
            jsonb_build_object('k', 'Assignment', 'v', 'Ended'),
            jsonb_build_object('k', 'Your posted loads', 'v', case when v_nl = 0 then 'None open' else v_nl || ' withdrawn from their board' end),
            jsonb_build_object('k', 'Bookings waiting on a rate con', 'v', case when v_nb = 0 then 'None' else v_nb || ' cancelled' end)),
          'card', jsonb_build_object('tone', 'warning', 'title', 'Do not contact this carrier', 'items', jsonb_build_array(
            'Do not call, text, WhatsApp or e-mail this carrier from any line — your own phone, a LoadBoot line, or anything else.',
            'This applies even if the carrier contacts you first. Do not reply; forward the message to LoadBoot by replying to this e-mail.',
            'Their documents, rate confirmations and contact details are no longer yours to use.')),
          'step', jsonb_build_object('label', 'Your next step', 'title', 'Keep working your other carriers',
            'text', 'This carrier no longer counts against you: the withdrawn posts and cancelled bookings are not held against your numbers or your trial. LoadBoot will assign you another carrier.'),
          'cta', jsonb_build_object('label', 'Open my workspace', 'url', 'https://loadboot.com/app/agent/'),
          'note', case when v_nmov > 0 then v_nmov || ' booking(s) already past the rate-con stage stay with LoadBoot dispatch — you will be told if anything is needed from you.' else '' end));
        v_txt := 'Hi ' || v_first || E',\n\nLoadBoot has ended your dispatch assignment with ' || coalesce(v_org_name, 'this carrier') || E', effective today.\n'
              || 'Posted loads withdrawn: ' || v_nl || '. Bookings waiting on a rate con cancelled: ' || v_nb || E'.\n\n'
              || E'Do not call, text, WhatsApp or e-mail this carrier from any line - even if they contact you first. Forward anything from them to LoadBoot by replying to this e-mail.\n\n'
              || E'This carrier no longer counts against you. LoadBoot will assign you another carrier.\n\nhttps://loadboot.com/app/agent/';
        begin
          perform app_private.sys_email(v_mail, 'dispatcher.assignment.ended.carrier_exit',
            'LoadBoot — your assignment with ' || coalesce(v_org_name, 'a carrier') || ' has ended', v_html, v_txt, 'exitend:' || a.id::text);
        exception when others then null; end;
      end if;

      perform app_private.disp_audit('dispatcher.assignment_ended', 'assignment', a.id::text, o, 'assignment ended by LoadBoot',
        jsonb_build_object('request_id', p_request_id, 'posts_withdrawn', v_nl, 'bookings_cancelled', v_nb, 'moving_left', v_nmov));

      v_list := v_list || jsonb_build_object('assignment_id', a.id, 'dispatcher_user_id', a.dispatcher_user_id,
        'dispatcher', (select coalesce(dp.full_name, '') from app_private.dispatcher_profiles dp where dp.user_id = a.dispatcher_user_id),
        'ended_at', now(), 'posts_withdrawn', v_nl, 'bookings_cancelled', v_nb, 'moving_left', v_nmov, 'emailed_at', case when v_mail is not null then now() end);
      v_na := v_na + 1; v_tl := v_tl + v_nl; v_tb := v_tb + v_nb; v_tm := v_tm + v_nmov;
      v_lines := v_lines || E'\n• ' || coalesce(v_org_name, 'carrier') || ': dispatcher ' ||
                 coalesce((select dp.full_name from app_private.dispatcher_profiles dp where dp.user_id = a.dispatcher_user_id), '?') ||
                 ' released (' || v_nl || ' posts withdrawn, ' || v_nb || ' pending bookings cancelled' ||
                 case when v_nmov > 0 then ', ' || v_nmov || ' MOVING booking(s) left for a person' else '' end || ')';
    end loop;
    update app_private.comm_holds set actions = jsonb_build_object('at', now(), 'assignments', v_list, 'riley_cancelled', v_nrp)
     where request_id = p_request_id and org_id = o;
  end loop;
  if cardinality(v_orgs) = 0 then
    update app_private.comm_holds set actions = jsonb_build_object('at', now(), 'assignments', '[]'::jsonb, 'riley_cancelled', v_nrp)
     where request_id = p_request_id and org_id is null;
  end if;

  begin
    perform app_private.disp_notify(null, 'staff', 'account.exit_hold.applied',
      'Exit hold applied — deletion request #' || p_request_id,
      coalesce(r.email, 'A user') || ': nothing non-essential reaches this account any more (e-mail, texts, WhatsApp, push, Riley). '
      || cardinality(v_orgs) || ' account(s) held · ' || v_na || ' dispatcher assignment(s) ended · ' || v_tl || ' posts withdrawn · '
      || v_tb || ' pending bookings cancelled · ' || v_nrp || ' Riley plan(s) cancelled.'
      || case when v_tm > 0 then E'\nMOVING FREIGHT: ' || v_tm || ' booking(s) past the rate-con stage were left alone — handle by hand.' else '' end
      || v_lines,
      '/app/command-center/#/deletions', true);
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'orgs', cardinality(v_orgs), 'assignments_ended', v_na, 'posts_withdrawn', v_tl,
    'bookings_cancelled', v_tb, 'moving_left', v_tm, 'riley_cancelled', v_nrp, 'summary', app_private.comm_hold_summary(p_request_id));
end $$;
revoke all on function app_private.on_account_deletion_requested(bigint) from public, anon, authenticated;

create or replace function app_private.comm_hold_lift(p_request bigint, p_note text)
returns int language plpgsql security definer set search_path = app_private, public as $$
declare n int; v_mail text;
begin
  if p_request is null then return 0; end if;
  update app_private.comm_holds set lifted_at = now(), lifted_note = p_note where request_id = p_request and lifted_at is null;
  get diagnostics n = row_count;
  if n > 0 then
    select email into v_mail from app_private.account_deletion_requests where id = p_request;
    begin
      perform app_private.disp_notify(null, 'staff', 'account.exit_hold.lifted',
        'Exit hold lifted — deletion request #' || p_request,
        coalesce(v_mail, 'The requester') || ': ' || p_note || '. Messages to this account flow again. Dispatcher assignments were NOT restored — reassign manually if wanted.',
        '/app/command-center/#/deletions', true);
    exception when others then null; end;
  end if;
  return n;
end $$;
revoke all on function app_private.comm_hold_lift(bigint, text) from public, anon, authenticated;

-- CC: apply to a request filed before this migration (never run automatically on those)
create or replace function public.cc_account_exit_hold_apply(p_request bigint)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v jsonb;
begin
  if not (public.has_global_permission('carriers.approve') or public.has_global_permission('finance.approve')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v := app_private.on_account_deletion_requested(p_request);
  perform app_private.log_audit('account.exit_hold.apply', 'account_deletion_request', p_request::text, null, 'exit hold applied from CC', coalesce(v, '{}'::jsonb), null);
  return v;
end $$;
revoke all on function public.cc_account_exit_hold_apply(bigint) from public, anon;
grant execute on function public.cc_account_exit_hold_apply(bigint) to authenticated;

-- ======================================================================= 4. guards (BEFORE INSERT, a1_ after the training guard)
create or replace function app_private.trg_comm_hold_delivery()
returns trigger language plpgsql security definer set search_path = app_private, public as $$
declare g text;
begin
  if new.status not in ('queued','scheduled') then return new; end if;
  if not exists (select 1 from app_private.comm_holds where lifted_at is null) then return new; end if;
  g := coalesce(nullif(new.meta->>'preference_group', ''), (select c.preference_group from app_private.email_catalog c where c.key = new.template_key));
  if g in ('account_critical','billing','staff_internal') then return new; end if;
  if not app_private.comm_on_hold(new.recipient_user, case when new.recipient_user is null then new.org_id end,
                                  coalesce(nullif(new.meta->>'intended_for', ''), new.recipient_email), new.recipient_phone) then return new; end if;
  new.status := 'suppressed';
  new.failure_reason := 'carrier exit hold';
  new.meta := coalesce(new.meta, '{}'::jsonb) || jsonb_build_object('exit_hold', true);
  if coalesce(new.channel, 'email') = 'email' and new.recipient_email is not null then
    begin perform app_private.email_block_note(new.template_key, new.recipient_email, new.recipient_user, g, 'carrier exit hold', 'carrier_exit_hold');
    exception when others then null; end;
  end if;
  return new;
end $$;
drop trigger if exists a1_comm_hold_guard on app_private.message_deliveries;
create trigger a1_comm_hold_guard before insert on app_private.message_deliveries for each row execute function app_private.trg_comm_hold_delivery();

create or replace function app_private.trg_comm_hold_push()
returns trigger language plpgsql security definer set search_path = app_private, public as $$
begin
  if app_private.comm_on_hold(new.user_id) then return null; end if;   -- skipped: the person can still open the portal and cancel
  return new;
end $$;
drop trigger if exists a1_comm_hold_guard on app_private.push_outbox;
create trigger a1_comm_hold_guard before insert on app_private.push_outbox for each row execute function app_private.trg_comm_hold_push();

create or replace function app_private.trg_comm_hold_wa()
returns trigger language plpgsql security definer set search_path = app_private, public as $$
begin
  if new.status in ('pending','held') and new.carrier_org_id is not null and app_private.comm_on_hold(null, new.carrier_org_id) then
    new.status := 'skipped'; new.note := 'Account closing — no messages.';
  end if;
  return new;
end $$;
drop trigger if exists a1_comm_hold_guard on app_private.wa_auto_outbox;
create trigger a1_comm_hold_guard before insert or update on app_private.wa_auto_outbox for each row execute function app_private.trg_comm_hold_wa();

create or replace function app_private.trg_comm_hold_riley()
returns trigger language plpgsql security definer set search_path = app_private, public as $$
begin
  if (tg_op = 'INSERT' or new.status is distinct from old.status)
     and new.status in ('planning','ready','scheduled','dialing')
     and app_private.comm_on_hold(null, new.org_id, null, new.to_number) then
    new.status := 'cancelled'; new.error := 'Account closing — no calls.'; new.closed_at := now();
  end if;
  if new.followup_status in ('pending','thinking','proposed') and (tg_op = 'INSERT' or new.followup_status is distinct from old.followup_status)
     and app_private.comm_on_hold(null, new.org_id, null, new.to_number) then
    new.followup_status := 'dismissed';
  end if;
  return new;
end $$;
drop trigger if exists a1_comm_hold_guard on app_private.riley_call_plans;
create trigger a1_comm_hold_guard before insert or update on app_private.riley_call_plans for each row execute function app_private.trg_comm_hold_riley();

create or replace function app_private.trg_comm_hold_sms()
returns trigger language plpgsql security definer set search_path = app_private, public as $$
begin
  if new.status in ('collecting','pending','ready') and app_private.comm_on_hold(new.user_id, new.org_id, null, new.to_number) then
    new.status := 'skipped'; new.reason := 'Account closing — no texts.';
  end if;
  return new;
end $$;
drop trigger if exists a1_comm_hold_guard on app_private.doc_sms_queue;
create trigger a1_comm_hold_guard before insert or update on app_private.doc_sms_queue for each row execute function app_private.trg_comm_hold_sms();

revoke all on function app_private.trg_comm_hold_delivery(), app_private.trg_comm_hold_push(), app_private.trg_comm_hold_wa(),
  app_private.trg_comm_hold_riley(), app_private.trg_comm_hold_sms() from public, anon, authenticated;

-- ======================================================================= 5. anchor patches
do $$
declare d text; miss constant text := 'bl_acct_0550: anchor not found in ';
  a text; b text;
begin
  -- sys_email: held recipient, non-essential group -> blocked + email_blocked_log
  d := pg_get_functiondef('app_private.sys_email(text,text,text,text,text,text)'::regprocedure);
  a := E'  select e.user_id, e.org_id into v_user, v_org from app_private.email_identify(p_to) e;\n';
  if position(a in d) = 0 then raise exception '%sys_email', miss; end if;
  execute replace(d, a, a || E'\n  -- bl_acct_0550: carrier exit hold. Essential mail (account & security, billing notices, staff) still goes.\n'
    || E'  if coalesce(v_group, '''') not in (''account_critical'',''billing'',''staff_internal'') and app_private.comm_on_hold(v_user, v_org, p_to) then\n'
    || E'    perform app_private.email_block_note(p_template, p_to, v_user, v_group, ''carrier exit hold'', ''carrier_exit_hold'');\n'
    || E'    return;\n  end if;\n');

  -- doc_sms_sweep: first reason in the list
  d := pg_get_functiondef('app_private.doc_sms_sweep()'::regprocedure);
  a := E'    why := case\n';
  if position(a in d) = 0 then raise exception '%doc_sms_sweep', miss; end if;
  execute replace(d, a, a || E'      when app_private.comm_on_hold(null, q.org_id, null, v_num) then ''Account closing — no texts.''   -- bl_acct_0550\n');

  -- retell_dial: refuse a held number / org (inbound calls are untouched)
  d := pg_get_functiondef('app_private.retell_dial(bigint)'::regprocedure);
  a := E'  if cfg.api_key is null or r.id is null then return; end if;\n';
  if position(a in d) = 0 then raise exception '%retell_dial', miss; end if;
  execute replace(d, a, a || E'  if app_private.comm_on_hold(null, r.org_id, null, r.to_number) then   -- bl_acct_0550\n'
    || E'    update app_private.lc_calls set status = ''cancelled'', summary = coalesce(summary, ''Not dialled: account closing — no calls.''), updated_at = now() where id = p_id;\n'
    || E'    return;\n  end if;\n');

  -- dispatcher_post_load: a held carrier cannot be a target
  d := pg_get_functiondef('public.dispatcher_post_load(uuid,jsonb)'::regprocedure);
  a := E'  if not app_private.disp_is_assigned(p_org) then return jsonb_build_object(''error'', ''you are not assigned to this carrier''); end if;\n';
  if position(a in d) = 0 then raise exception '%dispatcher_post_load', miss; end if;
  execute replace(d, a, a || E'  if app_private.comm_on_hold(null, p_org) then return jsonb_build_object(''error'', ''This carrier is not available for posting.''); end if;   -- bl_acct_0550\n');

  -- request_account_deletion: apply the hold (never fails the request)
  d := pg_get_functiondef('public.request_account_deletion(text)'::regprocedure);
  a := E'  return jsonb_build_object(''ok'', true, ''id'', v_id, ''status'', ''requested'');\n';
  if position(a in d) = 0 then raise exception '%request_account_deletion', miss; end if;
  execute replace(d, a, E'  -- bl_acct_0550: carrier exit hold\n  begin perform app_private.on_account_deletion_requested(v_id);\n'
    || E'  exception when others then\n    begin perform app_private.disp_notify(null, ''staff'', ''account.exit_hold.applied'', ''Exit hold FAILED — deletion request #'' || v_id, ''Apply it from CC → Deletion requests. Error: '' || sqlerrm, ''/app/command-center/#/deletions'', true);\n'
    || E'    exception when others then null; end;\n  end;\n' || a);

  -- cancel_account_deletion: lift
  d := pg_get_functiondef('public.cancel_account_deletion()'::regprocedure);
  a := E'  if not found then raise exception ''no open deletion request'' using errcode=''22023''; end if;\n';
  if position(a in d) = 0 then raise exception '%cancel_account_deletion', miss; end if;
  execute replace(d, a, a || E'  perform app_private.comm_hold_lift((select id from app_private.account_deletion_requests where user_id = auth.uid() and status = ''cancelled'' order by processed_at desc nulls last limit 1),\n'
    || E'    ''the requester cancelled the deletion request'');   -- bl_acct_0550\n');

  -- cc_account_deletion_process: staff reject lifts too
  d := pg_get_functiondef('public.cc_account_deletion_process(bigint,text,text)'::regprocedure);
  a := E'    return jsonb_build_object(''ok'', true, ''status'',''rejected'');\n';
  if position(a in d) = 0 then raise exception '%cc_account_deletion_process', miss; end if;
  execute replace(d, a, E'    perform app_private.comm_hold_lift(p_id, ''staff rejected the deletion request'');   -- bl_acct_0550\n' || a);

  -- cc_account_deletions: what the hold did
  d := pg_get_functiondef('public.cc_account_deletions(text)'::regprocedure);
  a := E'''reason'', r.reason, ''note'', r.note,';
  if position(a in d) = 0 then raise exception '%cc_account_deletions', miss; end if;
  execute replace(d, a, a || E' ''exit_hold'', app_private.comm_hold_summary(r.id),');

  -- Dispatcher 360 / activity: never the reason
  d := pg_get_functiondef('public.cc_dispatcher_360(uuid)'::regprocedure);
  a := E'''end_reason'', a.end_reason,';
  if position(a in d) = 0 then raise exception '%cc_dispatcher_360', miss; end if;
  execute replace(d, a, E'''end_reason'', case when a.end_reason = ''loadboot: carrier exit'' then ''Ended by LoadBoot'' else a.end_reason end,');

  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'cc_dispatcher_activity';
  a := E'''Assignment ended'' || coalesce('' — '' || a.end_reason, '''')';
  if position(a in d) = 0 then raise exception '%cc_dispatcher_activity', miss; end if;
  execute replace(d, a, E'''Assignment ended'' || coalesce('' — '' || case when a.end_reason = ''loadboot: carrier exit'' then ''Ended by LoadBoot'' else a.end_reason end, '''')');

  -- disp_trial_stats: bookings cancelled by the exit hold are not the dispatcher's cancels
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'app_private'::regnamespace and p.proname = 'disp_trial_stats';
  a := E'where dispatcher_user_id = p_user and created_at >= p_since and created_at < p_to),';
  if position(a in d) = 0 then raise exception '%disp_trial_stats', miss; end if;
  execute replace(d, a, E'where dispatcher_user_id = p_user and created_at >= p_since and created_at < p_to\n'
    || E'                and coalesce(cancel_reason, '''') <> ''loadboot: carrier exit''),   -- bl_acct_0550');
end $$;

-- ======================================================================= 6. assertion
do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
     and p.proname in ('cc_account_exit_hold_apply','request_account_deletion','cancel_account_deletion','cc_account_deletion_process',
                       'cc_account_deletions','cc_dispatcher_360','cc_dispatcher_activity','dispatcher_post_load');
  if bad is not null then raise exception 'anon can execute: %', bad; end if;
end $$;
