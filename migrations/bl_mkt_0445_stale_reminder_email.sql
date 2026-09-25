-- bl_mkt_0445 — Monday staff reminder when something on the public site is stale (plan step 7).
-- Applied: staging 2026-09-25. Prod: with 0442–0444.
-- CLAUDE.md §6: the email lives in the catalog. Key site.data_stale, class S, audience staff, preference group
-- staff_internal (never blockable), trigger cron app_private.cron_site_data_stale (Mon 12:59 UTC), idempotency key
-- site.data_stale:<date> so a re-run the same day cannot send twice. Recipient = app_private.lc_alert_email(),
-- the same staff alert address every other staff mail uses. Contact line: none (staff mail; no customer number).
--
--   app_private.site_stale_list()        one definition of "stale", shared by cc_site_facts() and the cron
--   app_private.cron_site_data_stale(p_dry boolean)   sends when the list is not empty; p_dry=true only returns it

create or replace function app_private.site_stale_list()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare v_rates_asof date; v_diesel_asof date; v_stale jsonb := '[]'::jsonb;
begin
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
  return v_stale;
end $$;
revoke execute on function app_private.site_stale_list() from public;

-- cc_site_facts(): same payload as 0443, stale block now = site_stale_list()
create or replace function public.cc_site_facts()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare cfg app_private.site_publish_config; eia app_private.eia_config;
begin
  perform app_private.site_pub_require_staff();
  select * into cfg from app_private.site_publish_config where id = 1;
  select * into eia from app_private.eia_config where id = 1;
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
    'stale', app_private.site_stale_list(),
    'today', current_date);
end $$;

-- catalog row (CLAUDE.md §6)
insert into app_private.email_catalog (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note, stop_condition,
                                       preference_group, unsub_allowed, status, cc_deep_link)
values ('site.data_stale', 'Site data stale (staff)',
        'Monday reminder to staff when a number on the public site is older than it should be: market rates > 7 days, diesel > 8 days or its pull failed, a registry fact past its cadence or due date. Lists what is stale and links to CC → Market data.',
        'S', 'staff', 'cron', 'app_private.cron_site_data_stale', 'weekly (Mon 12:59 UTC)', 'once per day (idempotency site.data_stale:<date>)',
        'nothing stale', 'staff_internal', false, 'live', '#/market-rates')
on conflict (key) do update set name = excluded.name, purpose = excluded.purpose, class = excluded.class, audience_role = excluded.audience_role,
  trigger_type = excluded.trigger_type, trigger_source = excluded.trigger_source, cadence = excluded.cadence, cap_note = excluded.cap_note,
  stop_condition = excluded.stop_condition, preference_group = excluded.preference_group, unsub_allowed = excluded.unsub_allowed,
  status = 'live', cc_deep_link = excluded.cc_deep_link;

create or replace function app_private.cron_site_data_stale(p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_stale jsonb := app_private.site_stale_list(); v_n integer; v_subj text; v_html text; v_text text; v_items text; v_lines text;
begin
  v_n := jsonb_array_length(v_stale);
  if v_n = 0 then return jsonb_build_object('sent', false, 'stale', 0); end if;
  select string_agg('<li><b>' || (e->>'what') || '</b> — ' || (e->>'msg') || coalesce(' (as of ' || (e->>'as_of') || ')', '') || '</li>', ''),
         string_agg('- ' || (e->>'what') || ': ' || (e->>'msg') || coalesce(' (as of ' || (e->>'as_of') || ')', ''), E'\n')
    into v_items, v_lines
    from jsonb_array_elements(v_stale) e;
  v_subj := format('[LoadBoot] %s stale item%s on the public site', v_n, case when v_n = 1 then '' else 's' end);
  v_html := '<p>Something on loadboot.com is older than it should be:</p><ul>' || v_items || '</ul>'
         || '<p>Open <a href="https://loadboot.com/command-center.html#/market-rates">Command Center → Market data</a>, '
         || 'type this week''s three DAT Trendlines numbers and press Publish; check the Diesel tab if the pull failed. The site rebuilds itself.</p>';
  v_text := 'Something on loadboot.com is older than it should be:' || E'\n' || v_lines || E'\n\n'
         || 'Open Command Center > Market data (https://loadboot.com/command-center.html#/market-rates), type this week''s three DAT Trendlines numbers and press Publish.';
  if p_dry then return jsonb_build_object('sent', false, 'dry', true, 'stale', v_n, 'to', app_private.lc_alert_email(), 'subject', v_subj, 'text', v_text); end if;
  perform app_private.sys_email(app_private.lc_alert_email(), 'site.data_stale', v_subj, v_html, v_text, 'site.data_stale:' || current_date);
  return jsonb_build_object('sent', true, 'stale', v_n, 'to', app_private.lc_alert_email());
end $$;
revoke execute on function app_private.cron_site_data_stale(boolean) from public;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'lb-site-data-stale') then perform cron.unschedule('lb-site-data-stale'); end if;
  perform cron.schedule('lb-site-data-stale', '59 12 * * 1', 'select app_private.cron_site_data_stale()');
end $$;

do $$
begin
  if not exists (select 1 from app_private.email_catalog where key = 'site.data_stale' and preference_group = 'staff_internal') then
    raise exception 'bl_mkt_0445: catalog row missing'; end if;
end $$;
