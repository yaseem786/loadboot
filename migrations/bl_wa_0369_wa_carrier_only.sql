-- bl_wa_0369 — WhatsApp is a CARRIER channel for dispatchers; everything else belongs to Command Center.
-- Yaseen's decision, 21 Sep 2026. Follows bl_wa_0367 + bl_wa_0368. Only functions change; no table changes.
--
-- WHY THIS IS TIGHTER THAN 0368
--   0368 still left a first-come pool for numbers LoadBoot did not recognise, and it routed a broker to whichever
--   dispatcher had him saved. Both are wrong for this business:
--     · the SAME broker is worked by several dispatchers at once, so a broker's WhatsApp message cannot be
--       attributed to one of them — and dispatchers are NOT allowed to do broker business on WhatsApp at all;
--     · the WhatsApp number is LoadBoot's public number (website, e-mail signatures), so strangers, shippers and
--       leads land on it. Those are the company's conversations, not a dispatcher's.
--
-- THE RULE NOW
--   1. A message from a CARRIER's own number, or from one of that carrier's DRIVERS, goes straight to that
--      carrier's ACTIVE dispatcher (dispatcher_assignments). Nobody has to take it.
--   2. EVERYTHING ELSE — broker, shipper, a number LoadBoot does not know — stays unowned and is handled by
--      COMMAND CENTER. There is no pool a dispatcher can claim from any more.
--   3. A dispatcher may START a WhatsApp conversation only with his own assigned carriers and their drivers.
--   4. Command Center can still hand any conversation to any dispatcher by name (cc_wa_assign) — the one override.
-- Note for the Phone Terms at their next version bump: "no broker business on WhatsApp" is now enforced by the
-- server, and the terms text should say so.
-- Rollback: re-apply bl_wa_0368's versions of these functions.

-- ---------------------------------------------------------------- routing: carriers and their drivers only
create or replace function app_private.wa_route(p_e164 text) returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare k text := right(regexp_replace(coalesce(p_e164,''),'[^0-9]','','g'), 10); v_carrier uuid; v_user uuid;
begin
  if length(k) < 10 then return '{}'::jsonb; end if;
  select o.id into v_carrier from public.organizations o join public.profiles p on p.id = o.owner_user_id
   where o.kind = 'carrier'
     and k in (right(regexp_replace(coalesce(p.phone,''),'[^0-9]','','g'),10), right(regexp_replace(coalesce(p.whatsapp,''),'[^0-9]','','g'),10))
   limit 1;
  if v_carrier is null then
    select d.carrier_id into v_carrier from app_private.fleet_drivers d
     where coalesce(d.status,'active') <> 'inactive'
       and right(regexp_replace(coalesce(d.phone,''),'[^0-9]','','g'),10) = k limit 1;
  end if;
  if v_carrier is null then return '{}'::jsonb; end if;   -- brokers, shippers, strangers: Command Center's
  select a.dispatcher_user_id into v_user from app_private.dispatcher_assignments a
   where a.carrier_org_id = v_carrier and a.status = 'active' order by a.assigned_at desc nulls last limit 1;
  return jsonb_build_object('carrier_org_id', v_carrier, 'owner_user_id', v_user, 'why', 'carrier');
end $$;

-- a dispatcher may only touch a thread that belongs to one of HIS carriers
create or replace function app_private.wa_can_take(p_uid uuid, p_carrier uuid) returns boolean
language sql stable security definer set search_path = app_private, public as $$
  select p_carrier is not null and exists (
    select 1 from app_private.dispatcher_assignments a
     where a.carrier_org_id = p_carrier and a.dispatcher_user_id = p_uid and a.status = 'active')
$$;

create or replace function app_private.wa_lock_reason(p_carrier uuid) returns text
language sql stable security definer set search_path = app_private, public as $$
  select case when p_carrier is null
    then 'On WhatsApp you handle your own carriers and their drivers. Command Center looks after everyone else.'
    else coalesce(
      (select coalesce(nullif(o.name,''), 'That carrier') || ' is assigned to ' ||
              coalesce(nullif(d.full_name,''), u.email, 'another dispatcher') || '.'
         from app_private.dispatcher_assignments a
         join auth.users u on u.id = a.dispatcher_user_id
         left join app_private.dispatcher_profiles d on d.user_id = a.dispatcher_user_id
         left join public.organizations o on o.id = a.carrier_org_id
        where a.carrier_org_id = p_carrier and a.status = 'active'
        order by a.assigned_at desc nulls last limit 1),
      (select coalesce(nullif(o.name,''), 'That carrier') || ' has no dispatcher yet - Command Center hands this one out.'
         from public.organizations o where o.id = p_carrier)) end
$$;

-- ---------------------------------------------------------------- the screens
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
    -- waiting = ONLY this dispatcher's own carriers that nobody owns yet (e.g. the carrier was assigned to him
    -- after the message arrived). Brokers, shippers and unknown numbers are Command Center's and never appear here.
    'unassigned', coalesce((select jsonb_agg(app_private.wa_thread_json(t) order by t.last_at desc)
       from app_private.wa_threads t
      where t.owner_user_id is null and t.status = 'open'
        and (v_role = 'staff' or app_private.wa_can_take(v_uid, t.carrier_org_id))), '[]'::jsonb),
    'templates', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'body', body, 'variables', variables,
         'var_labels', coalesce(var_labels,'[]'::jsonb), 'language', language) order by name)
       from app_private.wa_templates where status = 'approved'), '[]'::jsonb),
    'templates_pending', (select count(*) from app_private.wa_templates where status = 'pending'));
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
  -- a dispatcher may only open a conversation with his own carrier or that carrier's driver
  if v_role <> 'staff' and not app_private.wa_can_take(v_uid, coalesce(t.carrier_org_id, v_carrier)) then
    return jsonb_build_object('error', app_private.wa_lock_reason(coalesce(t.carrier_org_id, v_carrier))); end if;
  if t.id is null then
    mt := app_private.dial_match(v_uid, e);
    insert into app_private.wa_threads (wa_number, counterparty, owner_user_id, contact_name, contact_kind, carrier_org_id, last_at)
    values (cfg.wa_number, e, case when v_role = 'staff' then nullif(rt->>'owner_user_id','')::uuid else v_uid end,
            coalesce(nullif(btrim(coalesce(p_contact_name,'')),''), nullif(mt->>'contact_name','')), nullif(mt->>'kind',''),
            coalesce(v_carrier, nullif(mt->>'carrier_org_id','')::uuid), now())
    returning * into t;
  else
    if v_role <> 'staff' and t.owner_user_id is not null and t.owner_user_id <> v_uid then
      return jsonb_build_object('error','Another dispatcher owns this conversation.'); end if;
    if t.owner_user_id is null and v_role <> 'staff' then
      update app_private.wa_threads set owner_user_id = v_uid, carrier_org_id = coalesce(t.carrier_org_id, v_carrier), updated_at = now()
        where id = t.id returning * into t;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'thread', app_private.wa_thread_json(t));
end $$;

-- wa_thread, wa_claim and wa_send_prepare keep the bl_wa_0368 shape: they already refuse a dispatcher whenever
-- app_private.wa_can_take() says no — and that function now says no for every thread that is not one of his
-- carriers, including the ones with no carrier at all. Nothing else needs to change.
