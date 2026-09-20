-- bl_dial_0351b — closes the "phone is locked / portal is in the background" gap of a browser softphone.
--   1. FORWARD-TO-MOBILE: a line may carry forward_number (the dispatcher's own mobile). Inbound order becomes
--      browser (if online) → forward_number (rings the real phone, works with the screen locked) → Riley / voicemail.
--      The forwarded leg is still a Telnyx call: logged, recorded, and a missed one still becomes a callback task.
--      Caller ID on the forwarded leg is the dispatcher's own LoadBoot line (an owned number is never rejected).
--   2. PUSH: dialer_hook_event now returns `notify` for a new inbound call and for a missed one; telnyx-hook
--      sends it as a web push to that dispatcher's devices ("Incoming call — open LoadBoot").
-- Written as in-place patches of the 0351 functions so the big bodies are not duplicated. Idempotent. STAGING first.

alter table app_private.dialer_lines add column if not exists forward_number text;
alter table app_private.dialer_calls add column if not exists forward_tried boolean not null default false;

do $$
declare s text;
  procedure_missing constant text := 'bl_dial_0351b: expected text not found in ';
begin
  -- ---------------------------------------------------------------- dialer_hook_event
  s := pg_get_functiondef('public.dialer_hook_event(jsonb,boolean)'::regprocedure);
  if position('forward_tried' in s) = 0 then
    if position($o$    if nullif(cfg.fallback_number,'') is not null then
      update app_private.dialer_calls set status = 'forwarded'$o$ in s) = 0 then raise exception '%', procedure_missing || 'hook/fallback'; end if;
    s := replace(s, $o$    if nullif(cfg.fallback_number,'') is not null then
      update app_private.dialer_calls set status = 'forwarded'$o$, $n$    select * into ln from app_private.dialer_lines where id = c.line_id;
    if nullif(ln.forward_number,'') is not null and not c.forward_tried then
      update app_private.dialer_calls set forward_tried = true, updated_at = now() where id = c.id;
      act := jsonb_build_object('type','transfer','fwd', true, 'call_control_id', c.telnyx_call_control_id, 'to', ln.forward_number, 'from', ln.phone_e164,
               'timeout_secs', 25, 'client_state', encode(convert_to(c.id::text,'UTF8'),'base64'),
               'target_leg_client_state', encode(convert_to('b:' || c.id::text,'UTF8'),'base64'));
    elsif nullif(cfg.fallback_number,'') is not null then
      update app_private.dialer_calls set status = 'forwarded'$n$);

    if position($o$    if not exists (select 1 from app_private.dialer_callbacks where call_id = c.id) then
      insert into app_private.dialer_callbacks (dispatcher_user_id, call_id, number, contact_name, reason)
      values (c.dispatcher_user_id, c.id, c.counterparty, c.contact_name, case when nullif($o$ in s) = 0 then raise exception '%', procedure_missing || 'hook/callback'; end if;
    s := replace(s, $o$    if not exists (select 1 from app_private.dialer_callbacks where call_id = c.id) then
      insert into app_private.dialer_callbacks (dispatcher_user_id, call_id, number, contact_name, reason)
      values (c.dispatcher_user_id, c.id, c.counterparty, c.contact_name, case when nullif($o$, $n$    if coalesce((act->>'fwd')::boolean, false) is not true and not exists (select 1 from app_private.dialer_callbacks where call_id = c.id) then
      insert into app_private.dialer_callbacks (dispatcher_user_id, call_id, number, contact_name, reason)
      values (c.dispatcher_user_id, c.id, c.counterparty, c.contact_name, case when nullif($n$);

    if position($o$  return jsonb_build_object('ok', true, 'call_id', c.id, 'action', act);$o$ in s) = 0 then raise exception '%', procedure_missing || 'hook/return'; end if;
    s := replace(s, $o$  return jsonb_build_object('ok', true, 'call_id', c.id, 'action', act);$o$, $n$  return jsonb_build_object('ok', true, 'call_id', c.id, 'action', act, 'notify',
    case when c.id is null or c.direction <> 'inbound' or v_leg <> 'a' then null
         when ev = 'call.initiated' and v_cc = c.telnyx_call_control_id then jsonb_build_object('user_id', c.dispatcher_user_id, 'title', 'Incoming call',
              'body', coalesce(c.contact_name, c.counterparty, 'Unknown caller') || ' — open LoadBoot to answer', 'url', '/app/agent/#today')
         when ev = 'call.hangup' and c.answered_at is null then jsonb_build_object('user_id', c.dispatcher_user_id, 'title', 'Missed call',
              'body', coalesce(c.contact_name, c.counterparty, 'Unknown caller') || ' — it is in your Callbacks', 'url', '/app/agent/#today')
         else null end);$n$);
    execute s;
  end if;

  -- ---------------------------------------------------------------- cc_dialer_line_upsert (forward_number)
  s := pg_get_functiondef('public.cc_dialer_line_upsert(jsonb)'::regprocedure);
  if position('forward_number' in s) = 0 then
    if position($o$(dispatcher_user_id, phone_e164, label, telnyx_number_id, created_by)
    values (v_user, e, nullif(p->>'label',''), nullif(p->>'telnyx_number_id',''), auth.uid())$o$ in s) = 0
       or position($o$set label = coalesce(nullif(p->>'label',''), label),$o$ in s) = 0 then raise exception '%', procedure_missing || 'line_upsert'; end if;
    s := replace(s, $o$(dispatcher_user_id, phone_e164, label, telnyx_number_id, created_by)
    values (v_user, e, nullif(p->>'label',''), nullif(p->>'telnyx_number_id',''), auth.uid())$o$, $n$(dispatcher_user_id, phone_e164, label, telnyx_number_id, created_by, forward_number)
    values (v_user, e, nullif(p->>'label',''), nullif(p->>'telnyx_number_id',''), auth.uid(), app_private.dial_e164(p->>'forward_number'))$n$);
    s := replace(s, $o$set label = coalesce(nullif(p->>'label',''), label),$o$, $n$set label = coalesce(nullif(p->>'label',''), label), forward_number = case when p ? 'forward_number' then app_private.dial_e164(p->>'forward_number') else forward_number end,$n$);
    execute s;
  end if;

  -- ---------------------------------------------------------------- cc_dialer_overview (show forward_number)
  s := pg_get_functiondef('public.cc_dialer_overview()'::regprocedure);
  if position('forward_number' in s) = 0 then
    if position($o$'label', l.label,$o$ in s) = 0 then raise exception '%', procedure_missing || 'overview'; end if;
    s := replace(s, $o$'label', l.label,$o$, $n$'label', l.label, 'forward_number', l.forward_number,$n$);
    execute s;
  end if;
end $$;
