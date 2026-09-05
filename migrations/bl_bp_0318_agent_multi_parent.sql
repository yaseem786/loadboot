-- bl_bp_0318 — One agent account, many brokerages. Email CODE confirmation. No calls in the agent path.
--
-- Yaseen, 4 Sep: "agr ak agent 1 se zyada brokerage k sath work kar raha ho to?" and "email mein code jaye, brokerage agent
-- ko code de, agent paste kare" and "call wala na karo". So:
--   • app_private.agent_parents — one row per (agent org, brokerage MC). Each row is screened on FMCSA and confirmed on
--     its own. broker_trust.parent_* keeps mirroring the PRIMARY row (earliest confirmed, else latest) so every older
--     reader (CC queue, can_post reasons, rescreen) keeps working unchanged.
--   • Confirmation chain, all automated, staff only at the very end:
--       1. brokerage already on LoadBoot → its owner approves under Agents & team (email + in-app, with the code too)
--       2. FMCSA-listed email → link AND a 6-digit code (7 days). The brokerage hands the code to the agent; the agent
--          types it on the dashboard. Whoever controls that inbox is the brokerage — same proof as the link.
--       3. an agent-supplied address on the SAME DOMAIN as the FMCSA email also gets the code (domain = proof); any
--          other address is ignored (never a Gmail typed by the agent)
--       4. FMCSA lists no email → the agent is told the record is outdated: the brokerage updates it on Ask FMCSA
--          (MCS-150, free) and re-checks; last resort "ask our team" with an agent agreement
--     The automated phone call is no longer offered for parent confirmation (identity path keeps it).
--   • Loads: the agent picks which brokerage a load posts under (details.agent_parent_id); label, MC and the 3/10
--     posting limit are per brokerage. Revoke by one brokerage pulls only the loads under that brokerage.
--   • Old links (agent-confirm.html?t=) keep working — tokens are migrated onto the new rows.

-- ---------------------------------------------------------------------------
-- 0. schema
-- ---------------------------------------------------------------------------
alter table app_private.verify_codes add column if not exists channel text not null default 'call';
alter table app_private.verify_codes add column if not exists parent_id uuid;
alter table app_private.verify_codes add column if not exists to_email text;
alter table app_private.verify_codes alter column to_number drop not null;

create table if not exists app_private.agent_parents (
  id                 uuid primary key default gen_random_uuid(),
  agent_org          uuid not null references public.organizations(id) on delete cascade,
  parent_mc          text not null,
  parent_legal_name  text,
  parent_org_id      uuid references public.organizations(id) on delete set null,
  -- FMCSA screening snapshot for this MC (taken from the agent org's screening row when it lands)
  screen_outcome     text,
  screen_reason      text,
  screen_source      text,
  screened_at        timestamptz,
  fmcsa_legal_name   text,
  fmcsa_email        text,
  fmcsa_phone        text,
  -- who gets the confirmation
  contact_email      text,              -- agent-supplied; used ONLY when its domain matches the FMCSA email
  contact_source     text check (contact_source in ('fmcsa','domain','loadboot','staff','invite')),
  confirm_token      uuid not null default gen_random_uuid(),
  sent_to            text,
  sent_at            timestamptz,
  reminded_at        timestamptz,
  confirmed_at       timestamptz,
  confirmed_by       text,
  declined_at        timestamptz,
  revoked_at         timestamptz,
  revoked_by         text,
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (agent_org, parent_mc)
);
create unique index if not exists agent_parents_token_idx on app_private.agent_parents(confirm_token);
create index if not exists agent_parents_parent_org_idx on app_private.agent_parents(parent_org_id) where parent_org_id is not null;

-- migrate every existing agent (one parent each) — keeps the old confirm token so emailed links still work
insert into app_private.agent_parents (agent_org, parent_mc, parent_legal_name, parent_org_id, screen_outcome, screen_reason, screen_source, screened_at,
  fmcsa_legal_name, fmcsa_email, fmcsa_phone, contact_email, contact_source, confirm_token, sent_to, sent_at, reminded_at, confirmed_at, confirmed_by, declined_at, note, created_at)
select t.org_id, t.parent_mc, t.parent_legal_name, t.parent_org_id, s.outcome, s.reason, s.authority_source, s.checked_at,
       s.legal_name, s.fmcsa_email, s.phone,
       case when t.parent_contact_source = 'agent_supplied' then t.parent_contact_email end,
       case t.parent_contact_source when 'fmcsa' then 'fmcsa' when 'staff' then case when t.parent_org_id is not null then 'loadboot' else 'staff' end when 'agent_supplied' then null else null end,
       coalesce(t.parent_confirm_token, gen_random_uuid()), t.parent_contact_email, t.parent_confirm_sent_at, t.parent_reminded_at,
       t.parent_confirmed_at, t.parent_confirmed_by, t.parent_declined_at, t.parent_note, coalesce(t.updated_at, now())
  from app_private.broker_trust t
  left join app_private.broker_screenings s on s.org_id = t.org_id
 where t.is_agent and t.parent_mc is not null
on conflict (agent_org, parent_mc) do nothing;

-- ---------------------------------------------------------------------------
-- 1. helpers
-- ---------------------------------------------------------------------------
-- the row older readers see through broker_trust.parent_*: earliest confirmed live row, else the latest one
create or replace function app_private.agent_primary_parent(p_org uuid)
returns app_private.agent_parents language sql stable security definer set search_path to 'app_private, public' as $$
  select * from app_private.agent_parents ap where ap.agent_org = p_org and ap.revoked_at is null
   order by (ap.confirmed_at is not null and ap.declined_at is null) desc, ap.confirmed_at asc nulls last, ap.created_at desc limit 1;
$$;

create or replace function app_private.agent_sync_primary(p_org uuid)
returns void language plpgsql security definer set search_path to 'app_private, public' as $$
declare ap app_private.agent_parents;
begin
  ap := app_private.agent_primary_parent(p_org);
  if ap.id is null then return; end if;
  update app_private.broker_trust set is_agent = true, parent_mc = ap.parent_mc, parent_legal_name = coalesce(ap.fmcsa_legal_name, ap.parent_legal_name),
         parent_contact_email = coalesce(ap.sent_to, ap.fmcsa_email, ap.contact_email),
         parent_contact_source = case when ap.contact_source = 'fmcsa' then 'fmcsa' when ap.contact_source = 'domain' then 'agent_supplied' when ap.contact_source is null then parent_contact_source else 'staff' end,
         parent_org_id = ap.parent_org_id, parent_confirm_token = ap.confirm_token,
         parent_confirm_sent_at = ap.sent_at, parent_reminded_at = ap.reminded_at,
         parent_confirmed_at = ap.confirmed_at, parent_confirmed_by = ap.confirmed_by, parent_declined_at = ap.declined_at, parent_note = ap.note,
         updated_at = now()
   where org_id = p_org;
end $$;

create or replace function app_private.agent_parent_display(ap app_private.agent_parents)
returns text language sql immutable as $$
  select coalesce(ap.fmcsa_legal_name, ap.parent_legal_name, 'brokerage') || coalesce(' · MC-' || ap.parent_mc, '');
$$;

-- confirm / decline / revoke, one place — every path (code, link, parent portal, invite, staff) ends here
create or replace function app_private.agent_parent_confirm(p_id uuid, p_by text, p_note text default null)
returns void language plpgsql security definer set search_path to 'app_private, public' as $$
declare ap app_private.agent_parents; v_agent text; v_first boolean;
begin
  select * into ap from app_private.agent_parents where id = p_id for update;
  if ap.id is null then return; end if;
  v_first := not exists (select 1 from app_private.agent_parents x where x.agent_org = ap.agent_org and x.confirmed_at is not null and x.revoked_at is null and x.id <> ap.id);
  update app_private.agent_parents set confirmed_at = now(), confirmed_by = left(coalesce(nullif(trim(p_by),''),'brokerage contact'),120),
         declined_at = null, revoked_at = null, revoked_by = null, note = coalesce(left(nullif(trim(p_note),''),500), note), updated_at = now() where id = p_id;
  update app_private.verify_codes set consumed_at = coalesce(consumed_at, now()) where parent_id = p_id and consumed_at is null;
  -- a decline hold on this account lifts when a brokerage confirms
  update app_private.broker_trust set hold_reason = null, held_at = null, updated_at = now()
   where org_id = ap.agent_org and hold_reason like 'the brokerage you named%';
  perform app_private.agent_sync_primary(ap.agent_org);
  select name into v_agent from public.organizations where id = ap.agent_org;
  perform app_private.notify_partner(ap.agent_org, '✅ ' || coalesce(ap.fmcsa_legal_name, ap.parent_legal_name, 'Your brokerage') || ' confirmed you',
    'You can post under ' || app_private.agent_parent_display(ap) || ' now — up to 3 open postings under them until your first delivery.' ||
    case when v_first then ' Accept the Master Broker Agreement if you have not yet.' else '' end, 'success', '/app/partner/#post');
  if ap.parent_org_id is not null then
    perform app_private.notify_partner(ap.parent_org_id, '🤝 Agent confirmed', coalesce(v_agent,'An agent') || ' is now posting under your authority (' || coalesce(p_by,'') || '). Revoke any time under Agents & team.', 'info', '/app/partner/#agents');
  end if;
  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff','in_app','broker.parent_decided', jsonb_build_object('title', '🤝 Brokerage CONFIRMED agent — ' || coalesce(v_agent,'?'),
      'body', app_private.agent_parent_display(ap) || ' · by ' || coalesce(p_by,'?') || coalesce(' · ' || nullif(trim(p_note),''),''), 'tone','info', 'url','/app/command-center/#/broker-trust', 'org_id', ap.agent_org), 'sent', now());
  exception when others then null; end;
  perform app_private.log_audit('broker.parent_confirm', 'org', ap.agent_org::text, ap.agent_org, app_private.agent_parent_display(ap) || ' confirmed by ' || coalesce(p_by,'?'), jsonb_build_object('parent_id', ap.id, 'note', p_note), null);
end $$;

create or replace function app_private.agent_parent_decline(p_id uuid, p_by text, p_note text default null, p_revoke boolean default false)
returns void language plpgsql security definer set search_path to 'app_private, public' as $$
declare ap app_private.agent_parents; v_agent text; v_others boolean;
begin
  select * into ap from app_private.agent_parents where id = p_id for update;
  if ap.id is null then return; end if;
  if p_revoke then
    update app_private.agent_parents set revoked_at = now(), revoked_by = left(coalesce(nullif(trim(p_by),''),'brokerage'),120), note = coalesce(left(nullif(trim(p_note),''),500), note), updated_at = now() where id = p_id;
  else
    update app_private.agent_parents set declined_at = now(), confirmed_at = null, confirmed_by = left(coalesce(nullif(trim(p_by),''),'brokerage contact'),120), note = coalesce(left(nullif(trim(p_note),''),500), note), updated_at = now() where id = p_id;
  end if;
  update app_private.verify_codes set consumed_at = coalesce(consumed_at, now()) where parent_id = p_id and consumed_at is null;
  -- loads posted under THIS brokerage come down; other brokerages' loads stay
  update public.loads l set status = 'cancelled' from app_private.partner_loads pl
   where pl.posted_load_id = l.id and pl.broker_org = ap.agent_org and l.status = 'available' and pl.details->>'agent_parent_id' = ap.id::text;
  update app_private.partner_loads set status = 'cancelled', updated_at = now()
   where broker_org = ap.agent_org and status in ('submitted','accepted','posted') and details->>'agent_parent_id' = ap.id::text;
  v_others := exists (select 1 from app_private.agent_parents x where x.agent_org = ap.agent_org and x.confirmed_at is not null and x.declined_at is null and x.revoked_at is null and x.id <> ap.id);
  -- "not our agent" is a fraud signal → the whole account holds; a revoke only closes that brokerage
  if not p_revoke then
    perform app_private.broker_trust_hold(ap.agent_org, 'the brokerage you named said you are not their agent');
  end if;
  perform app_private.agent_sync_primary(ap.agent_org);
  select name into v_agent from public.organizations where id = ap.agent_org;
  perform app_private.notify_partner(ap.agent_org,
    case when p_revoke then app_private.agent_parent_display(ap) || ' revoked your access' else app_private.agent_parent_display(ap) || ' declined the confirmation' end,
    case when p_revoke then 'Open postings under them were cancelled.' || case when v_others then ' Your other brokerages are not affected.' else '' end
         else 'Posting is on hold. If this is a mistake, contact hello@loadboot.com with your agent agreement.' end,
    'urgent', '/app/partner/#onboarding');
  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff','in_app','broker.parent_decided', jsonb_build_object('title', case when p_revoke then '⛔ Brokerage REVOKED agent — ' else '🚨 Brokerage DECLINED agent (impersonation?) — ' end || coalesce(v_agent,'?'),
      'body', app_private.agent_parent_display(ap) || ' · by ' || coalesce(p_by,'?') || coalesce(' · ' || nullif(trim(p_note),''),''), 'tone', 'urgent', 'url','/app/command-center/#/broker-trust', 'org_id', ap.agent_org), 'sent', now());
  exception when others then null; end;
  perform app_private.log_audit(case when p_revoke then 'broker.parent_revoke' else 'broker.parent_decline' end, 'org', ap.agent_org::text, ap.agent_org, app_private.agent_parent_display(ap) || ' by ' || coalesce(p_by,'?'), jsonb_build_object('parent_id', ap.id, 'note', p_note), null);
end $$;

-- ---------------------------------------------------------------------------
-- 2. tier: an agent is confirmed when ANY brokerage confirmed them, pending when a brokerage screened and is deciding
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
  if coalesce(t.is_agent, false) then
    -- bl_bp_0318: per-brokerage rows
    if exists (select 1 from app_private.agent_parents ap where ap.agent_org = p_org and ap.confirmed_at is not null and ap.declined_at is null and ap.revoked_at is null) then return 'agent_confirmed'; end if;
    if exists (select 1 from app_private.agent_parents ap where ap.agent_org = p_org and ap.screen_outcome = 'pass' and ap.declined_at is null and ap.revoked_at is null) then return 'agent_pending'; end if;
    return 'new';
  end if;
  select * into s from app_private.broker_screenings where org_id = p_org;
  if s.org_id is null or s.outcome <> 'pass' then return 'new'; end if;
  select * into idn from app_private.broker_identity where org_id = p_org;
  if idn.org_id is null or idn.status <> 'verified' then return 'unclaimed'; end if;
  return 'screened';
end $$;

-- ---------------------------------------------------------------------------
-- 3. the confirmation email: link + CODE, to the FMCSA-listed address (or the LoadBoot owner, or a same-domain address)
-- ---------------------------------------------------------------------------
create or replace function app_private.broker_parent_confirm_send_p(p_id uuid, p_reminder boolean default false)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare ap app_private.agent_parents; v_agent text; v_agent_email text; v_to text[]; v_src text; v_code text; v_hash text;
        v_url text; v_html text; v_disp text; e text; v_fmcsa_dom text; v_owner text;
begin
  select * into ap from app_private.agent_parents where id = p_id for update;
  if ap.id is null then return jsonb_build_object('sent', false, 'why', 'no such brokerage row'); end if;
  if ap.confirmed_at is not null or ap.declined_at is not null or ap.revoked_at is not null then return jsonb_build_object('sent', false, 'why', 'already decided'); end if;
  if ap.screen_outcome is distinct from 'pass' then return jsonb_build_object('sent', false, 'why', 'FMCSA screening has not passed for this MC yet'); end if;
  if not p_reminder and ap.sent_at is not null and ap.sent_at > now() - interval '10 minutes' then return jsonb_build_object('sent', false, 'why', 'sent less than 10 minutes ago', 'to', ap.sent_to); end if;
  select o.name, lower(u.email) into v_agent, v_agent_email from public.organizations o join auth.users u on u.id = o.owner_user_id where o.id = ap.agent_org;
  v_disp := app_private.agent_parent_display(ap);
  v_to := array[]::text[];
  if ap.parent_org_id is not null then
    select lower(u.email) into v_owner from public.organizations o join auth.users u on u.id = o.owner_user_id where o.id = ap.parent_org_id;
    if v_owner is not null then v_to := v_to || v_owner; end if;
    v_src := 'loadboot';
    perform app_private.notify_partner(ap.parent_org_id, '🤝 An agent wants to post under your authority',
      coalesce(v_agent,'Someone') || ' says they are your agent. Approve or decline under Agents & team — nothing they post can be booked until you do.', 'action', '/app/partner/#agents');
  end if;
  if ap.fmcsa_email is not null and not (ap.fmcsa_email = any(v_to)) then v_to := v_to || ap.fmcsa_email; v_src := coalesce(v_src, 'fmcsa'); end if;
  -- an agent-supplied address counts only on the FMCSA email's own domain (never a free-mail domain)
  v_fmcsa_dom := lower(split_part(coalesce(ap.fmcsa_email,''), '@', 2));
  if ap.contact_email is not null and v_fmcsa_dom <> '' and lower(split_part(ap.contact_email,'@',2)) = v_fmcsa_dom
     and v_fmcsa_dom not in ('gmail.com','yahoo.com','outlook.com','hotmail.com','aol.com','icloud.com','live.com','msn.com','protonmail.com','proton.me','ymail.com','me.com','comcast.net','att.net','sbcglobal.net','verizon.net')
     and not (lower(ap.contact_email) = any(v_to)) then
    v_to := v_to || lower(ap.contact_email); v_src := coalesce(v_src, 'domain');
  end if;
  if coalesce(array_length(v_to,1),0) = 0 then
    update app_private.agent_parents set contact_source = null, updated_at = now() where id = ap.id;
    perform app_private.notify_partner(ap.agent_org, '⚠ FMCSA lists no email for ' || coalesce(ap.fmcsa_legal_name, ap.parent_legal_name, 'that brokerage'),
      'We can only confirm you through the contact on their FMCSA record, and that record has no email. Ask the brokerage to update it on Ask FMCSA (MCS-150 update, free, a few minutes) — then press Re-check. Or give us an address on their company domain' ||
      case when v_fmcsa_dom <> '' then ' (@' || v_fmcsa_dom || ')' else '' end || '. Otherwise the brokerage can create its own LoadBoot account and invite you.', 'warning', '/app/partner/#onboarding');
    return jsonb_build_object('sent', false, 'why', 'FMCSA lists no email for this brokerage', 'no_contact', true);
  end if;
  -- fresh 6-digit code, 7 days; older unconsumed email codes for this brokerage expire now
  update app_private.verify_codes set expires_at = now() where parent_id = ap.id and channel = 'email' and consumed_at is null and expires_at > now();
  declare b bytea := extensions.gen_random_bytes(4); begin
    v_code := lpad(((get_byte(b,0)::bigint * 16777216 + get_byte(b,1) * 65536 + get_byte(b,2) * 256 + get_byte(b,3)) % 1000000)::text, 6, '0');
  end;
  v_hash := encode(extensions.digest(v_code || ':' || ap.agent_org::text, 'sha256'), 'hex');
  insert into app_private.verify_codes (org_id, purpose, channel, parent_id, to_email, code_hash, expires_at, created_by)
  values (ap.agent_org, 'parent', 'email', ap.id, array_to_string(v_to, ', '), v_hash, now() + interval '7 days', null);
  v_url := 'https://loadboot.com/agent-confirm.html?t=' || ap.confirm_token::text;
  v_html :=
    '<h2 style="margin:0 0 10px;font-size:22px">Does ' || coalesce(v_agent,'this person') || ' post freight under your authority?</h2>'
    || '<p style="font-size:15px;color:#334155">' || coalesce(v_agent,'An agent') || ' (' || coalesce(v_agent_email,'') || ') has asked to post loads on LoadBoot as an agent of <b>'
    || coalesce(ap.fmcsa_legal_name, ap.parent_legal_name, 'your brokerage') || '</b>' || coalesce(' (MC-' || ap.parent_mc || ')','') || '. Every load they post will carry your name and MC, and the rate confirmation must be on your paper.</p>'
    || '<p style="font-size:15px;color:#334155"><b>If they are your agent</b>, give them this one-time code — they type it in their LoadBoot dashboard and are confirmed on the spot:</p>'
    || '<p style="margin:14px 0;font-size:34px;letter-spacing:.35em;font-weight:900;color:#10223B;font-family:ui-monospace,Menlo,monospace">' || v_code || '</p>'
    || '<p style="font-size:13px;color:#64748b">Valid 7 days. Or decide with one click — no account needed:</p>'
    || '<p style="margin:14px 0 20px"><a href="' || v_url || '" style="background:#0883F7;color:#fff;padding:13px 22px;border-radius:10px;text-decoration:none;font-weight:800">Review, confirm or decline →</a></p>'
    || '<p style="font-size:12px;color:#94a3b8">This email went to ' || case v_src when 'loadboot' then 'the owner of your LoadBoot account' when 'fmcsa' then 'the address on your FMCSA registration' else 'an address on your company domain' end
    || '. <b>If you do not know this person, do not share the code</b> — open the link and choose "Not our agent"; that blocks them. Nothing they post can be booked until you decide.</p>';
  foreach e in array v_to loop
    perform app_private.sys_email(e, 'broker.parent_confirm',
      case when p_reminder then 'Reminder: ' else '' end || 'Confirm your agent on LoadBoot — ' || coalesce(v_agent,''),
      v_html, null, 'agentconfirm:' || ap.id::text || ':' || case when p_reminder then 'r' else '1' end || ':' || md5(e));
  end loop;
  update app_private.agent_parents
     set sent_to = array_to_string(v_to, ', '), sent_at = case when p_reminder then coalesce(sent_at, now()) else now() end,
         reminded_at = case when p_reminder then now() else reminded_at end,
         contact_source = coalesce(v_src, contact_source), updated_at = now()
   where id = ap.id;
  perform app_private.agent_sync_primary(ap.agent_org);
  perform app_private.notify_partner(ap.agent_org, case when p_reminder then '📧 Reminder sent to ' else '📧 Confirmation sent to ' end || coalesce(ap.fmcsa_legal_name, ap.parent_legal_name, 'your brokerage'),
    'We emailed ' || array_to_string((select array_agg(app_private.mask_email(x)) from unnest(v_to) x), ' and ') || ' a 6-digit code and a confirm link. Ask them for the code and type it on your dashboard — you are confirmed the moment it matches.', 'info', '/app/partner/#onboarding');
  return jsonb_build_object('sent', true, 'to', (select array_agg(app_private.mask_email(x)) from unnest(v_to) x), 'source', v_src);
end $$;

-- old signature = "the latest undecided brokerage of this agent" (collector / staff callers)
create or replace function app_private.broker_parent_confirm_send(p_org uuid, p_reminder boolean default false)
returns void language plpgsql security definer set search_path to 'app_private, public' as $$
declare r record;
begin
  for r in select id from app_private.agent_parents where agent_org = p_org and confirmed_at is null and declined_at is null and revoked_at is null and screen_outcome = 'pass' order by created_at desc loop
    perform app_private.broker_parent_confirm_send_p(r.id, p_reminder);
  end loop;
end $$;

-- the collector's hand-off: copy the screening result onto the matching brokerage row, then start the confirmation
create or replace function app_private.agent_parent_screened(p_org uuid)
returns void language plpgsql security definer set search_path to 'app_private, public' as $$
declare s app_private.broker_screenings; ap app_private.agent_parents; v_mc text;
begin
  select * into s from app_private.broker_screenings where org_id = p_org;
  if s.org_id is null or s.outcome is null or s.outcome = 'pending' then return; end if;
  v_mc := nullif(regexp_replace(coalesce(s.mc_number,''), '\D', '', 'g'), '');
  select * into ap from app_private.agent_parents where agent_org = p_org and parent_mc = v_mc and revoked_at is null order by created_at desc limit 1;
  if ap.id is null then return; end if;
  update app_private.agent_parents
     set screen_outcome = s.outcome, screen_reason = s.reason, screen_source = s.authority_source, screened_at = coalesce(s.checked_at, now()),
         fmcsa_legal_name = coalesce(s.legal_name, fmcsa_legal_name), fmcsa_email = coalesce(s.fmcsa_email, fmcsa_email), fmcsa_phone = coalesce(s.phone, fmcsa_phone),
         parent_org_id = coalesce(app_private.mc_owner_org(v_mc, p_org), parent_org_id), updated_at = now()
   where id = ap.id returning * into ap;
  perform app_private.agent_sync_primary(p_org);
  if s.outcome = 'pass' and ap.confirmed_at is null and ap.declined_at is null and ap.contact_source = 'invite' then
    -- invited from Agents & team: the invite IS the brokerage's decision
    perform app_private.agent_parent_confirm(ap.id, 'invite', 'invited by the brokerage from Agents & team');
  elsif s.outcome = 'pass' and ap.confirmed_at is null and ap.declined_at is null then
    perform app_private.broker_parent_confirm_send_p(ap.id, false);
  elsif s.outcome = 'fail' then
    perform app_private.notify_partner(p_org, 'Brokerage check did not pass — ' || app_private.agent_parent_display(ap), coalesce(s.reason,''), 'warning', '/app/partner/#onboarding');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. agent side: add / re-check a brokerage, remove one, resend the email, enter the code
-- ---------------------------------------------------------------------------
create or replace function public.partner_agent_declare(p_parent_mc text, p_parent_company text, p_contact_email text default null)
returns jsonb
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; v_mc text; v_email text; v_parent uuid; v_parent_name text; v_me text; inv app_private.broker_agent_invites; ap app_private.agent_parents; s app_private.broker_screenings; r jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  v_mc := nullif(regexp_replace(coalesce(p_parent_mc,''), '[^0-9]', '', 'g'), '');
  if v_mc is null then raise exception 'the brokerage MC number is required' using errcode='22023'; end if;
  v_email := nullif(lower(trim(p_contact_email)),'');
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'contact email looks wrong' using errcode='22023'; end if;
  if (select count(*) from app_private.agent_parents where agent_org = v_org and revoked_at is null) >= 10
     and not exists (select 1 from app_private.agent_parents where agent_org = v_org and parent_mc = v_mc) then
    raise exception 'up to 10 brokerages per agent account' using errcode='22023'; end if;
  select * into s from app_private.broker_screenings where org_id = v_org;
  if s.request_id is not null and s.requested_at > now() - interval '3 minutes' and s.mc_number is distinct from v_mc then
    raise exception 'a brokerage check is still running — give it a minute, then add the next one' using errcode='22023'; end if;
  if exists (select 1 from app_private.agent_parents where agent_org = v_org and parent_mc = v_mc and declined_at is not null) then
    raise exception 'that brokerage said you are not their agent — contact hello@loadboot.com with your agent agreement' using errcode='42501'; end if;
  v_parent := app_private.mc_owner_org(v_mc, v_org);
  if v_parent is not null then select name into v_parent_name from public.organizations where id = v_parent; end if;
  insert into app_private.broker_trust(org_id, is_agent) values (v_org, true)
  on conflict (org_id) do update set is_agent = true, updated_at = now();
  insert into app_private.agent_parents(agent_org, parent_mc, parent_legal_name, parent_org_id, contact_email)
  values (v_org, v_mc, coalesce(v_parent_name, nullif(trim(p_parent_company),'')), v_parent, v_email)
  on conflict (agent_org, parent_mc) do update
    set parent_legal_name = coalesce(app_private.agent_parents.parent_legal_name, excluded.parent_legal_name),
        parent_org_id = coalesce(excluded.parent_org_id, app_private.agent_parents.parent_org_id),
        contact_email = coalesce(excluded.contact_email, app_private.agent_parents.contact_email),
        revoked_at = null, revoked_by = null, screen_outcome = null, screen_reason = null, updated_at = now()
  returning * into ap;
  perform app_private.log_audit('broker.agent_declared','org', v_org::text, v_org,
    'Declared as agent of MC-' || v_mc || coalesce(' ' || nullif(trim(p_parent_company),''),'') || case when v_parent is not null then ' (parent is on LoadBoot: ' || v_parent::text || ')' else '' end, null, null);
  -- invited by this brokerage? confirmed the moment the screening passes (or right now if already screened)
  if v_parent is not null then
    select u.email into v_me from auth.users u where u.id = auth.uid();
    select * into inv from app_private.broker_agent_invites where parent_org_id = v_parent and status = 'pending' and lower(email) = lower(coalesce(v_me,'')) order by created_at desc limit 1;
    if inv.id is not null then
      update app_private.broker_agent_invites set status = 'accepted', accepted_at = now(), agent_org_id = v_org where id = inv.id;
      update app_private.agent_parents set contact_source = 'invite', updated_at = now() where id = ap.id;
      perform app_private.notify_partner(v_parent, '🤝 Your invited agent joined', coalesce(v_me,'') || ' created their agent account under your authority.', 'success', '/app/partner/#agents');
    end if;
  end if;
  r := app_private.broker_screen_request(v_org, v_mc, null);
  return coalesce(r, '{}'::jsonb) || jsonb_build_object('parent_id', ap.id);
end $$;
revoke all on function public.partner_agent_declare(text, text, text) from public, anon;
grant execute on function public.partner_agent_declare(text, text, text) to authenticated;

create or replace function public.partner_agent_parent_remove(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_org uuid; ap app_private.agent_parents;
begin
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  select * into ap from app_private.agent_parents where id = p_id and agent_org = v_org for update;
  if ap.id is null then raise exception 'not your brokerage row' using errcode='42501'; end if;
  if ap.confirmed_at is not null and ap.revoked_at is null then
    -- leaving a brokerage: its open loads come down, the row stays as history
    perform app_private.agent_parent_decline(ap.id, 'agent (left the brokerage)', null, true);
    update app_private.agent_parents set revoked_by = 'agent', updated_at = now() where id = ap.id;
  else
    delete from app_private.verify_codes where parent_id = ap.id;
    delete from app_private.agent_parents where id = ap.id;
    perform app_private.agent_sync_primary(v_org);
  end if;
  return jsonb_build_object('ok', true, 'tier', app_private.broker_tier(v_org));
end $$;
revoke all on function public.partner_agent_parent_remove(uuid) from public, anon;
grant execute on function public.partner_agent_parent_remove(uuid) to authenticated;

create or replace function public.partner_agent_parent_resend(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_org uuid; ap app_private.agent_parents; n int;
begin
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  select * into ap from app_private.agent_parents where id = p_id and agent_org = v_org;
  if ap.id is null then raise exception 'not your brokerage row' using errcode='42501'; end if;
  select count(*) into n from app_private.verify_codes where parent_id = ap.id and created_at > now() - interval '24 hours';
  if n >= 5 then return jsonb_build_object('sent', false, 'why', 'Five emails in 24 hours is the limit — try tomorrow, or ask the brokerage to check spam.'); end if;
  return app_private.broker_parent_confirm_send_p(ap.id, true);
end $$;
revoke all on function public.partner_agent_parent_resend(uuid) from public, anon;
grant execute on function public.partner_agent_parent_resend(uuid) to authenticated;

-- the code box: matches the newest live code of this account (email codes for any brokerage, or an identity call code)
create or replace function public.partner_verify_code(p_code text)
returns jsonb
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; vc app_private.verify_codes; v_code text; v_hash text; v_name text; ap app_private.agent_parents; v_n int := 0; v_hit boolean := false;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  v_code := regexp_replace(coalesce(p_code,''), '\D', '', 'g');
  if length(v_code) <> 6 then return jsonb_build_object('ok', false, 'why', 'Enter the 6-digit code.'); end if;
  v_hash := encode(extensions.digest(v_code || ':' || v_org::text, 'sha256'), 'hex');
  for vc in select * from app_private.verify_codes where org_id = v_org and consumed_at is null and expires_at > now() and attempts < 5 order by created_at desc for update loop
    v_n := v_n + 1;
    if vc.code_hash = v_hash then v_hit := true; exit; end if;
  end loop;
  if v_n = 0 then
    if exists (select 1 from app_private.verify_codes where org_id = v_org and consumed_at is null and attempts >= 5 and expires_at > now()) then
      return jsonb_build_object('ok', false, 'why', 'Too many wrong attempts — ask for a new email (Resend).'); end if;
    return jsonb_build_object('ok', false, 'why', 'No live code for this account — send the confirmation email first, or it expired (7 days).');
  end if;
  if not v_hit then
    update app_private.verify_codes set attempts = attempts + 1 where org_id = v_org and consumed_at is null and expires_at > now() and attempts < 5;
    return jsonb_build_object('ok', false, 'why', 'That code does not match. Check the email your brokerage received (codes are 6 digits, valid 7 days).');
  end if;
  update app_private.verify_codes set consumed_at = now() where id = vc.id;
  select name into v_name from public.organizations where id = v_org;
  if vc.purpose = 'identity' then
    insert into app_private.broker_identity(org_id, status, method, fmcsa_phone, verified_at, verified_by, note)
    values (v_org, 'verified', 'phone', vc.to_number, now(), 'FMCSA-listed phone (automated code call)', 'code confirmed ' || to_char(now(),'YYYY-MM-DD HH24:MI'))
    on conflict (org_id) do update set status = 'verified', method = 'phone', verified_at = now(), verified_by = 'FMCSA-listed phone (automated code call)', declined_at = null, updated_at = now(),
      note = left(coalesce(app_private.broker_identity.note,'') || ' | code confirmed ' || to_char(now(),'YYYY-MM-DD HH24:MI'), 500);
    perform app_private.notify_partner(v_org, '✅ Identity confirmed — you can post now', 'The code from the call to your FMCSA-listed number matched. Accept the Master Broker Agreement and post your first load.', 'success', '/app/partner/#post');
    perform app_private.log_audit('broker.verify_code_ok', 'org', v_org::text, v_org, 'identity confirmed via code to ' || app_private.mask_phone(vc.to_number), null, null);
    return jsonb_build_object('ok', true, 'tier', app_private.broker_tier(v_org));
  end if;
  select * into ap from app_private.agent_parents where id = vc.parent_id;
  if ap.id is null then
    -- a pre-0318 phone code without a row: confirm the primary brokerage
    ap := app_private.agent_primary_parent(v_org);
    if ap.id is null then return jsonb_build_object('ok', false, 'why', 'This account has no brokerage to confirm.'); end if;
  end if;
  perform app_private.agent_parent_confirm(ap.id, case vc.channel when 'email' then 'code from the confirmation email (' || coalesce(app_private.mask_email(split_part(vc.to_email, ', ', 1)), 'FMCSA-listed address') || ')' else 'FMCSA-listed phone code (automated call)' end, null);
  perform app_private.log_audit('broker.verify_code_ok', 'org', v_org::text, v_org, 'parent ' || app_private.agent_parent_display(ap) || ' confirmed via ' || vc.channel || ' code', null, null);
  return jsonb_build_object('ok', true, 'tier', app_private.broker_tier(v_org), 'parent_id', ap.id, 'parent', app_private.agent_parent_display(ap));
end $$;
revoke all on function public.partner_verify_code(text) from public, anon;
grant execute on function public.partner_verify_code(text) to authenticated;

-- the automated call is no longer offered for parent confirmation (identity path unchanged)
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='partner_verify_call';
  if v_def is null then raise exception 'partner_verify_call missing'; end if;
  if position('bl_bp_0318' in v_def) > 0 then raise notice 'partner_verify_call already patched'; return; end if;
  v_old := $q$    if not coalesce(t.is_agent,false) then return jsonb_build_object('ok', false, 'why', 'Only agents confirm through a parent brokerage.'); end if;$q$;
  v_new := $q$    return jsonb_build_object('ok', false, 'why', 'Brokerages confirm agents by email code now (bl_bp_0318) — no call is placed.');  -- bl_bp_0318
    if not coalesce(t.is_agent,false) then return jsonb_build_object('ok', false, 'why', 'Only agents confirm through a parent brokerage.'); end if;$q$;
  if position(v_old in v_def) = 0 then raise exception 'partner_verify_call: anchor missing'; end if;
  v_def := replace(v_def, v_old, v_new);
  -- email codes must not eat the 3-calls-a-day budget
  v_def := replace(v_def, $q$from app_private.verify_codes where org_id = v_org and created_at > now() - interval '24 hours';$q$,
                          $q$from app_private.verify_codes where org_id = v_org and channel = 'call' and created_at > now() - interval '24 hours';$q$);
  execute v_def;
end $$;

-- ---------------------------------------------------------------------------
-- 5. token page (agent-confirm.html): rows instead of broker_trust
-- ---------------------------------------------------------------------------
create or replace function public.partner_agent_confirm_get(p_token uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare ap app_private.agent_parents; v_agent text; v_agent_email text; v_since timestamptz;
begin
  if p_token is null then return jsonb_build_object('ok', false, 'error', 'missing token'); end if;
  select * into ap from app_private.agent_parents where confirm_token = p_token;
  if ap.id is null then return jsonb_build_object('ok', false, 'error', 'This link is not valid or has already been used.'); end if;
  select o.name, u.email, o.created_at into v_agent, v_agent_email, v_since
    from public.organizations o join auth.users u on u.id = o.owner_user_id where o.id = ap.agent_org;
  return jsonb_build_object('ok', true,
    'agent_name', v_agent, 'agent_email', v_agent_email, 'agent_since', v_since,
    'parent_legal_name', coalesce(ap.fmcsa_legal_name, ap.parent_legal_name), 'parent_mc', ap.parent_mc,
    'contact_source', ap.contact_source,
    'decided', ap.confirmed_at is not null or ap.declined_at is not null or ap.revoked_at is not null,
    'confirmed', ap.confirmed_at is not null and ap.revoked_at is null, 'declined', ap.declined_at is not null);
end $$;

create or replace function public.partner_agent_confirm(p_token uuid, p_decision text, p_name text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare ap app_private.agent_parents;
begin
  if p_token is null then raise exception 'missing token' using errcode='22023'; end if;
  if p_decision not in ('confirm','decline') then raise exception 'decision must be confirm or decline' using errcode='22023'; end if;
  select * into ap from app_private.agent_parents where confirm_token = p_token for update;
  if ap.id is null then raise exception 'This link is not valid or has already been used.' using errcode='22023'; end if;
  if ap.confirmed_at is not null or ap.declined_at is not null or ap.revoked_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'confirmed', ap.confirmed_at is not null and ap.revoked_at is null);
  end if;
  if p_decision = 'confirm' then perform app_private.agent_parent_confirm(ap.id, coalesce(nullif(trim(p_name),''),'brokerage contact') || ' (email link)', p_note);
  else perform app_private.agent_parent_decline(ap.id, coalesce(nullif(trim(p_name),''),'brokerage contact') || ' (email link)', p_note, false); end if;
  return jsonb_build_object('ok', true, 'confirmed', p_decision = 'confirm');
end $$;
grant execute on function public.partner_agent_confirm_get(uuid) to anon, authenticated;
grant execute on function public.partner_agent_confirm(uuid, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. brokerage side (parent on LoadBoot): list, decide, invite — keyed by agent org as before
-- ---------------------------------------------------------------------------
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
    'agents', coalesce((select jsonb_agg(jsonb_build_object('org_id', o.id, 'parent_id', ap.id, 'name', o.name, 'email', u.email, 'since', o.created_at,
        'status', case when ap.revoked_at is not null then 'revoked' when ap.declined_at is not null then 'declined' when ap.confirmed_at is not null then 'confirmed' when ap.screen_outcome = 'pass' then 'pending' else 'screening' end,
        'confirmed_at', ap.confirmed_at, 'declined_at', ap.declined_at, 'revoked_at', ap.revoked_at, 'confirmed_by', ap.confirmed_by, 'tier', app_private.broker_tier(o.id),
        'other_brokerages', (select count(*) from app_private.agent_parents x where x.agent_org = o.id and x.id <> ap.id and x.confirmed_at is not null and x.revoked_at is null),
        'loads', (select count(*) from app_private.partner_loads pl where pl.broker_org = o.id and pl.details->>'agent_parent_id' = ap.id::text),
        'open', (select count(*) from app_private.partner_loads pl where pl.broker_org = o.id and pl.details->>'agent_parent_id' = ap.id::text and pl.status in ('submitted','accepted','posted')))
        order by (ap.confirmed_at is null and ap.declined_at is null and ap.revoked_at is null) desc, ap.created_at desc)
      from app_private.agent_parents ap join public.organizations o on o.id = ap.agent_org join auth.users u on u.id = o.owner_user_id
      where ap.parent_org_id = v_org), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'name', i.name, 'status', i.status, 'created_at', i.created_at, 'accepted_at', i.accepted_at) order by i.created_at desc)
      from app_private.broker_agent_invites i where i.parent_org_id = v_org), '[]'::jsonb));
end $$;
revoke all on function public.partner_agents_list() from public, anon;
grant execute on function public.partner_agents_list() to authenticated;

create or replace function public.partner_agent_decide(p_agent_org uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; ap app_private.agent_parents; v_who text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  if p_decision not in ('confirm','decline','revoke') then raise exception 'decision must be confirm, decline or revoke' using errcode='22023'; end if;
  select * into ap from app_private.agent_parents where agent_org = p_agent_org and parent_org_id = v_org order by created_at desc limit 1 for update;
  if ap.id is null then raise exception 'that agent is not linked to your brokerage' using errcode='42501'; end if;
  select u.email into v_who from auth.users u where u.id = auth.uid();
  if p_decision = 'confirm' then
    if ap.screen_outcome is distinct from 'pass' then
      -- the owner approving IS the authority answering; a still-running screen must not block them
      update app_private.agent_parents set screen_outcome = coalesce(screen_outcome, 'pass'), screen_source = coalesce(screen_source, 'parent'), updated_at = now() where id = ap.id;
    end if;
    perform app_private.agent_parent_confirm(ap.id, coalesce(v_who,'parent owner') || ' (LoadBoot account)', p_note);
  else
    perform app_private.agent_parent_decline(ap.id, coalesce(v_who,'parent owner') || ' (LoadBoot account)', p_note, p_decision = 'revoke');
  end if;
  return jsonb_build_object('ok', true, 'tier', app_private.broker_tier(p_agent_org));
end $$;
revoke all on function public.partner_agent_decide(uuid, text, text) from public, anon;
grant execute on function public.partner_agent_decide(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. posting under a chosen brokerage: per-brokerage limit, label, MC
-- ---------------------------------------------------------------------------
create or replace function app_private.agent_parent_for_post(p_org uuid, p_parent uuid)
returns app_private.agent_parents language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare ap app_private.agent_parents; n int; v_active int; v_deliv boolean; v_lim int; t app_private.broker_trust;
begin
  if p_parent is not null then
    select * into ap from app_private.agent_parents where id = p_parent and agent_org = p_org;
    if ap.id is null then raise exception 'that brokerage is not on your account' using errcode='42501'; end if;
  else
    select count(*) into n from app_private.agent_parents where agent_org = p_org and confirmed_at is not null and declined_at is null and revoked_at is null;
    if n = 0 then raise exception 'no brokerage has confirmed you yet' using errcode='42501'; end if;
    if n > 1 then raise exception 'choose which brokerage this load posts under' using errcode='22023'; end if;
    select * into ap from app_private.agent_parents where agent_org = p_org and confirmed_at is not null and declined_at is null and revoked_at is null;
  end if;
  if ap.confirmed_at is null or ap.declined_at is not null or ap.revoked_at is not null then
    raise exception '% has not confirmed you (or revoked access) — pick another brokerage or wait for their code', app_private.agent_parent_display(ap) using errcode='42501';
  end if;
  if app_private.broker_tier(p_org) <> 'verified' then
    select * into t from app_private.broker_trust where org_id = p_org;
    select count(*) into v_active from app_private.partner_loads pl where pl.broker_org = p_org and pl.details->>'agent_parent_id' = ap.id::text and coalesce(pl.status,'') in ('submitted','accepted','posted');
    v_deliv := exists (select 1 from app_private.trips tr join public.loads l on l.id = tr.load_id where l.broker_org = p_org and tr.status = 'delivered' and l.details->>'agent_parent_id' = ap.id::text);
    v_lim := coalesce(t.posting_limit_override, case when v_deliv then 10 else 3 end);
    if v_active >= v_lim then
      raise exception 'You have % open postings under % — the limit is % % Complete your packet under Documents to lift it.', v_active, app_private.agent_parent_display(ap), v_lim,
        case when v_deliv then 'until your documents are verified.' else 'until your first load under them delivers.' end using errcode='42501';
    end if;
  end if;
  return ap;
end $$;

-- account-wide 3/10 limit does not apply to agents — theirs is per brokerage (agent_parent_for_post)
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='app_private' and p.proname='broker_can_post';
  if v_def is null then raise exception 'broker_can_post missing'; end if;
  if position('bl_bp_0318' in v_def) > 0 then raise notice 'broker_can_post already patched'; return; end if;
  v_old := $q$  elsif v_active >= v_lim then$q$;
  v_new := $q$  elsif v_active >= v_lim and not coalesce(t.is_agent,false) then  -- bl_bp_0318: agents are limited per brokerage instead$q$;
  if position(v_old in v_def) = 0 then raise exception 'broker_can_post: limit anchor missing'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='cc_partner_submit_load';
  if v_def is null then raise exception 'cc_partner_submit_load missing'; end if;
  if position('agent_parent_for_post' in v_def) > 0 then raise notice 'cc_partner_submit_load already patched'; return; end if;
  v_old := $q$  perform app_private.assert_broker_can_post(v_org);$q$;
  v_new := $q$  perform app_private.assert_broker_can_post(v_org);
  -- bl_bp_0318: an agent posts under ONE chosen brokerage — its name, MC and posting limit ride on the load
  declare ap9 app_private.agent_parents;
  begin
    if exists (select 1 from app_private.broker_trust bt where bt.org_id = v_org and bt.is_agent) then
      ap9 := app_private.agent_parent_for_post(v_org, nullif(p->'details'->>'agent_parent_id','')::uuid);
      p := jsonb_set(coalesce(p,'{}'::jsonb), '{details}', coalesce(p->'details','{}'::jsonb) || jsonb_build_object(
             'agent_parent_id', ap9.id, 'agent_parent_mc', ap9.parent_mc, 'agent_parent_name', coalesce(ap9.fmcsa_legal_name, ap9.parent_legal_name)));
    end if;
  end;$q$;
  if position(v_old in v_def) = 0 then raise exception 'cc_partner_submit_load: anchor missing'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- label: the brokerage on the load, not the primary one
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='app_private' and p.proname='trust_label_load';
  if v_def is null then raise exception 'trust_label_load missing'; end if;
  if position('bl_bp_0318' in v_def) > 0 then raise notice 'trust_label_load already patched'; return; end if;
  v_old := $q$declare v_tier text; t app_private.broker_trust; v_name text; v_mc text;$q$;
  v_new := $q$declare v_tier text; t app_private.broker_trust; v_name text; v_mc text; v_pmc text; ap9 app_private.agent_parents;$q$;
  if position(v_old in v_def) = 0 then raise exception 'trust_label_load: declare anchor missing'; end if;
  v_def := replace(v_def, v_old, v_new);
  v_old := $q$  v_name := case when coalesce(t.is_agent,false) then coalesce(t.parent_legal_name, 'their brokerage') else null end;$q$;
  v_new := $q$  v_name := case when coalesce(t.is_agent,false) then coalesce(t.parent_legal_name, 'their brokerage') else null end;
  v_pmc := t.parent_mc;
  -- bl_bp_0318: the brokerage chosen for this load
  if coalesce(t.is_agent,false) and nullif(NEW.details->>'agent_parent_id','') is not null then
    select * into ap9 from app_private.agent_parents where id = (NEW.details->>'agent_parent_id')::uuid and agent_org = NEW.broker_org;
    if ap9.id is not null then v_name := coalesce(ap9.fmcsa_legal_name, ap9.parent_legal_name, v_name); v_pmc := ap9.parent_mc; end if;
  end if;$q$;
  if position(v_old in v_def) = 0 then raise exception 'trust_label_load: name anchor missing'; end if;
  v_def := replace(v_def, v_old, v_new);
  if position('t.parent_mc' in v_def) = 0 then raise exception 'trust_label_load: parent_mc anchor missing'; end if;
  v_def := replace(v_def, $q$coalesce(' · MC-' || t.parent_mc, '')$q$, $q$coalesce(' · MC-' || v_pmc, '')$q$);
  v_def := replace(v_def, $q$coalesce(' (MC-' || t.parent_mc || ')','')$q$, $q$coalesce(' (MC-' || v_pmc || ')','')$q$);
  execute v_def;
end $$;

-- ---------------------------------------------------------------------------
-- 8. collector: hand every agent screening to the brokerage row; reminders per row
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='app_private' and p.proname='broker_screen_collect';
  if v_def is null then raise exception 'broker_screen_collect missing'; end if;
  if position('agent_parent_screened' in v_def) > 0 then raise notice 'collector already patched'; return; end if;
  v_old := $q$    if v_out = 'pass' then
      v_pass := v_pass + 1;
      perform app_private.packet_autofill_from_fmcsa(r.org_id);  -- bl_bp_0315
      if coalesce(t.is_agent,false) and t.parent_confirmed_at is null then
        perform app_private.broker_parent_confirm_send(r.org_id);
      else$q$;
  v_new := $q$    if coalesce(t.is_agent,false) then perform app_private.agent_parent_screened(r.org_id); end if;  -- bl_bp_0318
    if v_out = 'pass' then
      v_pass := v_pass + 1;
      perform app_private.packet_autofill_from_fmcsa(r.org_id);  -- bl_bp_0315
      if coalesce(t.is_agent,false) then
        null;  -- bl_bp_0318: agent_parent_screened already sent the brokerage its code + link
      else$q$;
  if position(v_old in v_def) = 0 then raise exception 'collector: pass anchor missing'; end if;
  v_def := replace(v_def, v_old, v_new);
  v_old := $q$  for r in select bt.org_id from app_private.broker_trust bt
            where bt.is_agent and bt.parent_confirmed_at is null and bt.parent_declined_at is null
              and bt.parent_confirm_sent_at < now() - interval '48 hours' and bt.parent_reminded_at is null
              and bt.parent_confirm_token is not null
  loop
    perform app_private.broker_parent_confirm_send(r.org_id, true);
  end loop;$q$;
  v_new := $q$  for r in select ap.id from app_private.agent_parents ap
            where ap.confirmed_at is null and ap.declined_at is null and ap.revoked_at is null and ap.screen_outcome = 'pass'
              and ap.sent_at < now() - interval '48 hours' and ap.reminded_at is null
  loop
    perform app_private.broker_parent_confirm_send_p(r.id, true);  -- bl_bp_0318
  end loop;$q$;
  if position(v_old in v_def) = 0 then raise exception 'collector: reminder anchor missing'; end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;

-- ---------------------------------------------------------------------------
-- 9. partner_trust_status: 'parents' array (the agent card is built from it); verify_call = calls only
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='partner_trust_status';
  if v_def is null then raise exception 'partner_trust_status missing'; end if;
  if position($q$'parents'$q$ in v_def) > 0 then raise notice 'partner_trust_status already patched'; return; end if;
  v_old := $q$    'parent_on_loadboot', (t.parent_org_id is not null),$q$;
  v_new := $q$    'parents', coalesce((select jsonb_agg(jsonb_build_object('id', ap.id, 'mc', ap.parent_mc, 'name', coalesce(ap.fmcsa_legal_name, ap.parent_legal_name),
        'status', case when ap.revoked_at is not null then 'revoked' when ap.declined_at is not null then 'declined' when ap.confirmed_at is not null then 'confirmed'
                       when ap.screen_outcome = 'pass' then 'pending' when ap.screen_outcome = 'fail' then 'failed' when ap.screen_outcome in ('not_found','unknown','error') then 'needs_human' else 'screening' end,
        'screen_reason', ap.screen_reason, 'screened_at', ap.screened_at, 'on_loadboot', ap.parent_org_id is not null,
        'loadboot_name', (select o9.name from public.organizations o9 where o9.id = ap.parent_org_id),
        'has_fmcsa_email', ap.fmcsa_email is not null, 'fmcsa_email_masked', app_private.mask_email(ap.fmcsa_email), 'fmcsa_domain', nullif(lower(split_part(coalesce(ap.fmcsa_email,''),'@',2)),''),
        'contact_email', ap.contact_email, 'contact_source', ap.contact_source, 'sent_to', ap.sent_to, 'sent_at', ap.sent_at, 'reminded_at', ap.reminded_at,
        'confirmed_at', ap.confirmed_at, 'confirmed_by', ap.confirmed_by, 'declined_at', ap.declined_at, 'revoked_at', ap.revoked_at, 'revoked_by', ap.revoked_by, 'note', ap.note,
        'code_live', exists (select 1 from app_private.verify_codes v9 where v9.parent_id = ap.id and v9.consumed_at is null and v9.expires_at > now()),
        'code_expires_at', (select max(v9.expires_at) from app_private.verify_codes v9 where v9.parent_id = ap.id and v9.consumed_at is null and v9.expires_at > now()),
        'open', (select count(*) from app_private.partner_loads pl where pl.broker_org = v_org and pl.details->>'agent_parent_id' = ap.id::text and pl.status in ('submitted','accepted','posted')),
        'loads', (select count(*) from app_private.partner_loads pl where pl.broker_org = v_org and pl.details->>'agent_parent_id' = ap.id::text))
        order by (ap.confirmed_at is not null and ap.revoked_at is null) desc, ap.created_at)
      from app_private.agent_parents ap where ap.agent_org = v_org), '[]'::jsonb),
    'parent_on_loadboot', (t.parent_org_id is not null),$q$;
  if position(v_old in v_def) = 0 then raise exception 'partner_trust_status: anchor missing'; end if;
  v_def := replace(v_def, v_old, v_new);
  v_def := replace(v_def, $q$from app_private.verify_codes vc where vc.org_id = v_org order by vc.created_at desc limit 1)$q$,
                          $q$from app_private.verify_codes vc where vc.org_id = v_org and vc.channel = 'call' order by vc.created_at desc limit 1)$q$);
  v_def := replace(v_def, $q$from app_private.verify_codes v2 where v2.org_id = v_org and v2.created_at > now() - interval '24 hours')$q$,
                          $q$from app_private.verify_codes v2 where v2.org_id = v_org and v2.channel = 'call' and v2.created_at > now() - interval '24 hours')$q$);
  execute v_def;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Command Center: brokerage rows on the queue; staff actions go through the same helpers
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='cc_broker_trust_queue';
  if v_def is null then raise exception 'cc_broker_trust_queue missing'; end if;
  if position('agent_parents' in v_def) > 0 then raise notice 'cc_broker_trust_queue already patched'; return; end if;
  v_old := $q$           t.hold_reason, t.parent_org_id,$q$;
  v_new := $q$           (select jsonb_agg(jsonb_build_object('id', ap.id, 'mc', ap.parent_mc, 'name', coalesce(ap.fmcsa_legal_name, ap.parent_legal_name), 'screen', ap.screen_outcome, 'screen_reason', ap.screen_reason,
                     'fmcsa_email', ap.fmcsa_email, 'fmcsa_phone', ap.fmcsa_phone, 'contact_email', ap.contact_email, 'contact_source', ap.contact_source, 'sent_to', ap.sent_to, 'sent_at', ap.sent_at,
                     'confirmed_at', ap.confirmed_at, 'confirmed_by', ap.confirmed_by, 'declined_at', ap.declined_at, 'revoked_at', ap.revoked_at, 'note', ap.note, 'on_loadboot', ap.parent_org_id is not null,
                     'status', case when ap.revoked_at is not null then 'revoked' when ap.declined_at is not null then 'declined' when ap.confirmed_at is not null then 'confirmed' when ap.screen_outcome = 'pass' then 'pending' else coalesce(ap.screen_outcome,'screening') end)
                     order by ap.created_at) from app_private.agent_parents ap where ap.agent_org = o.id) as parents,
           t.hold_reason, t.parent_org_id,$q$;
  if position(v_old in v_def) = 0 then raise exception 'cc_broker_trust_queue: anchor missing'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='cc_broker_trust_set';
  if v_def is null then raise exception 'cc_broker_trust_set missing'; end if;
  if position('bl_bp_0318' in v_def) > 0 then raise notice 'cc_broker_trust_set already patched'; return; end if;
  v_old := $q$    if coalesce(t.is_agent,false) and t.parent_confirmed_at is null then perform app_private.broker_parent_confirm_send(p_org);
    else perform app_private.broker_identity_start(p_org); end if;$q$;
  v_new := $q$    if coalesce(t.is_agent,false) then perform app_private.agent_parent_screened(p_org);  -- bl_bp_0318
    else perform app_private.broker_identity_start(p_org); end if;$q$;
  if position(v_old in v_def) = 0 then raise exception 'cc_broker_trust_set: pass anchor missing'; end if;
  v_def := replace(v_def, v_old, v_new);
  v_old := $q$    update app_private.broker_trust set parent_confirmed_at = now(), parent_confirmed_by = 'staff', parent_note = left(nullif(trim(p_note),''),500),
           parent_declined_at = null, updated_at = now() where org_id = p_org;
    perform app_private.notify_partner(p_org, '✅ Your brokerage relationship is confirmed', 'You can post loads under their authority now.', 'success', '/app/partner/#post');$q$;
  v_new := $q$    -- bl_bp_0318: staff confirm the newest undecided brokerage (note required — say what was checked)
    if coalesce(trim(p_note),'') = '' then raise exception 'write what you checked (agent agreement, call with the brokerage...)' using errcode='22023'; end if;
    declare ap9 app_private.agent_parents;
    begin
      select * into ap9 from app_private.agent_parents where agent_org = p_org and confirmed_at is null and revoked_at is null order by (declined_at is null) desc, created_at desc limit 1;
      if ap9.id is null then raise exception 'no undecided brokerage on this agent' using errcode='22023'; end if;
      update app_private.agent_parents set screen_outcome = coalesce(screen_outcome,'pass'), screen_source = coalesce(screen_source,'staff'), updated_at = now() where id = ap9.id;
      perform app_private.agent_parent_confirm(ap9.id, 'staff', p_note);
      perform app_private.broker_trust_release(p_org);
    end;$q$;
  if position(v_old in v_def) = 0 then raise exception 'cc_broker_trust_set: confirm_parent anchor missing'; end if;
  v_def := replace(v_def, v_old, v_new);
  v_old := $q$    update app_private.broker_trust set parent_reminded_at = null where org_id = p_org;
    perform app_private.broker_parent_confirm_send(p_org, true);$q$;
  v_new := $q$    update app_private.agent_parents set reminded_at = null where agent_org = p_org and confirmed_at is null;  -- bl_bp_0318
    perform app_private.broker_parent_confirm_send(p_org, true);$q$;
  if position(v_old in v_def) = 0 then raise exception 'cc_broker_trust_set: resend anchor missing'; end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;

-- ---------------------------------------------------------------------------
-- 11. ACL re-check: only the two token RPCs are anon
-- ---------------------------------------------------------------------------
do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('partner_agent_declare','partner_agent_parent_remove','partner_agent_parent_resend','partner_verify_code','partner_agents_list','partner_agent_decide')
     and has_function_privilege('anon', p.oid, 'execute');
  if bad is not null then raise exception 'anon can execute: %', bad; end if;
end $$;
