-- bl_sms_0609 — Command Center can answer a MAIN-LINE text conversation, from the main line.
--
-- Found 15 Nov 2026 while building the CC SMS inbox: 14 of the 16 owner-less conversations on prod arrived on the main
-- number (+1 815 365-1168, sms_threads.line_id is null). public.dialer_sms_prepare only knew dispatcher lines:
--   · staff WITHOUT a line of their own  -> "No LoadBoot line is attached to this conversation yet" (could not reply at all)
--   · staff WITH a line of their own     -> the reply left from their personal line, a number the customer never texted
-- Now: a conversation with no owner and no line is answered by staff FROM the main line (doc_sms_config.from_e164, the
-- same sender the document texts use; default dialer_config.wa_number). The main line is also the last resort for staff
-- when no dispatcher line can be found. Dispatchers are untouched: they still send from their own line only.
-- Every other check (consent, STOP, broker switch, hourly cap, conduct guards) runs exactly as before.
--
-- Also: sms_msg_json now says WHO sent an outbound text ('sender') and which line it used ('line') for the inbox.
--
-- Patched in place (anchor replace) so nothing else in the functions is retyped. Idempotent. No new function, no ACL change.

do $mig$
declare d text;
begin
  -- ---------------------------------------------------------------- dialer_sms_prepare
  d := pg_get_functiondef('public.dialer_sms_prepare(jsonb)'::regprocedure);
  if position('bl_sms_0609' in d) = 0 then
    if position($a$ v_reply uuid; v_reply_row app_private.dialer_messages; v_from text;$a$ in d) = 0
       or position($a$  select * into ln from app_private.dialer_lines where dispatcher_user_id = v_uid and status = 'active' order by last_seen_at desc nulls last limit 1;$a$ in d) = 0
       or position($a$  if ln.id is null then return jsonb_build_object('ok', false, 'error', case when v_role = 'staff'$a$ in d) = 0
       or position($a$  v_from := ln.phone_e164;$a$ in d) = 0
       or position($a$'messaging_profile_id', case when v_kind = 'broker'$a$ in d) = 0 then
      raise exception 'bl_sms_0609: dialer_sms_prepare is not the version this patch expects';
    end if;
    d := replace(d, $a$ v_reply uuid; v_reply_row app_private.dialer_messages; v_from text;$a$,
                    $a$ v_reply uuid; v_reply_row app_private.dialer_messages; v_from text; v_main text; v_use_main boolean := false;$a$);
    d := replace(d, $a$  select * into ln from app_private.dialer_lines where dispatcher_user_id = v_uid and status = 'active' order by last_seen_at desc nulls last limit 1;$a$,
$a$  -- bl_sms_0609: a conversation that lives on the MAIN line (no owner, no line) is answered by Command Center from the main line.
  if v_role = 'staff' then
    v_main := coalesce((select c.from_e164 from app_private.doc_sms_config c order by c.id limit 1), app_private.dial_e164(cfg.wa_number));
  end if;
  v_use_main := v_main is not null and t.owner_user_id is null and t.line_id is null;
  if not v_use_main then
    select * into ln from app_private.dialer_lines where dispatcher_user_id = v_uid and status = 'active' order by last_seen_at desc nulls last limit 1;
  end if;$a$);
    d := replace(d, $a$  if ln.id is null then return jsonb_build_object('ok', false, 'error', case when v_role = 'staff'$a$,
$a$  if ln.id is null and v_main is not null then v_use_main := true; end if;
  if ln.id is null and not v_use_main then return jsonb_build_object('ok', false, 'error', case when v_role = 'staff'$a$);
    d := replace(d, $a$  v_from := ln.phone_e164;$a$,
                    $a$  v_from := case when v_use_main then v_main else ln.phone_e164 end;$a$);
    d := replace(d, $a$'messaging_profile_id', case when v_kind = 'broker'$a$,
                    $a$'messaging_profile_id', case when v_use_main then (select c.messaging_profile_id from app_private.doc_sms_config c order by c.id limit 1) when v_kind = 'broker'$a$);
    execute d;
  end if;

  -- ---------------------------------------------------------------- sms_msg_json: who sent it, on which line
  d := pg_get_functiondef('app_private.sms_msg_json(app_private.dialer_messages)'::regprocedure);
  if position($a$'sender',$a$ in d) = 0 then
    if position($a$'sender_user_id', m.sender_user_id,$a$ in d) = 0 then
      raise exception 'bl_sms_0609: sms_msg_json is not the version this patch expects';
    end if;
    d := replace(d, $a$'sender_user_id', m.sender_user_id,$a$,
$a$'sender_user_id', m.sender_user_id,
    'sender', (select coalesce(nullif(dp.full_name,''), nullif(pr.contact_name,''), split_part(u.email,'@',1)) from auth.users u
                 left join app_private.dispatcher_profiles dp on dp.user_id = u.id left join public.profiles pr on pr.id = u.id where u.id = m.sender_user_id),
    'line', (select l.phone_e164 from app_private.dialer_lines l where l.id = m.line_id),$a$);
    execute d;
  end if;
end $mig$;
