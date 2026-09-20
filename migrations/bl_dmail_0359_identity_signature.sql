-- bl_dmail_0359 — sender identity is set BY THE SYSTEM when a mailbox is assigned (owner, 20 Sep 2026):
--   From name  = "LoadBoot Dispatch — <Dispatcher name>"
--   Signature  = the LoadBoot brand signature built for that dispatcher (logo, name, title, their dedicated dialer
--                number if they have one, their address, loadboot.com, tagline). Never an invented phone number.
-- Staff can still edit both afterwards in CC → Dispatcher email → Edit; "Rebuild brand signature" re-applies this.

create or replace function app_private.dmail_signature_html(p_name text, p_address text, p_phone text) returns text
language sql immutable as $fn$
  select '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;color:#10223B"><tr>'
    || '<td style="padding:2px 16px 2px 0;border-right:3px solid #FC5305;vertical-align:middle"><a href="https://loadboot.com" style="text-decoration:none"><img src="https://loadboot.com/email-logo-2x.png" width="124" height="30" alt="LoadBoot" style="display:block;border:0"></a></td>'
    || '<td style="padding:2px 0 2px 16px;vertical-align:middle">'
    || '<div style="font-size:16px;font-weight:700;color:#10223B;line-height:1.25">' || app_private.dmail_esc(p_name) || '</div>'
    || '<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0883F7;line-height:1.6">Dispatcher &middot; LoadBoot Dispatch</div>'
    || '<div style="font-size:12.5px;color:#475569;line-height:1.6;margin-top:4px">'
    || case when nullif(p_phone,'') is not null then '<a href="tel:' || app_private.dmail_esc(regexp_replace(p_phone, '[^0-9+]', '', 'g')) || '" style="color:#475569;text-decoration:none">' || app_private.dmail_esc(p_phone) || '</a> &nbsp;|&nbsp; ' else '' end
    || '<a href="mailto:' || app_private.dmail_esc(p_address) || '" style="color:#475569;text-decoration:none">' || app_private.dmail_esc(p_address) || '</a> &nbsp;|&nbsp; '
    || '<a href="https://loadboot.com" style="color:#0883F7;text-decoration:none;font-weight:700">loadboot.com</a></div>'
    || '</td></tr></table>'
    || '<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#94a3b8;margin-top:8px">The Operating System for Trucking</div>'
$fn$;

create or replace function app_private.dmail_identity_apply(p_account uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare a app_private.dmail_accounts; v_full text; v_name text; v_e164 text; v_phone text;
begin
  select * into a from dmail_accounts where id = p_account;
  if a.id is null then return jsonb_build_object('error','mailbox not found'); end if;
  select full_name into v_full from dispatcher_profiles where user_id = a.assigned_to;
  -- default = first two words of the dispatcher's name ("Abdul Aziz Shinwari" → "Abdul Aziz"); staff can pass any name
  v_name := coalesce(nullif(btrim(coalesce(p_name,'')), ''), nullif(btrim(split_part(coalesce(v_full,''), ' ', 1) || ' ' || split_part(coalesce(v_full,''), ' ', 2)), ''));
  if v_name is null then return jsonb_build_object('error','assign the mailbox first, or give a name'); end if;
  v_name := left(regexp_replace(v_name, '[<>"\r\n]', '', 'g'), 60);
  select phone_e164 into v_e164 from dialer_lines where dispatcher_user_id = a.assigned_to and status = 'active' limit 1;
  v_phone := case when v_e164 ~ '^\+1[0-9]{10}$' then '(' || substr(v_e164, 3, 3) || ') ' || substr(v_e164, 6, 3) || '-' || substr(v_e164, 9, 4) else v_e164 end;
  update dmail_accounts set display_name = 'LoadBoot Dispatch — ' || v_name,
    signature_html = app_private.dmail_signature_html(v_name, a.address, v_phone), updated_at = now() where id = p_account;
  return jsonb_build_object('ok', true, 'display_name', 'LoadBoot Dispatch — ' || v_name, 'phone', v_phone);
end $$;
revoke all on function app_private.dmail_identity_apply(uuid, text) from public, anon, authenticated;

create or replace function public.cc_dmail_identity_apply(p_account uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  perform app_private.disp_audit('dmail.identity', 'dmail_account', p_account::text, null, coalesce(p_name,'(default name)'), '{}'::jsonb);
  return app_private.dmail_identity_apply(p_account, p_name);
end $$;
revoke all on function public.cc_dmail_identity_apply(uuid, text) from public, anon;
grant execute on function public.cc_dmail_identity_apply(uuid, text) to authenticated;

drop function if exists public.cc_dmail_assign(uuid, uuid);
create or replace function public.cc_dmail_assign(p_account uuid, p_user uuid, p_name text default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare a app_private.dmail_accounts; v_name text; v_mailed boolean := false; v_changed boolean;
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
  v_changed := a.assigned_to is distinct from p_user;
  update dmail_accounts set assigned_to = p_user, assigned_at = case when p_user is null then null when v_changed then now() else assigned_at end, assigned_by = auth.uid(), updated_at = now() where id = p_account;
  perform app_private.disp_audit('dmail.assign', 'dispatcher', coalesce(p_user, a.assigned_to)::text, null,
    a.address || case when p_user is null then ' unassigned' else ' assigned to ' || v_name end, jsonb_build_object('account', p_account));
  if p_user is not null and (v_changed or nullif(btrim(coalesce(p_name,'')),'') is not null) then
    perform app_private.dmail_identity_apply(p_account, p_name);      -- From name + brand signature for THIS dispatcher
  end if;
  if p_user is not null and v_changed then
    begin perform app_private.dmail_assign_email(p_user, p_account); v_mailed := true; exception when others then v_mailed := false; end;
  end if;
  return jsonb_build_object('ok', true, 'welcome_email', v_mailed, 'display_name', (select display_name from dmail_accounts where id = p_account));
end $$;
revoke all on function public.cc_dmail_assign(uuid, uuid, text) from public, anon;
grant execute on function public.cc_dmail_assign(uuid, uuid, text) to authenticated;
