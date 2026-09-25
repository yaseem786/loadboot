-- bl_mkt_0443 — Diesel pulls itself (docs/MARKET-DATA-SYSTEM-PLAN.md §3, step 3).
-- Applied: staging 2026-09-25. Prod: with bl_mkt_0442, after the step-8 test.
-- Owner decision (25 Sep 2026): diesel comes from the EIA API automatically, never typed by hand.
--
--   app_private.eia_config        function url + the anon bearer + the x-lb-worker token the cron sends
--                                 (copied ONCE, at apply time, from the existing lb-stripe-worker cron row —
--                                 nothing secret is written in this file; if that row is missing the config
--                                 stays empty and CC says "not configured")
--   app_private.diesel_pull_log   one row per pull: outcome ok | partial | eia_error | eia_key_missing |
--                                 implausible | not_configured | manual
--   app_private.diesel_pull_kick()  pg_cron entry point: net.http_post to the edge function
--   public.diesel_pull_record()   SERVICE-ROLE ONLY write from the edge function: upsert fuel_prices, log,
--                                 rebuild the site only when the EIA period moved
--   public.cc_diesel_pull_now()   staff: "Pull now" button
--   public.cc_diesel_set()        staff: manual override of one region (logged as 'manual', rebuilds)
--   public.cc_diesel_config_set() staff: fill / fix eia_config by hand if the copy above found nothing
--   public.cc_site_facts()        replaced: adds 'diesel_pull' (last pull, config state)
--   cron 'lb-diesel-pull'         Tue + Wed 14:00 UTC (EIA publishes Mon ~5 pm ET, Tue after a holiday)
-- Edge function: supabase/functions/eia-diesel-pull (verify_jwt on). Secret EIA_API_KEY: owner sets it.
-- No new anon name: diesel_pull_record is revoked from public, anon AND authenticated (service_role only).

create table if not exists app_private.eia_config (
  id              integer primary key default 1 check (id = 1),
  function_url    text,
  anon_key        text,
  worker_token    text,
  last_kick_at    timestamptz,
  last_request_id bigint,
  updated_at      timestamptz not null default now()
);
insert into app_private.eia_config (id, function_url, anon_key, worker_token)
select 1,
       (regexp_match(j.command, 'url := ''(https://[a-z0-9]+\.supabase\.co)/functions/v1/'))[1] || '/functions/v1/eia-diesel-pull',
       (regexp_match(j.command, 'Bearer ([A-Za-z0-9._-]+)'))[1],
       (regexp_match(j.command, 'x-lb-worker'', ''([0-9a-f]+)'))[1]
  from cron.job j where j.jobname = 'lb-stripe-worker'
on conflict (id) do nothing;
insert into app_private.eia_config (id) values (1) on conflict (id) do nothing;

create table if not exists app_private.diesel_pull_log (
  id         bigserial primary key,
  outcome    text not null,
  period     date,
  rows_n     integer,
  changed    boolean,
  error      text,
  raw        jsonb,
  actor      uuid,
  created_at timestamptz not null default now()
);
create index if not exists diesel_pull_log_created_idx on app_private.diesel_pull_log (created_at desc);

create or replace function app_private.diesel_pull_kick()
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare cfg app_private.eia_config; v_req bigint;
begin
  select * into cfg from app_private.eia_config where id = 1;
  if cfg.id is null or cfg.function_url is null or cfg.anon_key is null or cfg.worker_token is null then
    insert into app_private.diesel_pull_log (outcome, error, actor) values ('not_configured', 'eia_config is incomplete (function_url / anon_key / worker_token)', auth.uid());
    return jsonb_build_object('outcome', 'not_configured');
  end if;
  select net.http_post(url := cfg.function_url,
                       headers := jsonb_build_object('Content-Type', 'application/json',
                                                     'Authorization', 'Bearer ' || cfg.anon_key,
                                                     'x-lb-worker', cfg.worker_token),
                       body := '{}'::jsonb, timeout_milliseconds := 30000) into v_req;
  update app_private.eia_config set last_kick_at = now(), last_request_id = v_req, updated_at = now() where id = 1;
  return jsonb_build_object('outcome', 'kicked', 'request_id', v_req);
end $$;

-- Called by the edge function with the service role. p_rows: [{region, usd_gal, as_of}]
create or replace function public.diesel_pull_record(p_outcome text, p_period date, p_rows jsonb, p_error text, p_raw jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_before date; v_after date; v_changed boolean := false; v_n integer := 0; r jsonb; v_rb jsonb;
begin
  if coalesce(auth.role(), current_setting('request.jwt.claims', true)::jsonb->>'role', '') <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'service role only' using errcode = '42501';
  end if;
  if p_outcome in ('ok', 'partial') and jsonb_typeof(p_rows) = 'array' then
    select max(as_of) into v_before from app_private.fuel_prices;
    for r in select * from jsonb_array_elements(p_rows) loop
      if (r->>'usd_gal')::numeric between 1.00 and 12.00 and (r->>'as_of')::date <= current_date then
        insert into app_private.fuel_prices as f (region, diesel_usd_gal, as_of, updated_at)
        values (r->>'region', (r->>'usd_gal')::numeric, (r->>'as_of')::date, now())
        on conflict (region) do update set diesel_usd_gal = excluded.diesel_usd_gal, as_of = excluded.as_of, updated_at = now()
        where f.as_of is distinct from excluded.as_of or f.diesel_usd_gal is distinct from excluded.diesel_usd_gal;
        v_n := v_n + 1;
      end if;
    end loop;
    select max(as_of) into v_after from app_private.fuel_prices;
    v_changed := v_after is distinct from v_before;
    if v_changed then v_rb := app_private.site_rebuild('diesel ' || v_after, jsonb_build_object('rows', v_n)); end if;
  end if;
  insert into app_private.diesel_pull_log (outcome, period, rows_n, changed, error, raw)
  values (p_outcome, p_period, v_n, v_changed, p_error, p_raw);
  return jsonb_build_object('ok', true, 'outcome', p_outcome, 'rows', v_n, 'changed', v_changed, 'rebuild', v_rb);
end $$;

create or replace function public.cc_diesel_pull_now()
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
begin
  perform app_private.site_pub_require_staff();
  return app_private.diesel_pull_kick();
end $$;

create or replace function public.cc_diesel_set(p_region text, p_usd_gal numeric, p_as_of date default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_asof date := coalesce(p_as_of, current_date); v_rb jsonb; v_old numeric;
begin
  perform app_private.site_pub_require_staff();
  if p_usd_gal is null or p_usd_gal < 1.00 or p_usd_gal > 12.00 then raise exception 'diesel $/gal outside 1.00–12.00' using errcode = '22023'; end if;
  if v_asof > current_date then raise exception 'as_of cannot be in the future' using errcode = '22023'; end if;
  select diesel_usd_gal into v_old from app_private.fuel_prices where region = p_region;
  if not found then raise exception 'unknown region %', p_region using errcode = '22023'; end if;
  update app_private.fuel_prices set diesel_usd_gal = round(p_usd_gal, 3), as_of = v_asof, updated_at = now() where region = p_region;
  insert into app_private.diesel_pull_log (outcome, period, rows_n, changed, error, actor)
  values ('manual', v_asof, 1, true, format('%s: %s -> %s', p_region, v_old, round(p_usd_gal, 3)), auth.uid());
  perform app_private.log_audit('site.diesel_set', 'fuel_prices', p_region, null, format('%s: %s -> %s (as of %s)', p_region, v_old, round(p_usd_gal, 3), v_asof), null, null);
  v_rb := app_private.site_rebuild('diesel manual ' || p_region);
  return jsonb_build_object('ok', true, 'region', p_region, 'usd_gal', round(p_usd_gal, 3), 'as_of', v_asof, 'rebuild', v_rb);
end $$;

create or replace function public.cc_diesel_config_set(p_function_url text default null, p_anon_key text default null, p_worker_token text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
begin
  perform app_private.site_pub_require_staff();
  update app_private.eia_config
     set function_url = coalesce(nullif(trim(p_function_url), ''), function_url),
         anon_key     = coalesce(nullif(trim(p_anon_key), ''), anon_key),
         worker_token = coalesce(nullif(trim(p_worker_token), ''), worker_token),
         updated_at = now()
   where id = 1;
  perform app_private.log_audit('site.diesel_config_set', 'eia_config', '1', null, 'eia_config updated', null, null);
  return jsonb_build_object('ok', true, 'configured',
    (select function_url is not null and anon_key is not null and worker_token is not null from app_private.eia_config where id = 1));
end $$;

-- cc_site_facts: + diesel_pull
create or replace function public.cc_site_facts()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare cfg app_private.site_publish_config; eia app_private.eia_config; v_rates_asof date; v_diesel_asof date; v_stale jsonb := '[]'::jsonb;
begin
  perform app_private.site_pub_require_staff();
  select * into cfg from app_private.site_publish_config where id = 1;
  select * into eia from app_private.eia_config where id = 1;
  select max(as_of) into v_rates_asof from app_private.rate_benchmarks where scope = 'national';
  select as_of into v_diesel_asof from app_private.fuel_prices where region = 'US average';
  if v_rates_asof is null or v_rates_asof < current_date - 7 then
    v_stale := v_stale || jsonb_build_object('what', 'rates', 'as_of', v_rates_asof, 'msg', 'Market rates are older than 7 days'); end if;
  if v_diesel_asof is null or v_diesel_asof < current_date - 8 then
    v_stale := v_stale || jsonb_build_object('what', 'diesel', 'as_of', v_diesel_asof, 'msg', 'Diesel price is older than 8 days'); end if;
  if exists (select 1 from (select outcome from app_private.diesel_pull_log order by created_at desc limit 1) l where l.outcome not in ('ok', 'manual')) then
    v_stale := v_stale || jsonb_build_object('what', 'diesel_pull', 'msg', 'Last diesel pull did not succeed'); end if;
  v_stale := v_stale || coalesce((select jsonb_agg(jsonb_build_object('what', 'fact:' || key, 'as_of', as_of, 'due_on', due_on,
                 'msg', case when due_on is not null and due_on <= current_date then 'Source changed on ' || to_char(due_on, 'DD Mon YYYY')
                             else 'Older than its ' || cadence_days || '-day cadence' end))
      from app_private.site_facts
     where (due_on is not null and due_on <= current_date)
        or (cadence_days is not null and as_of + cadence_days < current_date)), '[]'::jsonb);
  return jsonb_build_object(
    'facts', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'kind', kind, 'value', value, 'unit', unit,
                'as_of', as_of, 'source', source, 'cadence_days', cadence_days, 'due_on', due_on, 'pages', pages,
                'note', note, 'updated_at', updated_at) order by key) from app_private.site_facts), '[]'::jsonb),
    'rates', coalesce((select jsonb_agg(jsonb_build_object('equipment', equipment, 'rpm_avg', rpm_avg, 'rpm_low', rpm_low,
                'rpm_high', rpm_high, 'as_of', as_of, 'source', source) order by equipment)
              from app_private.rate_benchmarks where scope = 'national'), '[]'::jsonb),
    'rate_history', coalesce((select jsonb_agg(jsonb_build_object('equipment', equipment, 'as_of', as_of, 'rpm', rpm, 'source', source)
                order by as_of desc, equipment)
              from (select * from app_private.rate_history order by as_of desc limit 96) h), '[]'::jsonb),
    'standards', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'label', label, 'value', value, 'unit', unit) order by key)
              from app_private.rate_standards where key like 'ratio\_%' or key like 'band\_%' or key like 'publish\_%'), '[]'::jsonb),
    'diesel', coalesce((select jsonb_agg(jsonb_build_object('region', region, 'usd_gal', diesel_usd_gal, 'as_of', as_of, 'updated_at', updated_at)
                order by case when region = 'US average' then 0 else 1 end, region) from app_private.fuel_prices), '[]'::jsonb),
    'diesel_pull', jsonb_build_object(
        'configured', eia.function_url is not null and eia.anon_key is not null and eia.worker_token is not null,
        'last_kick_at', eia.last_kick_at,
        'last', (select jsonb_build_object('at', created_at, 'outcome', outcome, 'period', period, 'rows', rows_n, 'changed', changed, 'error', error)
                   from app_private.diesel_pull_log order by created_at desc limit 1),
        'log', coalesce((select jsonb_agg(jsonb_build_object('at', created_at, 'outcome', outcome, 'period', period, 'changed', changed, 'error', error) order by created_at desc)
                 from (select * from app_private.diesel_pull_log order by created_at desc limit 10) l), '[]'::jsonb)),
    'publish', jsonb_build_object(
        'configured', coalesce(trim(cfg.build_hook_url), '') <> '',
        'hook_hint', case when coalesce(trim(cfg.build_hook_url), '') = '' then null
                          else regexp_replace(cfg.build_hook_url, '^(https?://[^/]+/).*?([A-Za-z0-9]{4})$', '\1…\2') end,
        'enabled', cfg.enabled, 'last_fired_at', cfg.last_fired_at, 'last_reason', cfg.last_reason, 'last_error', cfg.last_error,
        'log', coalesce((select jsonb_agg(jsonb_build_object('at', created_at, 'reason', reason, 'outcome', outcome, 'error', error) order by created_at desc)
                 from (select * from app_private.site_publish_log order by created_at desc limit 12) l), '[]'::jsonb)),
    'stale', v_stale,
    'today', current_date);
end $$;

-- grants
revoke execute on function public.diesel_pull_record(text, date, jsonb, text, jsonb)   from public, anon, authenticated;
grant  execute on function public.diesel_pull_record(text, date, jsonb, text, jsonb)   to service_role;
revoke execute on function public.cc_diesel_pull_now()                                from public, anon;
revoke execute on function public.cc_diesel_set(text, numeric, date)                  from public, anon;
revoke execute on function public.cc_diesel_config_set(text, text, text)              from public, anon;
grant  execute on function public.cc_diesel_pull_now()                                to authenticated, service_role;
grant  execute on function public.cc_diesel_set(text, numeric, date)                  to authenticated, service_role;
grant  execute on function public.cc_diesel_config_set(text, text, text)              to authenticated, service_role;
revoke execute on function app_private.diesel_pull_kick()                             from public;

-- cron: Tue + Wed 14:00 UTC (10:00 ET). Idempotent.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'lb-diesel-pull') then perform cron.unschedule('lb-diesel-pull'); end if;
  perform cron.schedule('lb-diesel-pull', '0 14 * * 2,3', 'select app_private.diesel_pull_kick()');
end $$;

do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('diesel_pull_record', 'cc_diesel_pull_now', 'cc_diesel_set', 'cc_diesel_config_set')
     and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then raise exception 'bl_mkt_0443: anon can still execute %', v_bad; end if;
  if has_function_privilege('authenticated', 'public.diesel_pull_record(text, date, jsonb, text, jsonb)', 'execute') then
    raise exception 'bl_mkt_0443: authenticated can execute diesel_pull_record'; end if;
end $$;
