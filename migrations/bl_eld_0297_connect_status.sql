-- bl_eld_0297 — ELD connect: honest status + live-test support.
-- Found 29 Aug on prod: a carrier pasted a non-Samsara string, the card said "✓ Provider API token on
-- file — polling active", and eld-poll got 401 every 5 minutes with nobody told. Also: merely OPENING the
-- Fleet page called carrier_eld_setup('generic') and inserted an 'active' row — so every carrier who ever
-- looked at the card has a phantom "generic" integration.
--   1) last_error / last_error_at / last_ok_at / org_name on eld_integrations, written by eld-poll (service role)
--      and by the connect flow (eld-test edge function → client → carrier_eld_setup with the org name).
--   2) carrier_eld_status() — READ-ONLY view for the card (no insert side-effect).
--   3) carrier_eld_disconnect(provider) — status 'disconnected', token cleared.
--   4) carrier_eld_setup gains p_org_name (from the live test) and resets the error fields on (re)connect.
--   5) eld_mark_error(ingest_token, msg) — service-role only, called by eld-poll on provider failure.
--   6) eld_hos_targets: EVERY active integration with a token (not only dispatcher-assigned carriers) — so a
--      valid token produces last_ok_at within 5 minutes and the card can say "connected · synced 3 min ago".
--      Drivers still only land on trucks through the existing name-match / single-truck rules.
-- Additive. Staging first, then prod.

alter table app_private.eld_integrations
  add column if not exists last_error text,
  add column if not exists last_error_at timestamptz,
  add column if not exists last_ok_at timestamptz,
  add column if not exists org_name text;

create or replace function public.carrier_eld_status()
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select coalesce((select jsonb_agg(jsonb_build_object(
      'provider', e.provider, 'status', e.status, 'has_api_token', e.api_token is not null,
      'org_name', e.org_name, 'last_ping_at', e.last_ping_at, 'last_ok_at', e.last_ok_at,
      'last_error', e.last_error, 'last_error_at', e.last_error_at, 'updated_at', e.updated_at,
      'token', case when e.provider = 'generic' then e.ingest_token end) order by e.provider)
    from app_private.eld_integrations e where e.carrier_id = app_private.my_carrier_org()), '[]'::jsonb);
$$;

create or replace function public.carrier_eld_disconnect(p_provider text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid := app_private.my_carrier_org();
begin
  if v_org is null then raise exception 'carrier account required' using errcode='42501'; end if;
  update app_private.eld_integrations set status = 'disconnected', api_token = null, last_error = null, last_error_at = null, updated_at = now()
   where carrier_id = v_org and provider = p_provider;
  return jsonb_build_object('ok', found);
end $$;

-- same signature as before + p_org_name; ACL re-asserted below because the signature changes
drop function if exists public.carrier_eld_setup(text, boolean, text);
create or replace function public.carrier_eld_setup(p_provider text default 'generic', p_rotate boolean default false, p_api_token text default null, p_org_name text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid; r record; v_tok text := nullif(trim(coalesce(p_api_token,'')),'');
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'carrier account required' using errcode='42501'; end if;
  if coalesce(p_provider,'generic') not in ('generic','samsara','motive') then raise exception 'unknown provider' using errcode='22023'; end if;
  select * into r from app_private.eld_integrations where carrier_id = v_org and provider = coalesce(p_provider,'generic');
  if r.id is null then
    insert into app_private.eld_integrations(carrier_id, provider, status, api_token, org_name)
    values (v_org, coalesce(p_provider,'generic'), 'active', v_tok, p_org_name) returning * into r;
  else
    update app_private.eld_integrations set
      status = 'active',
      api_token = coalesce(v_tok, api_token),
      org_name = coalesce(p_org_name, case when v_tok is not null then null else org_name end),
      last_error = case when v_tok is not null then null else last_error end,
      last_error_at = case when v_tok is not null then null else last_error_at end,
      ingest_token = case when p_rotate then gen_random_uuid() else ingest_token end,
      updated_at = now()
    where id = r.id returning * into r;
  end if;
  return jsonb_build_object('provider', r.provider, 'status', r.status, 'token', r.ingest_token,
    'has_api_token', r.api_token is not null, 'org_name', r.org_name, 'last_ping_at', r.last_ping_at, 'last_ok_at', r.last_ok_at,
    'webhook', 'POST https://__PROJECT_REF__.supabase.co/rest/v1/rpc/eld_ingest  body: {"p_token":"' || r.ingest_token || '","p_lat":<lat>,"p_lng":<lng>}  header: apikey: <anon key>');
  -- (__PROJECT_REF__ is substituted per project at apply time: rwscphuhpjoudvljvmdk prod / snslhvmkjusozgjelghi staging)
end $$;

create or replace function public.eld_mark_error(p_token uuid, p_error text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  if current_setting('request.jwt.claims', true)::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  update app_private.eld_integrations set last_error = left(coalesce(p_error,'error'), 200), last_error_at = now(), updated_at = now() where ingest_token = p_token;
  return jsonb_build_object('ok', found);
end $$;

-- successful HOS/GPS pulls stamp last_ok_at (and clear the error) — hook into the two ingest paths
create or replace function app_private.eld_touch_ok(p_id uuid)
returns void language sql security definer set search_path = app_private, public as $$
  update app_private.eld_integrations set last_ok_at = now(), last_ping_at = now(), last_error = null, last_error_at = null, updated_at = now() where id = p_id;
$$;

create or replace function public.eld_hos_targets()
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  if current_setting('request.jwt.claims', true)::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('provider', e.provider, 'api_token', e.api_token, 'ingest_token', e.ingest_token))
    from app_private.eld_integrations e
    where e.status = 'active' and e.api_token is not null and e.provider in ('samsara','motive')), '[]'::jsonb);
end $$;

-- eld_hos_ingest: stamp ok via the helper (keeps the rest of 0293/0295 byte-identical)
do $$
declare src text;
begin
  src := pg_get_functiondef('public.eld_hos_ingest(uuid, jsonb)'::regprocedure);
  if position('update app_private.eld_integrations set last_ping_at = now(), updated_at = now() where id = v_int.id;' in src) = 0 then raise exception 'expected statement not found in eld_hos_ingest'; end if;
  src := replace(src, 'update app_private.eld_integrations set last_ping_at = now(), updated_at = now() where id = v_int.id;', 'perform app_private.eld_touch_ok(v_int.id);');
  execute src;
  -- same for the webhook / GPS path
  src := pg_get_functiondef('public.eld_ingest(uuid, double precision, double precision, double precision, timestamptz)'::regprocedure);
  if position('update app_private.eld_integrations set last_ping_at = now(), updated_at = now() where id = v_int.id;' in src) = 0 then raise exception 'expected statement not found in eld_ingest'; end if;
  src := replace(src, 'update app_private.eld_integrations set last_ping_at = now(), updated_at = now() where id = v_int.id;', 'perform app_private.eld_touch_ok(v_int.id);');
  execute src;
end $$;

-- the phantom rows: 'generic' integrations with no token, never pinged, created by the old card's auto-insert
update app_private.eld_integrations set status = 'disconnected', updated_at = now()
 where provider = 'generic' and api_token is null and last_ping_at is null and status = 'active';

revoke all on function public.carrier_eld_status() from public, anon;
revoke all on function public.carrier_eld_disconnect(text) from public, anon;
revoke all on function public.carrier_eld_setup(text, boolean, text, text) from public, anon;
revoke all on function public.eld_mark_error(uuid, text) from public, anon, authenticated;
revoke all on function app_private.eld_touch_ok(uuid) from public, anon, authenticated;
grant execute on function public.carrier_eld_status(), public.carrier_eld_disconnect(text), public.carrier_eld_setup(text, boolean, text, text) to authenticated;
grant execute on function public.eld_mark_error(uuid, text) to service_role;
