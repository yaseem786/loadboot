-- bl_mkt_0442 — Market data registry + staff Publish (docs/MARKET-DATA-SYSTEM-PLAN.md §3, steps 1–2).
-- Applied: staging 2026-09-25. Prod: after the step-8 staging test.
-- Owner's goal (25 Sep 2026): no page on loadboot.com shows stale data. Every weekly number and every
-- weekly word is controlled from ONE place in CC and published from there; Publish rebuilds the site.
--
-- What this adds:
--   app_private.site_facts            registry of site numbers + short texts the owner edits in CC
--   app_private.site_publish_config   the Netlify build hook (owner pastes it in CC, never in a migration)
--   app_private.site_publish_log      every rebuild request and its outcome
--   app_private.site_rebuild()        fires the hook via pg_net, records the request
--   app_private.mkt_derive()          3 anchors (van/reefer/flatbed) -> all 8 equipment rows + low/high
--   public.get_public_site_facts()    ANON read for build_site.py: facts + diesel + rates as_of  (NEW anon name)
--   public.cc_site_facts()            staff: everything the CC "Market data" screen shows, incl. stale flags
--   public.cc_site_fact_set()         staff: upsert one fact, as_of = today, optional rebuild
--   public.cc_site_publish_config_set()  staff: paste the build hook URL
--   public.cc_site_rebuild()          staff: manual rebuild button
--   public.cc_market_rates_preview()  staff: derived preview of the 8 rows before publishing
--   public.cc_market_rates_publish()  staff: validate (>15 % WoW needs confirm) -> rate_benchmarks +
--                                     rate_history + rate_standards rpm_* -> audit -> rebuild
-- Ratios / bands live in app_private.rate_standards (already CC-editable via cc_set_rate_standard), so the
-- derived numbers are never typed by hand. The ratios seeded below are the ones the Sep 2026 data used
-- (step deck 1.014×flatbed, conestoga 1.028×flatbed, power only / box truck 0.85×van, hotshot 0.795×van,
-- band 0.80–1.20×, power only + hotshot fixed 1.80–3.50).
-- The build hook is kept in app_private (like fmcsa_config.auth_key), the repo's convention for secrets a
-- Postgres function has to read; anon has no USAGE on app_private.
-- anon SECURITY DEFINER surface: +1 name (get_public_site_facts). Baseline doc updated in the same commit.

-- ---------------------------------------------------------------- tables
create table if not exists app_private.site_facts (
  key          text primary key check (key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),
  kind         text not null check (kind in ('number','text')),
  value        text not null,
  unit         text,
  as_of        date not null default current_date,
  source       text,
  cadence_days integer check (cadence_days is null or cadence_days > 0),   -- null: no expiry
  due_on       date,                                                        -- slow facts: date the source changes
  pages        text[] not null default '{}',
  note         text,
  updated_by   uuid,
  updated_at   timestamptz not null default now()
);
comment on table app_private.site_facts is
  'Site-wide numbers and short weekly texts the owner edits in CC (Market data). Read by build_site.py via get_public_site_facts().';

create table if not exists app_private.site_publish_config (
  id              integer primary key default 1 check (id = 1),
  build_hook_url  text,
  enabled         boolean not null default true,
  last_fired_at   timestamptz,
  last_fired_by   uuid,
  last_reason     text,
  last_request_id bigint,
  last_error      text,
  updated_at      timestamptz not null default now()
);
insert into app_private.site_publish_config (id) values (1) on conflict (id) do nothing;

create table if not exists app_private.site_publish_log (
  id         bigserial primary key,
  reason     text not null,
  outcome    text not null,          -- fired | not_configured | disabled | error
  detail     jsonb,
  actor      uuid,
  request_id bigint,
  error      text,
  created_at timestamptz not null default now()
);
create index if not exists site_publish_log_created_idx on app_private.site_publish_log (created_at desc);

-- ---------------------------------------------------------------- ratios + bands (CC-editable via cc_set_rate_standard)
insert into app_private.rate_standards (key, label, value, unit, version) values
  ('ratio_step_deck',     'Step deck = flatbed ×',             '1.014', 'ratio', 1),
  ('ratio_conestoga',     'Conestoga = flatbed ×',             '1.028', 'ratio', 1),
  ('ratio_power_only',    'Power only = dry van ×',            '0.85',  'ratio', 1),
  ('ratio_box_truck',     'Box truck = dry van ×',             '0.85',  'ratio', 1),
  ('ratio_hotshot',       'Hotshot = dry van ×',               '0.795', 'ratio', 1),
  ('band_low_pct',        'Low end of range = avg ×',          '0.80',  'ratio', 1),
  ('band_high_pct',       'High end of range = avg ×',         '1.20',  'ratio', 1),
  ('band_fixed_low',      'Fixed range low (power only, hotshot)',  '1.80', '$/mi', 1),
  ('band_fixed_high',     'Fixed range high (power only, hotshot)', '3.50', '$/mi', 1),
  ('publish_max_wow_pct', 'Publish: max week-on-week move before confirm', '15', '%', 1)
on conflict (key) do nothing;

-- ---------------------------------------------------------------- helpers
create or replace function app_private.site_pub_require_staff()
returns void language plpgsql security definer set search_path to 'app_private, public' as $$
begin
  if not (public.has_global_permission('settings.manage')
          or public.has_global_permission('content.publish')
          or public.has_global_permission('seo.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;

create or replace function app_private.rate_standard_num(p_key text, p_default numeric)
returns numeric language sql stable security definer set search_path to 'app_private, public' as $$
  select coalesce((select nullif(regexp_replace(value, '[^0-9.]', '', 'g'), '')::numeric
                     from app_private.rate_standards where key = p_key), p_default);
$$;

-- Fires the Netlify build hook. Never raises: the caller's write must not roll back because Netlify blinked.
create or replace function app_private.site_rebuild(p_reason text, p_detail jsonb default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare cfg app_private.site_publish_config; v_req bigint; v_out text; v_err text;
begin
  select * into cfg from app_private.site_publish_config where id = 1;
  if cfg.id is null or coalesce(trim(cfg.build_hook_url), '') = '' then v_out := 'not_configured';
  elsif not cfg.enabled then v_out := 'disabled';
  else
    begin
      select net.http_post(url := cfg.build_hook_url,
                           headers := '{"Content-Type":"application/json"}'::jsonb,
                           body := jsonb_build_object('trigger_title', left('LoadBoot CC: ' || p_reason, 120)),
                           timeout_milliseconds := 15000) into v_req;
      v_out := 'fired';
    exception when others then
      v_out := 'error'; v_err := sqlerrm;
    end;
  end if;
  update app_private.site_publish_config
     set last_fired_at = case when v_out = 'fired' then now() else last_fired_at end,
         last_fired_by = case when v_out = 'fired' then auth.uid() else last_fired_by end,
         last_reason = p_reason, last_request_id = v_req, last_error = v_err, updated_at = now()
   where id = 1;
  insert into app_private.site_publish_log (reason, outcome, detail, actor, request_id, error)
  values (p_reason, v_out, p_detail, auth.uid(), v_req, v_err);
  return jsonb_build_object('outcome', v_out, 'request_id', v_req, 'error', v_err);
end $$;

-- 3 anchors -> 8 rows. Rounded to cents. Returns [{equipment, rpm_avg, rpm_low, rpm_high, basis}].
create or replace function app_private.mkt_derive(p_dry_van numeric, p_reefer numeric, p_flatbed numeric)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare
  r_sd numeric := app_private.rate_standard_num('ratio_step_deck', 1.014);
  r_cg numeric := app_private.rate_standard_num('ratio_conestoga', 1.028);
  r_po numeric := app_private.rate_standard_num('ratio_power_only', 0.85);
  r_bt numeric := app_private.rate_standard_num('ratio_box_truck', 0.85);
  r_hs numeric := app_private.rate_standard_num('ratio_hotshot', 0.795);
  b_lo numeric := app_private.rate_standard_num('band_low_pct', 0.80);
  b_hi numeric := app_private.rate_standard_num('band_high_pct', 1.20);
  f_lo numeric := app_private.rate_standard_num('band_fixed_low', 1.80);
  f_hi numeric := app_private.rate_standard_num('band_fixed_high', 3.50);
  rows_ jsonb := '[]'::jsonb; e record;
begin
  for e in
    select * from (values
      ('Dry Van',    round(p_dry_van, 2),        false, 'anchor'),
      ('Reefer',     round(p_reefer, 2),         false, 'anchor'),
      ('Flatbed',    round(p_flatbed, 2),        false, 'anchor'),
      ('Step Deck',  round(p_flatbed * r_sd, 2), false, 'flatbed × ' || r_sd),
      ('Conestoga',  round(p_flatbed * r_cg, 2), false, 'flatbed × ' || r_cg),
      ('Power Only', round(p_dry_van * r_po, 2), true,  'dry van × ' || r_po),
      ('Box Truck',  round(p_dry_van * r_bt, 2), false, 'dry van × ' || r_bt),
      ('Hotshot',    round(p_dry_van * r_hs, 2), true,  'dry van × ' || r_hs)
    ) v(equipment, avg, fixed_band, basis)
  loop
    rows_ := rows_ || jsonb_build_object(
      'equipment', e.equipment, 'rpm_avg', e.avg,
      'rpm_low',  case when e.fixed_band then f_lo else round(e.avg * b_lo, 2) end,
      'rpm_high', case when e.fixed_band then f_hi else round(e.avg * b_hi, 2) end,
      'basis', e.basis);
  end loop;
  return rows_;
end $$;

-- ---------------------------------------------------------------- public read (ANON — build_site.py)
create or replace function public.get_public_site_facts()
returns jsonb language sql stable security definer set search_path to 'app_private, public' as $$
  select jsonb_build_object(
    'facts', coalesce((select jsonb_object_agg(f.key, jsonb_build_object(
                'value', f.value, 'kind', f.kind, 'unit', f.unit, 'as_of', f.as_of, 'source', f.source))
              from app_private.site_facts f), '{}'::jsonb),
    'diesel', coalesce((select jsonb_object_agg(p.region, jsonb_build_object('usd_gal', p.diesel_usd_gal, 'as_of', p.as_of))
              from app_private.fuel_prices p), '{}'::jsonb),
    'rates_as_of', (select max(as_of) from app_private.rate_benchmarks where scope = 'national'),
    'generated_at', now());
$$;

-- ---------------------------------------------------------------- staff read
create or replace function public.cc_site_facts()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare cfg app_private.site_publish_config; v_rates_asof date; v_diesel_asof date; v_stale jsonb := '[]'::jsonb;
begin
  perform app_private.site_pub_require_staff();
  select * into cfg from app_private.site_publish_config where id = 1;
  select max(as_of) into v_rates_asof from app_private.rate_benchmarks where scope = 'national';
  select as_of into v_diesel_asof from app_private.fuel_prices where region = 'US average';
  if v_rates_asof is null or v_rates_asof < current_date - 7 then
    v_stale := v_stale || jsonb_build_object('what', 'rates', 'as_of', v_rates_asof, 'msg', 'Market rates are older than 7 days'); end if;
  if v_diesel_asof is null or v_diesel_asof < current_date - 8 then
    v_stale := v_stale || jsonb_build_object('what', 'diesel', 'as_of', v_diesel_asof, 'msg', 'Diesel price is older than 8 days'); end if;
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

-- ---------------------------------------------------------------- staff writes
-- p_opts: kind ('number'|'text', needed for a new key), unit, source, as_of (default today), cadence_days,
--         due_on, note, rebuild (default true)
create or replace function public.cc_site_fact_set(p_key text, p_value text, p_opts jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_kind text; v_val text := trim(coalesce(p_value, '')); v_rb jsonb; v_asof date; v_old text;
begin
  perform app_private.site_pub_require_staff();
  if p_key !~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$' then raise exception 'key must look like area.thing (lower case, dots)' using errcode = '22023'; end if;
  if v_val = '' then raise exception 'value required' using errcode = '22023'; end if;
  select kind, value into v_kind, v_old from app_private.site_facts where key = p_key;
  v_kind := coalesce(p_opts->>'kind', v_kind);
  if v_kind is null then raise exception 'new key: kind (number|text) required' using errcode = '22023'; end if;
  if v_kind = 'number' and v_val !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception 'number expected' using errcode = '22023'; end if;
  v_asof := coalesce((p_opts->>'as_of')::date, current_date);
  insert into app_private.site_facts as f (key, kind, value, unit, as_of, source, cadence_days, due_on, note, updated_by, updated_at)
  values (p_key, v_kind, v_val, p_opts->>'unit', v_asof, p_opts->>'source', (p_opts->>'cadence_days')::int, (p_opts->>'due_on')::date,
          p_opts->>'note', auth.uid(), now())
  on conflict (key) do update set
    kind = excluded.kind, value = excluded.value, as_of = excluded.as_of, updated_by = excluded.updated_by, updated_at = now(),
    unit = coalesce(excluded.unit, f.unit), source = coalesce(excluded.source, f.source),
    cadence_days = coalesce(excluded.cadence_days, f.cadence_days), due_on = coalesce(excluded.due_on, f.due_on),
    note = coalesce(excluded.note, f.note);
  perform app_private.log_audit('site.fact_set', 'site_fact', p_key, null,
    format('%s: %s -> %s', p_key, coalesce(v_old, '(new)'), v_val), p_opts, null);
  if coalesce((p_opts->>'rebuild')::boolean, true) then v_rb := app_private.site_rebuild('fact ' || p_key); end if;
  return jsonb_build_object('ok', true, 'key', p_key, 'value', v_val, 'as_of', v_asof, 'rebuild', v_rb);
end $$;

create or replace function public.cc_site_publish_config_set(p_url text, p_enabled boolean default true)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_url text := nullif(trim(coalesce(p_url, '')), '');
begin
  perform app_private.site_pub_require_staff();
  if v_url is not null and v_url !~ '^https://[A-Za-z0-9.-]+/' then raise exception 'https URL expected' using errcode = '22023'; end if;
  update app_private.site_publish_config
     set build_hook_url = coalesce(v_url, build_hook_url), enabled = p_enabled, updated_at = now() where id = 1;
  perform app_private.log_audit('site.publish_config_set', 'site_publish_config', '1', null,
    case when v_url is null then 'enabled=' || p_enabled else 'build hook set, enabled=' || p_enabled end, null, null);
  return jsonb_build_object('ok', true, 'configured', v_url is not null or exists (select 1 from app_private.site_publish_config where id = 1 and build_hook_url is not null), 'enabled', p_enabled);
end $$;

create or replace function public.cc_site_rebuild(p_reason text default 'manual')
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
begin
  perform app_private.site_pub_require_staff();
  return app_private.site_rebuild(left(coalesce(nullif(trim(p_reason), ''), 'manual'), 120));
end $$;

create or replace function public.cc_market_rates_preview(p_dry_van numeric, p_reefer numeric, p_flatbed numeric)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
begin
  perform app_private.site_pub_require_staff();
  return app_private.mkt_derive(p_dry_van, p_reefer, p_flatbed);
end $$;

-- Publish: as_of is ALWAYS the publish day; the DAT week goes in the source line. A >publish_max_wow_pct move
-- on any anchor returns {ok:false, needs_confirm:true, moves:[...]} until p_confirmed is true.
create or replace function public.cc_market_rates_publish(
  p_dry_van numeric, p_reefer numeric, p_flatbed numeric, p_week date,
  p_source text default null, p_confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare
  v_max numeric := app_private.rate_standard_num('publish_max_wow_pct', 15);
  v_rows jsonb; r jsonb; v_cur numeric; v_pct numeric; v_moves jsonb := '[]'::jsonb;
  v_asof date := current_date; v_source text; v_rb jsonb; v_slug text;
begin
  perform app_private.site_pub_require_staff();
  if p_dry_van is null or p_reefer is null or p_flatbed is null then raise exception 'all three anchors required' using errcode = '22023'; end if;
  if least(p_dry_van, p_reefer, p_flatbed) < 1.00 or greatest(p_dry_van, p_reefer, p_flatbed) > 8.00 then
    raise exception 'anchor outside $1.00–$8.00/mi — check the numbers' using errcode = '22023'; end if;
  if p_week is null or p_week > current_date or p_week < current_date - 21 then
    raise exception 'week must be a date within the last 21 days' using errcode = '22023'; end if;
  v_source := coalesce(nullif(trim(p_source), ''), 'DAT Trendlines national averages, week of ' || to_char(p_week, 'DD Mon YYYY'));
  v_rows := app_private.mkt_derive(p_dry_van, p_reefer, p_flatbed);

  for r in select * from jsonb_array_elements(v_rows) loop
    select rpm_avg into v_cur from app_private.rate_benchmarks where scope = 'national' and equipment = r->>'equipment';
    if v_cur is not null and v_cur > 0 then
      v_pct := round(((r->>'rpm_avg')::numeric - v_cur) / v_cur * 100, 1);
      if abs(v_pct) > v_max then
        v_moves := v_moves || jsonb_build_object('equipment', r->>'equipment', 'from', v_cur, 'to', (r->>'rpm_avg')::numeric, 'pct', v_pct);
      end if;
    end if;
  end loop;
  if jsonb_array_length(v_moves) > 0 and not coalesce(p_confirmed, false) then
    return jsonb_build_object('ok', false, 'needs_confirm', true, 'max_pct', v_max, 'moves', v_moves, 'rows', v_rows);
  end if;

  for r in select * from jsonb_array_elements(v_rows) loop
    insert into app_private.rate_benchmarks as b (scope, equipment, rpm_avg, rpm_low, rpm_high, window_days, source, as_of)
    values ('national', r->>'equipment', (r->>'rpm_avg')::numeric, (r->>'rpm_low')::numeric, (r->>'rpm_high')::numeric, 7, v_source, v_asof)
    on conflict (scope, equipment) do update set rpm_avg = excluded.rpm_avg, rpm_low = excluded.rpm_low, rpm_high = excluded.rpm_high,
      window_days = excluded.window_days, source = excluded.source, as_of = excluded.as_of;
    insert into app_private.rate_history (equipment, as_of, rpm, source)
    values (r->>'equipment', v_asof, (r->>'rpm_avg')::numeric, v_source)
    on conflict (equipment, as_of) do update set rpm = excluded.rpm, source = excluded.source;
    -- keep rate_standards rpm_* in step (outreach_prepare and the CC standards screen read these)
    v_slug := 'rpm_' || lower(replace(r->>'equipment', ' ', '_'));
    update app_private.rate_standards set value = (r->>'rpm_avg')::text, version = version + 1, updated_by = auth.uid(), updated_at = now()
     where key = v_slug and value is distinct from (r->>'rpm_avg')::text;
  end loop;

  perform app_private.log_audit('rates.published', 'rate_benchmarks', v_asof::text, null,
    format('van %s reefer %s flatbed %s (%s)%s', p_dry_van, p_reefer, p_flatbed, v_source,
           case when jsonb_array_length(v_moves) > 0 then ' — confirmed >' || v_max || '% move' else '' end),
    jsonb_build_object('rows', v_rows, 'moves', v_moves, 'week', p_week), null);
  v_rb := app_private.site_rebuild('rates ' || v_asof, jsonb_build_object('week', p_week));
  return jsonb_build_object('ok', true, 'as_of', v_asof, 'source', v_source, 'rows', v_rows, 'moves', v_moves, 'rebuild', v_rb);
end $$;

-- ---------------------------------------------------------------- grants (CLAUDE.md §4: explicit anon revoke on every new public fn)
revoke execute on function public.cc_site_facts()                                                from public, anon;
revoke execute on function public.cc_site_fact_set(text, text, jsonb)                             from public, anon;
revoke execute on function public.cc_site_publish_config_set(text, boolean)                       from public, anon;
revoke execute on function public.cc_site_rebuild(text)                                           from public, anon;
revoke execute on function public.cc_market_rates_preview(numeric, numeric, numeric)              from public, anon;
revoke execute on function public.cc_market_rates_publish(numeric, numeric, numeric, date, text, boolean) from public, anon;
grant  execute on function public.cc_site_facts()                                                to authenticated, service_role;
grant  execute on function public.cc_site_fact_set(text, text, jsonb)                             to authenticated, service_role;
grant  execute on function public.cc_site_publish_config_set(text, boolean)                       to authenticated, service_role;
grant  execute on function public.cc_site_rebuild(text)                                           to authenticated, service_role;
grant  execute on function public.cc_market_rates_preview(numeric, numeric, numeric)              to authenticated, service_role;
grant  execute on function public.cc_market_rates_publish(numeric, numeric, numeric, date, text, boolean) to authenticated, service_role;
-- the one intentionally anon-callable read (public site build), same shape as get_public_market_rates
revoke execute on function public.get_public_site_facts() from public;
grant  execute on function public.get_public_site_facts() to anon, authenticated, service_role;

-- app_private helpers: no PUBLIC execute (anon has no schema usage either, belt and braces)
revoke execute on function app_private.site_pub_require_staff()                  from public;
revoke execute on function app_private.rate_standard_num(text, numeric)          from public;
revoke execute on function app_private.site_rebuild(text, jsonb)                 from public;
revoke execute on function app_private.mkt_derive(numeric, numeric, numeric)     from public;

do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('cc_site_facts','cc_site_fact_set','cc_site_publish_config_set','cc_site_rebuild',
                                                'cc_market_rates_preview','cc_market_rates_publish')
     and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then raise exception 'bl_mkt_0442: anon can still execute %', v_bad; end if;
end $$;
