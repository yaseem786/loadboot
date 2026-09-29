-- bl_dev_0502b — Developer API runtime (log, rate limit, sandbox, filters), Developer Portal RPCs, CC "API 360" RPCs,
-- and the developer emails (handoff claude/DEVELOPER-PORTAL-API360-HANDOFF.md §3B–E). Needs bl_dev_0502.
-- Applied: staging 2026-09-29. Prod: after owner approval.
--
-- Runtime (service_role only — called by the dev-api edge function v8):
--   public.dev_api_auth(p_full)          key check + suspended check + per-key per-minute rate limit → jsonb
--   public.dev_api_log(p jsonb)           one row per API call into app_private.api_request_log
--   public.dev_api_loads(...)             public load board with optional equipment / origin_state / dest_state filters
--   app_private.cron_api_log_purge()      daily: request log older than developer_settings.log_retention_days (90), rate buckets > 1 h
-- Portal (authenticated, own rows only):
--   dev_portal_state, dev_profile_save, dev_request_production, dev_usage; cc_create_api_key / cc_revoke_api_key re-written
--   with the approval policy (sandbox self-serve; production read only after approval; write never self-serve for developers).
-- CC API 360 (integrations.view to read, integrations.manage to act; every action audited):
--   cc_api360_list, cc_api360_get, cc_api360_set_status, cc_api360_revoke_key, cc_api360_issue_key,
--   cc_api360_save_profile, cc_api360_settings_save, cc_api360_reclassify
-- Emails (CLAUDE.md §6 — all through the catalog): developer.welcome, developer.production_approved,
--   developer.production_denied, developer.suspended, developer.key_revoked (T, account_critical), and
--   developer.production_requested (S, staff_internal).
--
-- Every new public function: revoke from public, anon; grant to authenticated or service_role only. anon surface unchanged.

-- 1 ── tables ────────────────────────────────────────────────────────────────────────────────────────────
alter table app_private.api_keys add column if not exists created_by uuid;
alter table app_private.api_keys add column if not exists revoked_by uuid;
alter table app_private.api_keys add column if not exists revoke_reason text;
alter table app_private.api_keys add column if not exists partner_slug text;
alter table app_private.api_keys add column if not exists rate_limit_per_min int;
do $$ begin
  alter table app_private.api_keys add constraint api_keys_rate_limit_chk check (rate_limit_per_min is null or rate_limit_per_min between 1 and 10000);
exception when duplicate_object then null; end $$;
create index if not exists api_keys_owner_idx on app_private.api_keys (owner_user_id);

create table if not exists app_private.developer_access_requests (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  status           text not null default 'pending' check (status in ('pending','approved','denied','withdrawn')),
  use_case         text,
  expected_volume  text,
  integration_url  text,
  message          text,
  created_at       timestamptz not null default now(),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text
);
create unique index if not exists developer_access_requests_one_open on app_private.developer_access_requests (user_id) where status = 'pending';
alter table app_private.developer_access_requests enable row level security;
revoke all on app_private.developer_access_requests from public, anon, authenticated;

create table if not exists app_private.api_request_log (
  id             bigint generated always as identity primary key,
  key_id         uuid,
  key_prefix     text,
  owner_user_id  uuid,
  method         text,
  endpoint       text,
  status         int,
  latency_ms     int,
  error          text,
  sandbox        boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists api_request_log_key_idx   on app_private.api_request_log (key_id, created_at desc);
create index if not exists api_request_log_owner_idx on app_private.api_request_log (owner_user_id, created_at desc);
create index if not exists api_request_log_at_idx    on app_private.api_request_log (created_at);
alter table app_private.api_request_log enable row level security;
revoke all on app_private.api_request_log from public, anon, authenticated;

create table if not exists app_private.api_rate_buckets (
  key_id        uuid not null,
  window_start  timestamptz not null,
  n             int not null default 0,
  primary key (key_id, window_start)
);
alter table app_private.api_rate_buckets enable row level security;
revoke all on app_private.api_rate_buckets from public, anon, authenticated;

-- 2 ── runtime (service_role only) ───────────────────────────────────────────────────────────────────────
create or replace function public.dev_api_auth(p_full text)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public', 'extensions' as $$
declare
  k app_private.api_keys; d app_private.developer_accounts; s app_private.developer_settings;
  v_win timestamptz := date_trunc('minute', now()); v_n int; v_lim int;
begin
  if p_full is null or left(p_full, 3) <> 'lb_' then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Missing API key. Send: Authorization: Bearer lb_...');
  end if;
  select * into k from app_private.api_keys where key_hash = encode(extensions.digest(p_full, 'sha256'), 'hex');
  if not found then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Invalid or revoked API key.', 'prefix', left(p_full, 9));
  end if;
  if k.revoked_at is not null then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Invalid or revoked API key.',
                              'key_id', k.id, 'owner', k.owner_user_id, 'prefix', k.prefix);
  end if;
  select * into d from app_private.developer_accounts where user_id = k.owner_user_id;
  if found and d.status = 'suspended' then
    return jsonb_build_object('ok', false, 'status', 403, 'key_id', k.id, 'owner', k.owner_user_id, 'prefix', k.prefix,
                              'error', 'This developer account is suspended. Contact hello@loadboot.com.');
  end if;
  select * into s from app_private.developer_settings where id = 1;
  v_lim := coalesce(k.rate_limit_per_min, s.rate_limit_per_min, 60);
  insert into app_private.api_rate_buckets as b (key_id, window_start, n) values (k.id, v_win, 1)
    on conflict (key_id, window_start) do update set n = b.n + 1
    returning b.n into v_n;
  if v_n > v_lim then
    return jsonb_build_object('ok', false, 'status', 429, 'key_id', k.id, 'owner', k.owner_user_id, 'prefix', k.prefix,
      'error', format('Rate limit exceeded: %s requests per minute per key.', v_lim), 'limit', v_lim,
      'retry_after', greatest(1, 60 - floor(extract(epoch from (now() - v_win)))::int));
  end if;
  update app_private.api_keys set last_used_at = now() where id = k.id;
  return jsonb_build_object('ok', true, 'key_id', k.id, 'owner', k.owner_user_id, 'prefix', k.prefix,
    'scopes', to_jsonb(coalesce(k.scopes, array[]::text[])), 'sandbox', 'sandbox' = any(coalesce(k.scopes, array[]::text[])),
    'partner', coalesce(nullif(k.partner_slug, ''), nullif(d.partner_slug, ''), 'api'),
    'account_status', d.status, 'company', d.company, 'limit', v_lim, 'remaining', greatest(0, v_lim - v_n));
end $$;
revoke execute on function public.dev_api_auth(text) from public, anon, authenticated;
grant execute on function public.dev_api_auth(text) to service_role;

create or replace function public.dev_api_log(p jsonb)
returns void language plpgsql security definer set search_path to 'app_private', 'public' as $$
begin
  insert into app_private.api_request_log (key_id, key_prefix, owner_user_id, method, endpoint, status, latency_ms, error, sandbox)
  values (nullif(p->>'key_id', '')::uuid, left(p->>'prefix', 12), nullif(p->>'owner', '')::uuid, left(p->>'method', 8),
          left(p->>'endpoint', 120), (p->>'status')::int, (p->>'latency_ms')::int, left(p->>'error', 500),
          coalesce((p->>'sandbox')::boolean, false));
end $$;
revoke execute on function public.dev_api_log(jsonb) from public, anon, authenticated;
grant execute on function public.dev_api_log(jsonb) to service_role;

-- Same predicate as public.get_public_load_opportunities (keep them in step), plus optional filters.
-- State = the 2-letter code after the first comma in origin/destination ("Dallas, TX" / "Dallas, TX 75201").
create or replace function public.dev_api_loads(p_limit int default 25, p_equipment text default null,
                                                p_origin_state text default null, p_dest_state text default null)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.posted desc nulls last), '[]'::jsonb) from (
    select left(l.id::text, 8) as ref, l.origin, l.destination, l.equipment, l.miles, l.rate,
           case when l.miles > 0 then round(l.rate / l.miles, 2) else null end as rpm,
           l.pickup_date, l.published_at as posted, l.expires_at, l.commodity, l.weight,
           case when l.source_type = 'partner_portal' then 'Broker partner' else 'LoadBoot dispatch' end as posted_by
      from public.loads l
     where l.status = 'available' and (l.pickup_date is null or l.pickup_date >= current_date)
       and not (coalesce(l.details, '{}'::jsonb) ? 'direct_carrier_id') and l.is_public = true
       and (l.expires_at is null or l.expires_at > now())
       and (nullif(btrim(p_equipment), '') is null or l.equipment ilike '%' || btrim(p_equipment) || '%')
       and (nullif(btrim(p_origin_state), '') is null
            or upper(substring(l.origin from ',\s*([A-Za-z]{2})\y')) = upper(btrim(p_origin_state)))
       and (nullif(btrim(p_dest_state), '') is null
            or upper(substring(l.destination from ',\s*([A-Za-z]{2})\y')) = upper(btrim(p_dest_state)))
     order by l.published_at desc nulls last
     limit greatest(1, least(coalesce(p_limit, 25), 50))
  ) x;
$$;
revoke execute on function public.dev_api_loads(int, text, text, text) from public, anon, authenticated;
grant execute on function public.dev_api_loads(int, text, text, text) to service_role;

create or replace function app_private.cron_api_log_purge()
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare v_days int; v_log int; v_b int;
begin
  select log_retention_days into v_days from app_private.developer_settings where id = 1;
  delete from app_private.api_request_log where created_at < now() - make_interval(days => coalesce(v_days, 90));
  get diagnostics v_log = row_count;
  delete from app_private.api_rate_buckets where window_start < now() - interval '1 hour';
  get diagnostics v_b = row_count;
  return jsonb_build_object('log_deleted', v_log, 'buckets_deleted', v_b);
end $$;
revoke execute on function app_private.cron_api_log_purge() from public;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'lb-api-log-purge') then perform cron.unschedule('lb-api-log-purge'); end if;
  perform cron.schedule('lb-api-log-purge', '17 3 * * *', 'select app_private.cron_api_log_purge()');
end $$;

-- 3 ── emails (catalog first, CLAUDE.md §6) ──────────────────────────────────────────────────────────────
insert into app_private.email_catalog (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note,
                                       stop_condition, preference_group, unsub_allowed, status, cc_deep_link)
values
 ('developer.welcome', 'Developer welcome',
  'Sent once when a developer first opens the Developer Portal after confirming their email: what the sandbox is, how to make the first call, how to request production access.',
  'T', 'developer', 'event', 'public.dev_portal_state', 'once', 'once per account (idempotency developer.welcome:<user>)',
  'sent once', 'account_critical', false, 'live', '#/api360'),
 ('developer.production_approved', 'Developer production access approved',
  'Tells the developer staff approved production access and that they can now create a production read key.',
  'T', 'developer', 'event', 'public.cc_api360_set_status', 'per decision', 'once per decision', 'n/a', 'account_critical', false, 'live', '#/api360'),
 ('developer.production_denied', 'Developer production access not approved',
  'Tells the developer the production request was not approved, with the reason staff typed; sandbox stays available.',
  'T', 'developer', 'event', 'public.cc_api360_set_status', 'per decision', 'once per decision', 'n/a', 'account_critical', false, 'live', '#/api360'),
 ('developer.suspended', 'Developer account suspended',
  'Tells the developer their API access is suspended (all keys stop working) and why.',
  'T', 'developer', 'event', 'public.cc_api360_set_status', 'per decision', 'once per decision', 'n/a', 'account_critical', false, 'live', '#/api360'),
 ('developer.key_revoked', 'API key revoked by LoadBoot',
  'Tells the key owner that LoadBoot staff revoked one of their API keys (prefix + reason). Not sent when the developer revokes their own key.',
  'T', 'developer', 'event', 'public.cc_api360_revoke_key', 'per revoke', 'once per key', 'n/a', 'account_critical', false, 'live', '#/api360'),
 ('developer.production_requested', 'Developer production request (staff)',
  'Staff alert: a developer asked for production API access. Links to CC → API 360.',
  'S', 'staff', 'event', 'public.dev_request_production', 'per request', 'once per request', 'n/a', 'staff_internal', false, 'live', '#/api360')
on conflict (key) do update set name = excluded.name, purpose = excluded.purpose, class = excluded.class, audience_role = excluded.audience_role,
  trigger_type = excluded.trigger_type, trigger_source = excluded.trigger_source, cadence = excluded.cadence, cap_note = excluded.cap_note,
  stop_condition = excluded.stop_condition, preference_group = excluded.preference_group, unsub_allowed = excluded.unsub_allowed,
  status = 'live', cc_deep_link = excluded.cc_deep_link;

-- One sender for every developer email. p_extra: {note, key_prefix, key_name, request_id}. Never raises (a mail problem
-- must not undo a staff decision); failures land in the normal email logs via sys_email.
create or replace function app_private.dev_send_email(p_user uuid, p_key text, p_extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare
  v_to text; v_who text; v_subj text; v_body text; v_text text; v_idem text; d app_private.developer_accounts;
  v_note text := nullif(btrim(coalesce(p_extra->>'note', '')), '');
  h2 constant text := '<h2 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#10223B">';
  p  constant text := '<p style="color:#475569;margin:0 0 14px;line-height:1.55">';
  box constant text := '<div style="background:#f6f9fd;border:1px solid #e3edfa;border-radius:12px;padding:14px 18px;margin:0 0 18px;color:#334155">';
  v_portal constant text := 'https://loadboot.com/app/developer/';
begin
  select * into d from app_private.developer_accounts where user_id = p_user;
  select coalesce(d.email, u.email) into v_to from auth.users u where u.id = p_user;
  if v_to is null then return; end if;
  v_who := coalesce(nullif(btrim(d.name), ''), nullif(btrim(d.company), ''), split_part(v_to, '@', 1));

  if p_key = 'developer.welcome' then
    v_subj := 'Welcome to LoadBoot Developers, ' || v_who;
    v_body := h2 || 'Welcome, ' || v_who || '</h2>'
      || p || 'Your LoadBoot developer account is ready. Start in the <b>sandbox</b>: a sandbox key returns fixed test loads, so you can build and test without touching the real board.</p>'
      || box || '<b style="color:#10223B">Three steps</b><br>1. Create a sandbox key in the portal (it is shown once — copy it)<br>'
      || '2. Call <code>?resource=me</code>, then <code>?resource=loads</code><br>3. When your integration works, press <b>Request production access</b></div>';
    v_idem := 'developer.welcome:' || p_user;
  elsif p_key = 'developer.production_approved' then
    v_subj := 'Production API access approved';
    v_body := h2 || 'You are approved for production</h2>'
      || p || 'LoadBoot approved production API access for <b>' || coalesce(d.company, v_who) || '</b>. Open the portal and create a <b>production read key</b>.</p>'
      || box || 'Loads you show from our API carry "via LoadBoot" and link back with the load''s ref: <br><code>https://loadboot.com/app/carrier/?src=' || coalesce(d.partner_slug, 'api') || '&amp;ref={ref}</code></div>'
      || coalesce(p || 'Note from our team: ' || v_note || '</p>', '');
    v_idem := 'developer.production_approved:' || p_user || ':' || coalesce(p_extra->>'request_id', to_char(now(), 'YYYYMMDDHH24MI'));
  elsif p_key = 'developer.production_denied' then
    v_subj := 'About your production API request';
    v_body := h2 || 'Production access not approved yet</h2>'
      || p || 'We reviewed your request for production API access and could not approve it right now.</p>'
      || coalesce(box || '<b style="color:#10223B">Reason</b><br>' || v_note || '</div>', '')
      || p || 'Your sandbox keeps working. Reply to this email or write to hello@loadboot.com if you have more to share.</p>';
    v_idem := 'developer.production_denied:' || p_user || ':' || coalesce(p_extra->>'request_id', to_char(now(), 'YYYYMMDDHH24MI'));
  elsif p_key = 'developer.suspended' then
    v_subj := 'Your LoadBoot API access is suspended';
    v_body := h2 || 'API access suspended</h2>'
      || p || 'LoadBoot suspended API access for your developer account. All of your API keys stop working until this is lifted.</p>'
      || coalesce(box || '<b style="color:#10223B">Reason</b><br>' || v_note || '</div>', '')
      || p || 'Write to hello@loadboot.com to talk to us about it.</p>';
    v_idem := 'developer.suspended:' || p_user || ':' || to_char(now(), 'YYYYMMDDHH24MI');
  elsif p_key = 'developer.key_revoked' then
    v_subj := 'An API key on your LoadBoot account was revoked';
    v_body := h2 || 'API key revoked</h2>'
      || p || 'LoadBoot revoked the key <code>' || coalesce(p_extra->>'key_prefix', '') || '</code>'
      || coalesce(' (' || nullif(p_extra->>'key_name', '') || ')', '') || '. Calls made with it now return 401.</p>'
      || coalesce(box || '<b style="color:#10223B">Reason</b><br>' || v_note || '</div>', '')
      || p || 'You can create a new key in the portal. Questions: hello@loadboot.com.</p>';
    v_idem := 'developer.key_revoked:' || coalesce(p_extra->>'key_id', p_user::text);
  else
    return;
  end if;

  v_body := v_body
    || '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:#FC5305">'
    || '<a href="' || v_portal || '" style="display:inline-block;padding:13px 24px;color:#ffffff;font-weight:700;text-decoration:none;font-size:15px">Open the Developer Portal →</a></td></tr></table>';
  v_text := regexp_replace(regexp_replace(v_body, '<br>|</p>|</div>|</h2>', E'\n', 'g'), '<[^>]+>', '', 'g') || E'\n' || v_portal;
  begin
    perform app_private.sys_email(v_to, p_key, v_subj, v_body, v_text, v_idem);
  exception when others then null;
  end;
end $$;
revoke execute on function app_private.dev_send_email(uuid, text, jsonb) from public;

-- 4 ── API keys: the approval policy lives here, not in the browser ─────────────────────────────────────
create or replace function public.cc_create_api_key(p_name text, p_scopes text[] default array['read'])
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public', 'extensions' as $$
declare
  v_prefix text; v_secret text; v_full text; v_id uuid; v_scopes text[]; d app_private.developer_accounts; s app_private.developer_settings;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name is required' using errcode = '22023'; end if;
  select array_agg(distinct lower(btrim(x)) order by lower(btrim(x))) into v_scopes
    from unnest(coalesce(p_scopes, array['read'])) x where btrim(x) <> '';
  if v_scopes is null or not (v_scopes <@ array['read', 'write', 'sandbox']) then
    raise exception 'Scopes must be sandbox, read or write.' using errcode = '22023';
  end if;
  if 'sandbox' = any(v_scopes) and cardinality(v_scopes) > 1 then
    raise exception 'A sandbox key cannot also carry read or write.' using errcode = '22023';
  end if;
  -- bl_dev_0502b: developer accounts follow the approval policy
  select * into d from app_private.developer_accounts where user_id = auth.uid();
  if found then
    if d.status = 'suspended' then
      raise exception 'Your developer account is suspended. Contact hello@loadboot.com.' using errcode = '42501';
    end if;
    if 'sandbox' = any(v_scopes) then
      select * into s from app_private.developer_settings where id = 1;
      if not coalesce(s.sandbox_self_serve, true) and d.status <> 'approved' then
        raise exception 'Sandbox keys unlock after a quick review by LoadBoot. We will email you.' using errcode = '42501';
      end if;
    else
      if d.status <> 'approved' then
        raise exception 'Production keys unlock after LoadBoot approves your access. Use "Request production access" on your dashboard.' using errcode = '42501';
      end if;
      if 'write' = any(v_scopes) then
        raise exception 'Write access (posting loads) is for verified broker accounts. Email hello@loadboot.com.' using errcode = '42501';
      end if;
    end if;
  end if;
  if (select count(*) from app_private.api_keys where owner_user_id = auth.uid() and revoked_at is null) >= 10 then
    raise exception 'You already have 10 active keys. Revoke one first.' using errcode = '22023';
  end if;
  v_prefix := encode(extensions.gen_random_bytes(3), 'hex');
  v_secret := encode(extensions.gen_random_bytes(24), 'hex');
  v_full := 'lb_' || v_prefix || '_' || v_secret;
  insert into app_private.api_keys (owner_user_id, name, prefix, key_hash, scopes, created_by)
    values (auth.uid(), left(trim(p_name), 80), 'lb_' || v_prefix, encode(extensions.digest(v_full, 'sha256'), 'hex'), v_scopes, auth.uid())
    returning id into v_id;
  perform app_private.log_audit('apikey.create', 'api_key', v_id::text, null, 'API key created: ' || trim(p_name),
                                jsonb_build_object('scopes', v_scopes, 'owner', auth.uid()), null);
  return jsonb_build_object('id', v_id, 'key', v_full, 'prefix', 'lb_' || v_prefix, 'scopes', v_scopes);
end $$;

create or replace function public.cc_revoke_api_key(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'app_private', 'public' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  update app_private.api_keys set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = coalesce(revoke_reason, 'revoked by owner')
   where id = p_id and owner_user_id = auth.uid() and revoked_at is null;
  if found then
    perform app_private.log_audit('apikey.revoke', 'api_key', p_id::text, null, 'API key revoked by its owner', '{}'::jsonb, null);
    return true;
  end if;
  return false;
end $$;

-- 5 ── Developer Portal (authenticated; own data only) ──────────────────────────────────────────────────
create or replace function public.dev_portal_state()
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare v_uid uuid := auth.uid(); d app_private.developer_accounts; s app_private.developer_settings; v_confirmed boolean; v_is boolean;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into d from app_private.developer_accounts where user_id = v_uid;
  v_is := found;
  select * into s from app_private.developer_settings where id = 1;
  select u.email_confirmed_at is not null into v_confirmed from auth.users u where u.id = v_uid;
  if v_is and d.welcomed_at is null and v_confirmed then
    update app_private.developer_accounts set welcomed_at = now() where user_id = v_uid;
    perform app_private.dev_send_email(v_uid, 'developer.welcome', '{}'::jsonb);
  end if;
  return jsonb_build_object(
    'is_developer', v_is,
    -- a login that is not a developer account (carrier, broker, staff…) keeps the old self-serve behaviour
    'can_create_profile', not v_is
        and not exists (select 1 from public.organization_memberships m where m.user_id = v_uid)
        and not exists (select 1 from app_private.agent_profiles ap where ap.user_id = v_uid),
    'account', case when v_is then jsonb_build_object('name', d.name, 'company', d.company, 'website', d.website,
        'use_case', d.use_case, 'expected_volume', d.expected_volume, 'status', d.status, 'status_reason', d.status_reason,
        'partner_slug', d.partner_slug, 'created_at', d.created_at, 'reviewed_at', d.reviewed_at) end,
    'settings', jsonb_build_object('rate_limit_per_min', s.rate_limit_per_min, 'sandbox_self_serve', s.sandbox_self_serve),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'created_at', r.created_at,
        'decided_at', r.decided_at, 'decision_note', r.decision_note) order by r.created_at desc)
        from app_private.developer_access_requests r where r.user_id = v_uid), '[]'::jsonb),
    'keys', (select jsonb_build_object(
        'active', count(*) filter (where revoked_at is null),
        'sandbox', count(*) filter (where revoked_at is null and 'sandbox' = any(scopes)),
        'production', count(*) filter (where revoked_at is null and not ('sandbox' = any(scopes))),
        'used', count(*) filter (where last_used_at is not null))
        from app_private.api_keys where owner_user_id = v_uid),
    'calls_total', (select count(*) from app_private.api_request_log l where l.owner_user_id = v_uid),
    'webhooks', (select count(*) from app_private.webhook_endpoints w where w.owner_user = v_uid and w.active));
end $$;

create or replace function public.dev_profile_save(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare v_uid uuid := auth.uid(); v_email text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not exists (select 1 from app_private.developer_accounts where user_id = v_uid) then
    -- only a bare login (no org, no agent profile) may become a developer account from the portal
    if exists (select 1 from public.organization_memberships m where m.user_id = v_uid)
       or exists (select 1 from app_private.agent_profiles ap where ap.user_id = v_uid) then
      raise exception 'This login already belongs to a LoadBoot carrier, partner or agent account. Use a separate email for developer access.' using errcode = '42501';
    end if;
    select email into v_email from auth.users where id = v_uid;
    perform app_private.dev_account_from_meta(v_uid, v_email, p || jsonb_build_object('terms', 'yes'), 'portal');
  else
    update app_private.developer_accounts set
      name = coalesce(left(nullif(btrim(p->>'name'), ''), 200), name),
      company = coalesce(left(nullif(btrim(p->>'company'), ''), 200), company),
      website = coalesce(left(nullif(btrim(p->>'website'), ''), 300), website),
      use_case = coalesce(left(nullif(btrim(p->>'use_case'), ''), 2000), use_case),
      expected_volume = coalesce(left(nullif(btrim(p->>'expected_volume'), ''), 100), expected_volume),
      updated_at = now()
     where user_id = v_uid;
  end if;
  perform app_private.log_audit('developer.profile', 'developer_account', v_uid::text, null, 'Developer updated their profile', '{}'::jsonb, null);
  return public.dev_portal_state();
end $$;

create or replace function public.dev_request_production(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare v_uid uuid := auth.uid(); d app_private.developer_accounts; v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into d from app_private.developer_accounts where user_id = v_uid;
  if not found then raise exception 'Complete your developer profile first.' using errcode = '22023'; end if;
  if d.status = 'approved' then raise exception 'You already have production access.' using errcode = '22023'; end if;
  if d.status = 'suspended' then raise exception 'Your developer account is suspended. Contact hello@loadboot.com.' using errcode = '42501'; end if;
  if exists (select 1 from app_private.developer_access_requests where user_id = v_uid and status = 'pending') then
    raise exception 'Your request is already with our team.' using errcode = '22023';
  end if;
  if coalesce(btrim(coalesce(p->>'use_case', d.use_case)), '') = '' then
    raise exception 'Tell us what you are building.' using errcode = '22023';
  end if;
  if coalesce(btrim(coalesce(d.company, p->>'company')), '') = '' then
    raise exception 'Add your company name to your profile first.' using errcode = '22023';
  end if;
  insert into app_private.developer_access_requests (user_id, use_case, expected_volume, integration_url, message)
  values (v_uid, left(coalesce(nullif(btrim(p->>'use_case'), ''), d.use_case), 2000),
          left(coalesce(nullif(btrim(p->>'expected_volume'), ''), d.expected_volume), 100),
          left(nullif(btrim(p->>'integration_url'), ''), 300), left(nullif(btrim(p->>'message'), ''), 2000))
  returning id into v_id;
  perform app_private.log_audit('developer.request', 'developer_account', v_uid::text, null, 'Developer requested production access',
                                jsonb_build_object('request_id', v_id), null);
  begin
    insert into app_private.notifications (recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff', 'in_app', 'developer.production_requested',
      jsonb_build_object('title', 'Developer wants production API access', 'body', coalesce(d.company, d.email) || ' requested production access.',
                         'tone', 'info', 'url', '/app/command-center/#/api360?id=' || v_uid), 'sent', now());
  exception when others then null; end;
  begin
    perform app_private.sys_email(app_private.lc_alert_email(), 'developer.production_requested',
      '[LoadBoot] Production API request: ' || coalesce(d.company, d.email),
      '<p><b>' || coalesce(d.company, '(no company)') || '</b> (' || coalesce(d.email, '') || ') asked for production API access.</p>'
      || '<p>What they are building: ' || coalesce(left(coalesce(nullif(btrim(p->>'use_case'), ''), d.use_case), 400), '—') || '</p>'
      || '<p>Review it in <a href="https://loadboot.com/app/command-center/#/api360?id=' || v_uid || '">Command Center → API 360</a>.</p>',
      null, 'developer.production_requested:' || v_id);
  exception when others then null; end;
  return public.dev_portal_state();
end $$;

create or replace function public.dev_usage(p_days int default 7)
returns jsonb language plpgsql stable security definer set search_path to 'app_private', 'public' as $$
declare v_uid uuid := auth.uid(); v_days int := least(greatest(coalesce(p_days, 7), 1), 90);
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return jsonb_build_object(
    'days', v_days,
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', g.day::date, 'calls', coalesce(c.calls, 0), 'errors', coalesce(c.errors, 0)) order by g.day)
        from generate_series(current_date - (v_days - 1), current_date, interval '1 day') g(day)
        left join (select created_at::date d, count(*) calls, count(*) filter (where status >= 400) errors
                     from app_private.api_request_log where owner_user_id = v_uid and created_at >= current_date - (v_days - 1)
                    group by 1) c on c.d = g.day::date), '[]'::jsonb),
    'keys', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'prefix', k.prefix,
        'calls', (select count(*) from app_private.api_request_log l where l.key_id = k.id and l.created_at >= current_date - (v_days - 1)),
        'errors', (select count(*) from app_private.api_request_log l where l.key_id = k.id and l.status >= 400 and l.created_at >= current_date - (v_days - 1)),
        'last_call', k.last_used_at) order by k.created_at desc)
        from app_private.api_keys k where k.owner_user_id = v_uid and k.revoked_at is null), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('at', l.created_at, 'method', l.method, 'endpoint', l.endpoint,
        'status', l.status, 'latency_ms', l.latency_ms, 'prefix', l.key_prefix, 'error', l.error, 'sandbox', l.sandbox) order by l.created_at desc)
        from (select * from app_private.api_request_log where owner_user_id = v_uid order by created_at desc limit 25) l), '[]'::jsonb));
end $$;

-- 6 ── CC API 360 (staff) ────────────────────────────────────────────────────────────────────────────────
create or replace function app_private.api360_require(p_manage boolean)
returns void language plpgsql stable security definer set search_path to 'app_private', 'public' as $$
begin
  if auth.uid() is null or not (public.has_global_permission('integrations.manage')
       or (not p_manage and public.has_global_permission('integrations.view'))) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;
revoke execute on function app_private.api360_require(boolean) from public;

create or replace function public.cc_api360_list(p_status text default null, p_search text default null)
returns jsonb language plpgsql stable security definer set search_path to 'app_private', 'public' as $$
declare v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform app_private.api360_require(false);
  return jsonb_build_object(
    'kpis', jsonb_build_object(
      'accounts', (select count(*) from app_private.developer_accounts),
      'pending', (select count(*) from app_private.developer_accounts where status = 'pending'),
      'approved', (select count(*) from app_private.developer_accounts where status = 'approved'),
      'suspended', (select count(*) from app_private.developer_accounts where status = 'suspended'),
      'open_requests', (select count(*) from app_private.developer_access_requests where status = 'pending'),
      'active_keys', (select count(*) from app_private.api_keys where revoked_at is null),
      'calls_today', (select count(*) from app_private.api_request_log where created_at >= current_date),
      'errors_today', (select count(*) from app_private.api_request_log where created_at >= current_date and status >= 400)),
    'settings', (select to_jsonb(s) - 'id' from app_private.developer_settings s where id = 1),
    'accounts', coalesce((select jsonb_agg(to_jsonb(a) order by a.open_request desc, a.created_at desc) from (
        select d.user_id, coalesce(d.email, u.email) email, d.name, d.company, d.website, d.status, d.source, d.created_at,
               exists (select 1 from app_private.developer_access_requests r where r.user_id = d.user_id and r.status = 'pending') open_request,
               (select count(*) from app_private.api_keys k where k.owner_user_id = d.user_id and k.revoked_at is null) keys_active,
               (select max(k.last_used_at) from app_private.api_keys k where k.owner_user_id = d.user_id) last_call,
               (select count(*) from app_private.api_request_log l where l.owner_user_id = d.user_id and l.created_at >= current_date - 6) calls_7d,
               (select count(*) from app_private.api_request_log l where l.owner_user_id = d.user_id and l.created_at >= current_date - 6 and l.status >= 400) errors_7d
          from app_private.developer_accounts d left join auth.users u on u.id = d.user_id
         where (p_status is null or p_status = '' or d.status = p_status
                or (p_status = 'requests' and exists (select 1 from app_private.developer_access_requests r where r.user_id = d.user_id and r.status = 'pending')))
           and (v_q is null or coalesce(d.email, u.email) ilike '%' || v_q || '%' or d.company ilike '%' || v_q || '%'
                or d.name ilike '%' || v_q || '%' or d.website ilike '%' || v_q || '%')
         limit 500) a), '[]'::jsonb),
    -- keys whose owner is NOT a developer account: staff-created partner keys, carriers/brokers using the old portal
    'other_keys', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'owner', k.owner_user_id, 'owner_email', u.email,
        'owner_company', nullif(pr.company, ''), 'name', k.name, 'prefix', k.prefix, 'scopes', k.scopes, 'partner_slug', k.partner_slug,
        'created_at', k.created_at, 'last_used_at', k.last_used_at, 'revoked_at', k.revoked_at) order by k.revoked_at nulls first, k.created_at desc)
        from app_private.api_keys k left join auth.users u on u.id = k.owner_user_id left join public.profiles pr on pr.id = k.owner_user_id
       where not exists (select 1 from app_private.developer_accounts d where d.user_id = k.owner_user_id)
         and (v_q is null or u.email ilike '%' || v_q || '%' or k.name ilike '%' || v_q || '%' or k.prefix ilike '%' || v_q || '%')), '[]'::jsonb));
end $$;

create or replace function public.cc_api360_get(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private', 'public' as $$
declare v_keys uuid[]; v_reqs uuid[];
begin
  perform app_private.api360_require(false);
  select coalesce(array_agg(id), '{}') into v_keys from app_private.api_keys where owner_user_id = p_user;
  select coalesce(array_agg(id), '{}') into v_reqs from app_private.developer_access_requests where user_id = p_user;
  return jsonb_build_object(
    'user_id', p_user,
    'login', (select jsonb_build_object('email', u.email, 'created_at', u.created_at, 'confirmed', u.email_confirmed_at is not null,
                'last_sign_in_at', u.last_sign_in_at) from auth.users u where u.id = p_user),
    'profile', (select to_jsonb(p) from (select pr.company, pr.contact_name, pr.role, pr.status from public.profiles pr where pr.id = p_user) p),
    'account', (select to_jsonb(d) from app_private.developer_accounts d where d.user_id = p_user),
    'keys', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'prefix', k.prefix, 'scopes', k.scopes,
        'partner_slug', k.partner_slug, 'rate_limit_per_min', k.rate_limit_per_min, 'created_at', k.created_at, 'last_used_at', k.last_used_at,
        'revoked_at', k.revoked_at, 'revoke_reason', k.revoke_reason, 'staff_issued', k.created_by is distinct from k.owner_user_id and k.created_by is not null,
        'calls_30d', (select count(*) from app_private.api_request_log l where l.key_id = k.id and l.created_at >= current_date - 29),
        'errors_30d', (select count(*) from app_private.api_request_log l where l.key_id = k.id and l.status >= 400 and l.created_at >= current_date - 29))
        order by k.revoked_at nulls first, k.created_at desc) from app_private.api_keys k where k.owner_user_id = p_user), '[]'::jsonb),
    'usage', coalesce((select jsonb_agg(jsonb_build_object('day', g.day::date, 'calls', coalesce(c.calls, 0), 'errors', coalesce(c.errors, 0)) order by g.day)
        from generate_series(current_date - 29, current_date, interval '1 day') g(day)
        left join (select created_at::date d, count(*) calls, count(*) filter (where status >= 400) errors
                     from app_private.api_request_log where owner_user_id = p_user and created_at >= current_date - 29 group by 1) c
          on c.d = g.day::date), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(to_jsonb(l) - 'owner_user_id' order by l.created_at desc)
        from (select * from app_private.api_request_log where owner_user_id = p_user order by created_at desc limit 50) l), '[]'::jsonb),
    'errors', coalesce((select jsonb_agg(to_jsonb(l) - 'owner_user_id' order by l.created_at desc)
        from (select * from app_private.api_request_log where owner_user_id = p_user and status >= 400 order by created_at desc limit 50) l), '[]'::jsonb),
    'webhooks', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'url', w.url, 'event_types', w.event_types,
        'active', w.active, 'created_at', w.created_at,
        'deliveries', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'event_type', x.event_type, 'status', x.status,
            'attempts', x.attempts, 'note', x.note, 'created_at', x.created_at) order by x.created_at desc)
            from (select * from app_private.webhook_deliveries dd where dd.endpoint_id = w.id order by dd.created_at desc limit 20) x), '[]'::jsonb))
        order by w.created_at desc) from app_private.webhook_endpoints w where w.owner_user = p_user), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from app_private.developer_access_requests r where r.user_id = p_user), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('at', a.occurred_at, 'action', a.action, 'summary', a.summary,
        'actor', (select u.email from auth.users u where u.id = a.actor_id), 'detail', a.detail) order by a.occurred_at desc)
        from (select * from app_private.audit_logs a
               where (a.target_type = 'developer_account' and a.target_id = p_user::text)
                  or (a.target_type = 'api_key' and a.target_id = any (select unnest(v_keys)::text))
               order by a.occurred_at desc limit 100) a), '[]'::jsonb));
end $$;

-- status: approved | denied | suspended | pending (reinstate / reopen). Sends the matching catalog email.
create or replace function public.cc_api360_set_status(p_user uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare d app_private.developer_accounts; v_req uuid; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform app_private.api360_require(true);
  if p_status not in ('approved', 'denied', 'suspended', 'pending') then raise exception 'bad status' using errcode = '22023'; end if;
  select * into d from app_private.developer_accounts where user_id = p_user for update;
  if not found then raise exception 'not a developer account' using errcode = '22023'; end if;
  if p_status in ('denied', 'suspended') and v_note is null then
    raise exception 'Write the reason — the developer sees it.' using errcode = '22023';
  end if;
  if d.status = p_status then return public.cc_api360_get(p_user); end if;
  update app_private.developer_accounts
     set status = p_status, status_reason = case when p_status in ('denied', 'suspended') then v_note else null end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note, updated_at = now()
   where user_id = p_user;
  if p_status in ('approved', 'denied') then
    update app_private.developer_access_requests
       set status = p_status, decided_by = auth.uid(), decided_at = now(), decision_note = v_note
     where user_id = p_user and status = 'pending'
     returning id into v_req;
  end if;
  perform app_private.log_audit('developer.status', 'developer_account', p_user::text, null,
    'Developer status ' || d.status || ' → ' || p_status, jsonb_build_object('from', d.status, 'to', p_status, 'note', v_note, 'request_id', v_req), null);
  if p_status = 'approved' then
    perform app_private.dev_send_email(p_user, 'developer.production_approved', jsonb_build_object('note', v_note, 'request_id', v_req));
  elsif p_status = 'denied' then
    perform app_private.dev_send_email(p_user, 'developer.production_denied', jsonb_build_object('note', v_note, 'request_id', v_req));
  elsif p_status = 'suspended' then
    perform app_private.dev_send_email(p_user, 'developer.suspended', jsonb_build_object('note', v_note));
  end if;
  return public.cc_api360_get(p_user);
end $$;

create or replace function public.cc_api360_revoke_key(p_key uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare k app_private.api_keys;
begin
  perform app_private.api360_require(true);
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Write the reason — the key owner sees it.' using errcode = '22023'; end if;
  update app_private.api_keys set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = left(btrim(p_reason), 500)
   where id = p_key and revoked_at is null returning * into k;
  if not found then raise exception 'key not found or already revoked' using errcode = '22023'; end if;
  perform app_private.log_audit('apikey.revoke', 'api_key', p_key::text, null, 'API key revoked by staff: ' || k.prefix,
                                jsonb_build_object('owner', k.owner_user_id, 'reason', p_reason), null);
  perform app_private.dev_send_email(k.owner_user_id, 'developer.key_revoked',
    jsonb_build_object('note', p_reason, 'key_prefix', k.prefix, 'key_name', k.name, 'key_id', k.id));
  return public.cc_api360_get(k.owner_user_id);
end $$;

-- Staff issues a key on behalf of any login (partner programmes). The full key is returned ONCE to staff.
create or replace function public.cc_api360_issue_key(p_owner uuid, p_name text, p_scopes text[], p_partner_slug text default null,
                                                      p_rate_limit_per_min int default null)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public', 'extensions' as $$
declare v_prefix text; v_secret text; v_full text; v_id uuid; v_scopes text[];
begin
  perform app_private.api360_require(true);
  if not exists (select 1 from auth.users where id = p_owner) then raise exception 'owner not found' using errcode = '22023'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name is required' using errcode = '22023'; end if;
  select array_agg(distinct lower(btrim(x)) order by lower(btrim(x))) into v_scopes from unnest(p_scopes) x where btrim(x) <> '';
  if v_scopes is null or not (v_scopes <@ array['read', 'write', 'sandbox']) then raise exception 'Scopes must be sandbox, read or write.' using errcode = '22023'; end if;
  if 'sandbox' = any(v_scopes) and cardinality(v_scopes) > 1 then raise exception 'A sandbox key cannot also carry read or write.' using errcode = '22023'; end if;
  v_prefix := encode(extensions.gen_random_bytes(3), 'hex');
  v_secret := encode(extensions.gen_random_bytes(24), 'hex');
  v_full := 'lb_' || v_prefix || '_' || v_secret;
  insert into app_private.api_keys (owner_user_id, name, prefix, key_hash, scopes, created_by, partner_slug, rate_limit_per_min)
  values (p_owner, left(trim(p_name), 80), 'lb_' || v_prefix, encode(extensions.digest(v_full, 'sha256'), 'hex'), v_scopes, auth.uid(),
          nullif(regexp_replace(lower(btrim(coalesce(p_partner_slug, ''))), '[^a-z0-9-]+', '-', 'g'), ''), p_rate_limit_per_min)
  returning id into v_id;
  perform app_private.log_audit('apikey.issue', 'api_key', v_id::text, null, 'API key issued by staff: ' || trim(p_name),
                                jsonb_build_object('owner', p_owner, 'scopes', v_scopes), null);
  return jsonb_build_object('id', v_id, 'key', v_full, 'prefix', 'lb_' || v_prefix, 'scopes', v_scopes);
end $$;

create or replace function public.cc_api360_save_profile(p_user uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare v_slug text;
begin
  perform app_private.api360_require(true);
  if not exists (select 1 from app_private.developer_accounts where user_id = p_user) then raise exception 'not a developer account' using errcode = '22023'; end if;
  if p ? 'partner_slug' then
    v_slug := nullif(trim(both '-' from regexp_replace(lower(btrim(coalesce(p->>'partner_slug', ''))), '[^a-z0-9-]+', '-', 'g')), '');
    if v_slug is null then raise exception 'partner slug cannot be empty' using errcode = '22023'; end if;
    if exists (select 1 from app_private.developer_accounts where partner_slug = v_slug and user_id <> p_user) then
      raise exception 'that partner slug is taken' using errcode = '22023'; end if;
  end if;
  update app_private.developer_accounts set
    company = case when p ? 'company' then left(nullif(btrim(p->>'company'), ''), 200) else company end,
    website = case when p ? 'website' then left(nullif(btrim(p->>'website'), ''), 300) else website end,
    verification_note = case when p ? 'verification_note' then nullif(btrim(p->>'verification_note'), '') else verification_note end,
    staff_notes = case when p ? 'staff_notes' then nullif(btrim(p->>'staff_notes'), '') else staff_notes end,
    partner_slug = coalesce(v_slug, partner_slug),
    updated_at = now()
  where user_id = p_user;
  perform app_private.log_audit('developer.profile', 'developer_account', p_user::text, null, 'Staff edited developer profile',
                                jsonb_build_object('fields', (select jsonb_agg(k) from jsonb_object_keys(p) k)), null);
  return public.cc_api360_get(p_user);
end $$;

create or replace function public.cc_api360_settings_save(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare s app_private.developer_settings;
begin
  perform app_private.api360_require(true);
  update app_private.developer_settings set
    rate_limit_per_min = coalesce((p->>'rate_limit_per_min')::int, rate_limit_per_min),
    sandbox_self_serve = coalesce((p->>'sandbox_self_serve')::boolean, sandbox_self_serve),
    log_retention_days = coalesce((p->>'log_retention_days')::int, log_retention_days),
    updated_by = auth.uid(), updated_at = now()
  where id = 1 returning * into s;
  perform app_private.log_audit('developer.settings', 'developer_settings', '1', null, 'API settings changed', p, null);
  return to_jsonb(s) - 'id';
end $$;

-- A developer who still signed up as a "carrier" (old cached portal) is moved over by staff, same rules as bl_dev_0502:
-- only when the login has no carrier documents or settlements; its carrier org is closed (old status kept); no deletes.
create or replace function public.cc_api360_reclassify(p_email text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare v_uid uuid; v_org uuid; v_st text;
begin
  perform app_private.api360_require(true);
  select id into v_uid from auth.users where lower(email) = lower(btrim(p_email));
  if v_uid is null then raise exception 'no login with that email' using errcode = '22023'; end if;
  if exists (select 1 from app_private.developer_accounts where user_id = v_uid) then raise exception 'already a developer account' using errcode = '22023'; end if;
  if exists (select 1 from public.documents d where d.carrier_id = v_uid) or exists (select 1 from public.settlements s where s.carrier_id = v_uid) then
    raise exception 'This login has carrier documents or settlements — it is a real carrier. Not moved.' using errcode = '22023';
  end if;
  if exists (select 1 from public.organization_memberships m join public.organizations o on o.id = m.org_id
              where m.user_id = v_uid and o.kind <> 'carrier') then
    raise exception 'This login belongs to a broker/shipper/partner org. Not moved.' using errcode = '22023';
  end if;
  select o.id, o.status into v_org, v_st from public.organizations o where o.owner_user_id = v_uid and o.kind = 'carrier' order by o.created_at limit 1;
  insert into app_private.developer_accounts (user_id, email, source, status, partner_slug, verification_note, legacy_org_id, legacy_org_status, created_at)
  select v_uid, lower(u.email), 'reclassified', 'pending', app_private.dev_unique_slug(null, v_uid),
         'Reclassified from carrier by staff' || coalesce(': ' || nullif(btrim(p_note), ''), '.'), v_org, v_st, u.created_at
    from auth.users u where u.id = v_uid;
  if v_org is not null and coalesce(v_st, '') <> 'closed' then update public.organizations set status = 'closed' where id = v_org; end if;
  perform app_private.log_audit('developer.reclassify', 'developer_account', v_uid::text, v_org, 'Staff moved a carrier signup to developer accounts',
                                jsonb_build_object('legacy_org', v_org, 'legacy_org_status', v_st, 'note', p_note), null);
  return public.cc_api360_get(v_uid);
end $$;

-- 7 ── grants: nothing to anon; portal + CC functions to authenticated (they check auth.uid / permission inside) ──
do $$
declare f text;
begin
  foreach f in array array[
    'public.cc_create_api_key(text,text[])', 'public.cc_revoke_api_key(uuid)',
    'public.dev_portal_state()', 'public.dev_profile_save(jsonb)', 'public.dev_request_production(jsonb)', 'public.dev_usage(integer)',
    'public.cc_api360_list(text,text)', 'public.cc_api360_get(uuid)', 'public.cc_api360_set_status(uuid,text,text)',
    'public.cc_api360_revoke_key(uuid,text)', 'public.cc_api360_issue_key(uuid,text,text[],text,integer)',
    'public.cc_api360_save_profile(uuid,jsonb)', 'public.cc_api360_settings_save(jsonb)', 'public.cc_api360_reclassify(text,text)']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- 8 ── self-check ────────────────────────────────────────────────────────────────────────────────────────
do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'dev\_%' or p.proname like 'cc\_api360\_%' or p.proname in ('cc_create_api_key', 'cc_revoke_api_key'))
     and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then raise exception 'bl_dev_0502b: anon can execute %', v_bad; end if;
  if (select count(*) from app_private.email_catalog where key like 'developer.%') < 6 then raise exception 'bl_dev_0502b: catalog rows missing'; end if;
end $$;
