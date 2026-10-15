-- bl_bp_0456 — Partner onboarding gaps found by the 0455 audit (claude/PARTNER-360-0455.md, "Next milestone").
--   G6  Broker-agent welcome: signup stores partner_kind='broker' + agent_intent=true in user metadata, so the
--       broker-flavoured welcome ("Screen your MC…", staff "NO MC GIVEN", welcome.broker 3-step) went to agents.
--       New catalogued key welcome.broker_agent (CLAUDE.md §6) + agent branches in trg_partner_org_welcome and
--       cc_partner_register.
--   G7  Authority pause (bl_bp_0343) alerted staff only; the broker heard nothing until the restore. New
--       app_private.broker_authority_partner_notice → partner in-app + catalogued broker.authority_paused e-mail,
--       called from broker_screen_apply (fail #2) and broker_rescreen_sweep (14-day stale block). Confirmed agents of
--       the brokerage get an in-app notice too (their tier follows the parent's authority).
--   G8  Phone identity verification lost its staff notice in the 0318 rewrite — broker.verified_by_phone is back.
--   G9  Screening dead-ends now tell the partner: broker unknown / not_found / error (agents already get the 0449
--       nudge), shipper free_mail at signup, shipper check error; "FMCSA lists no email — we will call" now also
--       creates the staff call task it promised (broker.identity.no_email, once per org).
--   G13 Staff notice URLs open the right 360: partner.registered → #/broker | #/broker-agent | #/shipper ?id=,
--       shipper.checked → #/shipper?id=.
--   G2  Shipper-posted loads (cc_decide_partner_load → public.loads with broker_org = the shipper org) bypassed
--       trust_label_load / enforce_trust_gate_not_bookable (broker-only). Verified live 26 Sep: 0 such loads on
--       prod, so nothing to relabel. Both triggers now branch on the shipper tier: verified → clean; business_verified
--       → 'partial' + request-to-book; new / hold → not bookable.
--   Safe to re-run: every patch is anchored and guarded; catalog rows upsert on key.
--   Anon SECDEF surface: unchanged by name (36 prod / 35 staging). No new public function.

-- ---------------------------------------------------------------------------------------------------------------
-- 0. e-mail catalog rows (CLAUDE.md §6) — both keys are code-fired, so the rows land here, not via cc_email_template_new
-- ---------------------------------------------------------------------------------------------------------------
insert into app_private.email_catalog
  (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note, stop_condition,
   preference_group, unsub_allowed, cc_deep_link, status, discovered_in)
values
('welcome.broker_agent', 'Welcome (broker agent)',
 'First e-mail after a broker-agent org is created (signup with agent_intent). Agent-flavoured 3-step: name the brokerage you post for → the brokerage confirms you with the code we e-mail its FMCSA-listed address → post under its authority (request-to-book, 3 open postings until first delivery).',
 'T', 'broker', 'event', 'app_private.trg_partner_org_welcome', 'once', 'once (idempotency welcome-org:<org>)', 'n/a',
 'account_critical', false, '#/partners', 'live', '{code}'),
('broker.authority_paused', 'Broker — new posting paused (FMCSA authority)',
 'Tells the brokerage owner that new posting is paused: either FMCSA no longer shows active broker authority on two consecutive checks (fail), or LoadBoot could not re-confirm the authority for 14 days (stale). Says what is untouched (booked trips, tracking, invoices, payments), that open loads are request-to-book, and how to get it lifted.',
 'T', 'broker', 'event', 'app_private.broker_screen_apply / app_private.broker_rescreen_sweep → app_private.broker_authority_partner_notice',
 'once per pause episode', 'once per org, kind and day (idempotency authpause:<org>:<kind>:<yyyymmdd>)', 'authority passes again (the existing restore notice)',
 'account_critical', false, '#/broker-trust', 'live', '{code}')
on conflict (key) do update set name = excluded.name, purpose = excluded.purpose, class = excluded.class, audience_role = excluded.audience_role,
  trigger_type = excluded.trigger_type, trigger_source = excluded.trigger_source, cadence = excluded.cadence, cap_note = excluded.cap_note,
  stop_condition = excluded.stop_condition, preference_group = excluded.preference_group, unsub_allowed = excluded.unsub_allowed,
  cc_deep_link = excluded.cc_deep_link, status = 'live', updated_at = now();

-- ---------------------------------------------------------------------------------------------------------------
-- 1. G6 — welcome trigger: agent branch (signup metadata agent_intent). Body otherwise unchanged from bl_ship_0104 / 0312b.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function app_private.trg_partner_org_welcome()
returns trigger language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_email text; v_who text; v_kind text; v_agent boolean := false; v_key text; v_label text;
begin
  if new.kind not in ('broker','shipper') then return new; end if;
  if app_private.is_agent_org(new.id) or new.name like '%(Agent)' then return new; end if; -- LoadBoot agent workspaces have their own welcome
  select u.email, coalesce(lower(u.raw_user_meta_data->>'agent_intent') in ('true','1','yes'), false)
    into v_email, v_agent from auth.users u where u.id = new.owner_user_id;
  if v_email is null then return new; end if;
  v_agent := v_agent and new.kind = 'broker';  -- bl_bp_0456: broker agent = broker org + agent_intent
  v_who := coalesce(nullif(trim(new.name),''), initcap(split_part(v_email,'@',1)));
  v_kind := initcap(new.kind);
  v_key := case when v_agent then 'welcome.broker_agent' else 'welcome.' || new.kind end;
  v_label := case when v_agent then 'broker agent' else lower(v_kind) end;
  begin
    perform app_private.sys_email(v_email, v_key,
      'Welcome to LoadBoot, ' || v_who || ' — your ' || v_label || ' account is live',
      '<h2 style="margin:0 0 12px;font-size:26px;font-weight:800;color:#0b1220">Welcome aboard, ' || v_who || ' ' || case when new.kind='shipper' then '🏭' when v_agent then '🤝' else '🏢' end || '</h2>'
      || '<p style="color:#475569;margin:0 0 16px">Your LoadBoot <b>' || case when v_agent then 'Broker Agent' else v_kind end || '</b> account is live. Three steps to your first covered load:</p>'
      || '<div style="background:#f6f9fd;border:1px solid #e3edfa;border-radius:12px;padding:16px 18px;margin:0 0 18px"><b style="color:#0b1220">Your 3-step start</b><br>'
      || case when new.kind='shipper'
           then '<span style="color:#334155">1️⃣ Complete your shipper packet (credit application, agreement, payment terms — 10 minutes)<br>2️⃣ Post your first shipment with the full wizard — exact addresses, schedule, rate<br>3️⃣ Verified carriers book it — GPS-tracked door to door, every document collected for you</span>'
           when v_agent
           then '<span style="color:#334155">1️⃣ Name the brokerage you post for — its MC number and legal name. We read its broker authority live from FMCSA (seconds, nothing to upload)<br>2️⃣ The brokerage confirms you — we e-mail a 6-digit code to the address FMCSA has on file for it; one click or one code and you are confirmed<br>3️⃣ Post under its authority — verified carriers request to book, the brokerage''s name goes on the rate confirmation, GPS tracking and paperwork run themselves. Up to 3 open postings until your first delivery.</span>'
           else '<span style="color:#334155">1️⃣ Screen your MC — we read your broker authority live from FMCSA (seconds, nothing to upload) and you accept one master agreement<br>2️⃣ Post your first load — the full wizard with multi-stop, scheduling and your rate card<br>3️⃣ Verified carriers request to book — you approve within 30 minutes, GPS tracking and paperwork run themselves. The verification packet comes later and lifts your posting limit.</span>' end
      || '</div>'
      || '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:#FC5305"><a href="https://loadboot.com/app/partner/' || case when v_agent then '#onboarding' else '' end || '" style="display:inline-block;padding:14px 26px;color:#ffffff;font-weight:700;text-decoration:none;font-size:15px">Open your ' || v_label || ' portal →</a></td></tr></table>'
      || '<p style="color:#94a3b8;font-size:13px;margin:16px 0 0">GPS-verified deliveries · receipt-verified payments · real people on call.</p>',
      null, 'welcome-org:' || new.id::text);
  exception when others then null; end;
  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff', 'in_app', 'signup.new.staff', jsonb_build_object(
      'title', case when new.kind='shipper' then '🏭 New SHIPPER signup' when v_agent then '🤝 New BROKER AGENT signup' else '🏢 New BROKER signup' end,
      'body', v_who || ' just created a ' || v_label || ' account — ' || case when v_agent then 'the brokerage they post for lands in Broker Agent 360 once they declare it.' else 'onboarding packet lands in Brokers & Shippers when submitted.' end,
      'tone', 'info', 'url', '/app/command-center/#/partners'), 'sent', now());
  exception when others then null; end;
  return new;
end; $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. G6 + G13 — cc_partner_register: agent-flavoured in-app welcome; staff notice titled and linked by role.
--    (prod also carries a 2-arg sql wrapper that calls this one — untouched)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.cc_partner_register(p_kind text, p_company text, p_mc text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_org uuid; v_mc text; v_agent boolean := false; v_role text; v_route text;
begin
  if p_kind not in ('broker','shipper','facility') then raise exception 'invalid partner kind' using errcode='22023'; end if;
  if coalesce(trim(p_company),'') = '' then raise exception 'company name is required' using errcode='22023'; end if;
  v_mc := nullif(regexp_replace(coalesce(p_mc,''), '[^0-9]', '', 'g'), '');
  if v_mc is not null and length(v_mc) > 8 then
    raise exception 'MC number looks wrong — it is at most 8 digits (you entered %)', v_mc using errcode='22023';
  end if;
  v_org := app_private.my_partner_org(p_kind);
  if v_org is not null then
    if v_mc is not null then update public.organizations set mc_number = coalesce(mc_number, v_mc) where id = v_org; end if;
    return jsonb_build_object('org', v_org, 'kind', p_kind, 'existing', true);
  end if;
  -- bl_bp_0456: a broker agent signs up as partner_kind 'broker' + agent_intent (app/partner/app.js signup)
  select coalesce(lower(u.raw_user_meta_data->>'agent_intent') in ('true','1','yes'), false) into v_agent from auth.users u where u.id = auth.uid();
  v_agent := coalesce(v_agent, false) and p_kind = 'broker';
  v_role  := case when v_agent then 'broker agent' else p_kind end;
  v_route := case when v_agent then 'broker-agent' when p_kind = 'shipper' then 'shipper' else 'broker' end;
  insert into public.organizations(kind, name, owner_user_id, status, mc_number)
    values (p_kind, trim(p_company), auth.uid(), 'pending', v_mc) returning id into v_org;
  insert into public.organization_memberships(org_id, user_id, status, member_role)
    values (v_org, auth.uid(), 'active', 'owner');
  perform app_private.emit_event('partner.registered','organization', v_org::text, jsonb_build_object('org', v_org, 'kind', p_kind, 'mc', v_mc, 'agent', v_agent), null);
  perform app_private.log_audit('partner.register','organization', v_org::text, v_org,
    v_role || ' partner registered: ' || trim(p_company) || case when v_mc is not null then ' (MC-' || v_mc || ')' else '' end, '{}'::jsonb, null);
  perform app_private.notify_partner(v_org, '🎉 Welcome to LoadBoot — ' || trim(p_company),
    case when v_agent
      then 'Your broker agent account is created. Name the brokerage you post for (its MC) — we check it on FMCSA and e-mail that brokerage a 6-digit confirmation code. Once it confirms you, you post under its authority: up to 3 open postings until your first delivery.'
      when p_kind = 'broker'
      then 'Your broker account is created. Screen your MC against FMCSA (seconds, no uploads), accept the Master Broker Agreement, and post your first load — the verification packet comes later and lifts your limits.'
      when p_kind = 'shipper'
      then 'Your shipper account is created. We are confirming your business from your company email — usually under a minute — then you can request quotes right away. Payment terms and the short packet come before your first booking.'
      else 'Your ' || p_kind || ' account is created. Finish the guided onboarding (about 10 minutes) — once our team verifies your packet, load posting unlocks automatically.' end,
    'success', '/app/partner/#onboarding');
  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff', 'in_app', 'partner.registered',
      jsonb_build_object('title', 'New ' || v_role || ' registered — ' || trim(p_company)
          || case when v_mc is not null then ' · MC-' || v_mc when v_agent then ' · brokerage MC follows in a moment' when p_kind = 'broker' then ' · NO MC GIVEN' else '' end,
        'body', case when v_agent then 'Their declared brokerage is screened on FMCSA and e-mailed a confirmation code automatically. Open the 360 to watch it.'
                     when p_kind = 'shipper' then 'The company-domain check is running now; the short packet lands before their first booking. Open the 360 to watch it.'
                     else 'Their onboarding packet will land for review as they submit items. Open the 360 to watch it.' end,
        'tone', 'action', 'url', '/app/command-center/#/' || v_route || '?id=' || v_org, 'org_id', v_org), 'sent', now());
  exception when others then null; end;
  if p_kind = 'shipper' then perform app_private.shipper_business_start(v_org); end if;  -- bl_bp_0319
  return jsonb_build_object('org', v_org, 'kind', p_kind, 'existing', false, 'mc', v_mc, 'agent', v_agent);
end $$;
revoke execute on function public.cc_partner_register(text, text, text) from public, anon;
grant execute on function public.cc_partner_register(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. G7 — the broker hears about a pause: in-app + catalogued e-mail; confirmed agents of the brokerage in-app.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function app_private.broker_authority_partner_notice(p_org uuid, p_kind text, p_reason text)
returns void language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_name text; v_mail text; v_owner text; v_mc text; v_title text; v_body text; v_subj text; v_html text; v_text text; v_fact text; v_fact_txt text; r record;
begin
  select o.name, lower(u.email), coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'), ''), nullif(btrim(o.name), '')),
         nullif(regexp_replace(coalesce(o.mc_number,''), '\D', '', 'g'), '')
    into v_name, v_mail, v_owner, v_mc
    from public.organizations o left join auth.users u on u.id = o.owner_user_id where o.id = p_org;
  if v_name is null then return; end if;
  if p_kind = 'fail' then
    v_title := '⛔ New posting is paused — FMCSA authority';
    v_fact_txt := 'FMCSA no longer shows active broker authority for ' || coalesce('MC-' || v_mc, 'your MC') || ' on our two most recent checks' || coalesce(' (' || p_reason || ')', '') || '.';
    v_subj := 'New posting is paused on LoadBoot — FMCSA authority for ' || coalesce('MC-' || v_mc, v_name);
  else
    v_title := '🕐 New posting is paused — we could not re-confirm your authority';
    v_fact_txt := 'LoadBoot has not been able to re-confirm the broker authority for ' || coalesce('MC-' || v_mc, 'your MC') || ' on FMCSA for 14 days. This is usually our lookup, not your record.';
    v_subj := 'We could not re-confirm your broker authority — new posting paused';
  end if;
  v_body := v_fact_txt || ' Nothing already booked was cancelled: booked trips, tracking, invoices and payments are untouched. Open loads stay on the board as request-to-book only, and new posting resumes automatically the moment a daily FMCSA check passes again.'
    || case when p_kind = 'fail' then ' If your authority was reinstated or the FMCSA record is wrong, message our team from Help and we will verify by hand.'
            else ' You can ask our team from Help to verify by hand today.' end;
  perform app_private.notify_partner(p_org, v_title, v_body, 'warning', '/app/partner/#onboarding');

  -- confirmed agents post under this authority — their tier follows the parent's (bl_bp_0343 broker_authority_state)
  for r in select distinct ap.agent_org from app_private.agent_parents ap
            where (ap.parent_org_id = p_org or (v_mc is not null and ap.parent_mc = v_mc))
              and ap.confirmed_at is not null and ap.declined_at is null and ap.revoked_at is null and ap.agent_org <> p_org loop
    perform app_private.notify_partner(r.agent_org, v_title || ' — ' || v_name,
      'New posting under ' || v_name || coalesce(' (MC-' || v_mc || ')', '') || ' is paused: ' || v_fact_txt || ' Your open loads under it stay request-to-book only; nothing booked was cancelled. Posting resumes when the daily FMCSA check passes again.',
      'warning', '/app/partner/#onboarding');
  end loop;

  if v_mail is null then return; end if;
  v_fact := app_private.disp_esc(v_fact_txt);
  v_html :=
    '<h2 style="margin:0 0 10px;font-size:22px">' || app_private.disp_esc(v_title) || '</h2>'
    || '<p style="font-size:15px;color:#334155">Hi ' || app_private.disp_esc(coalesce(v_owner, 'there')) || ', this is a notice about <b>' || app_private.disp_esc(v_name) || '</b>''s LoadBoot account.</p>'
    || '<p style="font-size:15px;color:#334155;background:#fff7ed;border-left:4px solid #FC5305;padding:12px 14px;border-radius:6px">' || v_fact || '</p>'
    || '<p style="font-size:15px;color:#334155"><b>What is untouched:</b> booked trips, GPS tracking, invoices and payments. Nothing already booked was cancelled.</p>'
    || '<p style="font-size:15px;color:#334155"><b>What changes:</b> new posting is paused and your open loads stay on the board as <i>request-to-book</i> only. Posting resumes automatically the moment a daily FMCSA check passes again.</p>'
    || '<p style="font-size:15px;color:#334155"><b>What to do:</b> '
    || case when p_kind = 'fail' then 'if your authority was reinstated, or FMCSA''s record is wrong, reply to this e-mail or {{contact_inline}} &mdash; our team verifies by hand.'
            else 'nothing on your side is required. If you want posting back today, reply to this e-mail or {{contact_inline}} and our team will verify by hand.' end || '</p>'
    || '<p style="margin:14px 0 20px"><a href="https://loadboot.com/app/partner/#onboarding" style="background:#0883F7;color:#fff;padding:13px 22px;border-radius:10px;text-decoration:none;font-weight:800">Open my portal →</a></p>'
    || '<p style="font-size:12px;color:#94a3b8">Transactional notice about your LoadBoot partner account.</p>';
  v_text := 'Hi ' || coalesce(v_owner, 'there') || E',\n\n' || v_fact_txt
    || E'\n\nWhat is untouched: booked trips, GPS tracking, invoices and payments. Nothing already booked was cancelled.'
    || E'\nWhat changes: new posting is paused and your open loads stay request-to-book only. Posting resumes automatically when a daily FMCSA check passes again.'
    || E'\n\n' || case when p_kind = 'fail' then 'If your authority was reinstated, or the FMCSA record is wrong, reply to this e-mail or {{contact_inline}} — our team verifies by hand.'
                       else 'Nothing on your side is required. To get posting back today, reply to this e-mail or {{contact_inline}}.' end
    || E'\n\nhttps://loadboot.com/app/partner/#onboarding';
  begin
    perform app_private.sys_email(v_mail, 'broker.authority_paused', v_subj, v_html, v_text,
      'authpause:' || p_org::text || ':' || p_kind || ':' || to_char(now(), 'YYYYMMDD'));
  exception when others then null; end;
end $$;
revoke all on function app_private.broker_authority_partner_notice(uuid, text, text) from public, anon, authenticated;

-- broker_screen_apply — fail #2 (posting pauses): tell the broker, right before staff
do $p$
declare src text; a1 text;
begin
  src := pg_get_functiondef('app_private.broker_screen_apply(uuid,text,text,boolean,boolean,jsonb,text,text,text,boolean)'::regprocedure);
  if src like '%broker_authority_partner_notice%' then raise notice 'bl_bp_0456: broker_screen_apply already patched'; return; end if;
  a1 := E'  perform app_private.broker_authority_flag_loads(p_org, true);\n  perform app_private.broker_authority_alert(p_org, ''blocked'',';
  if src not like '%' || a1 || '%' then raise exception 'bl_bp_0456: broker_screen_apply blocked-branch anchor missing'; end if;
  src := replace(src, a1,
       E'  perform app_private.broker_authority_flag_loads(p_org, true);\n'
    || E'  perform app_private.broker_authority_partner_notice(p_org, ''fail'', p_reason);  -- bl_bp_0456 (G7)\n'
    || E'  perform app_private.broker_authority_alert(p_org, ''blocked'',');
  execute src;
end $p$;

-- broker_rescreen_sweep — 14-day stale block: same
do $p$
declare src text; a1 text;
begin
  src := pg_get_functiondef('app_private.broker_rescreen_sweep(integer)'::regprocedure);
  if src like '%broker_authority_partner_notice%' then raise notice 'bl_bp_0456: broker_rescreen_sweep already patched'; return; end if;
  a1 := E'    perform app_private.broker_authority_alert(r.org_id, ''stale_blocked'',';
  if src not like '%' || a1 || '%' then raise exception 'bl_bp_0456: broker_rescreen_sweep stale_blocked anchor missing'; end if;
  src := replace(src, a1,
       E'    perform app_private.broker_authority_partner_notice(r.org_id, ''stale'', null);  -- bl_bp_0456 (G7)\n' || a1);
  execute src;
end $p$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. G8 — partner_verify_code: staff notice for a phone-code confirmation (identity, and agent↔parent by phone)
-- ---------------------------------------------------------------------------------------------------------------
do $p$
declare src text; a1 text; a2 text;
begin
  src := pg_get_functiondef('public.partner_verify_code(text)'::regprocedure);
  if src like '%broker.verified_by_phone%' then raise notice 'bl_bp_0456: partner_verify_code already patched'; return; end if;
  a1 := E'    perform app_private.log_audit(''broker.verify_code_ok'', ''org'', v_org::text, v_org, ''identity confirmed via code to ''';
  a2 := E'  perform app_private.log_audit(''broker.verify_code_ok'', ''org'', v_org::text, v_org, ''parent '' ||';
  if src not like '%' || a1 || '%' then raise exception 'bl_bp_0456: partner_verify_code identity anchor missing'; end if;
  if src not like '%' || a2 || '%' then raise exception 'bl_bp_0456: partner_verify_code parent anchor missing'; end if;
  src := replace(src, a1,
       E'    begin  -- bl_bp_0456 (G8): staff notice lost in the 0318 rewrite\n'
    || E'      insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)\n'
    || E'      values (''staff'',''in_app'',''broker.verified_by_phone'', jsonb_build_object(''title'', ''🟢 Brokerage identity confirmed by phone code — '' || coalesce(v_name,''?''),\n'
    || E'        ''body'', ''Code read to FMCSA-listed '' || app_private.mask_phone(vc.to_number) || '' matched. No staff action needed.'', ''tone'',''info'', ''url'',''/app/command-center/#/broker?id='' || v_org, ''org_id'', v_org), ''sent'', now());\n'
    || E'    exception when others then null; end;\n' || a1);
  src := replace(src, a2,
       E'  if vc.channel = ''phone'' then begin  -- bl_bp_0456 (G8)\n'
    || E'    insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)\n'
    || E'    values (''staff'',''in_app'',''broker.verified_by_phone'', jsonb_build_object(''title'', ''🟢 Agent↔brokerage confirmed by phone code — '' || coalesce(v_name,''?''),\n'
    || E'      ''body'', app_private.agent_parent_display(ap) || '' · code read to FMCSA-listed '' || app_private.mask_phone(vc.to_number) || '' matched. No staff action needed.'', ''tone'',''info'', ''url'',''/app/command-center/#/broker-agent?id='' || v_org, ''org_id'', v_org), ''sent'', now());\n'
    || E'  exception when others then null; end; end if;\n' || a2);
  execute src;
end $p$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. G9 — screening dead-ends reach the partner (and the promised call reaches staff)
-- ---------------------------------------------------------------------------------------------------------------
-- 5a. broker_screen_collect: unknown / not_found / error on a never-passed brokerage → partner notice (agents: 0449 nudge)
do $p$
declare src text; a1 text;
begin
  src := pg_get_functiondef('app_private.broker_screen_collect()'::regprocedure);
  if src like '%bl_bp_0456%' then raise notice 'bl_bp_0456: broker_screen_collect already patched'; return; end if;
  a1 := E'      perform app_private.notify_partner(r.org_id, ''FMCSA screening did not pass'', coalesce(v_reason,''''), ''warning'', ''/app/partner/#onboarding'');\n    end if;';
  if src not like '%' || a1 || '%' then raise exception 'bl_bp_0456: broker_screen_collect fail-branch anchor missing'; end if;
  src := replace(src, a1,
       E'      perform app_private.notify_partner(r.org_id, ''FMCSA screening did not pass'', coalesce(v_reason,''''), ''warning'', ''/app/partner/#onboarding'');\n'
    || E'    elsif v_eff in (''unknown'',''not_found'',''error'') and v_prev is distinct from v_eff and not coalesce(t.is_agent,false) then  -- bl_bp_0456 (G9)\n'
    || E'      perform app_private.notify_partner(r.org_id,\n'
    || E'        case v_eff when ''not_found'' then ''⚠ '' || coalesce(''MC-'' || r.mc_number, ''Your MC'') || '' was not found on FMCSA''\n'
    || E'                   when ''error'' then ''⚠ The FMCSA check could not complete'' else ''⚠ Your FMCSA screening needs a human'' end,\n'
    || E'        case v_eff when ''not_found'' then ''FMCSA has no record of '' || coalesce(''MC-'' || r.mc_number, ''that number'') || ''. Check the MC under Onboarding and screen again; if it is right, our team has been notified and will check it by hand.''\n'
    || E'                   when ''error'' then ''FMCSA did not answer our lookup'' || coalesce('' ('' || v_reason || '')'', '''') || ''. Nothing is wrong on your side — press Screen again in a few minutes, or our team checks it by hand.''\n'
    || E'                   else ''We could not read broker authority from FMCSA''''s record'' || coalesce('' ('' || v_reason || '')'', '''') || ''. Our team has been notified and will confirm it by hand — usually within one business day.'' end,\n'
    || E'        ''warning'', ''/app/partner/#onboarding'');\n'
    || E'    end if;');
  execute src;
end $p$;

-- 5b. shipper_business_start: free-mail signup → partner notice once (the portal card shows the company-email form)
do $p$
declare src text; a1 text;
begin
  src := pg_get_functiondef('app_private.shipper_business_start(uuid)'::regprocedure);
  if src like '%bl_bp_0456%' then raise notice 'bl_bp_0456: shipper_business_start already patched'; return; end if;
  a1 := E'    return jsonb_build_object(''queued'', false, ''outcome'', ''free_mail'');';
  if src not like '%' || a1 || '%' then raise exception 'bl_bp_0456: shipper_business_start free_mail anchor missing'; end if;
  src := replace(src, a1,
       E'    if t.check_outcome is distinct from ''free_mail'' then  -- bl_bp_0456 (G9): once, not on every re-check\n'
    || E'      perform app_private.notify_partner(p_org, ''Confirm your company email to request quotes'',\n'
    || E'        ''You signed up with a personal inbox, which cannot prove a business. Enter an address on your company''''s own domain under Onboarding — we e-mail it a 6-digit code and quotes open the moment it matches.'', ''warning'', ''/app/partner/#onboarding'');\n'
    || E'    end if;\n' || a1);
  execute src;
end $p$;

-- 5c. shipper_check_collect: error → partner + staff notice; shipper.checked opens the Shipper 360 (G13)
do $p$
declare src text; a1 text; a2 text;
begin
  src := pg_get_functiondef('app_private.shipper_check_collect()'::regprocedure);
  if src like '%bl_bp_0456%' then raise notice 'bl_bp_0456: shipper_check_collect already patched'; return; end if;
  a1 := E'      update app_private.shipper_trust set request_id = null, checked_at = now(), check_outcome = v_out, check_reason = v_reason, updated_at = now() where org_id = r.org_id;\n      continue;';
  a2 := E'''url'', ''/app/command-center/#/broker-trust'', ''org_id'', r.org_id), ''sent'', now());';
  if src not like '%' || a1 || '%' then raise exception 'bl_bp_0456: shipper_check_collect error anchor missing'; end if;
  if src not like '%' || a2 || '%' then raise exception 'bl_bp_0456: shipper_check_collect url anchor missing'; end if;
  src := replace(src, a1,
       E'      update app_private.shipper_trust set request_id = null, checked_at = now(), check_outcome = v_out, check_reason = v_reason, updated_at = now() where org_id = r.org_id;\n'
    || E'      perform app_private.notify_partner(r.org_id, ''We could not run the business check yet'',  -- bl_bp_0456 (G9)\n'
    || E'        ''Our company-domain check did not complete ('' || v_reason || ''). Nothing is wrong on your side — press Re-check under Onboarding, or our team confirms it by hand.'', ''warning'', ''/app/partner/#onboarding'');\n'
    || E'      begin\n'
    || E'        insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)\n'
    || E'        values (''staff'',''in_app'',''shipper.checked'', jsonb_build_object(''title'', ''🟡 Shipper check ERROR — '' || coalesce(v_name,''?''), ''body'', v_reason || '' · confirm by hand in Shipper 360 if it repeats'',\n'
    || E'          ''tone'', ''action'', ''url'', ''/app/command-center/#/shipper?id='' || r.org_id, ''org_id'', r.org_id), ''sent'', now());\n'
    || E'      exception when others then null; end;\n'
    || E'      continue;');
  src := replace(src, a2, E'''url'', ''/app/command-center/#/shipper?id='' || r.org_id, ''org_id'', r.org_id), ''sent'', now());  -- bl_bp_0456 (G13)');
  execute src;
end $p$;

-- 5d. broker_identity_send_email: "we will call you" now creates the staff call task it promises (once per org)
do $p$
declare src text; a1 text;
begin
  src := pg_get_functiondef('app_private.broker_identity_send_email(uuid,boolean)'::regprocedure);
  if src like '%broker.identity.no_email%' then raise notice 'bl_bp_0456: broker_identity_send_email already patched'; return; end if;
  a1 := E'    return jsonb_build_object(''sent'', false, ''why'', ''no fmcsa email'');';
  if src not like '%' || a1 || '%' then raise exception 'bl_bp_0456: broker_identity_send_email no-email anchor missing'; end if;
  src := replace(src, a1,
       E'    if not exists (select 1 from app_private.notifications n where n.template_key = ''broker.identity.no_email'' and n.payload->>''org_id'' = p_org::text) then  -- bl_bp_0456 (G9)\n'
    || E'      begin\n'
    || E'        insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)\n'
    || E'        values (''staff'',''in_app'',''broker.identity.no_email'', jsonb_build_object(\n'
    || E'          ''title'', ''📞 Call needed — identity: '' || coalesce(s.legal_name, (select name from public.organizations where id = p_org), ''?''),\n'
    || E'          ''body'', ''FMCSA lists no e-mail for '' || coalesce(''MC-'' || s.mc_number, ''this MC'') || ''. The broker was told we will call the FMCSA-listed number'' || coalesce('' '' || app_private.mask_phone(idn.fmcsa_phone), '''') || '' within one business day — confirm identity from Broker 360 → Trust.'',\n'
    || E'          ''tone'', ''action'', ''url'', ''/app/command-center/#/broker?id='' || p_org, ''org_id'', p_org), ''sent'', now());\n'
    || E'      exception when others then null; end;\n'
    || E'    end if;\n' || a1);
  execute src;
end $p$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. G2 — shipper-posted loads get the same label + gate. Broker path byte-for-byte as bl_bp_0343 left it.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function app_private.trust_label_load()
returns trigger language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_tier text; t app_private.broker_trust; v_name text; v_mc text; v_pmc text; ap9 app_private.agent_parents; v_kind text; v_dom text;
begin
  -- Portal-posted partner loads only. Staff/dispatcher-entered and syndicated loads keep their own rules.
  if NEW.broker_org is null or coalesce(NEW.source_type,'partner_portal') <> 'partner_portal' then return NEW; end if;
  select kind into v_kind from public.organizations o where o.id = NEW.broker_org;
  -- bl_bp_0456 (G2): a shipper posting directly to the board
  if v_kind = 'shipper' then
    v_tier := app_private.shipper_tier(NEW.broker_org);
    if v_tier = 'verified' then
      if NEW.verification_state = 'partial' then
        NEW.verification_state := 'verified';
        NEW.details := coalesce(NEW.details,'{}'::jsonb) - 'source_notice';
      end if;
      return NEW;
    end if;
    select domain into v_dom from app_private.shipper_trust where org_id = NEW.broker_org;
    NEW.verification_state := 'partial';
    NEW.details := coalesce(NEW.details,'{}'::jsonb) || jsonb_build_object('source_notice', jsonb_build_object(
      'provider', 'a shipper new to LoadBoot', 'bookable', true, 'request_only', true, 'tier', v_tier,
      'label', 'Posted directly by a shipper new to LoadBoot' || case when v_tier = 'business_verified' then coalesce(' — company domain ' || v_dom || ' confirmed', ' — company confirmed') else '' end
        || '. Booking goes through request-to-book: the shipper approves and LoadBoot dispatch confirms the rate confirmation before you roll. Instant booking unlocks once their onboarding is reviewed.'));
    return NEW;
  end if;
  if v_kind is distinct from 'broker' then return NEW; end if;
  v_tier := app_private.broker_tier(NEW.broker_org);
  if v_tier = 'verified' then
    -- self-heal: a load posted while the brokerage was still 'partial' clears once they verify
    if NEW.verification_state = 'partial' then
      NEW.verification_state := 'verified';
      NEW.details := coalesce(NEW.details,'{}'::jsonb) - 'source_notice';
    end if;
    return NEW;
  end if;
  select * into t from app_private.broker_trust where org_id = NEW.broker_org;
  select nullif(regexp_replace(coalesce(mc_number,''),'\D','','g'),'') into v_mc from public.organizations where id = NEW.broker_org;
  v_name := case when coalesce(t.is_agent,false) then coalesce(t.parent_legal_name, 'their brokerage') else null end;
  v_pmc := t.parent_mc;
  -- bl_bp_0318: the brokerage chosen for this load
  if coalesce(t.is_agent,false) and nullif(NEW.details->>'agent_parent_id','') is not null then
    select * into ap9 from app_private.agent_parents where id = (NEW.details->>'agent_parent_id')::uuid and agent_org = NEW.broker_org;
    if ap9.id is not null then v_name := coalesce(ap9.fmcsa_legal_name, ap9.parent_legal_name, v_name); v_pmc := ap9.parent_mc; end if;
  end if;
  if v_name is not null then
    NEW.broker := v_name || coalesce(' · MC-' || v_pmc, '') || ' (agent: ' || coalesce((select name from public.organizations where id = NEW.broker_org), 'agent') || ')';
  end if;
  NEW.verification_state := 'partial';
  NEW.details := coalesce(NEW.details,'{}'::jsonb) || jsonb_build_object('source_notice', jsonb_build_object(
    'provider', case when v_name is not null then 'an agent of ' || v_name else 'a new LoadBoot brokerage' end,
    'bookable', true,
    'request_only', true,
    'tier', v_tier,
    'label', case when v_name is not null
      then 'Posted by an agent under ' || v_name || coalesce(' (MC-' || v_pmc || ')','')
           || ' — authority confirmed on FMCSA and by the brokerage. Booking goes through request-to-book: LoadBoot dispatch confirms the rate confirmation with the brokerage before you roll.'
      else 'New brokerage on LoadBoot — broker authority' || coalesce(' MC-' || v_mc, '') || ' verified live on FMCSA (bond on file). '
           || 'Booking goes through request-to-book: the broker approves and LoadBoot dispatch confirms the rate confirmation before you roll.' end));
  -- bl_bp_0343: never claim a live FMCSA verification we no longer have
  if v_tier in ('authority_fail','authority_stale') then
    NEW.details := coalesce(NEW.details,'{}'::jsonb) || jsonb_build_object('source_notice', jsonb_build_object(
      'provider', coalesce('an agent of ' || v_name, 'this brokerage'),
      'bookable', true, 'request_only', true, 'tier', v_tier,
      'label', case when v_tier = 'authority_fail'
        then 'LoadBoot could not confirm this brokerage''s broker authority on its two most recent FMCSA checks. The load stays on the board, but booking is by request only and LoadBoot dispatch confirms the rate confirmation with the brokerage before you roll.'
        else 'LoadBoot has not been able to reach FMCSA to re-confirm this brokerage''s authority recently. Booking is by request only until we can. This is a LoadBoot lookup problem, not a finding against the brokerage.' end));
  end if;
  return NEW;
end $$;

create or replace function app_private.enforce_trust_gate_not_bookable()
returns trigger language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_tier text; v_kind text;
begin
  if OLD.status is distinct from 'available' or NEW.status is not distinct from OLD.status
     or NEW.status in ('cancelled','canceled','expired') then return NEW; end if;
  if NEW.broker_org is null or coalesce(NEW.source_type,'partner_portal') <> 'partner_portal' then return NEW; end if;
  select kind into v_kind from public.organizations o where o.id = NEW.broker_org;
  if v_kind = 'shipper' then  -- bl_bp_0456 (G2)
    v_tier := app_private.shipper_tier(NEW.broker_org);
    if v_tier = 'verified' then
      if NEW.verification_state = 'partial' then NEW.verification_state := 'verified'; end if;
      return NEW;
    end if;
    if v_tier in ('hold','new') then
      raise exception 'This shipper is not cleared to book right now (%). LoadBoot dispatch has been notified.', v_tier using errcode = '42501';
    end if;
    -- business_verified: request-to-book paths only (below)
  elsif v_kind is distinct from 'broker' then
    return NEW;
  else
    v_tier := app_private.broker_tier(NEW.broker_org);
    if v_tier = 'verified' then
      if NEW.verification_state = 'partial' then NEW.verification_state := 'verified'; end if;
      return NEW;
    end if;
    if v_tier in ('hold','agent_pending','new','authority_fail','authority_stale') then  -- bl_bp_0343
      raise exception 'This brokerage is not cleared to book right now (%). LoadBoot dispatch has been notified.', v_tier using errcode = '42501';
    end if;
  end if;
  -- screened / agent_confirmed / business_verified: partner-approved paths only
  if exists (select 1 from app_private.load_book_requests r
              where r.load_id = NEW.id and r.status in ('pending','approved')
                and (NEW.assigned_to is null or r.carrier_user = NEW.assigned_to))
     or exists (select 1 from app_private.load_offers o
                 join public.organization_memberships om on om.org_id = o.carrier_id and om.status = 'active'
                where o.load_id = NEW.id and o.status in ('sent','viewed','accepted','countered')
                  and (NEW.assigned_to is null or om.user_id = NEW.assigned_to)) then
    return NEW;
  end if;
  if v_kind = 'shipper' then
    raise exception 'This load is from a shipper new to LoadBoot — book it with "Request to book" (the shipper approves and LoadBoot confirms the rate confirmation). Instant booking unlocks once their onboarding is reviewed.' using errcode = '42501';
  end if;
  raise exception 'This load is from a new brokerage — book it with "Request to book" (the broker approves within 30 minutes and LoadBoot confirms the rate confirmation). Instant booking unlocks once the brokerage completes verification.' using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. guard rails: the anon-executable SECDEF surface must not have moved (compare names in the caller — CLAUDE.md §4)
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare n int; names text;
begin
  select count(*), string_agg(p.proname, ',' order by p.proname) into n, names
    from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
  raise notice 'bl_bp_0456: anon SECDEF public = % → %', n, names;
  if names like '%cc_partner_register%' then raise exception 'bl_bp_0456: cc_partner_register became anon-executable'; end if;
end $$;
