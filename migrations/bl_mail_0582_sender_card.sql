-- bl_mail_0582 — CC Mailbox Phase 3 #1: sender record beside the open conversation.
-- Design doc (30 Oct 2026): "Right-hand panel for a matched sender: org name, MC/DOT, status, missing documents,
-- active dispatcher, open loads, last WhatsApp/SMS/call, and the last 5 emails."
--
-- Read-only. Reuses the rules CC already runs on, nothing new is invented:
--   * org        = latest non-null mail_messages.sender_org_id in the thread (same as cc_mail_list's org_id/org_name)
--   * missing    = the 4 activation requirements of bl_onb_0541 (mc_authority, insurance_coi, w9, dispatch_agreement)
--                  that are not status 'valid' with an unexpired expiry_date in carrier_compliance
--   * dispatcher = dispatcher_assignments active/paused (same row cc_carrier_360 shows)
--   * open loads = carrier: loads.target_carrier_org; broker/shipper: loads.broker_org / shipper_org;
--                  status available | booked | carrier_accepted
--   * last WhatsApp / SMS / call = wa_threads, sms_threads, dialer_calls keyed by carrier_org_id (carriers only —
--                  those tables have no broker/shipper key, so for brokers these come back null = unknown, not "none")
--   * last 5 emails = this org's (or, when unmatched, this address's) messages across every thread, drafts excluded
-- Gate: comm.view, like cc_mail_list. Not anon-executable (anon secdef surface stays 36).

create or replace function public.cc_mail_sender_card(p_thread text)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare
  v_email text; v_name text; v_role text; v_org uuid;
  o public.organizations%rowtype;
  v_contact jsonb; v_out jsonb;
begin
  if not public.has_global_permission('comm.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_thread is null or btrim(p_thread) = '' then return null; end if;

  select lower(m.peer_email), m.peer_name into v_email, v_name
    from app_private.mail_messages m
   where m.thread_key = p_thread and m.peer_email is not null
   order by (m.direction = 'in') desc, m.created_at desc limit 1;
  if v_email is null then return null; end if;

  select m.sender_role into v_role from app_private.mail_messages m
   where m.thread_key = p_thread and m.direction = 'in' and m.sender_role is not null
   order by m.created_at desc limit 1;
  select m.sender_org_id into v_org from app_private.mail_messages m
   where m.thread_key = p_thread and m.sender_org_id is not null
   order by m.created_at desc limit 1;

  select jsonb_build_object('name', coalesce(nullif(p.contact_name, ''), nullif(p.legal_owner_name, '')), 'phone', p.phone, 'company', p.company)
    into v_contact
    from public.profiles p where lower(p.email) = v_email limit 1;

  v_out := jsonb_build_object(
    'email', v_email, 'peer_name', v_name, 'role', coalesce(v_role, 'unknown'), 'contact', v_contact,
    'emails', coalesce((select jsonb_agg(jsonb_build_object('thread_key', e.thread_key, 'subject', e.subject, 'direction', e.direction,
                          'created_at', e.created_at, 'mailbox', e.mailbox, 'peer_email', e.peer_email) order by e.created_at desc)
                 from (select m.thread_key, m.subject, m.direction, m.created_at, m.mailbox, m.peer_email
                         from app_private.mail_messages m
                        where m.status is distinct from 'draft'
                          and (case when v_org is not null then m.sender_org_id = v_org or lower(m.peer_email) = v_email
                                    else lower(m.peer_email) = v_email end)
                        order by m.created_at desc limit 5) e), '[]'::jsonb));

  if v_org is null then
    return v_out || jsonb_build_object('matched', false);
  end if;

  select * into o from public.organizations where id = v_org;
  if not found then return v_out || jsonb_build_object('matched', false); end if;

  v_out := v_out || jsonb_build_object('matched', true,
    'org', jsonb_build_object('id', o.id, 'kind', o.kind, 'name', o.name, 'status', o.status,
                              'mc', o.mc_number, 'dot', o.dot_number, 'is_demo', coalesce(o.is_demo, false)));

  if o.kind::text = 'carrier' then
    v_out := v_out || jsonb_build_object(
      'onboarding_stage', (select ob.stage from app_private.carrier_onboarding ob where ob.carrier_id = o.id limit 1),
      'requirements', (select jsonb_agg(jsonb_build_object('key', r.k, 'label', r.label,
                          'status', case when c.status = 'valid' and c.expiry_date is not null and c.expiry_date < current_date then 'expired'
                                         else coalesce(c.status, 'missing') end,
                          'expiry_date', c.expiry_date) order by r.ord)
                         from (values (1, 'mc_authority', 'MC authority'), (2, 'insurance_coi', 'Insurance (COI)'),
                                      (3, 'w9', 'W-9'), (4, 'dispatch_agreement', 'Dispatch agreement')) r(ord, k, label)
                         left join lateral (select cc.status, cc.expiry_date from app_private.carrier_compliance cc
                                             where cc.carrier_id = o.id and cc.requirement_key = r.k
                                             order by (cc.status = 'valid') desc, cc.expiry_date desc nulls last limit 1) c on true),
      'dispatcher', (select jsonb_build_object('name', app_private.disp_display_name(a.dispatcher_user_id), 'status', a.status, 'assigned_at', a.assigned_at)
                       from app_private.dispatcher_assignments a
                      where a.carrier_org_id = o.id and a.status in ('active', 'paused') order by a.assigned_at desc limit 1),
      'last_whatsapp', (select jsonb_build_object('at', w.last_at, 'direction', w.last_direction) from app_private.wa_threads w
                         where w.carrier_org_id = o.id and w.last_at is not null order by w.last_at desc limit 1),
      'last_sms', (select jsonb_build_object('at', s.last_at, 'direction', s.last_direction) from app_private.sms_threads s
                    where s.carrier_org_id = o.id and s.last_at is not null order by s.last_at desc limit 1),
      'last_call', (select jsonb_build_object('at', d.started_at, 'direction', d.direction, 'status', d.status, 'duration_sec', d.duration_sec)
                     from app_private.dialer_calls d where d.carrier_org_id = o.id order by d.started_at desc nulls last limit 1),
      'comms_known', true);
  else
    v_out := v_out || jsonb_build_object('comms_known', false);
  end if;

  v_out := v_out || (
    select jsonb_build_object('open_loads_count', count(*),
             'open_loads', coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'origin', x.origin, 'destination', x.destination,
                             'status', x.status, 'pickup_date', x.pickup_date) order by x.pickup_date nulls last, x.created_at desc)
                             filter (where x.rn <= 3), '[]'::jsonb))
      from (select l.*, row_number() over (order by l.pickup_date nulls last, l.created_at desc) rn
              from public.loads l
             where l.status in ('available', 'booked', 'carrier_accepted')
               and (case o.kind::text when 'carrier' then l.target_carrier_org = o.id
                                      when 'broker'  then l.broker_org = o.id
                                      when 'shipper' then l.shipper_org = o.id or l.broker_org = o.id
                                      else false end)) x);

  return v_out;
end;
$function$;

revoke all on function public.cc_mail_sender_card(text) from public, anon;
grant execute on function public.cc_mail_sender_card(text) to authenticated;
