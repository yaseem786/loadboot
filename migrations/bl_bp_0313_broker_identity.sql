-- bl_bp_0313 — Broker IDENTITY layer on top of bl_bp_0312 (tiered trust).
--
-- 0312 proved "this MC is an active broker". It did NOT prove "you are that broker" — anyone
-- could type a real brokerage's MC. Industry practice (Highway, DAT, RMIS: verify against the
-- FMCSA-listed email/phone, watch ownership changes, treat identity as ongoing) → this adds:
--
--   IDENTITY CLAIM   a screened broker (own MC) is `unclaimed` until ONE of:
--                      domain   signup email domain == FMCSA-listed email domain (automatic)
--                      email    one-click link sent to the FMCSA-listed email (automatic on pass)
--                      staff    LoadBoot calls the FMCSA-listed phone and records it (CC action)
--                      parent   (agents) the parent brokerage confirmed them (0312)
--                    A decline from the FMCSA address = impersonation → hold + staff alert.
--   ONE MC = ONE ORG one active broker/shipper org per MC (partial unique index; prod has 0 dupes).
--                    A second signup with a claimed MC is refused with a "join your team" message
--                    and the existing owner + staff are notified.
--   PARENT ON LB     an agent whose parent brokerage already has a LoadBoot org is linked to it
--                    (`broker_trust.parent_org_id`); the confirmation goes to that org's OWNER
--                    (in-app + account email) instead of the FMCSA address. The parent gets an
--                    Agents screen: approve / decline / revoke / invite-by-email; an invited
--                    email is auto-confirmed when it declares that parent.
--   PARENT PAPER     loads posted by an agent carry the PARENT's name + MC in `loads.broker`.
--
-- Schema-agnostic like 0312. STAGING FIRST. Prod: 0312 → 0312b → 0312c → 0313 in one go.

-- ---------------------------------------------------------------------------
-- 1. tables / columns
-- ---------------------------------------------------------------------------
create table if not exists app_private.broker_identity (
  org_id          uuid primary key references public.organizations(id) on delete cascade,
  status          text not null default 'pending' check (status in ('pending','verified','declined')),
  method          text check (method in ('domain','email','staff','parent')),
  fmcsa_email     text,
  fmcsa_phone     text,
  signup_email    text,
  email_token     uuid,
  email_sent_at   timestamptz,
  email_resends   int not null default 0,
  verified_at     timestamptz,
  verified_by     text,
  declined_at     timestamptz,
  note            text,
  updated_at      timestamptz not null default now()
);
create unique index if not exists broker_identity_token_idx on app_private.broker_identity(email_token) where email_token is not null;

alter table app_private.broker_trust add column if not exists parent_org_id uuid references public.organizations(id);

create table if not exists app_private.broker_agent_invites (
  id            uuid primary key default gen_random_uuid(),
  parent_org_id uuid not null references public.organizations(id) on delete cascade,
  email         text not null,
  name          text,
  token         uuid not null default gen_random_uuid(),
  invited_by    uuid,
  status        text not null default 'pending' check (status in ('pending','accepted','revoked')),
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  agent_org_id  uuid
);
create index if not exists broker_agent_invites_email_idx on app_private.broker_agent_invites(lower(email)) where status = 'pending';

-- one active broker/shipper org per MC — prod and staging both have 0 duplicates today
do $$
begin
  if exists (select mc_number from public.organizations where kind in ('broker','shipper') and mc_number is not null and coalesce(status,'') <> 'archived' group by mc_number having count(*) > 1) then
    raise notice 'organizations: duplicate broker/shipper MCs exist — unique index NOT created; resolve by hand';
  else
    create unique index if not exists organizations_one_partner_per_mc
      on public.organizations (mc_number) where kind in ('broker','shipper') and mc_number is not null and coalesce(status,'') <> 'archived';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. helpers
-- ---------------------------------------------------------------------------
create or replace function app_private.mask_email(p text) returns text language sql immutable as $$
  select case when p is null or position('@' in p) = 0 then null
    else left(split_part(p,'@',1),1) || repeat('*', greatest(2, length(split_part(p,'@',1)) - 1)) || '@' || split_part(p,'@',2) end;
$$;
create or replace function app_private.mask_phone(p text) returns text language sql immutable as $$
  select case when p is null then null else regexp_replace(regexp_replace(p,'\D','','g'), '^(\d*)(\d{4})$', '(***) ***-\2') end;
$$;

-- who owns a given MC on LoadBoot (active broker/shipper org), excluding one org
create or replace function app_private.mc_owner_org(p_mc text, p_except uuid default null)
returns uuid language sql stable security definer set search_path to 'app_private, public' as $$
  select o.id from public.organizations o
   where o.kind in ('broker','shipper') and o.mc_number = nullif(regexp_replace(coalesce(p_mc,''),'\D','','g'),'')
     and coalesce(o.status,'') <> 'archived' and (p_except is null or o.id <> p_except)
   order by o.created_at limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 3. tier: 'unclaimed' sits between screening pass and screened
-- ---------------------------------------------------------------------------
create or replace function app_private.broker_tier(p_org uuid)
returns text
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare t app_private.broker_trust; s app_private.broker_screenings; idn app_private.broker_identity; v_kind text;
begin
  select kind into v_kind from public.organizations where id = p_org;
  if v_kind is null then return 'new'; end if;
  select * into t from app_private.broker_trust where org_id = p_org;
  if t.org_id is not null and t.hold_reason is not null then return 'hold'; end if;
  if app_private.org_onboarding_complete(p_org) then return 'verified'; end if;
  select * into s from app_private.broker_screenings where org_id = p_org;
  if s.org_id is null or s.outcome <> 'pass' then return 'new'; end if;
  if coalesce(t.is_agent, false) then
    return case when t.parent_confirmed_at is not null then 'agent_confirmed' else 'agent_pending' end;
  end if;
  select * into idn from app_private.broker_identity where org_id = p_org;
  if idn.org_id is null or idn.status <> 'verified' then return 'unclaimed'; end if;
  return 'screened';
end $$;

-- broker_can_post: add the 'unclaimed' reason (string surgery on the 0312 definition)
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='app_private' and p.proname='broker_can_post';
  if v_def is null then raise exception 'broker_can_post missing — apply bl_bp_0312 first'; end if;
  if position('unclaimed' in v_def) > 0 then raise notice 'broker_can_post already patched'; return; end if;
  v_old := $q$  elsif v_tier = 'agent_pending' then$q$;
  v_new := $q$  elsif v_tier = 'unclaimed' then
    reason := 'Confirm this is your brokerage: we emailed the address FMCSA has on file' ||
              coalesce(' (' || (select app_private.mask_email(fmcsa_email) from app_private.broker_identity where org_id = p_org) || ')', '') ||
              ' — click the link, or ask our team to call your FMCSA-listed number.';
  elsif v_tier = 'agent_pending' then$q$;
  if position(v_old in v_def) = 0 then raise exception 'broker_can_post: anchor missing'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- ---------------------------------------------------------------------------
-- 4. identity: create on screening pass, auto-verify on domain match, email the FMCSA address
-- ---------------------------------------------------------------------------
create or replace function app_private.broker_identity_start(p_org uuid)
returns void
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare s app_private.broker_screenings; t app_private.broker_trust; v_owner_email text; v_dm boolean; idn app_private.broker_identity; v_name text;
begin
  select * into s from app_private.broker_screenings where org_id = p_org;
  select * into t from app_private.broker_trust where org_id = p_org;
  if s.org_id is null or s.outcome <> 'pass' or coalesce(t.is_agent,false) then return; end if;
  select lower(u.email), o.name into v_owner_email, v_name from public.organizations o join auth.users u on u.id = o.owner_user_id where o.id = p_org;
  select * into idn from app_private.broker_identity where org_id = p_org;
  if idn.org_id is not null and idn.status = 'verified' then return; end if;
  v_dm := s.fmcsa_email is not null and v_owner_email is not null and lower(split_part(s.fmcsa_email,'@',2)) = split_part(v_owner_email,'@',2)
          and split_part(v_owner_email,'@',2) not in ('gmail.com','yahoo.com','outlook.com','hotmail.com','aol.com','icloud.com','protonmail.com','live.com','msn.com','me.com');
  insert into app_private.broker_identity(org_id, status, method, fmcsa_email, fmcsa_phone, signup_email, verified_at, verified_by)
  values (p_org, case when v_dm then 'verified' else 'pending' end, case when v_dm then 'domain' end, lower(s.fmcsa_email), s.phone, v_owner_email,
          case when v_dm then now() end, case when v_dm then 'domain match with FMCSA record' end)
  on conflict (org_id) do update set fmcsa_email = excluded.fmcsa_email, fmcsa_phone = excluded.fmcsa_phone, signup_email = excluded.signup_email,
    status = case when app_private.broker_identity.status = 'verified' then 'verified' else excluded.status end,
    method = coalesce(app_private.broker_identity.method, excluded.method),
    verified_at = coalesce(app_private.broker_identity.verified_at, excluded.verified_at),
    verified_by = coalesce(app_private.broker_identity.verified_by, excluded.verified_by), updated_at = now();
  if v_dm then
    perform app_private.notify_partner(p_org, '✅ Identity confirmed — you can post now',
      'Your signup email matches the domain FMCSA has on file for ' || coalesce(s.legal_name, v_name) || '. Accept the Master Broker Agreement and post your first load.', 'success', '/app/partner/#post');
    perform app_private.log_audit('broker.identity.verified','org', p_org::text, p_org, 'domain match: ' || coalesce(v_owner_email,''), null, null);
    return;
  end if;
  perform app_private.broker_identity_send_email(p_org, false);
end $$;

create or replace function app_private.broker_identity_send_email(p_org uuid, p_resend boolean default false)
returns jsonb
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare idn app_private.broker_identity; s app_private.broker_screenings; v_name text; v_owner text; v_url text; v_html text;
begin
  select * into idn from app_private.broker_identity where org_id = p_org;
  select * into s from app_private.broker_screenings where org_id = p_org;
  if idn.org_id is null or idn.status = 'verified' then return jsonb_build_object('sent', false, 'why', 'already verified or not started'); end if;
  if idn.fmcsa_email is null then
    perform app_private.notify_partner(p_org, 'FMCSA lists no email for your brokerage',
      'We could not email your FMCSA contact. Our team will call the phone number on your FMCSA record' || coalesce(' (' || app_private.mask_phone(idn.fmcsa_phone) || ')','') || ' to confirm it is you — usually within one business day.', 'warning', '/app/partner/#onboarding');
    return jsonb_build_object('sent', false, 'why', 'no fmcsa email');
  end if;
  if p_resend and idn.email_sent_at > now() - interval '10 minutes' then return jsonb_build_object('sent', false, 'why', 'wait 10 minutes between sends'); end if;
  if p_resend and idn.email_resends >= 5 then return jsonb_build_object('sent', false, 'why', 'resend limit reached — ask our team to call'); end if;
  if idn.email_token is null then update app_private.broker_identity set email_token = gen_random_uuid() where org_id = p_org returning * into idn; end if;
  select o.name, u.email into v_name, v_owner from public.organizations o join auth.users u on u.id = o.owner_user_id where o.id = p_org;
  v_url := 'https://loadboot.com/claim-confirm.html?t=' || idn.email_token::text;
  v_html :=
    '<h2 style="margin:0 0 10px;font-size:22px">Is someone at ' || coalesce(s.legal_name, v_name) || ' onboarding on LoadBoot?</h2>'
    || '<p style="font-size:15px;color:#334155">A LoadBoot account was just created for <b>' || coalesce(s.legal_name, v_name) || '</b> (MC-' || coalesce(s.mc_number,'') || ') by <b>' || coalesce(v_owner,'') || '</b>. '
    || 'We are emailing the address FMCSA has on file to make sure it is really your company.</p>'
    || '<p style="font-size:15px;color:#334155">If that is you or a colleague, confirm below and posting unlocks. If you do not know this person, decline — that blocks the account and alerts us.</p>'
    || '<p style="margin:18px 0"><a href="' || v_url || '" style="background:#0883F7;color:#fff;padding:13px 22px;border-radius:10px;text-decoration:none;font-weight:800">Review &amp; confirm →</a></p>'
    || '<p style="font-size:12px;color:#94a3b8">No account needed. This link came from LoadBoot (loadboot.com); we never ask for passwords or payments by email.</p>';
  perform app_private.sys_email(idn.fmcsa_email, 'broker.identity_claim',
    case when p_resend then 'Reminder: ' else '' end || 'Confirm your brokerage on LoadBoot — ' || coalesce(s.legal_name, v_name),
    v_html, null, 'brokerclaim:' || p_org::text || ':' || (idn.email_resends + case when p_resend then 1 else 0 end)::text);
  update app_private.broker_identity set email_sent_at = now(), email_resends = email_resends + case when p_resend then 1 else 0 end, updated_at = now() where org_id = p_org;
  perform app_private.notify_partner(p_org, '📧 Confirm it is you — check ' || app_private.mask_email(idn.fmcsa_email),
    'We emailed the address FMCSA has on file for your brokerage. One click there unlocks posting. Not your inbox anymore? Ask our team to call your FMCSA-listed number instead.', 'info', '/app/partner/#onboarding');
  return jsonb_build_object('sent', true, 'to', app_private.mask_email(idn.fmcsa_email));
end $$;

-- hook into the collector: after a PASS for a non-agent, start identity (string surgery on 0312's collector)
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='app_private' and p.proname='broker_screen_collect';
  if v_def is null then raise exception 'broker_screen_collect missing'; end if;
  if position('broker_identity_start' in v_def) > 0 then raise notice 'collector already patched'; return; end if;
  v_old := $q$      else
        perform app_private.notify_partner(r.org_id, '✅ FMCSA screening passed — you can post now',$q$;
  v_new := $q$      else
        perform app_private.broker_identity_start(r.org_id);
        perform app_private.notify_partner(r.org_id, '✅ FMCSA screening passed',$q$;
  if position(v_old in v_def) = 0 then raise exception 'broker_screen_collect: anchor missing'; end if;
  v_def := replace(v_def, v_old, v_new);
  v_def := replace(v_def, $q$'Broker authority ' || coalesce('MC-' || r.mc_number, '') || ' is active on FMCSA. Accept the Master Broker Agreement and post your first load — up to 3 open postings until your first delivery.',$q$,
                          $q$'Broker authority ' || coalesce('MC-' || r.mc_number, '') || ' is active on FMCSA. Next: confirm it is really your brokerage (one click from the email FMCSA has on file), accept the Master Broker Agreement, and post — up to 3 open postings until your first delivery.',$q$);
  execute v_def;
end $$;

-- staff "pass by hand" must also start identity
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='cc_broker_trust_set';
  if v_def is null then raise exception 'cc_broker_trust_set missing'; end if;
  if position('verify_identity' in v_def) > 0 then raise notice 'cc_broker_trust_set already patched'; return; end if;
  v_old := $q$  elsif p_action = 'confirm_parent' then$q$;
  v_new := $q$  elsif p_action = 'verify_identity' then
    -- staff called the FMCSA-listed phone (or otherwise proved identity) — reason required, recorded
    if coalesce(trim(p_note),'') = '' then raise exception 'write how identity was verified (e.g. called FMCSA number, spoke to owner)' using errcode='22023'; end if;
    insert into app_private.broker_identity(org_id, status, method, verified_at, verified_by, note)
    values (p_org, 'verified', 'staff', now(), 'staff', left(trim(p_note),500))
    on conflict (org_id) do update set status='verified', method='staff', verified_at=now(), verified_by='staff', note=left(trim(p_note),500), declined_at=null, updated_at=now();
    perform app_private.notify_partner(p_org, '✅ Identity confirmed — you can post now', 'Our team confirmed your brokerage. Accept the Master Broker Agreement and post your first load.', 'success', '/app/partner/#post');
  elsif p_action = 'reject_identity' then
    if coalesce(trim(p_note),'') = '' then raise exception 'a written reason is required' using errcode='22023'; end if;
    insert into app_private.broker_identity(org_id, status, declined_at, note) values (p_org, 'declined', now(), left(trim(p_note),500))
    on conflict (org_id) do update set status='declined', declined_at=now(), note=left(trim(p_note),500), updated_at=now();
    perform app_private.broker_trust_hold(p_org, 'identity could not be confirmed: ' || left(trim(p_note),200));
    perform app_private.notify_partner(p_org, '⛔ Posting paused — identity not confirmed', left(trim(p_note),300) || '  Contact hello@loadboot.com with proof you represent this brokerage.', 'urgent', '/app/partner/#onboarding');
  elsif p_action = 'resend_identity' then
    perform app_private.broker_identity_send_email(p_org, true);
  elsif p_action = 'confirm_parent' then$q$;
  if position(v_old in v_def) = 0 then raise exception 'cc_broker_trust_set: anchor missing'; end if;
  v_def := replace(v_def, v_old, v_new);
  -- pass-by-hand → also start identity
  v_def := replace(v_def, $q$    if coalesce(t.is_agent,false) and t.parent_confirmed_at is null then perform app_private.broker_parent_confirm_send(p_org);
    else perform app_private.notify_partner(p_org, '✅ Authority verified — you can post now', 'Accept the Master Broker Agreement and post your first load.', 'success', '/app/partner/#post'); end if;$q$,
                          $q$    if coalesce(t.is_agent,false) and t.parent_confirmed_at is null then perform app_private.broker_parent_confirm_send(p_org);
    else perform app_private.broker_identity_start(p_org); end if;$q$);
  execute v_def;
end $$;

-- ---------------------------------------------------------------------------
-- 5. one MC = one org — refuse a second signup for a claimed MC (own-MC path only; agents use parent_mc)
-- ---------------------------------------------------------------------------
create or replace function public.partner_broker_screen(p_mc text, p_dot text default null)
returns jsonb
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; v_mc text; v_other uuid; v_other_name text; v_me text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  v_org := app_private.my_partner_org('broker');
  if v_org is null or not exists (select 1 from public.organizations where id = v_org and kind = 'broker') then
    raise exception 'not a broker account' using errcode='42501'; end if;
  v_mc := nullif(regexp_replace(coalesce(p_mc,''), '[^0-9]', '', 'g'), '');
  if v_mc is not null then
    v_other := app_private.mc_owner_org(v_mc, v_org);
    if v_other is not null then
      select name into v_other_name from public.organizations where id = v_other;
      select u.email into v_me from auth.users u where u.id = auth.uid();
      perform app_private.notify_partner(v_other, '⚠ Someone tried to register your MC',
        coalesce(v_me,'A new signup') || ' entered MC-' || v_mc || ' while creating a broker account. If that is a colleague, invite them from Agents & team. If not, no action is needed — they were refused.', 'warning', '/app/partner/#agents');
      begin
        insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
        values ('staff','in_app','broker.mc_collision', jsonb_build_object('title','⚠ MC collision — MC-' || v_mc, 'body', coalesce(v_me,'?') || ' tried to register MC-' || v_mc || ', already held by ' || coalesce(v_other_name,'?') || '.', 'tone','action','url','/app/command-center/#/broker-trust','org_id', v_org), 'sent', now());
      exception when others then null; end;
      perform app_private.log_audit('broker.mc_collision','org', v_org::text, v_org, 'MC-' || v_mc || ' already registered by ' || v_other::text, null, null);
      -- returned, not raised: a raise would roll back the owner warning + staff alert + audit above
      return jsonb_build_object('queued', false, 'outcome', 'refused', 'code', '23505',
        'error', 'MC-' || v_mc || ' is already registered on LoadBoot by ' || coalesce(v_other_name,'another account') || '. If that is your company, ask the account owner to invite you under Agents & team; if you believe this is wrong, email hello@loadboot.com.');
    end if;
    update public.organizations set mc_number = coalesce(mc_number, v_mc) where id = v_org;
  end if;
  insert into app_private.broker_trust(org_id) values (v_org) on conflict do nothing;
  return app_private.broker_screen_request(v_org, v_mc, p_dot);
end $$;
revoke all on function public.partner_broker_screen(text, text) from public, anon;
grant execute on function public.partner_broker_screen(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. parent already on LoadBoot: link, route confirmation to the parent OWNER, invites
-- ---------------------------------------------------------------------------
create or replace function public.partner_agent_declare(p_parent_mc text, p_parent_company text, p_contact_email text default null)
returns jsonb
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; v_mc text; v_email text; v_parent uuid; v_parent_name text; v_me text; inv app_private.broker_agent_invites;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  v_mc := nullif(regexp_replace(coalesce(p_parent_mc,''), '[^0-9]', '', 'g'), '');
  if v_mc is null then raise exception 'the brokerage MC number is required' using errcode='22023'; end if;
  v_email := nullif(lower(trim(p_contact_email)),'');
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'contact email looks wrong' using errcode='22023'; end if;
  v_parent := app_private.mc_owner_org(v_mc, v_org);
  if v_parent is not null then select name into v_parent_name from public.organizations where id = v_parent; end if;
  insert into app_private.broker_trust(org_id, is_agent, parent_mc, parent_legal_name, parent_contact_email, parent_contact_source, parent_org_id)
  values (v_org, true, v_mc, coalesce(v_parent_name, nullif(trim(p_parent_company),'')), v_email, case when v_email is not null then 'agent_supplied' end, v_parent)
  on conflict (org_id) do update set is_agent = true, parent_mc = excluded.parent_mc,
    parent_legal_name = coalesce(excluded.parent_legal_name, app_private.broker_trust.parent_legal_name),
    parent_contact_email = coalesce(excluded.parent_contact_email, app_private.broker_trust.parent_contact_email),
    parent_contact_source = coalesce(excluded.parent_contact_source, app_private.broker_trust.parent_contact_source),
    parent_org_id = excluded.parent_org_id,
    parent_confirmed_at = case when app_private.broker_trust.parent_mc is distinct from excluded.parent_mc then null else app_private.broker_trust.parent_confirmed_at end,
    parent_declined_at = null, parent_confirm_sent_at = null, parent_reminded_at = null, updated_at = now();
  perform app_private.log_audit('broker.agent_declared','org', v_org::text, v_org,
    'Declared as agent of MC-' || v_mc || coalesce(' ' || nullif(trim(p_parent_company),''),'') || case when v_parent is not null then ' (parent is on LoadBoot: ' || v_parent::text || ')' else '' end, null, null);
  -- invited by this parent? auto-confirm
  if v_parent is not null then
    select u.email into v_me from auth.users u where u.id = auth.uid();
    select * into inv from app_private.broker_agent_invites where parent_org_id = v_parent and status = 'pending' and lower(email) = lower(coalesce(v_me,'')) order by created_at desc limit 1;
    if inv.id is not null then
      update app_private.broker_agent_invites set status = 'accepted', accepted_at = now(), agent_org_id = v_org where id = inv.id;
      update app_private.broker_trust set parent_confirmed_at = now(), parent_confirmed_by = 'invite', parent_contact_source = 'staff', updated_at = now() where org_id = v_org;
      perform app_private.notify_partner(v_parent, '🤝 Your invited agent joined', coalesce(v_me,'') || ' created their agent account under your authority.', 'success', '/app/partner/#agents');
    end if;
  end if;
  return app_private.broker_screen_request(v_org, v_mc, null);
end $$;
revoke all on function public.partner_agent_declare(text, text, text) from public, anon;
grant execute on function public.partner_agent_declare(text, text, text) to authenticated;

-- parent confirmation: route to the LoadBoot parent owner when the parent org exists
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='app_private' and p.proname='broker_parent_confirm_send';
  if v_def is null then raise exception 'broker_parent_confirm_send missing'; end if;
  if position('parent_org_id' in v_def) > 0 then raise notice 'broker_parent_confirm_send already patched'; return; end if;
  v_old := $q$  v_to := coalesce(s.fmcsa_email, t.parent_contact_email);
  v_src := case when s.fmcsa_email is not null then 'fmcsa' when t.parent_contact_email is not null then 'agent_supplied' else null end;$q$;
  v_new := $q$  -- bl_bp_0313: parent already on LoadBoot → its account owner decides (in-app + account email); FMCSA address otherwise
  if t.parent_org_id is not null then
    select lower(u.email) into v_to from public.organizations o join auth.users u on u.id = o.owner_user_id where o.id = t.parent_org_id;
    v_src := 'staff';
    perform app_private.notify_partner(t.parent_org_id, '🤝 An agent wants to post under your authority',
      (select o.name from public.organizations o where o.id = p_org) || ' says they are your agent. Approve or decline under Agents & team — nothing they post can be booked until you do.', 'action', '/app/partner/#agents');
  else
    v_to := coalesce(s.fmcsa_email, t.parent_contact_email);
    v_src := case when s.fmcsa_email is not null then 'fmcsa' when t.parent_contact_email is not null then 'agent_supplied' else null end;
  end if;$q$;
  if position(v_old in v_def) = 0 then raise exception 'broker_parent_confirm_send: anchor missing'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- parent-side RPCs
create or replace function public.partner_agents_list()
returns jsonb
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  return jsonb_build_object(
    'agents', coalesce((select jsonb_agg(jsonb_build_object('org_id', o.id, 'name', o.name, 'email', u.email, 'since', o.created_at,
        'status', case when t.parent_declined_at is not null then 'declined' when t.parent_confirmed_at is not null then 'confirmed' else 'pending' end,
        'confirmed_at', t.parent_confirmed_at, 'declined_at', t.parent_declined_at, 'tier', app_private.broker_tier(o.id),
        'loads', (select count(*) from app_private.partner_loads pl where pl.broker_org = o.id),
        'open', (select count(*) from app_private.partner_loads pl where pl.broker_org = o.id and pl.status in ('submitted','accepted','posted')))
        order by (t.parent_confirmed_at is null and t.parent_declined_at is null) desc, o.created_at desc)
      from app_private.broker_trust t join public.organizations o on o.id = t.org_id join auth.users u on u.id = o.owner_user_id
      where t.is_agent and t.parent_org_id = v_org), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'name', i.name, 'status', i.status, 'created_at', i.created_at, 'accepted_at', i.accepted_at) order by i.created_at desc)
      from app_private.broker_agent_invites i where i.parent_org_id = v_org), '[]'::jsonb));
end $$;
revoke all on function public.partner_agents_list() from public, anon;
grant execute on function public.partner_agents_list() to authenticated;

create or replace function public.partner_agent_decide(p_agent_org uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; t app_private.broker_trust; v_who text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  if p_decision not in ('confirm','decline','revoke') then raise exception 'decision must be confirm, decline or revoke' using errcode='22023'; end if;
  select * into t from app_private.broker_trust where org_id = p_agent_org and is_agent and parent_org_id = v_org for update;
  if t.org_id is null then raise exception 'that agent is not linked to your brokerage' using errcode='42501'; end if;
  select u.email into v_who from auth.users u where u.id = auth.uid();
  if p_decision = 'confirm' then
    update app_private.broker_trust set parent_confirmed_at = now(), parent_confirmed_by = coalesce(v_who,'parent owner'), parent_declined_at = null, hold_reason = null, held_at = null, parent_note = left(nullif(trim(p_note),''),500), updated_at = now() where org_id = p_agent_org;
    perform app_private.notify_partner(p_agent_org, '✅ ' || (select name from public.organizations where id = v_org) || ' confirmed you', 'You can post loads under their authority now — up to 3 open postings until your first delivery.', 'success', '/app/partner/#post');
  else
    update app_private.broker_trust set parent_declined_at = now(), parent_confirmed_at = null, parent_confirmed_by = coalesce(v_who,'parent owner'), parent_note = left(nullif(trim(p_note),''),500),
      hold_reason = case when p_decision = 'revoke' then 'your brokerage revoked your agent access' else 'the brokerage you named said you are not their agent' end, held_at = now(), updated_at = now() where org_id = p_agent_org;
    perform app_private.notify_partner(p_agent_org, case when p_decision = 'revoke' then 'Your brokerage revoked your access' else 'Your brokerage declined the confirmation' end, 'Posting is on hold. Contact your brokerage or hello@loadboot.com.', 'urgent', '/app/partner/#onboarding');
    -- any open postings of a revoked agent are pulled
    if p_decision = 'revoke' then
      update public.loads l set status = 'cancelled' from app_private.partner_loads pl where pl.posted_load_id = l.id and pl.broker_org = p_agent_org and l.status = 'available';
      update app_private.partner_loads set status = 'cancelled', updated_at = now() where broker_org = p_agent_org and status in ('submitted','accepted','posted');
    end if;
  end if;
  perform app_private.log_audit('broker.parent_' || p_decision, 'org', p_agent_org::text, v_org, 'Parent decided via portal: ' || p_decision || coalesce(' — ' || p_note,''), null, null);
  return jsonb_build_object('ok', true, 'tier', app_private.broker_tier(p_agent_org));
end $$;
revoke all on function public.partner_agent_decide(uuid, text, text) from public, anon;
grant execute on function public.partner_agent_decide(uuid, text, text) to authenticated;

create or replace function public.partner_agent_invite(p_email text, p_name text default null)
returns jsonb
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; v_email text; v_name text; v_mc text; inv app_private.broker_agent_invites;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  if app_private.broker_tier(v_org) not in ('screened','verified') then raise exception 'confirm your own brokerage first, then invite agents' using errcode='42501'; end if;
  v_email := lower(trim(p_email));
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'enter a valid email' using errcode='22023'; end if;
  if (select count(*) from app_private.broker_agent_invites where parent_org_id = v_org and created_at > now() - interval '1 day') >= 20 then raise exception 'invite limit reached for today' using errcode='22023'; end if;
  select name, mc_number into v_name, v_mc from public.organizations where id = v_org;
  update app_private.broker_agent_invites set status = 'revoked' where parent_org_id = v_org and lower(email) = v_email and status = 'pending';
  insert into app_private.broker_agent_invites(parent_org_id, email, name, invited_by) values (v_org, v_email, nullif(trim(p_name),''), auth.uid()) returning * into inv;
  perform app_private.sys_email(v_email, 'broker.agent_invite',
    v_name || ' invited you to post loads on LoadBoot',
    '<h2 style="margin:0 0 10px;font-size:22px">' || v_name || ' invited you as their agent</h2>'
    || '<p style="font-size:15px;color:#334155">Create your LoadBoot account with <b>this email address</b>, choose <b>Broker Agent</b>, and enter their MC' || coalesce(' (MC-' || v_mc || ')','') || '. Because they invited you, you are confirmed automatically — no waiting.</p>'
    || '<p style="margin:18px 0"><a href="https://loadboot.com/app/partner/#signup" style="background:#0883F7;color:#fff;padding:13px 22px;border-radius:10px;text-decoration:none;font-weight:800">Create your agent account →</a></p>'
    || '<p style="font-size:12px;color:#94a3b8">Every load you post will show ' || v_name || '''s name and MC; rate confirmations must be on their paper.</p>',
    null, 'agentinvite:' || inv.id::text);
  return jsonb_build_object('ok', true, 'id', inv.id);
end $$;
revoke all on function public.partner_agent_invite(text, text) from public, anon;
grant execute on function public.partner_agent_invite(text, text) to authenticated;

create or replace function public.partner_agent_invite_revoke(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_org uuid;
begin
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  update app_private.broker_agent_invites set status = 'revoked' where id = p_id and parent_org_id = v_org and status = 'pending';
  return jsonb_build_object('ok', found);
end $$;
revoke all on function public.partner_agent_invite_revoke(uuid) from public, anon;
grant execute on function public.partner_agent_invite_revoke(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. portal-facing: identity in partner_trust_status + resend + "please call me"
-- ---------------------------------------------------------------------------
create or replace function public.partner_identity_resend()
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_org uuid;
begin
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  return app_private.broker_identity_send_email(v_org, true);
end $$;
revoke all on function public.partner_identity_resend() from public, anon;
grant execute on function public.partner_identity_resend() to authenticated;

create or replace function public.partner_identity_request_call(p_phone text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_org uuid; idn app_private.broker_identity; v_name text;
begin
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  select * into idn from app_private.broker_identity where org_id = v_org;
  select name into v_name from public.organizations where id = v_org;
  if idn.org_id is null then raise exception 'screen your MC first' using errcode='22023'; end if;
  if idn.status = 'verified' then return jsonb_build_object('ok', true, 'already', true); end if;
  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff','in_app','broker.identity_call', jsonb_build_object(
      'title', '📞 Broker asks for an identity call — ' || coalesce(v_name,'?'),
      'body', 'Call the FMCSA-listed number ' || coalesce(idn.fmcsa_phone,'(none on file)') || coalesce(' · they say reach them at ' || nullif(trim(p_phone),''),'') || coalesce(' · ' || nullif(trim(p_note),''),'') || ' — then Verify identity in Broker trust.',
      'tone','action','url','/app/command-center/#/broker-trust','org_id', v_org), 'sent', now());
  exception when others then null; end;
  update app_private.broker_identity set note = left(coalesce(note,'') || ' | call requested ' || to_char(now(),'YYYY-MM-DD HH24:MI') || coalesce(' ' || nullif(trim(p_phone),''),''), 500), updated_at = now() where org_id = v_org;
  perform app_private.notify_partner(v_org, '📞 Call requested', 'Our team will call the number on your FMCSA record' || coalesce(' (' || app_private.mask_phone(idn.fmcsa_phone) || ')','') || ' during business hours to confirm it is you.', 'info', '/app/partner/#onboarding');
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.partner_identity_request_call(text, text) from public, anon;
grant execute on function public.partner_identity_request_call(text, text) to authenticated;

-- partner_trust_status: add identity + parent_on_loadboot (surgery)
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='partner_trust_status';
  if v_def is null then raise exception 'partner_trust_status missing'; end if;
  if position('identity' in v_def) > 0 then raise notice 'partner_trust_status already patched'; return; end if;
  v_old := $q$    'hold_reason', t.hold_reason,$q$;
  v_new := $q$    'hold_reason', t.hold_reason,
    'identity', (select jsonb_build_object('status', i.status, 'method', i.method, 'fmcsa_email_masked', app_private.mask_email(i.fmcsa_email), 'fmcsa_phone_masked', app_private.mask_phone(i.fmcsa_phone),
                   'email_sent_at', i.email_sent_at, 'resends', i.email_resends, 'verified_at', i.verified_at, 'declined_at', i.declined_at, 'has_fmcsa_email', i.fmcsa_email is not null)
                 from app_private.broker_identity i where i.org_id = v_org),
    'parent_on_loadboot', (t.parent_org_id is not null),
    'parent_org_name', (select o2.name from public.organizations o2 where o2.id = t.parent_org_id),$q$;
  if position(v_old in v_def) = 0 then raise exception 'partner_trust_status: anchor missing'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- ---------------------------------------------------------------------------
-- 8. claim-confirm page RPCs (anon by token, same pattern as agent-confirm)
-- ---------------------------------------------------------------------------
create or replace function public.partner_claim_get(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare idn app_private.broker_identity; s app_private.broker_screenings; v_name text; v_owner text; v_since timestamptz;
begin
  if p_token is null then return jsonb_build_object('ok', false, 'error', 'missing token'); end if;
  select * into idn from app_private.broker_identity where email_token = p_token;
  if idn.org_id is null then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  select * into s from app_private.broker_screenings where org_id = idn.org_id;
  select o.name, u.email, o.created_at into v_name, v_owner, v_since from public.organizations o join auth.users u on u.id = o.owner_user_id where o.id = idn.org_id;
  return jsonb_build_object('ok', true, 'company', coalesce(s.legal_name, v_name), 'mc', s.mc_number, 'signup_email', v_owner, 'signup_at', v_since,
    'decided', idn.status <> 'pending', 'confirmed', idn.status = 'verified', 'declined', idn.status = 'declined');
end $$;

create or replace function public.partner_claim_confirm(p_token uuid, p_decision text, p_name text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare idn app_private.broker_identity; v_name text;
begin
  if p_token is null then raise exception 'missing token' using errcode='22023'; end if;
  if p_decision not in ('confirm','decline') then raise exception 'decision must be confirm or decline' using errcode='22023'; end if;
  select * into idn from app_private.broker_identity where email_token = p_token for update;
  if idn.org_id is null then raise exception 'This link is not valid.' using errcode='22023'; end if;
  if idn.status <> 'pending' then return jsonb_build_object('ok', true, 'already', true, 'confirmed', idn.status = 'verified'); end if;
  select name into v_name from public.organizations where id = idn.org_id;
  if p_decision = 'confirm' then
    update app_private.broker_identity set status = 'verified', method = 'email', verified_at = now(), verified_by = left(coalesce(nullif(trim(p_name),''),'FMCSA contact'),120), note = left(nullif(trim(p_note),''),500), updated_at = now() where org_id = idn.org_id;
    perform app_private.notify_partner(idn.org_id, '✅ Identity confirmed — you can post now', 'Your brokerage confirmed from the FMCSA-listed email. Accept the Master Broker Agreement and post your first load.', 'success', '/app/partner/#post');
  else
    update app_private.broker_identity set status = 'declined', declined_at = now(), verified_by = left(coalesce(nullif(trim(p_name),''),'FMCSA contact'),120), note = left(nullif(trim(p_note),''),500), updated_at = now() where org_id = idn.org_id;
    perform app_private.broker_trust_hold(idn.org_id, 'the brokerage''s FMCSA contact said this account is not theirs');
    perform app_private.notify_partner(idn.org_id, '⛔ Posting paused', 'The brokerage''s FMCSA-listed contact did not recognise this account. If this is a mistake, email hello@loadboot.com with proof you represent the brokerage.', 'urgent', '/app/partner/#onboarding');
  end if;
  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff','in_app','broker.identity_decided', jsonb_build_object(
      'title', case when p_decision='confirm' then '🟢 Brokerage confirmed identity — ' else '🚨 IMPERSONATION? FMCSA contact DECLINED — ' end || coalesce(v_name,'?'),
      'body', 'by ' || coalesce(nullif(trim(p_name),''),'(no name)') || coalesce(' · ' || nullif(trim(p_note),''),''),
      'tone', case when p_decision='confirm' then 'info' else 'urgent' end, 'url', '/app/command-center/#/broker-trust', 'org_id', idn.org_id), 'sent', now());
  exception when others then null; end;
  perform app_private.log_audit('broker.identity_' || p_decision, 'org', idn.org_id::text, idn.org_id, 'FMCSA contact ' || p_decision || 'ed via claim page', jsonb_build_object('by', p_name, 'note', p_note), null);
  return jsonb_build_object('ok', true, 'confirmed', p_decision = 'confirm');
end $$;
grant execute on function public.partner_claim_get(uuid) to anon, authenticated;
grant execute on function public.partner_claim_confirm(uuid, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. loads posted by an agent carry the PARENT's name + MC
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='app_private' and p.proname='trust_label_load';
  if v_def is null then raise exception 'trust_label_load missing'; end if;
  if position('NEW.broker :=' in v_def) > 0 then raise notice 'trust_label_load already patched'; return; end if;
  v_old := $q$  NEW.verification_state := 'partial';$q$;
  v_new := $q$  if v_name is not null then
    NEW.broker := v_name || coalesce(' · MC-' || t.parent_mc, '') || ' (agent: ' || coalesce((select name from public.organizations where id = NEW.broker_org), 'agent') || ')';
  end if;
  NEW.verification_state := 'partial';$q$;
  if position(v_old in v_def) = 0 then raise exception 'trust_label_load: anchor missing'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- ---------------------------------------------------------------------------
-- 10. CC queue: identity + parent link columns (surgery on 0312's queue)
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='cc_broker_trust_queue';
  if v_def is null then raise exception 'cc_broker_trust_queue missing'; end if;
  if position('identity_status' in v_def) > 0 then raise notice 'cc_broker_trust_queue already patched'; return; end if;
  v_old := $q$           t.hold_reason,$q$;
  v_new := $q$           t.hold_reason, t.parent_org_id, (select o2.name from public.organizations o2 where o2.id = t.parent_org_id) as parent_org_name,
           i.status as identity_status, i.method as identity_method, i.fmcsa_email as identity_fmcsa_email, i.fmcsa_phone as identity_fmcsa_phone,
           i.signup_email as identity_signup_email, i.email_sent_at as identity_email_sent_at, i.email_resends as identity_resends, i.verified_at as identity_verified_at, i.note as identity_note,$q$;
  if position(v_old in v_def) = 0 then raise exception 'cc_broker_trust_queue: anchor 1 missing'; end if;
  v_def := replace(v_def, v_old, v_new);
  v_old := $q$      left join app_private.broker_trust t on t.org_id = o.id$q$;
  v_new := $q$      left join app_private.broker_trust t on t.org_id = o.id
      left join app_private.broker_identity i on i.org_id = o.id$q$;
  if position(v_old in v_def) = 0 then raise exception 'cc_broker_trust_queue: anchor 2 missing'; end if;
  v_def := replace(v_def, v_old, v_new);
  v_def := replace(v_def, $q$case c.tier when 'agent_pending' then 0 when 'new' then 1$q$, $q$case c.tier when 'agent_pending' then 0 when 'unclaimed' then 0 when 'new' then 1$q$);
  execute v_def;
end $$;

-- ---------------------------------------------------------------------------
-- 11. screening by USDOT: the collector resolves the MC from the FMCSA answer, records it on the
--     org (one-MC-one-org still enforced) — the portal accepts "MC 123456" or "USDOT 2228065"
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='app_private' and p.proname='broker_screen_collect';
  if position('resolved_mc' in v_def) > 0 then raise notice 'collector DOT patch already applied'; return; end if;
  v_old := $q$    select name into v_org_name from public.organizations where id = r.org_id;
    select * into t from app_private.broker_trust where org_id = r.org_id;$q$;
  v_new := $q$    select name into v_org_name from public.organizations where id = r.org_id;
    select * into t from app_private.broker_trust where org_id = r.org_id;
    -- bl_bp_0313: screened by USDOT → take the MC FMCSA returned (own-MC path only)
    if r.mc_number is null and car is not null and not coalesce(t.is_agent,false) then
      declare resolved_mc text; v_holder uuid; v_holder_name text;
      begin
        resolved_mc := nullif(regexp_replace(coalesce(nullif(car->>'mcNumber',''), nullif(car->>'docketFromCensus',''), nullif(car->>'mcFromSafer',''), ''), '\D', '', 'g'), '');
        if resolved_mc is not null then
          v_holder := app_private.mc_owner_org(resolved_mc, r.org_id);
          if v_holder is not null then
            select name into v_holder_name from public.organizations where id = v_holder;
            v_out := 'fail';
            v_reason := 'MC-' || resolved_mc || ' is already registered on LoadBoot by ' || coalesce(v_holder_name,'another account') || '. If that is your company, ask the account owner to invite you under Agents & team.';
            update app_private.broker_screenings set outcome = v_out, reason = v_reason, updated_at = now() where org_id = r.org_id;
            perform app_private.notify_partner(v_holder, '⚠ Someone tried to register your MC', coalesce(v_org_name,'A new signup') || ' screened USDOT ' || coalesce(r.dot_number,'?') || ' which resolves to your MC-' || resolved_mc || '. If that is a colleague, invite them from Agents & team.', 'warning', '/app/partner/#agents');
          else
            update app_private.broker_screenings set mc_number = resolved_mc, updated_at = now() where org_id = r.org_id;
            update public.organizations set mc_number = resolved_mc where id = r.org_id and mc_number is null;
            r.mc_number := resolved_mc;
          end if;
        end if;
      end;
    end if;$q$;
  if position(v_old in v_def) = 0 then raise exception 'broker_screen_collect: DOT anchor missing'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- partner_broker_screen: DOT-only screening allowed (MC optional) — the org gets its MC from the collector
-- (the 0313 body above already passes p_dot through; nothing else to change)

-- ---------------------------------------------------------------------------
-- 12. ACL re-check
-- ---------------------------------------------------------------------------
do $$
declare r record; bad text := '';
begin
  for r in select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('partner_broker_screen','partner_agent_declare','partner_trust_status','cc_broker_trust_queue','cc_broker_trust_set',
                                'partner_agents_list','partner_agent_decide','partner_agent_invite','partner_agent_invite_revoke','partner_identity_resend','partner_identity_request_call')
              and has_function_privilege('anon', p.oid, 'execute')
  loop bad := bad || r.proname || ' '; end loop;
  if bad <> '' then raise exception 'ACL leak: anon can execute %', bad; end if;
end $$;
