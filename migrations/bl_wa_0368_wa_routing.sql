-- bl_wa_0368 — WhatsApp conversations are ROUTED, not grabbed (Yaseen's decision, 21 Sep 2026).
-- Follows bl_wa_0367. Additive: only the five wa_* functions below are replaced; no table changes.
--
-- THE HOLE THIS CLOSES
--   In 0367 any active dispatcher could take any unassigned conversation — including a carrier that was never
--   assigned to him. Now the server decides, and the browser cannot talk it out of it.
--
-- THE RULE
--   1. AUTO-ROUTE on the first inbound message. app_private.wa_route() looks the number up:
--        · the carrier's own contact (organizations.kind = 'carrier' → owner profile phone / whatsapp)
--        · a driver of a carrier (fleet_drivers.phone)
--        · a broker the dispatcher already keeps (broker_contacts.phone, dispatcher_bookings.broker_phone)
--      A carrier match writes carrier_org_id on the thread and hands it straight to that carrier's ACTIVE
--      dispatcher — nobody has to "take" it. A broker match hands it to the dispatcher who keeps that broker.
--   2. LOCKED CLAIM. A thread that carries a carrier_org_id can only be opened, claimed or answered by a
--      dispatcher with an ACTIVE assignment on that carrier (cc_dispatcher_assign). Anyone else is refused by
--      name: "GABE LOGISTICS is assigned to <dispatcher>." A carrier with NO active dispatcher stays locked to
--      Command Center — that is the honest answer, not a free-for-all.
--   3. THE POOL stays open only for numbers LoadBoot does not recognise — a new broker, a shipper, a stranger.
--      Those any active dispatcher may take, first come first served.
--   4. COMMAND CENTER OVERRIDES EVERYTHING (cc_wa_assign), as before, and staff can always read and reply.
-- Rollback: re-apply bl_wa_0367's versions of these functions.

-- ---------------------------------------------------------------- routing
create or replace function app_private.wa_route(p_e164 text) returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare k text := right(regexp_replace(coalesce(p_e164,''),'[^0-9]','','g'), 10); v_carrier uuid; v_user uuid;
begin
  if length(k) < 10 then return '{}'::jsonb; end if;
  -- the carrier itself
  select o.id into v_carrier from public.organizations o join public.profiles p on p.id = o.owner_user_id
   where o.kind = 'carrier'
     and k in (right(regexp_replace(coalesce(p.phone,''),'[^0-9]','','g'),10), right(regexp_replace(coalesce(p.whatsapp,''),'[^0-9]','','g'),10))
   limit 1;
  -- one of its drivers
  if v_carrier is null then
    select d.carrier_id into v_carrier from app_private.fleet_drivers d
     where coalesce(d.status,'active') <> 'inactive'
       and right(regexp_replace(coalesce(d.phone,''),'[^0-9]','','g'),10) = k limit 1;
  end if;
  if v_carrier is not null then
    select a.dispatcher_user_id into v_user from app_private.dispatcher_assignments a
     where a.carrier_org_id = v_carrier and a.status = 'active' order by a.assigned_at desc nulls last limit 1;
    return jsonb_build_object('carrier_org_id', v_carrier, 'owner_user_id', v_user, 'why', 'carrier');
  end if;
  -- a broker one of the dispatchers already keeps
  select bc.dispatcher_user_id into v_user from app_private.broker_contacts bc
   where right(regexp_replace(coalesce(bc.phone,''),'[^0-9]','','g'),10) = k order by bc.updated_at desc limit 1;
  if v_user is not null then return jsonb_build_object('owner_user_id', v_user, 'why', 'broker_contact'); end if;
  select b.dispatcher_user_id into v_user from app_private.dispatcher_bookings b
   where right(regexp_replace(coalesce(b.broker_phone,''),'[^0-9]','','g'),10) = k order by b.created_at desc limit 1;
  if v_user is not null then return jsonb_build_object('owner_user_id', v_user, 'why', 'booking'); end if;
  return '{}'::jsonb;
end $$;

create or replace function app_private.wa_can_take(p_uid uuid, p_carrier uuid) returns boolean
language sql stable security definer set search_path = app_private, public as $$
  select case when p_carrier is null then true
    else exists (select 1 from app_private.dispatcher_assignments a
                  where a.carrier_org_id = p_carrier and a.dispatcher_user_id = p_uid and a.status = 'active') end
$$;

-- who the refusal should name
create or replace function app_private.wa_lock_reason(p_carrier uuid) returns text
language sql stable security definer set search_path = app_private, public as $$
  select case when p_carrier is null then null else coalesce(
    (select coalesce(nullif(o.name,''), 'That carrier') || ' is assigned to ' ||
            coalesce(nullif(d.full_name,''), u.email, 'another dispatcher') || '.'
       from app_private.dispatcher_assignments a
       join auth.users u on u.id = a.dispatcher_user_id
       left join app_private.dispatcher_profiles d on d.user_id = a.dispatcher_user_id
       left join public.organizations o on o.id = a.carrier_org_id
      where a.carrier_org_id = p_carrier and a.status = 'active'
      order by a.assigned_at desc nulls last limit 1),
    (select coalesce(nullif(o.name,''), 'That carrier') || ' has no dispatcher yet — Command Center hands this one out.'
       from public.organizations o where o.id = p_carrier)) end
$$;

-- ---------------------------------------------------------------- the five functions the rule touches
create or replace function public.wa_inbox() returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); cfg app_private.dialer_config; v_role text;
begin
  if v_uid is null then return jsonb_build_object('error','Sign in first.'); end if;
  v_role := app_private.wa_actor(v_uid);
  if v_role is null then return jsonb_build_object('enabled', false, 'reason', 'not_active', 'threads', '[]'::jsonb, 'unassigned', '[]'::jsonb); end if;
  select * into cfg from app_private.dialer_config where id = 1;
  return jsonb_build_object(
    'enabled', coalesce(cfg.enabled,false) and coalesce(cfg.wa_enabled,false),
    'reason', case when not coalesce(cfg.enabled,false) then 'off' when not coalesce(cfg.wa_enabled,false) then 'wa_off'
                   when cfg.wa_number is null then 'no_number' else null end,
    'number', cfg.wa_number, 'role', v_role,
    'unread', (select coalesce(sum(unread),0) from app_private.wa_threads where owner_user_id = v_uid),
    'threads', coalesce((select jsonb_agg(app_private.wa_thread_json(t) order by t.last_at desc)
       from app_private.wa_threads t where t.owner_user_id = v_uid and t.status = 'open'), '[]'::jsonb),
    -- the pool shows ONLY what this dispatcher is allowed to take: unknown numbers, or his own carriers
    'unassigned', coalesce((select jsonb_agg(app_private.wa_thread_json(t) order by t.last_at desc)
       from app_private.wa_threads t
      where t.owner_user_id is null and t.status = 'open'
        and (v_role = 'staff' or app_private.wa_can_take(v_uid, t.carrier_org_id))), '[]'::jsonb),
    'templates', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'body', body, 'variables', variables,
         'var_labels', coalesce(var_labels,'[]'::jsonb), 'language', language) order by name)
       from app_private.wa_templates where status = 'approved'), '[]'::jsonb),
    'templates_pending', (select count(*) from app_private.wa_templates where status = 'pending'));
end $$;

create or replace function public.wa_thread(p_id uuid, p_before timestamptz default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_role text; t app_private.wa_threads;
begin
  v_role := app_private.wa_actor(v_uid);
  if v_role is null then return jsonb_build_object('error','Not allowed.'); end if;
  select * into t from app_private.wa_threads where id = p_id;
  if t.id is null then return jsonb_build_object('error','That conversation does not exist.'); end if;
  if v_role <> 'staff' then
    if t.owner_user_id is not null and t.owner_user_id <> v_uid then
      return jsonb_build_object('error','Another dispatcher owns this conversation.'); end if;
    if t.owner_user_id is null and not app_private.wa_can_take(v_uid, t.carrier_org_id) then
      return jsonb_build_object('error', coalesce(app_private.wa_lock_reason(t.carrier_org_id), 'Not allowed.')); end if;
  end if;
  if t.owner_user_id = v_uid then
    update app_private.wa_messages set read_at = now() where thread_id = t.id and direction = 'inbound' and read_at is null;
    update app_private.wa_threads set unread = 0, updated_at = now() where id = t.id returning * into t;
  end if;
  return jsonb_build_object('thread', app_private.wa_thread_json(t),
    'match', app_private.dial_match(coalesce(t.owner_user_id, v_uid), t.counterparty),
    'messages', coalesce((select jsonb_agg(app_private.wa_msg_json(m) order by m.created_at) from (
        select * from app_private.wa_messages where thread_id = t.id and (p_before is null or created_at < p_before)
        order by created_at desc limit 60) m), '[]'::jsonb));
end $$;

create or replace function public.wa_claim(p_id uuid) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_role text; t app_private.wa_threads;
begin
  v_role := app_private.wa_actor(v_uid);
  if v_role is null then return jsonb_build_object('error','Not allowed.'); end if;
  select * into t from app_private.wa_threads where id = p_id;
  if t.id is null then return jsonb_build_object('error','That conversation does not exist.'); end if;
  if t.owner_user_id = v_uid then return jsonb_build_object('ok', true, 'thread', app_private.wa_thread_json(t)); end if;
  if t.owner_user_id is not null then return jsonb_build_object('error','Another dispatcher already took this conversation.'); end if;
  if v_role <> 'staff' and not app_private.wa_can_take(v_uid, t.carrier_org_id) then
    return jsonb_build_object('error', coalesce(app_private.wa_lock_reason(t.carrier_org_id), 'Not allowed.')); end if;
  update app_private.wa_threads set owner_user_id = v_uid, updated_at = now()
    where id = p_id and owner_user_id is null returning * into t;
  if t.id is null then return jsonb_build_object('error','Another dispatcher already took this conversation.'); end if;
  return jsonb_build_object('ok', true, 'thread', app_private.wa_thread_json(t));
end $$;

create or replace function public.wa_start(p_number text, p_contact_name text default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_role text; cfg app_private.dialer_config; e text; t app_private.wa_threads;
  mt jsonb; rt jsonb; blk text; v_carrier uuid;
begin
  v_role := app_private.wa_actor(v_uid);
  if v_role is null then return jsonb_build_object('error','Not allowed.'); end if;
  select * into cfg from app_private.dialer_config where id = 1;
  if cfg.wa_number is null then return jsonb_build_object('error','No WhatsApp number is configured yet.'); end if;
  e := app_private.dial_e164(p_number);
  if e is null then return jsonb_build_object('error','That is not a valid phone number.'); end if;
  blk := app_private.dial_blocked(e, true);
  if blk is not null then return jsonb_build_object('error', blk); end if;
  if e = cfg.wa_number then return jsonb_build_object('error','That is LoadBoot''s own WhatsApp number.'); end if;
  select * into t from app_private.wa_threads where wa_number = cfg.wa_number and counterparty = e;
  rt := app_private.wa_route(e);
  v_carrier := nullif(rt->>'carrier_org_id','')::uuid;
  if t.id is null then
    if v_role <> 'staff' and not app_private.wa_can_take(v_uid, v_carrier) then
      return jsonb_build_object('error', coalesce(app_private.wa_lock_reason(v_carrier), 'Not allowed.')); end if;
    mt := app_private.dial_match(v_uid, e);
    insert into app_private.wa_threads (wa_number, counterparty, owner_user_id, contact_name, contact_kind, carrier_org_id, last_at)
    values (cfg.wa_number, e, case when v_role = 'staff' then nullif(rt->>'owner_user_id','')::uuid else v_uid end,
            coalesce(nullif(btrim(coalesce(p_contact_name,'')),''), nullif(mt->>'contact_name','')), nullif(mt->>'kind',''),
            coalesce(v_carrier, nullif(mt->>'carrier_org_id','')::uuid), now())
    returning * into t;
  else
    if v_role <> 'staff' and t.owner_user_id is not null and t.owner_user_id <> v_uid then
      return jsonb_build_object('error','Another dispatcher owns this conversation.'); end if;
    if v_role <> 'staff' and t.owner_user_id is null and not app_private.wa_can_take(v_uid, coalesce(t.carrier_org_id, v_carrier)) then
      return jsonb_build_object('error', coalesce(app_private.wa_lock_reason(coalesce(t.carrier_org_id, v_carrier)), 'Not allowed.')); end if;
    if t.owner_user_id is null and v_role <> 'staff' then
      update app_private.wa_threads set owner_user_id = v_uid, carrier_org_id = coalesce(t.carrier_org_id, v_carrier), updated_at = now()
        where id = t.id returning * into t;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'thread', app_private.wa_thread_json(t));
end $$;

create or replace function public.wa_send_prepare(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_role text; cfg app_private.dialer_config; t app_private.wa_threads;
  tpl app_private.wa_templates; v_vars jsonb; v_body text; v_open boolean; n int; m app_private.wa_messages;
  v_kind text := 'text'; v_payload jsonb; r jsonb;
begin
  v_role := app_private.wa_actor(v_uid);
  if v_role is null then return jsonb_build_object('ok', false, 'error','Not allowed.'); end if;
  select * into cfg from app_private.dialer_config where id = 1;
  if not (coalesce(cfg.enabled,false) and coalesce(cfg.wa_enabled,false)) then
    return jsonb_build_object('ok', false, 'error','WhatsApp is not switched on yet.'); end if;
  if cfg.wa_number is null then return jsonb_build_object('ok', false, 'error','No WhatsApp number is configured.'); end if;
  if coalesce(cfg.terms_required,false) and v_role <> 'staff'
     and not exists (select 1 from app_private.dialer_terms_acceptances a where a.user_id = v_uid and a.version = coalesce(cfg.terms_version,1)) then
    return jsonb_build_object('ok', false, 'error','Accept the LoadBoot Phone Terms first.'); end if;

  if nullif(p->>'thread_id','') is not null then
    select * into t from app_private.wa_threads where id = (p->>'thread_id')::uuid;
  elsif nullif(p->>'to','') is not null then
    r := public.wa_start(p->>'to', null);
    if r ? 'error' then return jsonb_build_object('ok', false, 'error', r->>'error'); end if;
    select * into t from app_private.wa_threads where id = (r->'thread'->>'id')::uuid;
  end if;
  if t.id is null then return jsonb_build_object('ok', false, 'error','That conversation does not exist.'); end if;
  if v_role <> 'staff' then
    if t.owner_user_id is null then
      if not app_private.wa_can_take(v_uid, t.carrier_org_id) then
        return jsonb_build_object('ok', false, 'error', coalesce(app_private.wa_lock_reason(t.carrier_org_id), 'Not allowed.')); end if;
      update app_private.wa_threads set owner_user_id = v_uid, updated_at = now() where id = t.id and owner_user_id is null returning * into t;
    elsif t.owner_user_id <> v_uid then
      return jsonb_build_object('ok', false, 'error','Another dispatcher owns this conversation.');
    end if;
  end if;
  if t.status <> 'open' then return jsonb_build_object('ok', false, 'error','This conversation is closed.'); end if;

  select count(*) into n from app_private.wa_messages x where x.direction = 'outbound' and x.created_at > now() - interval '1 hour';
  if n >= coalesce(cfg.max_wa_per_hour, 120) then return jsonb_build_object('ok', false, 'error','Hourly WhatsApp limit reached - try again shortly.'); end if;

  v_open := t.last_inbound_at is not null and t.last_inbound_at > now() - interval '24 hours';

  if nullif(p->'template'->>'name','') is not null then
    select * into tpl from app_private.wa_templates where name = p->'template'->>'name';
    if tpl.name is null then return jsonb_build_object('ok', false, 'error','That template does not exist.'); end if;
    if tpl.status <> 'approved' then
      return jsonb_build_object('ok', false, 'error','That template is ' || tpl.status || ' at Meta - it cannot be sent yet.'); end if;
    v_vars := case when jsonb_typeof(p->'template'->'vars') = 'array' then p->'template'->'vars' else '[]'::jsonb end;
    if jsonb_array_length(v_vars) <> tpl.variables then
      return jsonb_build_object('ok', false, 'error','This template needs ' || tpl.variables || ' values.'); end if;
    if exists (select 1 from jsonb_array_elements_text(v_vars) x where btrim(coalesce(x,'')) = '') then
      return jsonb_build_object('ok', false, 'error','Fill in every value first.'); end if;
    v_kind := 'template';
    v_body := app_private.wa_fill(tpl.body, v_vars);
    v_payload := jsonb_build_object('type','template','template',
      jsonb_build_object('name', tpl.name, 'language', jsonb_build_object('policy','deterministic','code', tpl.language))
      || case when tpl.variables = 0 then '{}'::jsonb else jsonb_build_object('components', jsonb_build_array(
           jsonb_build_object('type','body','parameters',
             (select jsonb_agg(jsonb_build_object('type','text','text', x)) from jsonb_array_elements_text(v_vars) x)))) end);
  else
    v_body := btrim(coalesce(p->>'body',''));
    if v_body = '' then return jsonb_build_object('ok', false, 'error','Write a message first.'); end if;
    if length(v_body) > 3000 then return jsonb_build_object('ok', false, 'error','That message is too long (3000 characters max).'); end if;
    if not v_open then
      return jsonb_build_object('ok', false, 'error','The 24-hour window is closed - send an approved template instead.', 'needs_template', true); end if;
    v_payload := jsonb_build_object('type','text','text', jsonb_build_object('body', v_body, 'preview_url', false));
  end if;

  insert into app_private.wa_messages (thread_id, direction, sender_user_id, kind, body, template_name, template_vars, status)
  values (t.id, 'outbound', v_uid, v_kind, v_body, tpl.name, v_vars, 'queued') returning * into m;
  update app_private.wa_threads set last_at = now(), last_body = left(v_body, 300), last_direction = 'outbound',
     last_outbound_at = now(), updated_at = now() where id = t.id;

  return jsonb_build_object('ok', true, 'id', m.id, 'thread_id', t.id, 'from', cfg.wa_number, 'to', t.counterparty,
    'whatsapp_message', v_payload, 'messaging_profile_id', cfg.wa_messaging_profile_id, 'message', app_private.wa_msg_json(m));
end $$;

-- inbound: route it the moment it arrives, so the right dispatcher is simply notified
create or replace function public.wa_hook(p jsonb, p_verified boolean default true) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare ev text := p->>'event_type'; pl jsonb := coalesce(p->'payload','{}'::jsonb); v_id text := coalesce(pl->>'id', p->>'id');
  v_from text; v_to text; v_text text; v_dir text; v_status text; cfg app_private.dialer_config;
  t app_private.wa_threads; m app_private.wa_messages; mt jsonb; rt jsonb; v_media jsonb; res jsonb;
begin
  insert into app_private.wa_webhook_log (event_id, event_type, verified, payload)
  values (coalesce(v_id, gen_random_uuid()::text), ev, p_verified, p) on conflict (event_id) do nothing;
  if not coalesce(p_verified, false) then return jsonb_build_object('ok', true, 'logged_only', true); end if;
  select * into cfg from app_private.dialer_config where id = 1;

  v_from := app_private.dial_e164(coalesce(pl->'from'->>'phone_number', case when jsonb_typeof(pl->'from') = 'string' then pl->>'from' end));
  v_to   := app_private.dial_e164(coalesce(pl->'to'->0->>'phone_number', pl->'to'->>'phone_number',
                                           case when jsonb_typeof(pl->'to') = 'string' then pl->>'to' end));
  v_text := coalesce(
      case when jsonb_typeof(pl->'text') = 'string' then pl->>'text' when jsonb_typeof(pl->'text') = 'object' then pl->'text'->>'body' end,
      pl->'whatsapp_message'->'text'->>'body', pl->'message'->'text'->>'body', '');
  v_media := case when jsonb_typeof(pl->'media') = 'array' and jsonb_array_length(pl->'media') > 0 then pl->'media' else null end;
  v_dir := lower(coalesce(pl->>'direction',''));

  if v_id is not null and exists (select 1 from app_private.wa_messages where telnyx_message_id = v_id) then
    v_status := lower(coalesce(pl->'to'->0->>'status', pl->>'status', ''));
    update app_private.wa_messages set updated_at = now(),
       status = case when v_status = 'delivered' then 'delivered' when v_status = 'read' then 'read'
                     when v_status in ('sending_failed','delivery_failed','failed') then 'failed'
                     when v_status in ('sent','queued','sending','delivery_unconfirmed') and status = 'queued' then 'sent'
                     when ev = 'message.delivered' then 'delivered' when ev = 'message.read' then 'read'
                     when ev = 'message.failed' then 'failed' when ev = 'message.sent' and status = 'queued' then 'sent'
                     else status end,
       error = case when v_status in ('sending_failed','delivery_failed','failed') or ev = 'message.failed'
                    then left(coalesce(pl->'errors'->0->>'detail', pl->'errors'->0->>'title', nullif(v_status,'')), 300) else error end
     where telnyx_message_id = v_id returning * into m;
    update app_private.wa_webhook_log set result = jsonb_build_object('status_update', true, 'message_id', m.id) where event_id = v_id;
    return jsonb_build_object('ok', true, 'status_update', true);
  end if;

  if ev = 'message.received' or v_dir = 'inbound' then
    if v_from is null then return jsonb_build_object('ok', true, 'skipped','no from'); end if;
    if cfg.wa_number is not null and v_to is not null and v_to <> cfg.wa_number then
      return jsonb_build_object('ok', true, 'skipped','not our WhatsApp number'); end if;
    select * into t from app_private.wa_threads where wa_number = coalesce(cfg.wa_number, v_to) and counterparty = v_from;
    if t.id is null then
      insert into app_private.wa_threads (wa_number, counterparty, owner_user_id, last_at, last_direction)
      values (coalesce(cfg.wa_number, v_to), v_from, null, now(), 'inbound') returning * into t;
    end if;
    -- bl_wa_0368: the routing step. A carrier's own number or its driver's number goes straight to that
    -- carrier's active dispatcher; a known broker goes to the dispatcher who keeps him; anything unknown
    -- stays in the pool. Nothing here can hand a carrier to a dispatcher who is not assigned to it.
    if t.owner_user_id is null or t.carrier_org_id is null then
      rt := app_private.wa_route(v_from);
      if rt <> '{}'::jsonb then
        update app_private.wa_threads set
           carrier_org_id = coalesce(carrier_org_id, nullif(rt->>'carrier_org_id','')::uuid),
           owner_user_id  = coalesce(owner_user_id,  nullif(rt->>'owner_user_id','')::uuid),
           updated_at = now()
         where id = t.id returning * into t;
      end if;
    end if;
    if t.owner_user_id is not null and coalesce(t.contact_name,'') = '' then
      mt := app_private.dial_match(t.owner_user_id, v_from);
      if nullif(mt->>'contact_name','') is not null then
        update app_private.wa_threads set contact_name = mt->>'contact_name', contact_kind = nullif(mt->>'kind',''),
          carrier_org_id = coalesce(carrier_org_id, nullif(mt->>'carrier_org_id','')::uuid) where id = t.id returning * into t;
      end if;
    end if;
    insert into app_private.wa_messages (thread_id, direction, kind, body, media, status, telnyx_message_id)
    values (t.id, 'inbound', case when v_media is not null then 'media' else 'text' end, left(v_text, 4000), v_media, 'received', v_id)
    on conflict (telnyx_message_id) do nothing returning * into m;
    if m.id is null then return jsonb_build_object('ok', true, 'dup', true); end if;
    update app_private.wa_threads set unread = unread + 1, last_at = now(), last_body = left(v_text, 300),
       last_direction = 'inbound', last_inbound_at = now(), status = 'open', updated_at = now() where id = t.id returning * into t;
    res := jsonb_build_object('ok', true, 'thread_id', t.id, 'message_id', m.id, 'unassigned', t.owner_user_id is null,
                              'routed', coalesce(rt->>'why', 'pool'));
    if t.owner_user_id is not null then
      res := res || jsonb_build_object('notify', jsonb_build_object('user_id', t.owner_user_id,
        'title', 'WhatsApp from ' || coalesce(nullif(t.contact_name,''), t.counterparty),
        'body', left(coalesce(nullif(v_text,''), 'Sent an attachment'), 120), 'url', '/app/agent/#today'));
    end if;
    update app_private.wa_webhook_log set result = res, thread_id = t.id where event_id = v_id;
    return res;
  end if;

  return jsonb_build_object('ok', true, 'ignored', ev);
end $$;

revoke all on function app_private.wa_route(text) from public, anon, authenticated;
revoke all on function app_private.wa_can_take(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.wa_lock_reason(uuid) from public, anon, authenticated;
