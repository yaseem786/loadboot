-- bl_dmail_0365 — in-app notices on the ASSIGN path
--
-- Gap found 20 Sep 2026 while onboarding Abdul Aziz Shinwari: the WITHDRAW and REPLACE
-- paths each raise an in-app notice (dispatcher.mailbox.withdrawn, dispatcher.phone.line_changed),
-- but the ASSIGN path raised none — a dispatcher who got a first line or a first mailbox
-- saw nothing in the portal, only an e-mail.
--
-- Additive: the only change to each function is one extra disp_notify, in its own
-- begin/exception block so a failed notice can never break the e-mail or the assignment.
-- Nothing else in either body is touched.
--   cc_dialer_line_upsert -> dispatcher.phone.line_ready   (first line only; a replacement
--                                                           still gets line_changed, not both)
--   cc_dmail_assign       -> dispatcher.mailbox.ready

CREATE OR REPLACE FUNCTION public.cc_dialer_line_upsert(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private', 'public'
AS $function$
declare v_user uuid := nullif(p->>'dispatcher_user_id','')::uuid; e text := app_private.dial_e164(p->>'number'); v_id uuid; v_name text;
        v_old text[]; o text;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if v_user is null or e is null then return jsonb_build_object('error','dispatcher and a valid number are required'); end if;
  select full_name into v_name from app_private.dispatcher_profiles where user_id = v_user;
  if v_name is null then return jsonb_build_object('error','not a dispatcher'); end if;
  if exists (select 1 from app_private.dialer_lines where phone_e164 = e and status = 'active' and dispatcher_user_id <> v_user) then
    return jsonb_build_object('error','that number is already assigned to another dispatcher'); end if;
  -- numbers this dispatcher is losing in this call (a replacement, not a plain withdrawal)
  select array_agg(phone_e164) into v_old from app_private.dialer_lines
    where dispatcher_user_id = v_user and status = 'active' and phone_e164 <> e;
  update app_private.dialer_lines set status = 'released', updated_at = now() where dispatcher_user_id = v_user and status = 'active' and phone_e164 <> e;
  select id into v_id from app_private.dialer_lines where dispatcher_user_id = v_user and status = 'active' and phone_e164 = e;
  if v_id is null then
    insert into app_private.dialer_lines (dispatcher_user_id, phone_e164, label, telnyx_number_id, created_by, forward_number)
    values (v_user, e, nullif(p->>'label',''), nullif(p->>'telnyx_number_id',''), auth.uid(), app_private.dial_e164(p->>'forward_number')) returning id into v_id;
    if coalesce(array_length(v_old,1),0) = 0 then
      begin perform app_private.disp_phone_line_email(v_user, e); exception when others then null; end;
      -- bl_dmail_0365: first line — say so in the portal too, not only by e-mail
      begin
        perform app_private.disp_notify(v_user, 'dispatcher', 'dispatcher.phone.line_ready',
          'Your LoadBoot phone line is ready',
          'Your line is ' || coalesce(app_private.disp_fmt_us(e), e) || '. Use it for every broker and carrier call — never your personal number. Details are in your email.',
          '/app/agent/#dashboard', false);
      exception when others then null; end;
    else
      -- replacement: ONE "your line has changed" e-mail per old number (it carries the new one), no line_ready
      foreach o in array v_old loop
        begin
          perform app_private.disp_phone_line_withdrawn_email(v_user, o, e);
          perform app_private.disp_notify(v_user, 'dispatcher', 'dispatcher.phone.line_changed',
            'Your LoadBoot phone line has changed',
            'Your new line is ' || coalesce(app_private.disp_fmt_us(e), e) || '. The old number '
              || coalesce(app_private.disp_fmt_us(o), o) || ' no longer reaches you. Details are in your email.',
            '/app/agent/#dashboard', false);
        exception when others then null; end;
      end loop;
    end if;
  else
    update app_private.dialer_lines set label = coalesce(nullif(p->>'label',''), label), forward_number = case when p ? 'forward_number' then app_private.dial_e164(p->>'forward_number') else forward_number end, telnyx_number_id = coalesce(nullif(p->>'telnyx_number_id',''), telnyx_number_id), updated_at = now() where id = v_id;
  end if;
  perform app_private.disp_audit('dialer.line_assign', 'dispatcher', v_user::text, null, v_name || ': line ' || e, jsonb_build_object('line_id', v_id, 'number', e));
  return jsonb_build_object('ok', true, 'line_id', v_id, 'number', e, 'replaced', coalesce(array_length(v_old,1),0));
end $function$;

CREATE OR REPLACE FUNCTION public.cc_dmail_assign(p_account uuid, p_user uuid, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private', 'public'
AS $function$
declare a app_private.dmail_accounts; v_name text; v_mailed boolean := false; v_changed boolean;
        v_prev uuid; v_withdrawn boolean := false;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select * into a from dmail_accounts where id = p_account;
  if a.id is null then return jsonb_build_object('error','mailbox not found'); end if;
  if p_user is not null then
    select full_name into v_name from dispatcher_profiles where user_id = p_user and status in ('trial','verified','active');
    if v_name is null then return jsonb_build_object('error','not an active dispatcher'); end if;
    if exists (select 1 from dmail_accounts where assigned_to = p_user and id <> p_account) then
      return jsonb_build_object('error','that dispatcher already has a mailbox — unassign it first'); end if;
  end if;
  v_prev := a.assigned_to;
  v_changed := v_prev is distinct from p_user;
  update dmail_accounts set assigned_to = p_user, assigned_at = case when p_user is null then null when v_changed then now() else assigned_at end, assigned_by = auth.uid(), updated_at = now() where id = p_account;
  perform app_private.disp_audit('dmail.assign', 'dispatcher', coalesce(p_user, v_prev)::text, null,
    a.address || case when p_user is null then ' unassigned' else ' assigned to ' || v_name end, jsonb_build_object('account', p_account));
  if p_user is not null and (v_changed or nullif(btrim(coalesce(p_name,'')),'') is not null) then
    perform app_private.dmail_identity_apply(p_account, p_name);
  elsif p_user is null and v_changed then
    perform app_private.dmail_identity_reset(p_account);
  end if;
  if v_changed and v_prev is not null then
    begin
      perform app_private.dmail_withdraw_email(v_prev, p_account);
      perform app_private.disp_notify(v_prev, 'dispatcher', 'dispatcher.mailbox.withdrawn',
        'Your LoadBoot mailbox was withdrawn',
        'Access to ' || a.address || ' has ended and the Email tab has been removed from your workspace. The mailbox and its email stay with LoadBoot. Details are in your email.',
        '/app/agent/#dashboard', false);
      v_withdrawn := true;
    exception when others then v_withdrawn := false; end;
  end if;
  if p_user is not null and v_changed then
    begin perform app_private.dmail_assign_email(p_user, p_account); v_mailed := true; exception when others then v_mailed := false; end;
    -- bl_dmail_0365: the Email tab just appeared in his workspace — say so in the portal too
    begin
      perform app_private.disp_notify(p_user, 'dispatcher', 'dispatcher.mailbox.ready',
        'Your LoadBoot mailbox is ready',
        a.address || ' is now yours and the Email tab is open in your workspace. Use it for every broker and carrier email — never a personal account. Your login password is in your email.',
        '/app/agent/#email', false);
    exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'welcome_email', v_mailed, 'withdraw_email', v_withdrawn,
    'display_name', (select display_name from dmail_accounts where id = p_account));
end $function$;
