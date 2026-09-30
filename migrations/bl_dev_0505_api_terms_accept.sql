-- bl_dev_0505 — API use terms: versioned, accepted in the Developer Portal (30 Sep 2026, owner: "option B").
-- The public Terms page now has its own "API use" section (terms_module.py → /terms.html#api). This file makes
-- acceptance of THAT text a recorded, versioned fact instead of a checkbox pointing at terms that said nothing about
-- the API:
--   app_private.developer_accounts.terms_version   which version the developer accepted (null = none / old wording)
--   app_private.dev_api_terms()                     the current version + the short summary the portal shows
--   public.dev_accept_api_terms(p_version)          authenticated; the developer accepts the CURRENT version
--   dev_portal_state                                 + 'terms' {version, url, points, accepted_at, accepted_version, needs_accept}
--   dev_account_from_meta                           stamps terms_version only when the signup screen sent the current one
--   dev_request_production                          refuses until the current version is accepted
-- Not changed on purpose: existing keys keep working (owner, 30 Sep: legacy keys left active); staff approval in
-- API 360 is not blocked — API 360 shows the accepted version so staff can see it.
-- Security: no anon grant. dev_accept_api_terms is revoked from public+anon and granted to authenticated only, so the
-- anon SECURITY DEFINER surface (36 prod / 35 staging) does not move.
-- Applied: staging + prod 2026-09-30 (anon 35/36, names md5 unchanged).
-- Bumping the version later: change 'version' in dev_api_terms() (and the date on the Terms page); every developer
-- is asked again on their next portal visit and cannot request production until they accept.

alter table app_private.developer_accounts add column if not exists terms_version text;

create or replace function app_private.dev_api_terms() returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'version', 'api-v1-2026-09-30',
    'url', '/terms.html#api',
    'title', 'LoadBoot API use terms',
    'points', jsonb_build_array(
      'Your API keys are secret. Never share them or put them in an app, web page or public code; you are responsible for every call made with them.',
      'Every load you show from the API says "via LoadBoot" and links back to LoadBoot with the load''s url.',
      'No reselling, bulk copying or re-hosting LoadBoot load data, and no using it to take a load, broker or shipper around LoadBoot.',
      'Sandbox data is test data. Production access needs LoadBoot approval, and rate limits apply to every key.',
      'LoadBoot logs every API call and may limit, suspend or revoke keys that break these terms.'))
$$;
revoke all on function app_private.dev_api_terms() from public, anon;

-- Anchor patcher (same as bl_dev_0502): replace an exact snippet, refuse if the count is not what we read today,
-- skip if the marker is already there (idempotent re-run).
create or replace function pg_temp.bl_patch(p_fn regprocedure, p_old text, p_new text, p_expect int, p_marker text)
returns void language plpgsql as $$
declare v_def text; v_n int;
begin
  v_def := pg_get_functiondef(p_fn);
  if strpos(v_def, p_marker) > 0 then return; end if;
  v_n := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  if v_n <> p_expect then
    raise exception 'bl_dev_0505: % — anchor found % times, expected %', p_fn, v_n, p_expect;
  end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- 1 ── signup: record the version only when the new screen sent it (an old cached screen showed the old wording) ──
select pg_temp.bl_patch('app_private.dev_account_from_meta(uuid, text, jsonb, text)'::regprocedure,
  $a$partner_slug, source, terms_accepted_at)$a$,
  $a$partner_slug, source, terms_accepted_at, terms_version) /* bl_dev_0505 */$a$,
  1, 'bl_dev_0505');
select pg_temp.bl_patch('app_private.dev_account_from_meta(uuid, text, jsonb, text)'::regprocedure,
  $a$case when coalesce(p_meta->>'terms', '') in ('yes', 'true', '1') then now() end)$a$,
  $a$case when coalesce(p_meta->>'terms', '') in ('yes', 'true', '1') then now() end,
     case when coalesce(p_meta->>'terms', '') in ('yes', 'true', '1')
           and p_meta->>'terms_version' = app_private.dev_api_terms()->>'version' then p_meta->>'terms_version' end)$a$,
  1, 'dev_api_terms()');

-- 2 ── portal state carries the terms and whether this developer must (re)accept ────────────────────────────────
select pg_temp.bl_patch('public.dev_portal_state()'::regprocedure,
  $a$'webhooks', (select count(*) from app_private.webhook_endpoints w where w.owner_user = v_uid and w.active));$a$,
  $a$'webhooks', (select count(*) from app_private.webhook_endpoints w where w.owner_user = v_uid and w.active),
    -- bl_dev_0505: API use terms (null for a login that is not a developer account)
    'terms', case when v_is then app_private.dev_api_terms() || jsonb_build_object(
        'accepted_at', d.terms_accepted_at, 'accepted_version', d.terms_version,
        'needs_accept', d.terms_version is distinct from app_private.dev_api_terms()->>'version') end);$a$,
  1, 'bl_dev_0505');

-- 3 ── production request needs the current terms ───────────────────────────────────────────────────────────────
select pg_temp.bl_patch('public.dev_request_production(jsonb)'::regprocedure,
  $a$  if exists (select 1 from app_private.developer_access_requests where user_id = v_uid and status = 'pending') then$a$,
  $a$  if d.terms_version is distinct from app_private.dev_api_terms()->>'version' then  -- bl_dev_0505
    raise exception 'Accept the API use terms first (Overview tab).' using errcode = '22023';
  end if;
  if exists (select 1 from app_private.developer_access_requests where user_id = v_uid and status = 'pending') then$a$,
  1, 'bl_dev_0505');

-- 4 ── accept ────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.dev_accept_api_terms(p_version text)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare v_uid uuid := auth.uid(); v_ver text := app_private.dev_api_terms()->>'version'; d app_private.developer_accounts;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into d from app_private.developer_accounts where user_id = v_uid;
  if not found then raise exception 'Complete your developer profile first.' using errcode = '22023'; end if;
  -- the screen must have shown the version we are recording; a stale tab reloads instead of accepting blind
  if p_version is distinct from v_ver then
    raise exception 'The API use terms were updated. Reload the page and read the new version.' using errcode = '22023';
  end if;
  if d.terms_version is distinct from v_ver then
    update app_private.developer_accounts set terms_accepted_at = now(), terms_version = v_ver, updated_at = now()
     where user_id = v_uid;
    perform app_private.log_audit('developer.terms_accepted', 'developer_account', v_uid::text, null,
      'Developer accepted the API use terms ' || v_ver,
      jsonb_build_object('version', v_ver, 'previous_version', d.terms_version, 'previous_accepted_at', d.terms_accepted_at), null);
  end if;
  return public.dev_portal_state();
end $$;
revoke all on function public.dev_accept_api_terms(text) from public, anon;
grant execute on function public.dev_accept_api_terms(text) to authenticated;
