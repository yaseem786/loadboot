-- bl_dev_0502 — Developer accounts are their own persona, not carriers (handoff claude/DEVELOPER-PORTAL-API360-HANDOFF.md §3A).
-- Applied: staging 2026-09-29. Prod: after owner approval.
--
-- The bug: app/developer/app.js signed people up with no role, handle_new_user() treated "no role" as a
-- CARRIER, so every developer landed in CC → Carriers as "Pending" with blank columns, got a carrier org,
-- the carrier welcome email and the carrier onboarding-reminder ladder.
--
-- This file:
--   1. app_private.developer_accounts (+ developer_settings singleton)
--   2. handle_new_user(): role 'developer' → developer_accounts row, NO carrier org (mirrors the agent branch)
--   3. send_welcome_email(): developers get no carrier welcome / no "New carrier signup" staff mail
--   4. every carrier list / count that already excluded agents now excludes developers too:
--      cc_list_carriers, cc_get_overview, cc_run_onboarding_reminders, resolve_audience_emails, cc_audience_estimate
--   5. data fix: the 5 prod accounts named in the handoff → developer_accounts (status pending, source reclassified);
--      their auto-made carrier org is set to 'closed' (previous status kept in legacy_org_status). No deletes.
--      On staging these addresses do not exist, so step 5 is a no-op there.
--
-- Reversible: drop the developer branch lines / exclusion lines (each patch carries the marker bl_dev_0502),
-- set organizations.status back from developer_accounts.legacy_org_status, drop the two tables.
-- Nothing is granted to anon. No public function is added in this file.

-- 1 ── tables ────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists app_private.developer_accounts (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  email              text,
  name               text,
  company            text,
  website            text,
  use_case           text,
  expected_volume    text,
  partner_slug       text unique,          -- the ?src= in the link-back URL; staff can edit
  status             text not null default 'pending' check (status in ('pending','approved','denied','suspended')),
  status_reason      text,                 -- shown to the developer (deny / suspend reason)
  source             text not null default 'signup' check (source in ('signup','portal','reclassified','staff')),
  terms_accepted_at  timestamptz,
  verification_note  text,                 -- staff: SOS lookup, website check, …
  staff_notes        text,
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  review_note        text,
  welcomed_at        timestamptz,
  legacy_org_id      uuid,                 -- reclassified: the carrier org handle_new_user made by mistake
  legacy_org_status  text,                 -- … and its status before we closed it (for reversal)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists developer_accounts_status_idx on app_private.developer_accounts (status, created_at desc);
alter table app_private.developer_accounts enable row level security;
revoke all on app_private.developer_accounts from public, anon, authenticated;

create table if not exists app_private.developer_settings (
  id                   int primary key default 1 check (id = 1),
  rate_limit_per_min   int not null default 60 check (rate_limit_per_min between 1 and 10000),
  sandbox_self_serve   boolean not null default true,   -- false = sandbox keys only after staff approval
  log_retention_days   int not null default 90 check (log_retention_days between 7 and 400),
  updated_by           uuid,
  updated_at           timestamptz not null default now()
);
insert into app_private.developer_settings (id) values (1) on conflict (id) do nothing;
alter table app_private.developer_settings enable row level security;
revoke all on app_private.developer_settings from public, anon, authenticated;

-- 2 ── helpers ───────────────────────────────────────────────────────────────────────────────────────────
create or replace function app_private.is_developer_account(p_user uuid)
returns boolean language sql stable security definer set search_path to 'app_private', 'public' as $$
  select exists (select 1 from app_private.developer_accounts d where d.user_id = p_user);
$$;
revoke execute on function app_private.is_developer_account(uuid) from public;

create or replace function app_private.dev_unique_slug(p_base text, p_user uuid)
returns text language plpgsql stable security definer set search_path to 'app_private', 'public' as $$
declare v text;
begin
  v := trim(both '-' from left(regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9]+', '-', 'g'), 32));
  if v = '' or v is null then v := 'dev-' || left(md5(p_user::text), 6); end if;
  if exists (select 1 from app_private.developer_accounts where partner_slug = v and user_id <> p_user) then
    v := left(v, 25) || '-' || left(md5(p_user::text), 6);
  end if;
  return v;
end $$;
revoke execute on function app_private.dev_unique_slug(text, uuid) from public;

-- Creates the developer row from signup metadata. Values are trimmed and capped; blanks stay NULL.
create or replace function app_private.dev_account_from_meta(p_user uuid, p_email text, p_meta jsonb, p_source text)
returns void language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare
  v_company text := left(nullif(btrim(coalesce(p_meta->>'company', '')), ''), 200);
begin
  insert into app_private.developer_accounts
    (user_id, email, name, company, website, use_case, expected_volume, partner_slug, source, terms_accepted_at)
  values
    (p_user, lower(p_email),
     left(nullif(btrim(coalesce(p_meta->>'name', '')), ''), 200),
     v_company,
     left(nullif(btrim(coalesce(p_meta->>'website', '')), ''), 300),
     left(nullif(btrim(coalesce(p_meta->>'use_case', '')), ''), 2000),
     left(nullif(btrim(coalesce(p_meta->>'expected_volume', '')), ''), 100),
     app_private.dev_unique_slug(v_company, p_user),
     p_source,
     case when coalesce(p_meta->>'terms', '') in ('yes', 'true', '1') then now() end)
  on conflict (user_id) do nothing;
end $$;
revoke execute on function app_private.dev_account_from_meta(uuid, text, jsonb, text) from public;

-- Anchor patcher used below: replace an exact snippet in a live function, refuse if the snippet count is not what we
-- read today, skip if the marker is already there (idempotent re-run).
create or replace function pg_temp.bl_patch(p_fn regprocedure, p_old text, p_new text, p_expect int, p_marker text)
returns void language plpgsql as $$
declare v_def text; v_n int;
begin
  v_def := pg_get_functiondef(p_fn);
  if strpos(v_def, p_marker) > 0 then return; end if;
  v_n := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  if v_n <> p_expect then
    raise exception 'bl_dev_0502: % — anchor found % times, expected %', p_fn, v_n, p_expect;
  end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- 3 ── handle_new_user: developer branch, no carrier org ────────────────────────────────────────────────
select pg_temp.bl_patch('public.handle_new_user()'::regprocedure,
  $a$not in ('driver','agent','investor')$a$,
  $a$not in ('driver','agent','investor','developer') /* bl_dev_0502 */$a$,
  1, 'bl_dev_0502');
select pg_temp.bl_patch('public.handle_new_user()'::regprocedure,
  $a$  if coalesce(new.raw_user_meta_data->>'role','') = 'investor' then$a$,
  $a$  -- bl_dev_0502: developer/API signups get a developer_accounts row and nothing carrier-shaped.
  if coalesce(new.raw_user_meta_data->>'role','') = 'developer' then
    begin
      perform app_private.dev_account_from_meta(new.id, new.email, new.raw_user_meta_data, 'signup');
    exception when others then null;
    end;
  end if;
  if coalesce(new.raw_user_meta_data->>'role','') = 'investor' then$a$,
  1, 'dev_account_from_meta');

-- 4 ── send_welcome_email: no carrier welcome for developers; staff get an in-app note instead ───────────
select pg_temp.bl_patch('app_private.send_welcome_email()'::regprocedure,
  $a$  if exists (select 1 from auth.users u where u.id = new.id and coalesce(u.raw_user_meta_data->>'role','')='driver') then return new; end if;$a$,
  $a$  if exists (select 1 from auth.users u where u.id = new.id and coalesce(u.raw_user_meta_data->>'role','')='driver') then return new; end if;
  -- bl_dev_0502: developer signups are not carriers. Their welcome (developer.welcome) is sent by dev_portal_state()
  -- after the address is confirmed; here staff only get an in-app heads-up pointing at CC → API 360.
  if exists (select 1 from auth.users u where u.id = new.id and coalesce(u.raw_user_meta_data->>'role','')='developer') then
    begin
      insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
      values ('staff', 'in_app', 'signup.new.staff',
        jsonb_build_object('title', 'New developer signup', 'body', coalesce(nullif(trim(new.company),''), new.email) || ' created a developer (API) account.',
                           'tone', 'info', 'url', '/app/command-center/#/api360'), 'sent', now());
    exception when others then null; end;
    return new;
  end if;$a$,
  1, 'bl_dev_0502');

-- 5 ── carrier lists / counts exclude developers ─────────────────────────────────────────────────────────
select pg_temp.bl_patch('public.cc_list_carriers(text,text,integer)'::regprocedure,
  $a$      and not exists (select 1 from app_private.referrers r where r.user_id = pr.id and r.org_id is null)$a$,
  $a$      and not exists (select 1 from app_private.referrers r where r.user_id = pr.id and r.org_id is null)
      and not exists (select 1 from app_private.developer_accounts da where da.user_id = pr.id)  -- bl_dev_0502$a$,
  1, 'bl_dev_0502');

select pg_temp.bl_patch('public.cc_get_overview()'::regprocedure,
  $a$from public.profiles where role='carrier'$a$,
  $a$from public.profiles where role='carrier' and not app_private.is_developer_account(profiles.id) /* bl_dev_0502 */$a$,
  4, 'bl_dev_0502');

select pg_temp.bl_patch('public.cc_run_onboarding_reminders()'::regprocedure,
  $a$      and not exists (select 1 from app_private.agent_profiles ap where ap.user_id = pr.id)$a$,
  $a$      and not exists (select 1 from app_private.agent_profiles ap where ap.user_id = pr.id)
      and not exists (select 1 from app_private.developer_accounts da where da.user_id = pr.id)  -- bl_dev_0502$a$,
  1, 'bl_dev_0502');

select pg_temp.bl_patch('app_private.resolve_audience_emails(text)'::regprocedure,
  $a$where p.role='carrier' and p.email is not null$a$,
  $a$where p.role='carrier' and not app_private.is_developer_account(p.id) /* bl_dev_0502 */ and p.email is not null$a$,
  1, 'bl_dev_0502');

select pg_temp.bl_patch('public.cc_audience_estimate(text)'::regprocedure,
  $a$from public.profiles where role='carrier';$a$,
  $a$from public.profiles where role='carrier' and not app_private.is_developer_account(profiles.id) /* bl_dev_0502 */;$a$,
  1, 'bl_dev_0502');

-- 6 ── data fix: the developer signups that landed as carriers (prod; no-op on staging) ───────────────────
do $$
declare r record; v_org uuid; v_st text; v_note text; v_close boolean;
begin
  for r in
    select u.id, lower(u.email) email, u.created_at
      from auth.users u
     where lower(u.email) in ('brian.a@lyntex.io', 'nguyenbrian83@gmail.com', 'byteitsolutionsnc@gmail.com',
                              'techcentralnc@gmail.com', 'support@velogriddispatch.com')
       and not exists (select 1 from app_private.developer_accounts d where d.user_id = u.id)
  loop
    v_org := null; v_st := null;
    select o.id, o.status into v_org, v_st
      from public.organizations o where o.owner_user_id = r.id and o.kind = 'carrier' order by o.created_at limit 1;
    v_note := 'Reclassified from carrier by bl_dev_0502 (29 Sep 2026): signed up through the developer portal, which sent no role.';
    if r.email = 'brian.a@lyntex.io' then
      v_note := v_note || ' Owner note: Lyntex Designs (lyntex.io), a software/AI agency — not a carrier.';
    end if;
    if exists (select 1 from app_private.agent_profiles ap where ap.user_id = r.id) then
      v_note := v_note || ' This login also has an agent profile.';
    end if;
    if exists (select 1 from app_private.api_keys k where k.owner_user_id = r.id and k.revoked_at is null) then
      v_note := v_note || ' Had API keys before approval existed; they were left active (not revoked).';
    end if;
    insert into app_private.developer_accounts (user_id, email, source, status, partner_slug, verification_note,
                                                legacy_org_id, legacy_org_status, created_at)
    values (r.id, r.email, 'reclassified', 'pending', app_private.dev_unique_slug(null, r.id), v_note, v_org, v_st, r.created_at);
    -- close the mistaken carrier org only if nothing carrier-shaped ever happened on it
    v_close := v_org is not null and coalesce(v_st, '') <> 'closed'
               and not exists (select 1 from public.documents d where d.carrier_id = r.id)
               and not exists (select 1 from public.settlements s where s.carrier_id = r.id);
    if v_close then
      update public.organizations set status = 'closed' where id = v_org;
    end if;
    perform app_private.log_audit('developer.reclassify', 'developer_account', r.id::text, v_org,
      'Developer signup reclassified out of the carrier list (bl_dev_0502)',
      jsonb_build_object('email', r.email, 'legacy_org', v_org, 'legacy_org_status', v_st, 'org_closed', v_close), null);
  end loop;
end $$;

-- 7 ── self-check ─────────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if strpos(pg_get_functiondef('public.handle_new_user()'::regprocedure), 'dev_account_from_meta') = 0 then
    raise exception 'bl_dev_0502: handle_new_user not patched'; end if;
  if strpos(pg_get_functiondef('public.cc_list_carriers(text,text,integer)'::regprocedure), 'developer_accounts') = 0 then
    raise exception 'bl_dev_0502: cc_list_carriers not patched'; end if;
  if strpos(pg_get_functiondef('public.cc_run_onboarding_reminders()'::regprocedure), 'developer_accounts') = 0 then
    raise exception 'bl_dev_0502: onboarding reminders not patched'; end if;
end $$;
