-- bl_dmail_0358 — when staff assign a mailbox to a dispatcher, the dispatcher gets a branded welcome email:
-- what the mailbox is, what it can do, and the RULES (company property, monitored, no deleting, no double brokering,
-- rate cons through LoadBoot, no bulk mail, document handling, security). Sent to the dispatcher's login email AND into
-- the new mailbox itself, so it is the first email they see in the Email tab and the rules are always one search away.
-- Sent only when the assignee actually changes (re-pressing Assign for the same person sends nothing). Never blocks the assign.

create or replace function app_private.dmail_esc(t text) returns text language sql immutable as
$$ select replace(replace(replace(replace(coalesce(t,''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') $$;

-- one row of the feature / rule lists. p_body is code-defined markup (never user input).
create or replace function app_private.dmail_li(p_title text, p_body text) returns text language sql immutable as
$$ select '<div style="padding:9px 0;border-bottom:1px solid rgba(15,23,42,.07)"><div style="font-weight:700;color:#10223B">' || p_title || '</div><div style="color:#475569;font-size:14px">' || p_body || '</div></div>' $$;

create or replace function app_private.dmail_welcome_html(p_name text, p_address text, p_display text) returns text
language sql stable as $fn$
  select
    '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
    || '<div style="font-size:11px;letter-spacing:.16em;font-weight:700;color:#0883F7;text-transform:uppercase;margin-bottom:6px">LoadBoot Dispatch &middot; Your company email</div>'
    || '<div style="font-size:24px;font-weight:800;color:#10223B;letter-spacing:-.01em;margin:0 0 14px">Your LoadBoot mailbox is ready</div>'
    || '<p style="margin:0 0 14px">Hi ' || app_private.dmail_esc(coalesce(nullif(p_name,''),'there')) || ', LoadBoot has assigned you a company email address. There is nothing to install and no password to remember &mdash; it lives inside your dispatcher portal.</p>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#10223B;border-radius:14px;margin:0 0 18px"><tr><td style="padding:18px 20px">'
    || '<div style="font-size:11px;letter-spacing:.14em;font-weight:700;color:#7fb8ff;text-transform:uppercase">Your address</div>'
    || '<div style="font-size:20px;font-weight:800;color:#ffffff;margin:2px 0 8px">' || app_private.dmail_esc(p_address) || '</div>'
    || '<div style="font-size:13px;color:#b8c7de">Brokers and carriers see your emails as: <b style="color:#fff">' || app_private.dmail_esc(p_display) || '</b></div>'
    || '</td></tr></table>'
    || '<p style="margin:0 0 18px"><a href="https://loadboot.com/app/agent/#dashboard/email" style="display:inline-block;background:#0883F7;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px">Open my inbox</a></p>'
    || '<div style="font-size:11px;letter-spacing:.12em;font-weight:700;color:#64748b;text-transform:uppercase;margin:0 0 8px">What you can do</div>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e9f0;border-radius:12px;margin:0 0 18px"><tr><td style="padding:6px 16px">'
    || app_private.dmail_li('Inbox in your portal', 'Open the <b>Email</b> tab on desktop or on your phone. New email arrives within about a minute.')
    || app_private.dmail_li('Send, reply, reply-all, forward', 'With attachments up to 15 MB per email, and 5 seconds to undo a send.')
    || app_private.dmail_li('Drafts save themselves', 'Close the window any time &mdash; your draft is waiting in Drafts.')
    || app_private.dmail_li('Search, star, mark unread', 'Find any rate con or broker thread in seconds.')
    || app_private.dmail_li('Company signature', 'Added to every email automatically. It is set by LoadBoot and cannot be edited.')
    || '</td></tr></table>'
    || '<div style="font-size:11px;letter-spacing:.12em;font-weight:700;color:#FC5305;text-transform:uppercase;margin:0 0 8px">Rules for this mailbox</div>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-left:3px solid #FC5305;background:#fff8f2;border-radius:0 12px 12px 0;margin:0 0 18px"><tr><td style="padding:8px 16px">'
    || app_private.dmail_li('1. It belongs to LoadBoot', 'The address and every email in it are company property. Use it for LoadBoot dispatch work only &mdash; never for personal email.')
    || app_private.dmail_li('2. It is monitored', 'LoadBoot staff can see every email you receive and send, for quality, training and compliance.')
    || app_private.dmail_li('3. Nothing is deleted', 'You cannot delete email, and you must not try to work around that. If something should be removed, ask LoadBoot staff.')
    || app_private.dmail_li('4. Keep conversations here', 'Do not move broker or carrier conversations to a personal email address. Every load needs its email trail on this address.')
    || app_private.dmail_li('5. Be honest about who you are', 'You write as a LoadBoot dispatcher acting for the carriers assigned to you. Never claim to be the carrier''s owner, a broker, or to hold authority you do not hold. No double brokering or re-brokering &mdash; ever.')
    || app_private.dmail_li('6. Rate confirmations go through LoadBoot', 'Log every booking and attach the rate con in your portal. A carrier is committed only after LoadBoot approves it.')
    || app_private.dmail_li('7. No bulk or cold blasts', 'Maximum 25 recipients per email, no bought lists, no copy-paste campaigns. One spam complaint damages the address for everyone.')
    || app_private.dmail_li('8. Handle documents carefully', 'Send a carrier''s W-9, insurance certificate or authority letter only to the broker on a live load. Never act on an emailed request to change bank or factoring details &mdash; send it to LoadBoot staff first.')
    || app_private.dmail_li('9. Watch for fraud', 'Do not open unexpected attachments or links. If an email looks wrong, leave it and tell LoadBoot staff.')
    || app_private.dmail_li('10. Stay professional', 'Clear subject lines, polite wording, prompt replies during your shift.')
    || app_private.dmail_li('11. Access follows your assignment', 'If your assignment ends or is paused, access stops immediately and the mailbox stays with LoadBoot.')
    || '</td></tr></table>'
    || '<p style="margin:0 0 16px">Using the mailbox means you accept these rules. Questions? Message your LoadBoot coordinator in the portal.</p>'
    || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b">Operations</span></p>'
    || '<p style="color:#8ea2c3;font-size:12px;margin:0">You are receiving this because LoadBoot staff assigned ' || app_private.dmail_esc(p_address) || ' to your dispatcher account.</p>'
    || '</div>'
$fn$;

create or replace function app_private.dmail_assign_email(p_user uuid, p_account uuid) returns void
language plpgsql security definer set search_path to 'app_private','public' as $fn$
declare v_mail text; v_name text; a app_private.dmail_accounts; v_html text; v_text text; v_key text;
begin
  select u.email into v_mail from auth.users u where u.id = p_user;
  select * into a from app_private.dmail_accounts where id = p_account;
  if a.id is null then return; end if;
  select full_name into v_name from app_private.dispatcher_profiles where user_id = p_user;
  v_html := app_private.dmail_welcome_html(split_part(coalesce(v_name,''), ' ', 1), a.address, a.display_name);
  v_text := 'Hi ' || coalesce(nullif(split_part(coalesce(v_name,''), ' ', 1), ''), 'there') || E',\n\nLoadBoot has assigned you a company email address: ' || a.address
    || E'\nBrokers and carriers see your emails as: ' || a.display_name
    || E'\n\nOpen the Email tab in your dispatcher portal: https://loadboot.com/app/agent/#dashboard/email\nNo password is needed.'
    || E'\n\nRULES: 1) The mailbox and its email belong to LoadBoot - work use only. 2) LoadBoot staff can see every email. 3) You cannot delete email. 4) Keep broker and carrier conversations on this address. 5) You write as a LoadBoot dispatcher for your assigned carriers - never claim authority you do not hold; no double brokering. 6) Every rate con is logged in the portal and approved by LoadBoot. 7) No bulk email - max 25 recipients. 8) Carrier documents only to the broker on a live load; never act on emailed bank/factoring changes - send them to staff. 9) Do not open unexpected attachments or links. 10) Stay professional. 11) Access ends when your assignment ends.'
    || E'\n\nUsing the mailbox means you accept these rules.\n\nLoadBoot Dispatch - Operations';
  v_key := 'dmail.assign:' || p_account::text || ':' || p_user::text || ':' || extract(epoch from now())::bigint::text;
  if v_mail is not null then
    perform app_private.sys_email(v_mail, 'dispatcher.mailbox.assigned', 'Your LoadBoot email address is ready — ' || a.address, v_html, v_text, v_key);
  end if;
  -- and into the mailbox itself, so it is the first thing in their new inbox
  if lower(coalesce(v_mail,'')) <> a.address then
    perform app_private.sys_email(a.address, 'dispatcher.mailbox.assigned', 'Welcome to your LoadBoot mailbox — features and rules', v_html, v_text, v_key || ':inbox');
  end if;
end $fn$;
revoke all on function app_private.dmail_assign_email(uuid, uuid) from public, anon, authenticated;

create or replace function public.cc_dmail_assign(p_account uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare a app_private.dmail_accounts; v_name text; v_mailed boolean := false;
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
  update dmail_accounts set assigned_to = p_user, assigned_at = case when p_user is null then null else now() end, assigned_by = auth.uid(), updated_at = now() where id = p_account;
  perform app_private.disp_audit('dmail.assign', 'dispatcher', coalesce(p_user, a.assigned_to)::text, null,
    a.address || case when p_user is null then ' unassigned' else ' assigned to ' || v_name end, jsonb_build_object('account', p_account));
  if p_user is not null and a.assigned_to is distinct from p_user then
    begin perform app_private.dmail_assign_email(p_user, p_account); v_mailed := true; exception when others then v_mailed := false; end;
  end if;
  return jsonb_build_object('ok', true, 'welcome_email', v_mailed);
end $$;
revoke all on function public.cc_dmail_assign(uuid, uuid) from public, anon;
grant execute on function public.cc_dmail_assign(uuid, uuid) to authenticated;
