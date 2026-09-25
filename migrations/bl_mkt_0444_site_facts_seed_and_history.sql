-- bl_mkt_0444 — Registry seed + what the build reads (docs/MARKET-DATA-SYSTEM-PLAN.md §3, step 4).
-- Applied: staging 2026-09-25. Prod: with 0442/0443 after the step-8 test.
--
--   get_public_site_facts()   replaced: + rate_history (the dated weekly reports are built from it now, so
--                             refresh_rate_snapshot.py's weekly ritual is retired), and diesel is sent ONLY while a
--                             verified pull (EIA 'ok' or a CC 'manual' override) stands behind the fuel_prices rows —
--                             the $6.529 that sat in fuel_prices on 25 Sep 2026 (typed in by hand on 23 Sep, source
--                             unknown, EIA says ~$3.8) never reaches a page; the build keeps its fallback figure until
--                             the first real EIA pull lands.
--   site_facts seed           the four slow facts build_site.py reads with fact(): IRS per diem (due 1 Oct 2026) and
--                             the FTR Class 8 line. Values = what the site already said; nothing new is asserted.
--   eia_config                prod has no lb-stripe-worker cron to copy from (0443's seed), so: anon bearer from any
--                             cron row that calls an edge function, and a fresh random worker token when none was
--                             copied. cc_diesel_worker_token() shows it to staff so the owner can set the function
--                             secret EIA_WORKER_TOKEN himself (the function accepts EIA_WORKER_TOKEN or LB_WORKER_TOKEN).
-- No anon-surface change (get_public_site_facts keeps its grants through CREATE OR REPLACE; asserted below).

create or replace function public.get_public_site_facts()
returns jsonb language sql stable security definer set search_path to 'app_private, public' as $$
  with verified as (
    select exists (
      select 1 from app_private.diesel_pull_log l
       where l.outcome in ('ok', 'manual')
         and l.created_at >= coalesce((select max(updated_at) from app_private.fuel_prices), now()) - interval '5 minutes'
    ) as ok
  )
  select jsonb_build_object(
    'facts', coalesce((select jsonb_object_agg(f.key, jsonb_build_object(
                'value', f.value, 'kind', f.kind, 'unit', f.unit, 'as_of', f.as_of, 'source', f.source))
              from app_private.site_facts f), '{}'::jsonb),
    'diesel', case when (select ok from verified)
              then coalesce((select jsonb_object_agg(p.region, jsonb_build_object('usd_gal', p.diesel_usd_gal, 'as_of', p.as_of))
                             from app_private.fuel_prices p), '{}'::jsonb)
              else '{}'::jsonb end,
    'diesel_verified', (select ok from verified),
    'rates_as_of', (select max(as_of) from app_private.rate_benchmarks where scope = 'national'),
    'rate_history', coalesce((select jsonb_agg(jsonb_build_object('equipment', h.equipment, 'as_of', h.as_of, 'rpm', h.rpm, 'source', h.source)
                              order by h.as_of, h.equipment) from app_private.rate_history h), '[]'::jsonb),
    'generated_at', now());
$$;

insert into app_private.site_facts (key, kind, value, unit, as_of, source, cadence_days, due_on, pages, note) values
  ('perdiem.conus',          'number', '80', '$/day', '2025-10-01', 'IRS special transportation industry M&IE rate, CONUS (FY2026)', null, '2026-10-01',
     '{truck-driver-per-diem-2026}', 'Changes every 1 Oct with the federal fiscal year. Check the IRS per diem notice for FY2027 and update; the page, its title, the calculator and the FAQ follow.'),
  ('perdiem.oconus',         'number', '86', '$/day', '2025-10-01', 'IRS special transportation industry M&IE rate, outside CONUS (FY2026)', null, '2026-10-01',
     '{truck-driver-per-diem-2026}', 'Same notice as perdiem.conus.'),
  ('perdiem.deductible_pct', 'number', '80', '%',     '2025-10-01', 'IRC 274(n)(3) - workers subject to DOT hours-of-service', null, null,
     '{truck-driver-per-diem-2026}', 'Statutory; only changes by act of Congress.'),
  ('stat.class8.orders_line','text',   '30,500 Class 8 net orders in June 2026, up 241% year over year', null, '2026-07-10', 'FTR, June 2026 Class 8 orders', 90, null,
     '{should-i-buy-a-truck-before-2027-epa-rule}', 'The one sentence in the EPA-2027 article that quotes a monthly statistic. Refresh with FTR/ACT''s latest month.')
on conflict (key) do nothing;

-- eia_config: fill what 0443's copy could not (prod)
update app_private.eia_config c
   set function_url = coalesce(c.function_url,
         (select (regexp_match(j.command, '(https://[a-z0-9]+\.supabase\.co)/functions/v1/'))[1] || '/functions/v1/eia-diesel-pull'
            from cron.job j where j.command ~ 'functions/v1' and j.command ~ 'supabase\.co' limit 1)),
       anon_key = coalesce(c.anon_key,
         (select (regexp_match(j.command, 'Bearer ([A-Za-z0-9._-]+)'))[1] from cron.job j where j.command ~ 'Bearer eyJ' limit 1)),
       worker_token = coalesce(c.worker_token, encode(gen_random_bytes(24), 'hex')),
       updated_at = now()
 where c.id = 1;

create or replace function public.cc_diesel_worker_token()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
begin
  perform app_private.site_pub_require_staff();
  return (select jsonb_build_object('worker_token', worker_token, 'function_url', function_url, 'anon_key_set', anon_key is not null)
            from app_private.eia_config where id = 1);
end $$;
revoke execute on function public.cc_diesel_worker_token() from public, anon;
grant  execute on function public.cc_diesel_worker_token() to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.cc_diesel_worker_token()', 'execute') then raise exception 'bl_mkt_0444: anon can execute cc_diesel_worker_token'; end if;
  if not has_function_privilege('anon', 'public.get_public_site_facts()', 'execute') then raise exception 'bl_mkt_0444: get_public_site_facts lost its anon grant'; end if;
  if (select count(*) from app_private.site_facts where key like 'perdiem.%') <> 3 then raise exception 'bl_mkt_0444: per diem seed missing'; end if;
end $$;
