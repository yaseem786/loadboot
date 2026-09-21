-- bl_wa_0376 - the "your WhatsApp conversations are ready" e-mail.
-- APPLIED ON STAGING 21 Sep 2026. The two bodies below are pg_get_functiondef() straight off staging, so the
-- repo and the database say the same thing.
--
-- WHY IT EXISTS
--   Command Center hands a dispatcher his carrier and driver conversations (cc_wa_assign). Until now nothing
--   told the man it had happened. This sends him one LoadBoot-branded e-mail listing exactly which conversations
--   are his, which of them he may reply to freely right now (a reply arrived in the last 24 hours) and which
--   need an approved template, plus the rules: carriers and drivers only, brokers belong to Command Center,
--   every message is a record.
--
-- NOTES
--   * It reuses the dispatcher e-mail furniture already in the codebase (disp_head / disp_box / disp_btn /
--     sys_email), so it looks like every other LoadBoot dispatcher e-mail.
--   * v_key makes it idempotent per set of conversations: pressing the button twice with nothing newly assigned
--     does not send a second e-mail; assign one more conversation and the key changes, so the new list does go out.
--   * It returns 0 and sends nothing when the dispatcher has no open conversations - cc_wa_notify_assigned turns
--     that into a plain refusal for the staff member rather than a silent success.
-- Rollback: drop both functions; nothing else depends on them.

CREATE OR REPLACE FUNCTION app_private.wa_assigned_email(p_user uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private', 'public'
AS $function$
declare v_mail text; v_name text; cfg app_private.dialer_config; v_html text; v_rows text := ''; n int := 0;
  v_num text; v_contact text := app_private.disp_contact()->>'email'; r record; v_key text;
begin
  select u.email into v_mail from auth.users u where u.id = p_user;
  if v_mail is null then return 0; end if;
  select full_name into v_name from app_private.dispatcher_profiles where user_id = p_user;
  select * into cfg from app_private.dialer_config where id = 1;
  v_num := coalesce(app_private.disp_fmt_us(cfg.wa_number), cfg.wa_number);
  if v_num is null then return 0; end if;

  for r in
    select t.id, t.counterparty, t.contact_name, t.last_inbound_at,
           coalesce(nullif(o.name,''), '') carrier
      from app_private.wa_threads t left join public.organizations o on o.id = t.carrier_org_id
     where t.owner_user_id = p_user and t.status = 'open'
     order by coalesce(o.name,''), t.contact_name nulls last, t.counterparty
  loop
    n := n + 1;
    v_rows := v_rows || '<tr><td style="padding:9px 12px;border-bottom:1px solid #e9eef6">'
      || '<b>' || app_private.disp_esc(coalesce(nullif(r.contact_name,''), coalesce(app_private.disp_fmt_us(r.counterparty), r.counterparty))) || '</b>'
      || case when r.carrier <> '' then '<div style="color:#64748b;font-size:12.5px">' || app_private.disp_esc(r.carrier) || '</div>' else '' end
      || '</td><td style="padding:9px 12px;border-bottom:1px solid #e9eef6;color:#64748b;font-size:12.5px;white-space:nowrap">'
      || coalesce(app_private.disp_fmt_us(r.counterparty), r.counterparty)
      || '</td><td style="padding:9px 12px;border-bottom:1px solid #e9eef6;font-size:12.5px;white-space:nowrap">'
      || case when r.last_inbound_at > now() - interval '24 hours'
              then '<span style="color:#15803d;font-weight:700">Replies open</span>'
              else '<span style="color:#b45309;font-weight:700">Template only</span>' end
      || '</td></tr>';
  end loop;
  if n = 0 then return 0; end if;

  v_key := 'wa.assigned:' || p_user::text || ':' || md5((select string_agg(t.id::text, ',' order by t.id)
             from app_private.wa_threads t where t.owner_user_id = p_user and t.status = 'open'));

  v_html := '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
    || app_private.disp_head('LoadBoot Dispatch &middot; WhatsApp', 'Your WhatsApp conversations are ready')
    || '<p style="margin:0 0 14px">Dear ' || app_private.disp_esc(coalesce(nullif(v_name,''),'Dispatcher'))
    || ', WhatsApp is now part of your workspace. The conversations below are yours &mdash; they sit in your phone dock under <b>Texts &rarr; WhatsApp</b>.</p>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#10223B;border-radius:14px;margin:0 0 18px"><tr><td style="padding:18px 20px">'
    || '<div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#8ea2c3;font-weight:700">LoadBoot&rsquo;s WhatsApp number</div>'
    || '<div style="font-size:26px;font-weight:800;color:#FC5305">' || app_private.disp_esc(v_num) || '</div>'
    || '<div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#8ea2c3;font-weight:700;margin-top:4px">One company number &middot; every message is logged</div></td></tr></table>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e9eef6;border-radius:12px;overflow:hidden;margin:0 0 18px">'
    || '<tr><td colspan="3" style="padding:10px 12px;background:#f8fafc;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#64748b;font-weight:700">Yours on WhatsApp</td></tr>'
    || v_rows || '</table>'
    || app_private.disp_box('What you can send', 'While a person has written to you in the last <b>24 hours</b> you may reply freely &mdash; text, a photo, a document, even a voice note. '
         || 'After 24 hours of silence WhatsApp only allows an <b>approved template</b>, and the screen will show you which ones exist. This is Meta&rsquo;s rule, not LoadBoot&rsquo;s.')
    || app_private.disp_box('What is yours and what is not', 'WhatsApp is for <b>your carriers and their drivers</b>. Brokers, shippers and unknown numbers on this number belong to Command Center &mdash; '
         || 'you will not see them, and you cannot open them. Broker work stays on your own phone line and e-mail.', 'stop')
    || app_private.disp_box('Remember', 'Every WhatsApp message is a LoadBoot record and staff can read it. Say who you are, keep it about the load or the truck, and never send bank details or passwords.')
    || app_private.disp_btn('Open my workspace', 'https://loadboot.com/app/agent/#dashboard')
    || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b;font-size:13px">' || v_contact || '</span></p>'
    || '<p style="color:#8ea2c3;font-size:12px;margin:0">You are receiving this because WhatsApp conversations were assigned to you.</p></div>';

  perform app_private.sys_email(v_mail, 'dispatcher.whatsapp.assigned',
    'Your WhatsApp conversations are ready — ' || v_num, v_html,
    'WhatsApp is now part of your LoadBoot workspace (Texts > WhatsApp). LoadBoot WhatsApp number: ' || v_num
      || '. ' || n || ' conversation(s) are assigned to you. Free replies only within 24 hours of their last message; after that an approved template only. Carriers and drivers only - brokers and unknown numbers belong to Command Center. Every message is logged.',
    v_key);
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION public.cc_wa_notify_assigned(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private', 'public'
AS $function$
declare n int;
begin
  if not app_private.disp_is_staff() then raise exception 'staff only'; end if;
  if p_user is null then return jsonb_build_object('error','Choose a dispatcher first.'); end if;
  if not exists (select 1 from app_private.dispatcher_profiles where user_id = p_user and status in ('trial','verified','active')) then
    return jsonb_build_object('error','That dispatcher is not active.'); end if;
  n := app_private.wa_assigned_email(p_user);
  if n = 0 then return jsonb_build_object('error','That dispatcher has no open WhatsApp conversations yet.'); end if;
  perform app_private.disp_audit('wa.assigned_email', 'dispatcher', p_user::text, null,
    'WhatsApp assignment e-mail sent (' || n || ' conversation(s))', jsonb_build_object('threads', n));
  return jsonb_build_object('ok', true, 'threads', n);
end $function$
;

revoke all on function public.cc_wa_notify_assigned(uuid) from public, anon;
grant execute on function public.cc_wa_notify_assigned(uuid) to authenticated;
