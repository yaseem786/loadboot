-- bl_dmail_0364a — when a dispatcher's number is REPLACED (cc_dialer_line_upsert releases his old active
-- line and gives him a new one) he now gets ONE "your line has changed" e-mail (old + new number) instead of
-- silence, plus an in-app notice. A first line still gets the normal line_ready e-mail.
-- Applied to STAGING 20 Sep 2026; applied to PROD the same day inside the merged 0364 transaction.

drop function if exists app_private.disp_phone_line_withdrawn_email(uuid, text);

create or replace function app_private.disp_phone_line_withdrawn_email(p_user uuid, p_e164 text, p_replaced_by text default null)
returns void language plpgsql security definer set search_path to 'app_private','public' as $fn$
declare v_mail text; v_name text; v_num text := app_private.disp_fmt_us(p_e164); v_html text;
        v_new text := app_private.disp_fmt_us(p_replaced_by); v_repl boolean;
        v_contact text := app_private.disp_contact()->>'email';
begin
  select u.email into v_mail from auth.users u where u.id = p_user;
  if v_mail is null or v_num is null then return; end if;
  v_repl := v_new is not null;
  select full_name into v_name from app_private.dispatcher_profiles where user_id = p_user;
  v_html := '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
    || app_private.disp_head('LoadBoot Dispatch &middot; Phone',
         case when v_repl then 'Your LoadBoot phone line has changed' else 'Your LoadBoot phone line has been withdrawn' end)
    || '<p style="margin:0 0 14px">Dear ' || app_private.disp_esc(coalesce(nullif(v_name,''),'Dispatcher')) || ', '
    || case when v_repl then 'LoadBoot has moved your dispatcher workspace to a new business line. Your old number no longer reaches you.'
            else 'the LoadBoot business line below has been withdrawn from your dispatcher workspace.' end || '</p>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#10223B;border-radius:14px;margin:0 0 18px"><tr><td style="padding:18px 20px">'
    || case when v_repl then
         '<div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#8ea2c3;font-weight:700">Your new line</div>'
      || '<div style="font-size:26px;font-weight:800;color:#FC5305">' || app_private.disp_esc(v_new) || '</div>'
      || '<div style="font-size:13px;color:#b8c7de;margin-top:6px">Old number <b style="color:#fff">' || app_private.disp_esc(v_num)
      || '</b> &middot; withdrawn ' || to_char(now() at time zone 'UTC','DD Mon YYYY') || '</div>'
       else
         '<div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#8ea2c3;font-weight:700">Line withdrawn</div>'
      || '<div style="font-size:26px;font-weight:800;color:#FC5305">' || app_private.disp_esc(v_num) || '</div>'
      || '<div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#8ea2c3;font-weight:700;margin-top:4px">Withdrawn '
      || to_char(now() at time zone 'UTC','DD Mon YYYY') || '</div>' end
    || '</td></tr></table>'
    || app_private.disp_box('What this means',
         case when v_repl then 'Open the phone in your workspace and it connects on the new number straight away &mdash; nothing to install. '
                             || 'Calls and texts to the old number no longer reach you; they go to LoadBoot.'
              else 'The phone in your workspace no longer connects and this number no longer reaches you. '
                || 'Calls and texts sent to it go to LoadBoot. The number returns to LoadBoot and may be given to another dispatcher.' end)
    || app_private.disp_box('The number and the records belong to LoadBoot',
         'The call history, recordings, texts and contacts on '
      || case when v_repl then 'both lines are' else 'this line are' end
      || ' LoadBoot business records and stay with LoadBoot.')
    || app_private.disp_box(case when v_repl then 'Before your next call' else 'Before you close the tab' end,
         'Remove the old number from your email signature, load-board profiles and broker records'
      || case when v_repl then ' and put the new one in its place. ' else '. Do not give it out as yours. ' end
      || 'If a broker or a carrier is waiting for a call back on the old line, tell LoadBoot staff today so nothing is dropped. '
      || 'Never use a personal number in place of a LoadBoot line for LoadBoot work.', 'stop')
    || app_private.disp_btn('Open my workspace', 'https://loadboot.com/app/agent/#dashboard')
    || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b;font-size:13px">' || v_contact || '</span></p>'
    || '<p style="color:#8ea2c3;font-size:12px;margin:0">You are receiving this because '
    || case when v_repl then 'your LoadBoot phone line was changed.' else 'a LoadBoot phone line was withdrawn from your dispatcher account.' end
    || '</p></div>';
  perform app_private.sys_email(v_mail,
    case when v_repl then 'dispatcher.phone.line_changed' else 'dispatcher.phone.line_withdrawn' end,
    case when v_repl then 'Your LoadBoot phone line has changed — now ' || v_new
         else 'Your LoadBoot phone line has been withdrawn — ' || v_num end,
    v_html,
    case when v_repl then 'Your LoadBoot line has changed. New number: ' || v_new || '. Old number ' || v_num || ' no longer reaches you. '
           || 'Open the phone in your workspace and it connects on the new number. Replace the old number in your signature, load-board profiles and broker records. '
           || 'If someone is waiting for a call back on the old line, tell LoadBoot staff today. LoadBoot Dispatch'
         else 'The LoadBoot line ' || v_num || ' has been withdrawn from your dispatcher workspace. The phone no longer connects and the number no longer reaches you. '
           || 'The number, call history, recordings and texts stay with LoadBoot. Remove the number from your signature, load-board profiles and broker records. '
           || 'If someone is waiting for a call back on this line, tell LoadBoot staff today. LoadBoot Dispatch' end,
    'disp.phone_withdraw:' || p_user::text || ':' || p_e164 || ':' || coalesce(p_replaced_by,'-') || ':' || extract(epoch from now())::bigint::text);
end $fn$;

revoke all on function app_private.disp_phone_line_withdrawn_email(uuid,text,text) from public;

create or replace function public.cc_dialer_line_upsert(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $fn$
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
end $fn$;
