-- bl_agent_0083 — one-tap EMAIL INVITES from the agent portal (premium branded template).
-- agent_send_invite(side, email, name): per-side hero pitch (broker/shipper/carrier),
-- agent's name as personal inviter, referral link on the CTA button.
-- Rate-limited 25/day per agent; idempotent per (agent,email,day); in-app receipt.

create or replace function public.agent_send_invite(p_side text, p_email text, p_name text default null)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare v_ref app_private.referrers; v_agent text; v_link text; v_subject text; v_html text;
        v_hero text; v_b1 text; v_b2 text; v_b3 text; v_cta text; v_today text := to_char(now(),'YYYYMMDD');
        v_sent int;
begin
  if p_side not in ('broker','shipper','carrier') then raise exception 'side must be broker, shipper or carrier' using errcode='22023'; end if;
  if not (p_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'enter a valid email address' using errcode='22023'; end if;
  v_ref := app_private.agent_referrer_for(auth.uid());
  if v_ref.id is null then raise exception 'no agent account' using errcode='42501'; end if;
  select count(*) into v_sent from app_private.notifications
   where recipient_user = v_ref.user_id and template_key = 'agent.invite_sent' and sent_at > now() - interval '24 hours';
  if v_sent >= 25 then raise exception 'daily invite limit reached (25) — try again tomorrow' using errcode='22023'; end if;
  v_agent := coalesce(nullif(v_ref.display_name,''), 'your LoadBoot agent');
  v_link  := 'https://loadboot.com/?ref=' || v_ref.code;
  if p_side = 'broker' then
    v_subject := coalesce(nullif(p_name,''), 'Hi') || ' — post a load, watch a verified carrier book it in one tap';
    v_hero := 'Your loads, covered in minutes.<br><span style="color:#4ade80">No calls. No ghost carriers.</span>';
    v_b1 := '<b>Post in 2 minutes</b> — real addresses, rate card, multi-stop; verified carriers book in one tap';
    v_b2 := '<b>GPS on every trip</b> — live tracking, geofenced check-ins, POD proof nobody can argue with';
    v_b3 := '<b>Paperwork runs itself</b> — rate confirmations, invoices and settlement, all automatic';
    v_cta := 'Post your first load free';
  elsif p_side = 'shipper' then
    v_subject := coalesce(nullif(p_name,''), 'Hi') || ' — your freight on a verified truck, tracked door to door';
    v_hero := 'Ship it. Track it. Done.<br><span style="color:#4ade80">Verified carriers, live GPS, documented settlement.</span>';
    v_b1 := '<b>Request a shipment</b> — brokers quote it fast with market-rate transparency';
    v_b2 := '<b>Watch your freight live</b> — GPS door to door, delivery proof on record';
    v_b3 := '<b>One documented settlement</b> — no chasing invoices or he-said-she-said';
    v_cta := 'Move your first shipment';
  else
    v_subject := coalesce(nullif(p_name,''), 'Hi') || ' — real loads, detention that actually gets PAID';
    v_hero := 'Real loads. Zero ghost posts.<br><span style="color:#4ade80">Detention paid with GPS proof.</span>';
    v_b1 := '<b>Booked loads vanish instantly</b> — every load you see is real and bookable in one tap';
    v_b2 := '<b>GPS gets you PAID</b> — arrive/depart stamps auto-build your detention claims';
    v_b3 := '<b>Money on time</b> — written rate cons, auto invoicing, payments tracked to your bank';
    v_cta := 'Get your free verified account';
  end if;
  v_html :=
    '<div style="background:#0b1220;padding:28px 12px;font-family:Inter,Arial,sans-serif">'
    || '<div style="max-width:560px;margin:0 auto;background:#10223B;border-radius:18px;overflow:hidden;border:1px solid #1e3a5f">'
    ||   '<div style="padding:26px 28px 8px;text-align:center">'
    ||     '<div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-.02em">Load<span style="color:#F97316">Boot</span> <span style="font-size:11px;color:#7f92b3;font-weight:600">— The Operating System for Trucking</span></div>'
    ||   '</div>'
    ||   '<div style="padding:18px 28px 0;text-align:center">'
    ||     '<div style="font-size:25px;font-weight:800;color:#fff;line-height:1.3">' || v_hero || '</div>'
    ||     '<p style="color:#b9c6da;font-size:14px;line-height:1.7;margin:14px 0 0">' || coalesce(nullif(p_name,''),'Hi') || ', I''m ' || v_agent || ' — I work with LoadBoot and I set this up for people I trust. Your account is free, and joining through my link means I personally look after your onboarding.</p>'
    ||   '</div>'
    ||   '<div style="margin:20px 24px;background:#0d1526;border:1px solid #24405f;border-radius:14px;padding:16px 18px">'
    ||     '<div style="color:#e6edf8;font-size:13.5px;line-height:2">✅ ' || v_b1 || '<br>✅ ' || v_b2 || '<br>✅ ' || v_b3 || '</div>'
    ||   '</div>'
    ||   '<div style="text-align:center;padding:2px 28px 8px">'
    ||     '<a href="' || v_link || '" style="display:inline-block;background:#FC5305;color:#fff;font-weight:800;font-size:16px;padding:15px 34px;border-radius:12px;text-decoration:none">' || v_cta || ' →</a>'
    ||     '<div style="color:#7f92b3;font-size:11.5px;margin-top:10px">Free forever · no contracts · takes ~3 minutes</div>'
    ||   '</div>'
    ||   '<div style="border-top:1px solid #1e3a5f;margin-top:18px;padding:14px 28px 20px;text-align:center;color:#64748b;font-size:11px;line-height:1.7">'
    ||     'Invited personally by ' || v_agent || ' via LoadBoot''s agent program.<br>LoadBoot · loadboot.com · hello@loadboot.com'
    ||   '</div>'
    || '</div></div>';
  perform app_private.sys_email(lower(p_email), 'agent.invite', v_subject, v_html, null,
    'agentinvite:' || v_ref.id::text || ':' || lower(p_email) || ':' || v_today);
  begin
    insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
    values (v_ref.user_id, 'in_app', 'agent.invite_sent',
      jsonb_build_object('title', '✉ Invite sent to ' || lower(p_email), 'body', initcap(p_side) || ' invite — you''ll see them in My Chain the moment they join through your link.', 'tone', 'info', 'url', '/app/agent/#chain'), 'sent', now());
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'note', 'Invite sent to ' || lower(p_email) || ' — it lands with YOUR link inside, so the join is credited to you automatically.');
end; $$;
revoke all on function public.agent_send_invite(text, text, text) from public;
grant execute on function public.agent_send_invite(text, text, text) to authenticated;

notify pgrst, 'reload schema';
