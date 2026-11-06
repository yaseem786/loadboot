-- bl_bp_0592 — broker identity when FMCSA lists NO email and NO phone: the "company path" (owner, 5 Nov 2026)
-- Found on TransPak (MC 778563): FMCSA has no contact for the MC, yet the portal said "we emailed the address FMCSA has
-- on file — click the link", the "ask our team to call" button answered "we will call the number on your FMCSA record"
-- and staff got "Call the FMCSA-listed number (none on file)". A dead end on both sides.
-- Now, when FMCSA lists neither an email nor a usable US phone:
--   * the broker is told the truth and gets a form (portal → Onboarding 1b): company main line, company website,
--     their direct number, best time. Faster route named too: update the FMCSA record (MCS-150).
--   * staff get ONE alert with a checklist + evidence (signup domain, free-mail flag, other LoadBoot accounts on the same
--     domain that passed the company-domain check). The number the broker types is a HINT only — staff must find the
--     main line on the company's own website / public listing, call it, ask for the person, then Verify identity.
--   * Verify identity records method 'company_callback' for this path (audit shows how it was proven).
--   * every message (portal reason, in-app notices, staff alerts) now says what really happens for each case.

alter table app_private.broker_identity
  add column if not exists company_phone text,
  add column if not exists company_site text,
  add column if not exists direct_phone text,
  add column if not exists company_note text,
  add column if not exists company_requested_at timestamptz;
alter table app_private.broker_identity drop constraint if exists broker_identity_method_check;
alter table app_private.broker_identity add constraint broker_identity_method_check
  check (method = any (array['domain', 'email', 'staff', 'parent', 'phone', 'company_callback']));

-- which FMCSA contact can actually be used
create or replace function app_private.broker_fmcsa_contact(p_org uuid)
returns jsonb language sql stable security definer set search_path to 'app_private', 'public' as $function$
  select jsonb_build_object(
    'has_email', i.fmcsa_email is not null,
    'has_phone', coalesce(regexp_replace(coalesce(i.fmcsa_phone, s.phone, ''), '\D', '', 'g'), '') ~ '^1?[0-9]{10}$',
    'company_requested_at', i.company_requested_at)
    from app_private.broker_identity i left join app_private.broker_screenings s on s.org_id = i.org_id
   where i.org_id = p_org;
$function$;

-- evidence staff see with the alert (nothing here verifies anyone on its own)
create or replace function app_private.broker_identity_evidence(p_org uuid)
returns text language sql stable security definer set search_path to 'app_private', 'public' as $function$
  with d as (
    select lower(split_part(u.email, '@', 2)) dom,
           coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), nullif(u.raw_user_meta_data->>'name', ''), u.email) who, u.email
      from public.organizations o join auth.users u on u.id = o.owner_user_id
     where o.id = p_org)
  select 'Ask for: ' || d.who || ' (' || d.email || ')'
      || ' · signup domain ' || d.dom
      || case when d.dom in ('gmail.com','yahoo.com','outlook.com','hotmail.com','aol.com','icloud.com','protonmail.com','live.com','msn.com','me.com')
              then ' ⚠ FREE MAIL — ask for a company-domain email or proof on company letterhead before verifying'
              else ' (company domain)' end
      || coalesce(' · same domain already passed the company-domain check on: ' ||
           (select string_agg(o2.name || ' (' || o2.kind || ')', ', ') from app_private.shipper_trust st join public.organizations o2 on o2.id = st.org_id
             where st.domain = d.dom and st.check_outcome = 'pass' and st.org_id <> p_org), '')
    from d;
$function$;

-- the broker asks to be confirmed through their company (portal form)
create or replace function public.partner_identity_company_request(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public' as $function$
declare v_org uuid; idn app_private.broker_identity; v_name text; v_main text; v_direct text; v_site text; v_note text; v_ev text;
begin
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode = '42501'; end if;
  select * into idn from app_private.broker_identity where org_id = v_org;
  if idn.org_id is null then raise exception 'screen your MC first' using errcode = '22023'; end if;
  if idn.status = 'verified' then return jsonb_build_object('ok', true, 'already', true); end if;
  if idn.company_requested_at > now() - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'why', 'Already received — our team is on it. You can update the details in 10 minutes.'); end if;
  v_main   := app_private.dial_e164(coalesce(p->>'company_phone', ''));
  v_direct := app_private.dial_e164(coalesce(p->>'direct_phone', ''));
  v_site   := nullif(left(btrim(coalesce(p->>'company_site', '')), 200), '');
  v_note   := nullif(left(btrim(coalesce(p->>'note', '')), 300), '');
  if v_main is null and v_direct is null then
    return jsonb_build_object('ok', false, 'why', 'Add your company''s main phone line (or your direct number).'); end if;
  update app_private.broker_identity set company_phone = v_main, direct_phone = v_direct, company_site = v_site, company_note = v_note,
         company_requested_at = now(), note = left(coalesce(note, '') || ' | company path requested ' || to_char(now(), 'YYYY-MM-DD HH24:MI'), 500), updated_at = now()
   where org_id = v_org;
  select name into v_name from public.organizations where id = v_org;
  v_ev := app_private.broker_identity_evidence(v_org);
  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff', 'in_app', 'broker.identity.company', jsonb_build_object(
      'title', '📞 Confirm through the company — ' || coalesce(v_name, '?'),
      'body', 'FMCSA lists no email or phone for this MC. 1) Find the main line on the company''s OWN website or public listing'
              || coalesce(' (they gave ' || v_site || ')', '') || ' — the number they typed is a hint only'
              || coalesce(': ' || v_main, '') || '. 2) Call it and ask for the person' || coalesce('; direct line ' || v_direct, '')
              || coalesce('; best time: ' || v_note, '') || '. 3) Broker trust → Verify identity, write the number you called and where you found it. '
              || coalesce(v_ev, ''),
      'tone', 'action', 'url', '/app/command-center/#/broker?id=' || v_org, 'org_id', v_org), 'sent', now());
  exception when others then null; end;
  perform app_private.notify_partner(v_org, '📞 We''ll confirm through your company',
    'Got it. Our team will call your company''s main line (as listed publicly) and ask for you — usually within one business day. Posting opens the moment it is confirmed.',
    'info', '/app/partner/#onboarding');
  perform app_private.log_audit('broker.identity.company_request', 'org', v_org::text, v_org, coalesce(v_main, '') || ' / ' || coalesce(v_direct, ''), null, null);
  return jsonb_build_object('ok', true);
end $function$;
revoke all on function public.partner_identity_company_request(jsonb) from public, anon;
grant execute on function public.partner_identity_company_request(jsonb) to authenticated;
revoke all on function app_private.broker_fmcsa_contact(uuid), app_private.broker_identity_evidence(uuid) from public, anon;

-- "ask our team to call": truthful when FMCSA has no phone
create or replace function public.partner_identity_request_call(p_phone text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_org uuid; idn app_private.broker_identity; v_name text; c jsonb;
begin
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  select * into idn from app_private.broker_identity where org_id = v_org;
  select name into v_name from public.organizations where id = v_org;
  if idn.org_id is null then raise exception 'screen your MC first' using errcode='22023'; end if;
  if idn.status = 'verified' then return jsonb_build_object('ok', true, 'already', true); end if;
  c := app_private.broker_fmcsa_contact(v_org);
  if not coalesce((c->>'has_phone')::boolean, false) then   -- bl_bp_0592: nothing to call on the FMCSA record → the company path
    return jsonb_build_object('ok', false, 'company_path', true,
      'why', 'FMCSA lists no phone for your brokerage, so we confirm through your company instead — add your company''s main line below.');
  end if;
  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff','in_app','broker.identity_call', jsonb_build_object(
      'title', '📞 Broker asks for an identity call — ' || coalesce(v_name,'?'),
      'body', 'Call the FMCSA-listed number ' || idn.fmcsa_phone || coalesce(' · they say reach them at ' || nullif(trim(p_phone),''),'') || coalesce(' · ' || nullif(trim(p_note),''),'') || ' — then Verify identity in Broker trust.',
      'tone','action','url','/app/command-center/#/broker-trust','org_id', v_org), 'sent', now());
  exception when others then null; end;
  update app_private.broker_identity set note = left(coalesce(note,'') || ' | call requested ' || to_char(now(),'YYYY-MM-DD HH24:MI') || coalesce(' ' || nullif(trim(p_phone),''),''), 500), updated_at = now() where org_id = v_org;
  perform app_private.notify_partner(v_org, '📞 Call requested', 'Our team will call the number on your FMCSA record (' || app_private.mask_phone(idn.fmcsa_phone) || ') during business hours to confirm it is you. Faster: the automated call in Onboarding → 1b confirms you in a minute.', 'info', '/app/partner/#onboarding');
  return jsonb_build_object('ok', true);
end $function$;

-- anchor patches (no retyping of the big functions); each anchor must occur exactly once
do $$
declare r record; d text; n int;
begin
  for r in select * from (values
    -- 1) the reason under the portal hero
    ('app_private.broker_can_post(uuid)',
$a$    reason := 'Confirm this is your brokerage: we emailed the address FMCSA has on file' ||
              coalesce(' (' || (select app_private.mask_email(fmcsa_email) from app_private.broker_identity where org_id = p_org) || ')', '') ||
              ' — click the link, or ask our team to call your FMCSA-listed number.';$a$,
$a$    reason := case   -- bl_bp_0592: say what really happens for this MC
      when ((app_private.broker_fmcsa_contact(p_org))->>'has_email')::boolean then
        'Confirm this is your brokerage: click the link we emailed to ' ||
        coalesce((select app_private.mask_email(fmcsa_email) from app_private.broker_identity where org_id = p_org), 'the address FMCSA has on file') ||
        ', or take the automated call to your FMCSA-listed number.'
      when ((app_private.broker_fmcsa_contact(p_org))->>'has_phone')::boolean then
        'Confirm this is your brokerage: take the automated call to your FMCSA-listed number (Onboarding → 1b) — it takes about a minute.'
      when (app_private.broker_fmcsa_contact(p_org))->>'company_requested_at' is not null then
        'We are confirming with your company directly: our team calls your company''s main line and asks for you, usually within one business day.'
      else 'FMCSA lists no email or phone for your MC, so we confirm through your company instead: add your company''s main phone line in Onboarding (step 1b).'
    end;$a$),
    -- 2) the in-app notice + staff alert sent when there is no FMCSA email
    ('app_private.broker_identity_send_email(uuid,boolean)',
$a$      'We could not email your FMCSA contact. Our team will call the phone number on your FMCSA record' || coalesce(' (' || app_private.mask_phone(idn.fmcsa_phone) || ')','') || ' to confirm it is you — usually within one business day.', 'warning', '/app/partner/#onboarding');$a$,
$a$      case when ((app_private.broker_fmcsa_contact(p_org))->>'has_phone')::boolean
           then 'Confirm in about a minute with the automated call to the number on your FMCSA record' || coalesce(' (' || app_private.mask_phone(idn.fmcsa_phone) || ')','') || ' — Onboarding → 1b.'
           else 'FMCSA lists no email or phone for your brokerage, so we confirm through your company instead: add your company''s main phone line in Onboarding → 1b and our team calls it, usually within one business day.' end,
      'warning', '/app/partner/#onboarding');$a$),
    ('app_private.broker_identity_send_email(uuid,boolean)',
$a$'. The broker was told we will call the FMCSA-listed number' || coalesce(' ' || app_private.mask_phone(idn.fmcsa_phone), '') || ' within one business day — confirm identity from Broker 360 → Trust.',$a$,
$a$case when ((app_private.broker_fmcsa_contact(p_org))->>'has_phone')::boolean
                 then '. The broker can self-confirm with the automated call to ' || app_private.mask_phone(idn.fmcsa_phone) || '; if nobody answers, call it yourself and Verify identity in Broker 360 → Trust.'
                 else ' and no phone either. The broker was asked for the company''s main line (company path). Find the main line on the company''s own website, call it, ask for the person, then Verify identity. ' || coalesce(app_private.broker_identity_evidence(p_org), '') end,$a$),
    -- 3) staff Verify identity records HOW: company path vs FMCSA phone
    ('public.cc_broker_trust_set(uuid,text,text)',
$a$    perform app_private.notify_partner(p_org, '✅ Identity confirmed — you can post now', 'Our team confirmed your brokerage.$a$,
$a$    update app_private.broker_identity set method = 'company_callback' where org_id = p_org   -- bl_bp_0592
       and not coalesce(((app_private.broker_fmcsa_contact(p_org))->>'has_email')::boolean, false)
       and not coalesce(((app_private.broker_fmcsa_contact(p_org))->>'has_phone')::boolean, false);
    perform app_private.notify_partner(p_org, '✅ Identity confirmed — you can post now', 'Our team confirmed your brokerage.$a$),
    -- 4a) Broker 360 shows what the broker gave + the evidence line
    ('public.cc_partner_360(uuid)',
$a$'identity', case when idn.org_id is null then null else jsonb_build_object($a$,
$a$'identity', case when idn.org_id is null then null else jsonb_build_object('company_phone', idn.company_phone, 'company_site', idn.company_site, 'direct_phone', idn.direct_phone, 'company_note', idn.company_note, 'company_requested_at', idn.company_requested_at, 'evidence', app_private.broker_identity_evidence(p_org), $a$),
    -- 4) the portal learns which path applies
    ('public.partner_trust_status()',
$a$'has_fmcsa_email', i.fmcsa_email is not null)$a$,
$a$'has_fmcsa_email', i.fmcsa_email is not null, 'has_fmcsa_phone', ((app_private.broker_fmcsa_contact(i.org_id))->>'has_phone')::boolean,
                   'company_requested_at', i.company_requested_at, 'company_site', i.company_site, 'company_phone_masked', app_private.mask_phone(i.company_phone))$a$)
  ) v(fn, anchor, repl) loop
    d := pg_get_functiondef(r.fn::regprocedure);
    if position(r.repl in d) > 0 then continue; end if;   -- already patched (re-run safe)
    n := (length(d) - length(replace(d, r.anchor, ''))) / length(r.anchor);   -- already patched
    if n <> 1 then raise exception 'bl_bp_0592: anchor found % times in %', n, r.fn; end if;
    execute replace(d, r.anchor, r.repl);
  end loop;
end $$;
