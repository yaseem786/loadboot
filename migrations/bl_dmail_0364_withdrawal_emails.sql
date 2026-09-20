-- bl_dmail_0364 — withdrawal e-mails + in-app notifications on release, and identity reset on unassign.
-- Applied to STAGING (snslhvmkjusozgjelghi) 20 Sep 2026. Additive; safe to replay.
-- Changes behaviour of: public.cc_dmail_assign (unassign / reassign), public.cc_dialer_line_release.
-- Deliberately NOT changed: cc_dialer_line_upsert's implicit release when a dispatcher gets a DIFFERENT
-- number (that is a replacement, the line_ready e-mail already covers it — no "withdrawn" notice there).

-- ---------------------------------------------------------------- neutral identity (after release)
create or replace function app_private.dmail_signature_neutral(p_address text)
returns text language sql stable as $fn$
  select '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;color:#10223B"><tr>'
    || '<td style="padding:2px 16px 2px 0;border-right:3px solid #FC5305;vertical-align:middle"><a href="https://loadboot.com" style="text-decoration:none"><img src="https://loadboot.com/email-logo-2x.png" width="124" height="30" alt="LoadBoot" style="display:block;border:0"></a></td>'
    || '<td style="padding:2px 0 2px 16px;vertical-align:middle">'
    || '<div style="font-size:16px;font-weight:700;color:#10223B;line-height:1.25">LoadBoot Dispatch</div>'
    || '<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0883F7;line-height:1.6">Dispatch Operations</div>'
    || '<div style="font-size:12.5px;color:#475569;line-height:1.6;margin-top:4px">'
    || '<a href="mailto:' || app_private.dmail_esc(p_address) || '" style="color:#475569;text-decoration:none">' || app_private.dmail_esc(p_address) || '</a> &nbsp;|&nbsp; '
    || '<a href="https://loadboot.com" style="color:#0883F7;text-decoration:none;font-weight:700">loadboot.com</a></div>'
    || '</td></tr></table>'
    || '<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#94a3b8;margin-top:8px">The Operating System for Trucking</div>'
$fn$;

create or replace function app_private.dmail_identity_reset(p_account uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $fn$
declare a app_private.dmail_accounts;
begin
  select * into a from dmail_accounts where id = p_account;
  if a.id is null then return jsonb_build_object('error','mailbox not found'); end if;
  update dmail_accounts
     set display_name   = 'LoadBoot Dispatch',
         signature_html = app_private.dmail_signature_neutral(a.address),
         updated_at     = now()
   where id = p_account;
  return jsonb_build_object('ok', true, 'display_name', 'LoadBoot Dispatch');
end $fn$;

-- ---------------------------------------------------------------- mailbox withdrawn e-mail
create or replace function app_private.dmail_withdraw_html(p_name text, p_address text)
returns text language sql stable as $fn$
  select '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
    || app_private.disp_head('LoadBoot Dispatch &middot; Mailbox', 'Your LoadBoot mailbox has been withdrawn')
    || '<p style="margin:0 0 14px">Dear ' || app_private.disp_esc(coalesce(nullif(p_name,''),'Dispatcher'))
    || ', your access to the LoadBoot company mailbox below has ended. The Email tab has been removed from your dispatcher workspace.</p>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#10223B;border-radius:14px;margin:0 0 18px"><tr><td style="padding:18px 20px">'
    || '<div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#8ea2c3;font-weight:700">Address withdrawn</div>'
    || '<div style="font-size:20px;font-weight:800;color:#FC5305;margin:2px 0 6px">' || app_private.disp_esc(p_address) || '</div>'
    || '<div style="font-size:13px;color:#b8c7de">Access ended ' || to_char(now() at time zone 'UTC','DD Mon YYYY') || ' &middot; this address is no longer yours</div>'
    || '</td></tr></table>'
    || app_private.disp_box('What this means',
         'You can no longer open, send or receive email from this address, and it no longer appears in your workspace. '
      || 'Anything a broker or carrier sends to it now goes to LoadBoot staff.')
    || app_private.disp_box('The mailbox and its email stay with LoadBoot',
         'The address and every message in it are company property and are kept in full. '
      || 'Do not try to reach the mailbox by any other route, and remove the address from your email signatures, load-board profiles and broker records.')
    || app_private.disp_box('Work in flight',
         'Do not continue any broker or carrier conversation from a personal email address. '
      || 'If a load, a rate confirmation or a document is still open on your side, tell LoadBoot staff today so it can be handed over. '
      || 'Never present yourself as holding a LoadBoot address you no longer hold.', 'stop')
    || app_private.disp_btn('Open my workspace', 'https://loadboot.com/app/agent/#dashboard')
    || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b;font-size:13px">'
    || (app_private.disp_contact()->>'email') || '</span></p>'
    || '<p style="color:#8ea2c3;font-size:12px;margin:0">You are receiving this because LoadBoot staff withdrew '
    || app_private.disp_esc(p_address) || ' from your dispatcher account.</p></div>'
$fn$;

create or replace function app_private.dmail_withdraw_email(p_user uuid, p_account uuid)
returns void language plpgsql security definer set search_path to 'app_private','public' as $fn$
declare v_mail text; v_name text; a app_private.dmail_accounts;
begin
  select * into a from app_private.dmail_accounts where id = p_account;
  if a.id is null then return; end if;
  select u.email into v_mail from auth.users u where u.id = p_user;
  if v_mail is null then return; end if;               -- login e-mail only; never into the mailbox itself
  select full_name into v_name from app_private.dispatcher_profiles where user_id = p_user;
  perform app_private.sys_email(
    v_mail, 'dispatcher.mailbox.withdrawn',
    'Your LoadBoot mailbox has been withdrawn — ' || a.address,
    app_private.dmail_withdraw_html(coalesce(nullif(v_name,''),'Dispatcher'), a.address),
    'Your access to the LoadBoot mailbox ' || a.address || ' has ended and the Email tab has been removed from your workspace. '
      || 'The address and every message in it stay with LoadBoot. Remove the address from your signatures, load-board profiles and broker records. '
      || 'Do not continue broker or carrier conversations from a personal email address - if anything is still open on your side, tell LoadBoot staff today. LoadBoot Dispatch',
    'dmail.withdraw:' || p_account::text || ':' || p_user::text || ':' || extract(epoch from now())::bigint::text);
end $fn$;

-- ---------------------------------------------------------------- phone line withdrawn e-mail
create or replace function app_private.disp_phone_line_withdrawn_email(p_user uuid, p_e164 text)
returns void language plpgsql security definer set search_path to 'app_private','public' as $fn$
declare v_mail text; v_name text; v_num text := app_private.disp_fmt_us(p_e164); v_html text;
        v_contact text := app_private.disp_contact()->>'email';
begin
  select u.email into v_mail from auth.users u where u.id = p_user;
  if v_mail is null or v_num is null then return; end if;
  select full_name into v_name from app_private.dispatcher_profiles where user_id = p_user;
  v_html := '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
    || app_private.disp_head('LoadBoot Dispatch &middot; Phone', 'Your LoadBoot phone line has been withdrawn')
    || '<p style="margin:0 0 14px">Dear ' || app_private.disp_esc(coalesce(nullif(v_name,''),'Dispatcher'))
    || ', the LoadBoot business line below has been withdrawn from your dispatcher workspace.</p>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#10223B;border-radius:14px;margin:0 0 18px"><tr><td style="padding:18px 20px">'
    || '<div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#8ea2c3;font-weight:700">Line withdrawn</div>'
    || '<div style="font-size:26px;font-weight:800;color:#FC5305">' || app_private.disp_esc(v_num) || '</div>'
    || '<div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#8ea2c3;font-weight:700;margin-top:4px">Withdrawn '
    || to_char(now() at time zone 'UTC','DD Mon YYYY') || '</div></td></tr></table>'
    || app_private.disp_box('What this means',
         'The phone in your workspace no longer connects and this number no longer reaches you. '
      || 'Calls and texts sent to it go to LoadBoot. The number returns to LoadBoot and may be given to another dispatcher.')
    || app_private.disp_box('The number and the records belong to LoadBoot',
         'The call history, recordings, texts and contacts on this line are LoadBoot business records and stay with LoadBoot.')
    || app_private.disp_box('Before you close the tab',
         'Remove the number from your email signature, load-board profiles and broker records. Do not give it out as yours. '
      || 'If a broker or a carrier is waiting for a call back on this line, tell LoadBoot staff today so nothing is dropped. '
      || 'Never use a personal number in place of a LoadBoot line for LoadBoot work.', 'stop')
    || app_private.disp_btn('Open my workspace', 'https://loadboot.com/app/agent/#dashboard')
    || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b;font-size:13px">' || v_contact || '</span></p>'
    || '<p style="color:#8ea2c3;font-size:12px;margin:0">You are receiving this because a LoadBoot phone line was withdrawn from your dispatcher account.</p></div>';
  perform app_private.sys_email(v_mail, 'dispatcher.phone.line_withdrawn',
    'Your LoadBoot phone line has been withdrawn — ' || v_num, v_html,
    'The LoadBoot line ' || v_num || ' has been withdrawn from your dispatcher workspace. The phone no longer connects and the number no longer reaches you. '
      || 'The number, call history, recordings and texts stay with LoadBoot. Remove the number from your signature, load-board profiles and broker records. '
      || 'If someone is waiting for a call back on this line, tell LoadBoot staff today. LoadBoot Dispatch',
    'disp.phone_withdraw:' || p_user::text || ':' || p_e164 || ':' || extract(epoch from now())::bigint::text);
end $fn$;

-- ---------------------------------------------------------------- cc_dmail_assign: reset + withdraw notice
create or replace function public.cc_dmail_assign(p_account uuid, p_user uuid, p_name text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $fn$
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
  -- identity: apply for the new holder, reset to a neutral LoadBoot identity when released
  if p_user is not null and (v_changed or nullif(btrim(coalesce(p_name,'')),'') is not null) then
    perform app_private.dmail_identity_apply(p_account, p_name);
  elsif p_user is null and v_changed then
    perform app_private.dmail_identity_reset(p_account);
  end if;
  -- the previous holder loses access: branded e-mail + in-app notice (never blocks the release)
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
  end if;
  return jsonb_build_object('ok', true, 'welcome_email', v_mailed, 'withdraw_email', v_withdrawn,
    'display_name', (select display_name from dmail_accounts where id = p_account));
end $fn$;

-- ---------------------------------------------------------------- cc_dialer_line_release: notice
create or replace function public.cc_dialer_line_release(p_line uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $fn$
declare ln app_private.dialer_lines; v_withdrawn boolean := false; v_num text;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  update app_private.dialer_lines set status = 'released', updated_at = now() where id = p_line and status = 'active' returning * into ln;
  if ln.id is null then return jsonb_build_object('error','line not found'); end if;
  perform app_private.disp_audit('dialer.line_release', 'dispatcher', ln.dispatcher_user_id::text, null, 'line ' || ln.phone_e164 || ' released', jsonb_build_object('line_id', ln.id));
  v_num := coalesce(app_private.disp_fmt_us(ln.phone_e164), ln.phone_e164);
  begin
    perform app_private.disp_phone_line_withdrawn_email(ln.dispatcher_user_id, ln.phone_e164);
    perform app_private.disp_notify(ln.dispatcher_user_id, 'dispatcher', 'dispatcher.phone.line_withdrawn',
      'Your LoadBoot phone line was withdrawn',
      'The line ' || v_num || ' has been withdrawn from your workspace. The phone no longer connects and the number no longer reaches you. Details are in your email.',
      '/app/agent/#dashboard', false);
    v_withdrawn := true;
  exception when others then v_withdrawn := false; end;
  return jsonb_build_object('ok', true, 'withdraw_email', v_withdrawn);
end $fn$;

-- ---------------------------------------------------------------- grants
revoke all on function app_private.dmail_signature_neutral(text) from public;
revoke all on function app_private.dmail_identity_reset(uuid) from public;
revoke all on function app_private.dmail_withdraw_html(text,text) from public;
revoke all on function app_private.dmail_withdraw_email(uuid,uuid) from public;
revoke all on function app_private.disp_phone_line_withdrawn_email(uuid,text) from public;
-- the four created with a default PUBLIC EXECUTE grant in 0358/0359 (see PROD-GOLIVE-0356-0363-STATUS.md)
revoke all on function app_private.dmail_esc(text) from public;
revoke all on function app_private.dmail_li(text,text) from public;
revoke all on function app_private.dmail_welcome_html(text,text,text) from public;
revoke all on function app_private.dmail_signature_html(text,text,text) from public;
