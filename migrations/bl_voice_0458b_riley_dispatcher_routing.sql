-- bl_voice_0458b — a known carrier who calls the WhatsApp line reaches THEIR dispatcher first; Riley is the
-- fallback and knows who that dispatcher is.
--
-- Owner ask (26 Sep 2026): the same number (+1 815 …) is shown everywhere for calls and WhatsApp. When a carrier
-- calls it wanting their dedicated dispatcher, the call must go to that dispatcher's LoadBoot line, and if Riley
-- ends up answering she must know who the dispatcher is.
--
-- HOW
--   caller number → public.profiles.phone → organization_memberships → dispatcher_assignments (active)
--     → dispatcher_profiles.full_name + the dispatcher's active dialer_lines row
--   * dialer_hook_event (riley branch): when the caller resolves to a dispatcher whose contact has been RELEASED
--     to the carrier and who has an active line, the call is treated exactly as if the carrier had dialled that
--     line: browser → dispatcher mobile (if set) → fallback → voicemail. (`riley_route_to_dispatcher` switch.)
--   * dialer_config.fallback_number is set to the Riley number where it was empty, so every unanswered
--     dispatcher-line call — WhatsApp line or the dispatcher's own number — ends with Riley, not a dead voicemail.
--     The number is internal routing only; nothing shows it to a customer (CLAUDE.md §7).
--   * retell_inbound_verified adds the dispatcher's name to Riley's briefing ({{context}}), and the inbound prompt
--     tells Riley what to do when the caller asks for that person.
--
-- STAGING first, then prod. Idempotent. No new anon-executable function (the helper lives in app_private).

begin;

-- ---------------------------------------------------------------------------------------------------------
-- 1. Who is this caller's dispatcher?
-- ---------------------------------------------------------------------------------------------------------
create or replace function app_private.riley_caller_dispatcher(p_from text)
 returns table (dispatcher_user_id uuid, full_name text, line_id uuid, line_number text, released boolean, carrier_name text, carrier_org_id uuid)
 language sql
 stable
 set search_path to 'app_private', 'public'
as $function$
  with last10 as (select right(regexp_replace(coalesce(p_from,''), '[^0-9]', '', 'g'), 10) d),
  prof as (
    select p.id, p.contact_name from public.profiles p, last10
    where length(last10.d) = 10 and right(regexp_replace(coalesce(p.phone,''), '[^0-9]', '', 'g'), 10) = last10.d
    order by p.created_at desc limit 1),
  org as (
    select m.org_id from public.organization_memberships m, prof
    where m.user_id = prof.id and coalesce(m.status,'active') = 'active'
    order by m.created_at limit 1),
  asg as (
    select a.dispatcher_user_id, a.carrier_org_id, a.contact_released_at
    from app_private.dispatcher_assignments a, org
    where a.carrier_org_id = org.org_id and a.status = 'active'
    order by a.assigned_at desc limit 1)
  select asg.dispatcher_user_id, dp.full_name, l.id, l.phone_e164, (asg.contact_released_at is not null), prof.contact_name, asg.carrier_org_id
  from asg
  left join app_private.dispatcher_profiles dp on dp.user_id = asg.dispatcher_user_id
  left join lateral (select id, phone_e164 from app_private.dialer_lines where dialer_lines.dispatcher_user_id = asg.dispatcher_user_id and status = 'active' order by created_at limit 1) l on true
  left join prof on true;
$function$;
revoke all on function app_private.riley_caller_dispatcher(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 2. Telnyx side: route to the dispatcher first, Riley as the fallback for every line
-- ---------------------------------------------------------------------------------------------------------
alter table app_private.dialer_config add column if not exists riley_route_to_dispatcher boolean not null default true;
comment on column app_private.dialer_config.riley_route_to_dispatcher is 'WhatsApp-line calls from a carrier whose dispatcher contact is released ring that dispatcher''s line first (browser → mobile), Riley only if unanswered. Off = everyone goes straight to Riley.';

-- Riley becomes the fallback for unanswered dispatcher-line calls where nothing was set (voicemail stays after her).
update app_private.dialer_config d
   set fallback_number = (select from_number from app_private.retell_config where id = 1), updated_at = now()
 where d.id = 1 and nullif(d.fallback_number,'') is null
   and nullif((select from_number from app_private.retell_config where id = 1),'') is not null;

do $$
declare s text;
begin
  s := pg_get_functiondef('public.dialer_hook_event(jsonb,boolean)'::regprocedure);
  if position('riley_wa_enabled' in s) = 0 then raise exception 'bl_voice_0458b: apply bl_voice_0458 first'; end if;
  if position('riley_caller_dispatcher' in s) = 0 then
    -- (a) locals
    if position('ln app_private.dialer_lines; v_riley text;' in s) = 0 then raise exception 'bl_voice_0458b: declare anchor missing'; end if;
    s := replace(s, 'ln app_private.dialer_lines; v_riley text;', 'ln app_private.dialer_lines; v_riley text; v_rd record;');
    -- (b) inside the riley branch: resolve the dispatcher before deciding
    if position($a$    select from_number into v_riley from app_private.retell_config where id = 1;
    if nullif(v_riley,'') is not null then$a$ in s) = 0 then raise exception 'bl_voice_0458b: riley anchor missing'; end if;
    s := replace(s, $a$    select from_number into v_riley from app_private.retell_config where id = 1;
    if nullif(v_riley,'') is not null then$a$,
$b$    select from_number into v_riley from app_private.retell_config where id = 1;
    -- bl_voice_0458b: a known carrier whose dispatcher contact is released rings that dispatcher first.
    -- We only pre-load `ln`; the dispatcher-line branch below then runs as if they had dialled that line
    -- (browser → mobile → fallback = Riley → voicemail).
    select * into v_rd from app_private.riley_caller_dispatcher(coalesce(v_from, pl->>'from'));
    if coalesce(cfg.riley_route_to_dispatcher, true) and v_rd.line_id is not null and coalesce(v_rd.released, false) then
      select * into ln from app_private.dialer_lines where id = v_rd.line_id and status = 'active';
    end if;
    if ln.id is not null then
      null;  -- handled by the dispatcher-line branch
    elsif nullif(v_riley,'') is not null then$b$);
    -- (c) the dispatcher-line branch must not overwrite a pre-loaded line
    if position($a$    select * into ln from app_private.dialer_lines where phone_e164 = v_to and status = 'active';$a$ in s) = 0 then raise exception 'bl_voice_0458b: line anchor missing'; end if;
    s := replace(s, $a$    select * into ln from app_private.dialer_lines where phone_e164 = v_to and status = 'active';$a$,
                    $b$    if ln.id is null then select * into ln from app_private.dialer_lines where phone_e164 = v_to and status = 'active'; end if;$b$);
    -- (d) name the caller from their profile when the broker match has nothing
    if position($a$          m->>'contact_name', (m->>'broker_contact_id')::uuid,$a$ in s) = 0 then raise exception 'bl_voice_0458b: insert anchor missing'; end if;
    s := replace(s, $a$          m->>'contact_name', (m->>'broker_contact_id')::uuid,$a$,
                    $b$          coalesce(m->>'contact_name', v_rd.carrier_name), (m->>'broker_contact_id')::uuid,$b$);
    execute s;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Riley's briefing names the dispatcher
-- ---------------------------------------------------------------------------------------------------------
do $$
declare s text;
begin
  s := pg_get_functiondef('public.retell_inbound_verified(jsonb)'::regprocedure);
  if position('riley_caller_dispatcher' in s) = 0 then
    if position('v_name text; v_role text; v_context text;' in s) = 0 then raise exception 'bl_voice_0458b: inbound declare anchor missing'; end if;
    s := replace(s, 'v_name text; v_role text; v_context text;', 'v_name text; v_role text; v_context text; v_rd record; v_disp_ctx text;');
    if position($a$      E'\nNever read their MC or DOT number back to them unless they ask - it is just context for you.';$a$ in s) = 0 then raise exception 'bl_voice_0458b: inbound context anchor missing'; end if;
    s := replace(s, $a$      E'\nNever read their MC or DOT number back to them unless they ask - it is just context for you.';$a$,
$b$      E'\nNever read their MC or DOT number back to them unless they ask - it is just context for you.';
    -- bl_voice_0458b: their dedicated dispatcher, so Riley can speak about that person by name
    select * into v_rd from app_private.riley_caller_dispatcher(payload->'call_inbound'->>'from_number');
    if v_rd.dispatcher_user_id is not null then
      v_disp_ctx := E'\nTheir dedicated LoadBoot dispatcher: ' || coalesce(nullif(v_rd.full_name,''), 'assigned (name not on file)') ||
        case when coalesce(v_rd.released,false) then '. They reached you because that dispatcher did not pick up right now.'
             else '. The dispatcher has not been introduced to them yet.' end ||
        E'\nIF THEY ASK FOR THEIR DISPATCHER: say warmly that ' || coalesce(nullif(split_part(coalesce(v_rd.full_name,''),' ',1),''), 'their dispatcher') ||
        ' is on another call, take the message and the best number to reach them, and promise a call back within the hour. Never give out the dispatcher''s number.';
    else
      v_disp_ctx := E'\nNo dedicated dispatcher is assigned to this account yet (assignment happens within three business days of verification). If they ask, say exactly that and offer to have the team confirm the timing by email.';
    end if;
    v_context := v_context || v_disp_ctx;$b$);
    execute s;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 4. Inbound prompt: one more rule for the KNOWN caller section (draft only; publish from CC)
-- ---------------------------------------------------------------------------------------------------------
update app_private.riley_prompts
   set general_prompt = replace(general_prompt,
        'If the name is "there", we do not know them yet.',
        'If the name is "there", we do not know them yet.' || E'\n' ||
        'If the briefing names their dedicated dispatcher and they ask for that person: that dispatcher could not pick up right now, which is why you have the call. Say so warmly, take the message and the best number, and promise the dispatcher calls back within the hour. Never give out the dispatcher''s number. If the briefing says no dispatcher is assigned yet, say exactly that.'),
       updated_at = now()
 where agent_key = 'inbound'
   and position('If the briefing names their dedicated dispatcher' in general_prompt) = 0;

-- ---------------------------------------------------------------------------------------------------------
-- 5. CC settings carry the new switch
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.cc_riley_settings_get()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'app_private', 'public'
as $function$
  select case when not (public.has_global_permission('comm.view') or public.has_global_permission('comm.manage')
                     or public.has_global_permission('support.view') or public.has_global_permission('dispatch.manage')
                     or public.has_global_permission('settings.manage'))
    then jsonb_build_object('error','not authorized')
    else (select jsonb_build_object(
      'riley_wa_enabled', d.riley_wa_enabled, 'riley_route_to_dispatcher', d.riley_route_to_dispatcher,
      'wa_number', d.wa_number, 'dialer_enabled', d.enabled,
      'record_calls', d.record_calls, 'fallback_number_set', nullif(d.fallback_number,'') is not null,
      'fallback_is_riley', nullif(d.fallback_number,'') is not null and d.fallback_number = r.from_number,
      'riley_number_set', nullif(r.from_number,'') is not null,
      'inbound_agent_id', r.inbound_agent_id, 'outbound_agent_id', r.outbound_agent_id,
      'escalation_number', r.escalation_number, 'retell_key_set', r.api_key is not null,
      'signing_key_set', r.webhook_signing_key is not null, 'allow_unsigned_webhook', r.allow_unsigned_webhook,
      'released_carriers', (select count(*) from app_private.dispatcher_assignments a where a.status = 'active' and a.contact_released_at is not null),
      'can_manage', (public.has_global_permission('comm.manage') or public.has_global_permission('settings.manage')))
      from app_private.dialer_config d, app_private.retell_config r where d.id = 1 and r.id = 1) end;
$function$;
revoke execute on function public.cc_riley_settings_get() from public, anon;
grant  execute on function public.cc_riley_settings_get() to authenticated;

create or replace function public.cc_riley_settings_set(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'app_private', 'public'
as $function$
declare v_esc text;
begin
  if not (public.has_global_permission('comm.manage') or public.has_global_permission('settings.manage')) then
    return jsonb_build_object('error','not authorized');
  end if;
  if p ? 'riley_wa_enabled' then
    update app_private.dialer_config set riley_wa_enabled = coalesce((p->>'riley_wa_enabled')::boolean, false), updated_at = now(), updated_by = auth.uid() where id = 1;
  end if;
  if p ? 'riley_route_to_dispatcher' then
    update app_private.dialer_config set riley_route_to_dispatcher = coalesce((p->>'riley_route_to_dispatcher')::boolean, true), updated_at = now(), updated_by = auth.uid() where id = 1;
  end if;
  if p ? 'escalation_number' then
    v_esc := nullif(app_private.dial_e164(p->>'escalation_number'), '');
    if v_esc is not null and v_esc = (select from_number from app_private.retell_config where id = 1) then
      return jsonb_build_object('error','the escalation number cannot be the Riley line itself');
    end if;
    update app_private.retell_config set escalation_number = v_esc where id = 1;
  end if;
  if p ? 'inbound_agent_id' and (p->>'inbound_agent_id') ~ '^agent_[0-9a-f]{20,40}$' then
    update app_private.retell_config set inbound_agent_id = p->>'inbound_agent_id' where id = 1;
  end if;
  if p ? 'outbound_agent_id' and (p->>'outbound_agent_id') ~ '^agent_[0-9a-f]{20,40}$' then
    update app_private.retell_config set outbound_agent_id = p->>'outbound_agent_id' where id = 1;
  end if;
  return public.cc_riley_settings_get();
end $function$;
revoke execute on function public.cc_riley_settings_set(jsonb) from public, anon;
grant  execute on function public.cc_riley_settings_set(jsonb) to authenticated;

do $$
declare bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','app_private') and has_function_privilege('anon', p.oid, 'execute')
    and p.proname in ('riley_caller_dispatcher','cc_riley_settings_get','cc_riley_settings_set');
  if bad is not null then raise exception 'bl_voice_0458b: anon can execute %', bad; end if;
end $$;

commit;
