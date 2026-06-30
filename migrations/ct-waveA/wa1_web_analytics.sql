-- CONTROL TOWER WAVE A1 — FIRST-PARTY WEB ANALYTICS.
-- Privacy-safe, consent-aware first-party analytics. A public beacon posts pageviews/events via
-- track_web_event() (the ONLY anon-callable write, SECURITY DEFINER + validated + size-capped).
-- No PII: only an anonymous client id, page, referrer, UTM, device/browser/OS, coarse language,
-- and self-classified bot/internal flags. Exact geo is never claimed. Staff read via cc_web_*
-- RPCs (analytics.view). Additive; flag web_analytics_enabled.
-- Applied to STAGING as ledger name wa1_web_analytics.

create table if not exists app_private.web_sessions (
  id uuid primary key default gen_random_uuid(),
  anon_id text not null,
  first_seen timestamptz not null default now(), last_seen timestamptz not null default now(),
  landing_page text, referrer text, referrer_host text,
  utm_source text, utm_medium text, utm_campaign text,
  device text, browser text, os text, language text, timezone text,
  source_class text not null default 'direct',  -- direct/organic/referral/ai/social/paid/internal
  is_bot boolean not null default false, is_internal boolean not null default false,
  authenticated boolean not null default false, lead_id uuid,
  pageviews int not null default 0, events int not null default 0,
  form_started boolean not null default false, converted boolean not null default false,
  unique(anon_id));
create index if not exists web_sessions_last_idx on app_private.web_sessions(last_seen desc);
create index if not exists web_sessions_class_idx on app_private.web_sessions(source_class, last_seen desc);

create table if not exists app_private.web_events (
  id bigint generated always as identity primary key,
  anon_id text not null, event_type text not null default 'pageview'
    check (event_type in ('pageview','event','form_start','form_submit','conversion','outbound')),
  page text, prev_page text, label text, value numeric, meta jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now());
create index if not exists web_events_time_idx on app_private.web_events(occurred_at desc);
create index if not exists web_events_anon_idx on app_private.web_events(anon_id, occurred_at desc);

alter table app_private.web_sessions enable row level security;
alter table app_private.web_events enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;

-- AI / source classification from a referrer host
create or replace function app_private.classify_source(p_host text, p_utm_source text, p_utm_medium text)
returns text language sql immutable as $function$
  select case
    when p_host is null and p_utm_source is null then 'direct'
    when p_host ~* '(chatgpt|openai|perplexity|gemini|bard|copilot|claude|you\.com|phind)' or p_utm_source ~* '(chatgpt|openai|perplexity|gemini|copilot|claude|ai)' then 'ai'
    when p_host ~* '(google|bing|duckduckgo|yahoo|ecosia|brave)' and coalesce(p_utm_medium,'')<>'cpc' then 'organic'
    when p_host ~* '(facebook|instagram|twitter|x\.com|linkedin|t\.co|reddit|youtube|tiktok|pinterest)' then 'social'
    when coalesce(p_utm_medium,'') in ('cpc','ppc','paid') then 'paid'
    when p_host is not null then 'referral'
    else 'direct' end;
$function$;

-- PUBLIC INGEST — the only anon write. Validated, size-capped, no PII.
create or replace function public.track_web_event(p jsonb)
returns void language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_anon text; v_type text; v_page text; v_ref text; v_host text; v_class text; v_internal boolean; v_bot boolean;
begin
  v_anon := left(coalesce(p->>'anon_id',''), 64);
  if v_anon = '' then return; end if;  -- silently ignore invalid beacons
  v_type := coalesce(p->>'type','pageview');
  if v_type not in ('pageview','event','form_start','form_submit','conversion','outbound') then v_type := 'event'; end if;
  v_page := left(coalesce(p->>'page',''), 512);
  v_ref := left(coalesce(p->>'referrer',''), 512);
  v_host := nullif(left(coalesce(p->>'referrer_host',''),255),'');
  v_bot := coalesce((p->>'bot')::boolean,false) or coalesce(p->>'ua','') ~* '(bot|crawl|spider|headless|preview)';
  v_internal := coalesce((p->>'internal')::boolean,false);
  v_class := case when v_internal then 'internal' else app_private.classify_source(v_host, p->>'utm_source', p->>'utm_medium') end;

  insert into app_private.web_sessions(anon_id,landing_page,referrer,referrer_host,utm_source,utm_medium,utm_campaign,device,browser,os,language,timezone,source_class,is_bot,is_internal)
    values (v_anon, v_page, v_ref, v_host, left(p->>'utm_source',128), left(p->>'utm_medium',128), left(p->>'utm_campaign',128),
            left(p->>'device',32), left(p->>'browser',64), left(p->>'os',64), left(p->>'language',16), left(p->>'timezone',64), v_class, v_bot, v_internal)
  on conflict (anon_id) do update set last_seen=now(),
    pageviews = app_private.web_sessions.pageviews + (case when v_type='pageview' then 1 else 0 end),
    events = app_private.web_sessions.events + (case when v_type in ('event','outbound') then 1 else 0 end),
    form_started = app_private.web_sessions.form_started or v_type='form_start',
    converted = app_private.web_sessions.converted or v_type='conversion';

  insert into app_private.web_events(anon_id,event_type,page,prev_page,label,value,meta)
    values (v_anon, v_type, v_page, left(p->>'prev_page',512), left(p->>'label',128),
            nullif(p->>'value','')::numeric, coalesce(p->'meta','{}'::jsonb) - 'anon_id');
end; $function$;
revoke all on function public.track_web_event(jsonb) from public;
grant execute on function public.track_web_event(jsonb) to anon, authenticated;

-- STAFF READS
create or replace function public.cc_web_live(p_minutes int default 5)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_m int := least(greatest(coalesce(p_minutes,5),1),60);
begin
  if not public.has_global_permission('analytics.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object(
    'active_now',(select count(*) from app_private.web_sessions where last_seen > now()-(v_m||' minutes')::interval and not is_bot and not is_internal),
    'active_30m',(select count(*) from app_private.web_sessions where last_seen > now()-interval '30 minutes' and not is_bot and not is_internal),
    'by_page',(select coalesce(jsonb_agg(jsonb_build_object('page',page,'visitors',c) order by c desc),'[]'::jsonb) from (select coalesce(e.page,'/') page, count(distinct e.anon_id) c from app_private.web_events e join app_private.web_sessions s on s.anon_id=e.anon_id where e.occurred_at > now()-(v_m||' minutes')::interval and not s.is_bot and not s.is_internal group by 1 order by c desc limit 10) x),
    'visitors',(select coalesce(jsonb_agg(jsonb_build_object('anon',left(anon_id,8),'page',landing_page,'source',source_class,'device',device,'country',language,'last',last_seen,'pages',pageviews,'converted',converted) order by last_seen desc),'[]'::jsonb) from (select * from app_private.web_sessions where last_seen > now()-(v_m||' minutes')::interval and not is_bot and not is_internal order by last_seen desc limit 25) y));
end; $function$;

create or replace function public.cc_web_overview(p_days int default 7)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_d int := least(greatest(coalesce(p_days,7),1),90); v_from timestamptz;
begin
  if not public.has_global_permission('analytics.view') then raise exception 'not authorized' using errcode='42501'; end if;
  v_from := now()-(v_d||' days')::interval;
  return jsonb_build_object(
    'sessions',(select count(*) from app_private.web_sessions where first_seen>=v_from and not is_bot and not is_internal),
    'pageviews',(select count(*) from app_private.web_events e join app_private.web_sessions s on s.anon_id=e.anon_id where e.event_type='pageview' and e.occurred_at>=v_from and not s.is_bot and not s.is_internal),
    'conversions',(select count(*) from app_private.web_sessions where converted and first_seen>=v_from and not is_bot and not is_internal),
    'forms',(select count(*) from app_private.web_events where event_type='form_submit' and occurred_at>=v_from),
    'by_source',(select coalesce(jsonb_object_agg(source_class,c),'{}'::jsonb) from (select source_class, count(*) c from app_private.web_sessions where first_seen>=v_from and not is_bot and not is_internal group by 1) a),
    'daily',(select coalesce(jsonb_agg(jsonb_build_object('day',d::date,'sessions',(select count(*) from app_private.web_sessions s where s.first_seen::date=d::date and not s.is_bot and not s.is_internal)) order by d),'[]'::jsonb) from generate_series(v_from::date, current_date, interval '1 day') d));
end; $function$;

create or replace function public.cc_web_pages(p_days int default 7, p_limit int default 25)
returns table (page text, pageviews bigint, visitors bigint) language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_d int := least(greatest(coalesce(p_days,7),1),90); v_l int := least(greatest(coalesce(p_limit,25),1),200);
begin
  if not public.has_global_permission('analytics.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select coalesce(e.page,'/'), count(*) filter (where e.event_type='pageview'), count(distinct e.anon_id)
    from app_private.web_events e join app_private.web_sessions s on s.anon_id=e.anon_id
    where e.occurred_at > now()-(v_d||' days')::interval and not s.is_bot and not s.is_internal
    group by 1 order by 2 desc limit v_l;
end; $function$;

create or replace function public.cc_web_referrers(p_days int default 7, p_limit int default 25)
returns table (referrer_host text, source_class text, sessions bigint, conversions bigint) language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_d int := least(greatest(coalesce(p_days,7),1),90); v_l int := least(greatest(coalesce(p_limit,25),1),200);
begin
  if not public.has_global_permission('analytics.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select coalesce(referrer_host,'(direct)'), source_class, count(*), count(*) filter (where converted)
    from app_private.web_sessions where first_seen > now()-(v_d||' days')::interval and not is_bot and not is_internal
    group by 1,2 order by 3 desc limit v_l;
end; $function$;

create or replace function public.cc_web_ai_referrals(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_d int := least(greatest(coalesce(p_days,30),1),180);
begin
  if not public.has_global_permission('analytics.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object(
    'ai_sessions',(select count(*) from app_private.web_sessions where source_class='ai' and first_seen>now()-(v_d||' days')::interval),
    'ai_conversions',(select count(*) from app_private.web_sessions where source_class='ai' and converted and first_seen>now()-(v_d||' days')::interval),
    'by_host',(select coalesce(jsonb_agg(jsonb_build_object('host',referrer_host,'sessions',c) order by c desc),'[]'::jsonb) from (select coalesce(referrer_host,'(unknown)') referrer_host, count(*) c from app_private.web_sessions where source_class='ai' and first_seen>now()-(v_d||' days')::interval group by 1) x),
    'note','AI attribution uses HTTP referrer + UTM. Visitors arriving without a referrer fall into direct/unknown and cannot always be attributed.');
end; $function$;

revoke all on all functions in schema app_private from public, anon, authenticated;
do $$ declare fn text; begin
  for fn in select unnest(array['public.cc_web_live(int)','public.cc_web_overview(int)','public.cc_web_pages(int,int)','public.cc_web_referrers(int,int)','public.cc_web_ai_referrals(int)']) loop
    execute format('revoke execute on function %s from public, anon', fn); execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

insert into app_private.feature_flags(key,enabled,description,environment,audience)
  values ('web_analytics_enabled',false,'Enable the first-party Web Analytics control center','all','staff') on conflict (key) do nothing;
