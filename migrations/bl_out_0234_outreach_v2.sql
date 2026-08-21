-- bl_out_0234_outreach_v2 — Outreach engine v2: attribution, replies, real text part,
-- placeholder rendering ({STATE}/{RATE_*}/{OC}), never email existing users, batch spread.
-- ADDITIVE: no working engine is removed; all changes are new columns/functions or
-- create-or-replace of outreach-owned functions. Template content updated in bl_out_0235.

-- ---------------------------------------------------------------- 1) columns
alter table app_private.outreach_contacts
  add column if not exists clicked_at   timestamptz,
  add column if not exists replied_at   timestamptz,
  add column if not exists converted_at timestamptz,
  add column if not exists converted_user uuid;

alter table app_private.message_deliveries
  add column if not exists opened_at  timestamptz,
  add column if not exists clicked_at timestamptz;

alter table app_private.web_sessions
  add column if not exists outreach_contact uuid;

-- ------------------------------------------- 2) delivery mark: opens/clicks non-destructive
-- Resend open/click webhooks previously OVERWROTE status='delivered' with 'opened'/'clicked',
-- which would shrink every "delivered" count. Now they stamp timestamps and never regress status.
create or replace function public.cc_delivery_worker_mark(p_id uuid, p_status text, p_reason text default null, p_provider text default null, p_dedupe text default null)
returns text
language plpgsql security definer set search_path to 'app_private, public'
as $function$
declare v record; v_new text;
begin
  select * into v from app_private.message_deliveries where id=p_id for update;
  if v.id is null then raise exception 'delivery not found' using errcode='22023'; end if;
  if p_status not in ('sent','delivered','opened','clicked','bounced','complained','unsubscribed','failed') then raise exception 'invalid status' using errcode='22023'; end if;
  if p_status in ('opened','clicked') then
    -- engagement events: stamp, promote sent->delivered, never downgrade a terminal status
    update app_private.message_deliveries set
      opened_at  = coalesce(opened_at, now()),
      clicked_at = case when p_status='clicked' then coalesce(clicked_at, now()) else clicked_at end,
      status     = case when status='sent' then 'delivered' else status end,
      delivered_at = coalesce(delivered_at, now()),
      updated_at = now()
    where id=p_id;
    v_new := p_status;
  elsif p_status='failed' then
    v_new := case when v.attempts>=5 then 'dead_letter' else 'queued' end;
    update app_private.message_deliveries set status=v_new, failure_reason=p_reason, updated_at=now() where id=p_id;
  else
    update app_private.message_deliveries set status=p_status, failure_reason=p_reason,
      sent_at=coalesce(sent_at, case when p_status in ('sent','delivered') then now() end),
      delivered_at=case when p_status='delivered' then now() else delivered_at end, updated_at=now() where id=p_id;
    v_new := p_status;
    if p_status in ('bounced','complained') and v.recipient_email is not null then
      insert into app_private.suppressions(channel,address,reason) values ('email',lower(v.recipient_email),p_status) on conflict do nothing; end if;
  end if;
  insert into app_private.provider_events(delivery_id,provider,raw_type,normalized_status,dedupe_key,payload)
    values (p_id,coalesce(p_provider,v.provider),p_status,v_new,p_dedupe,jsonb_build_object('reason',p_reason))
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return v_new;
end; $function$;

-- --------------------------------------------- 3) web beacon: capture per-contact click token
-- Outreach links now carry &oc=<contact uuid>. The site beacon forwards it; we stamp the
-- contact and the session. Everything else in track_web_event is unchanged.
create or replace function public.track_web_event(p jsonb)
returns void
language plpgsql security definer set search_path to 'app_private, public'
as $function$
declare v_anon text; v_type text; v_page text; v_ref text; v_host text; v_class text; v_internal boolean; v_bot boolean; v_oc uuid;
begin
  if coalesce(p->>'tkind','') in ('error','vital') then
    perform app_private.tele_ingest(p);
    return;
  end if;

  v_anon := left(coalesce(p->>'anon_id',''), 64); if v_anon = '' then return; end if;
  v_type := coalesce(p->>'type','pageview'); if v_type not in ('pageview','event','form_start','form_submit','conversion','outbound') then v_type := 'event'; end if;
  v_page := left(coalesce(p->>'page',''), 512); v_ref := left(coalesce(p->>'referrer',''), 512); v_host := nullif(left(coalesce(p->>'referrer_host',''),255),'');
  v_bot := coalesce((p->>'bot')::boolean,false) or coalesce(p->>'ua','') ~* '(bot|crawl|spider|headless|preview)'; v_internal := coalesce((p->>'internal')::boolean,false);
  v_class := case when v_internal then 'internal' else app_private.classify_source(v_host, p->>'utm_source', p->>'utm_medium') end;
  begin v_oc := nullif(p->>'oc','')::uuid; exception when others then v_oc := null; end;
  insert into app_private.web_sessions(anon_id,landing_page,referrer,referrer_host,utm_source,utm_medium,utm_campaign,device,browser,os,language,timezone,source_class,is_bot,is_internal,outreach_contact)
    values (v_anon, v_page, v_ref, v_host, left(p->>'utm_source',128), left(p->>'utm_medium',128), left(p->>'utm_campaign',128), left(p->>'device',32), left(p->>'browser',64), left(p->>'os',64), left(p->>'language',16), left(p->>'timezone',64), v_class, v_bot, v_internal, v_oc)
  on conflict (anon_id) do update set last_seen=now(), pageviews = app_private.web_sessions.pageviews + (case when v_type='pageview' then 1 else 0 end), events = app_private.web_sessions.events + (case when v_type in ('event','outbound') then 1 else 0 end), form_started = app_private.web_sessions.form_started or v_type='form_start', converted = app_private.web_sessions.converted or v_type='conversion', outreach_contact = coalesce(app_private.web_sessions.outreach_contact, excluded.outreach_contact);
  if v_oc is not null and not v_bot then
    update app_private.outreach_contacts set clicked_at = coalesce(clicked_at, now()) where id = v_oc;
  end if;
  insert into app_private.web_events(anon_id,event_type,page,prev_page,label,value,meta) values (v_anon, v_type, v_page, left(p->>'prev_page',512), left(p->>'label',128), nullif(p->>'value','')::numeric, coalesce(p->'meta','{}'::jsonb) - 'anon_id');
end; $function$;

-- ------------------------------------------------------- 4) html -> plain text (deliverability)
-- The text/plain part used to be just the subject line; Gmail treats a link-heavy HTML part
-- with a one-line text part as a spam signature. This produces an honest mirror.
create or replace function app_private.outreach_html_to_text(p_html text)
returns text language plpgsql immutable as $function$
declare h text := coalesce(p_html,'');
begin
  h := regexp_replace(h, '<a\s+[^>]*href="([^"]+)"[^>]*>(.+?)</a>', '\2 (\1)', 'gi');
  h := regexp_replace(h, '<br\s*/?>', chr(10), 'gi');
  h := regexp_replace(h, '</p>', chr(10)||chr(10), 'gi');
  h := regexp_replace(h, '<[^>]+>', '', 'g');
  h := replace(h, '&mdash;', '—'); h := replace(h, '&middot;', '·');
  h := replace(h, '&ldquo;', '"'); h := replace(h, '&rdquo;', '"');
  h := replace(h, '&lsquo;', ''''); h := replace(h, '&rsquo;', '''');
  h := replace(h, '&nbsp;', ' '); h := replace(h, '&bull;', '-');
  h := replace(h, '&rarr;', '->'); h := replace(h, '&amp;', '&');
  h := regexp_replace(h, '[ '||chr(9)||']+', ' ', 'g');
  h := regexp_replace(h, chr(10)||'{3,}', chr(10)||chr(10), 'g');
  return btrim(h);
end; $function$;

-- ------------------------------------------------------------ 5) single rendering point
-- All placeholder replacement in one place: {NAME} {STATE} {UNSUB} {OC} {RATE_VAN}
-- {RATE_REEFER} {RATE_FLATBED}. Also fixes ALL-CAPS FMCSA names and builds the text part.
create or replace function app_private.outreach_prepare(
  p_contact app_private.outreach_contacts,
  p_tpl app_private.outreach_templates,
  out o_subject text, out o_html text, out o_text text)
language plpgsql as $function$
declare v_name text; v_unsub text; v_html text; v_rv text; v_rr text; v_rf text;
begin
  v_html := coalesce(case when p_tpl.parts is not null then app_private.outreach_render(p_tpl.parts) else p_tpl.html end, '');
  if v_html = '' then o_subject := null; o_html := ''; o_text := ''; return; end if;

  -- FMCSA census names arrive ALL CAPS; a merge tag in caps is what spam looks like.
  v_name := coalesce(nullif(trim(p_contact.company), ''), 'there');
  if v_name <> 'there' then
    v_name := initcap(lower(v_name));
    v_name := replace(replace(replace(replace(v_name, ' Llc', ' LLC'), ' Inc', ' Inc'), ' Usa', ' USA'), ' Dba ', ' DBA ');
    v_name := regexp_replace(v_name, '^Llc ', 'LLC ');
  end if;

  v_unsub := 'https://loadboot.com/unsub.html?e=' || replace(lower(trim(p_contact.email)),'+','%2B') || '&t=' || app_private.outreach_unsub_token(p_contact.email);
  v_rv := coalesce((select value from app_private.rate_standards where key='rpm_dry_van' limit 1), '2.90');
  v_rr := coalesce((select value from app_private.rate_standards where key='rpm_reefer'  limit 1), '3.35');
  v_rf := coalesce((select value from app_private.rate_standards where key='rpm_flatbed' limit 1), '3.55');

  o_subject := p_tpl.subject;
  o_subject := replace(o_subject, '{NAME}', v_name);
  o_subject := replace(o_subject, '{STATE}', coalesce(nullif(trim(p_contact.state),''), 'your state'));

  v_html := replace(v_html, '{NAME}', v_name);
  v_html := replace(v_html, '{STATE}', coalesce(nullif(trim(p_contact.state),''), 'your state'));
  v_html := replace(v_html, '{UNSUB}', v_unsub);
  v_html := replace(v_html, '{OC}', p_contact.id::text);
  v_html := replace(v_html, '{RATE_VAN}', v_rv);
  v_html := replace(v_html, '{RATE_REEFER}', v_rr);
  v_html := replace(v_html, '{RATE_FLATBED}', v_rf);
  o_html := v_html;
  o_text := app_private.outreach_html_to_text(v_html);
end; $function$;

-- ---------------------------------------------------------------- 6) daily run v3
-- New: real text part, prepared rendering, per-run batch (spread across the day),
-- and three new skips — replied contacts, converted contacts, and anyone who already
-- has an account (never cold-email your own users).
create or replace function app_private.outreach_run_daily()
returns jsonb
language plpgsql security definer set search_path to 'app_private, public'
as $function$
declare st app_private.outreach_state; v_cap int; v_sent int := 0; c record; v_contact app_private.outreach_contacts; t app_private.outreach_templates;
        v_subj text; v_html text; v_text text; v_health jsonb;
        v_daily_cap int; v_batch int; v_sent_today int := 0; v_allowed int; v_eligible int := 0; v_skipped int := 0; v_capped boolean := false;
begin
  v_health := app_private.outreach_health_check();
  if coalesce((v_health->>'paused')::boolean, false) then return jsonb_build_object('skipped','killswitch', 'health', v_health); end if;
  select * into st from app_private.outreach_state where id=1;
  if not st.enabled then return jsonb_build_object('skipped','disabled'); end if;
  if st.started_on is null then update app_private.outreach_state set started_on=current_date where id=1; st.started_on := current_date; end if;
  if st.last_run is distinct from current_date then update app_private.outreach_state set last_run=current_date, sent_today=0 where id=1; st.sent_today := 0; end if;
  v_cap := least(st.max_cap, st.base_cap * (2 ^ floor((current_date - st.started_on) / 7.0))::int) - st.sent_today;
  if v_cap <= 0 then return jsonb_build_object('skipped','cap reached'); end if;

  select case
           when jsonb_typeof(v.j) = 'number' then (v.j #>> '{}')::int
           when jsonb_typeof(v.j) = 'string' and (v.j #>> '{}') ~ '^[0-9]+$' then (v.j #>> '{}')::int
           else null
         end
    into v_daily_cap
    from (select coalesce(s.value, d.default_value) as j
            from app_private.system_setting_defs d
            left join app_private.system_settings s on s.key = d.key
           where d.key = 'outreach.daily_cap') v;
  v_daily_cap := coalesce(v_daily_cap, 150);

  select case
           when jsonb_typeof(v.j) = 'number' then (v.j #>> '{}')::int
           when jsonb_typeof(v.j) = 'string' and (v.j #>> '{}') ~ '^[0-9]+$' then (v.j #>> '{}')::int
           else null
         end
    into v_batch
    from (select coalesce(s.value, d.default_value) as j
            from app_private.system_setting_defs d
            left join app_private.system_settings s on s.key = d.key
           where d.key = 'outreach.batch_per_run') v;
  v_batch := coalesce(v_batch, 150);

  select count(*) into v_sent_today
    from app_private.message_deliveries md
   where md.template_key like 'outreach.%'
     and md.created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc');

  v_allowed := greatest(least(least(v_cap, v_daily_cap - v_sent_today), v_batch), 0);
  v_capped := (v_daily_cap - v_sent_today) < v_cap;

  for c in
    select r.* from (
      select oc.*,
             row_number() over (partition by oc.kind
               order by oc.emails_sent desc, oc.last_sent_at asc nulls last, oc.created_at asc) as _rn
      from app_private.outreach_contacts oc
      where oc.status='active' and oc.emails_sent < 7
        and oc.replied_at is null and oc.converted_at is null
        and (oc.last_sent_at is null or oc.last_sent_at < now() - interval '3 days')
        and not exists (select 1 from app_private.suppressions s
                        where s.channel='email' and s.address=lower(trim(oc.email)))
        and not exists (select 1 from auth.users u where lower(u.email)=lower(trim(oc.email)))
        and exists (select 1 from app_private.outreach_templates tt where tt.audience=oc.kind and tt.day=oc.emails_sent+1 and tt.active)
    ) r
    order by r._rn, r.kind
    limit v_allowed
  loop
    if v_sent_today + v_sent >= v_daily_cap then v_capped := true; exit; end if;
    select * into v_contact from app_private.outreach_contacts where id = c.id;
    select * into t from app_private.outreach_templates where audience=c.kind and day=c.emails_sent+1 and active;
    select o_subject, o_html, o_text into v_subj, v_html, v_text from app_private.outreach_prepare(v_contact, t);
    if coalesce(v_html,'') = '' then continue; end if;
    begin
      perform app_private.sys_email(c.email, 'outreach.'||c.kind||'-d'||t.day, v_subj, v_html, v_text,
        'outr:'||c.id::text||':d'||t.day);
      update app_private.outreach_contacts
        set emails_sent = emails_sent + 1, last_sent_at = now(),
            status = case when emails_sent + 1 >= 7 then 'completed' else status end
        where id = c.id;
      v_sent := v_sent + 1;
    exception when others then null; end;
  end loop;
  update app_private.outreach_state set sent_today = sent_today + v_sent where id=1;
  v_sent_today := v_sent_today + v_sent;

  if v_capped and v_sent_today >= v_daily_cap then
    select count(*) into v_eligible
      from app_private.outreach_contacts oc
     where oc.status='active' and oc.emails_sent < 7
       and oc.replied_at is null and oc.converted_at is null
       and (oc.last_sent_at is null or oc.last_sent_at < now() - interval '3 days')
       and not exists (select 1 from app_private.suppressions s
                       where s.channel='email' and s.address=lower(trim(oc.email)))
       and not exists (select 1 from auth.users u where lower(u.email)=lower(trim(oc.email)))
       and exists (select 1 from app_private.outreach_templates tt where tt.audience=oc.kind and tt.day=oc.emails_sent+1 and tt.active)
     ;
    v_skipped := greatest(v_eligible, 0);

    begin
      if not exists (select 1 from app_private.notifications
                     where template_key = 'ops.outreach_capped'
                       and created_at > now() - interval '12 hours') then
        insert into app_private.notifications (recipient_role, channel, template_key, payload, status, sent_at)
        values ('staff','in_app','ops.outreach_capped',
          jsonb_build_object(
            'title','📪 Daily outreach cap reached — sending stopped for today',
            'body', v_sent_today || ' outreach email(s) queued or sent today against a cap of ' || v_daily_cap
                 || '. ' || v_skipped || ' eligible contact(s) remain and will be picked up on the next run.'
                 || E'\nChange the ceiling in app_private.system_settings, key ''outreach.daily_cap''.',
            'tone','warning','url','/automation'), 'sent', now());
      end if;
    exception when others then null; end;
  end if;

  return jsonb_build_object('ok', true, 'sent', v_sent, 'cap', v_cap, 'health', v_health,
                            'capped', v_capped, 'sent_today', v_sent_today,
                            'daily_cap', v_daily_cap, 'batch', v_batch, 'skipped', v_skipped);
end $function$;

-- ------------------------------------------------------------ 7) replies stop the drip
create or replace function app_private.outreach_mail_reply()
returns trigger language plpgsql as $function$
begin
  if new.direction = 'in' and coalesce(new.peer_email,'') <> '' then
    update app_private.outreach_contacts
       set replied_at = coalesce(replied_at, now())
     where lower(trim(email)) = lower(trim(new.peer_email))
       and emails_sent > 0;
  end if;
  return new;
end; $function$;

drop trigger if exists trg_outreach_reply on app_private.mail_messages;
create trigger trg_outreach_reply
  after insert on app_private.mail_messages
  for each row execute function app_private.outreach_mail_reply();

-- ------------------------------------------------------------ 8) signup attribution (hourly)
create or replace function app_private.outreach_attribution()
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $function$
declare v_new int := 0;
begin
  with m as (
    update app_private.outreach_contacts oc
       set converted_at = u.created_at, converted_user = u.id
      from auth.users u
     where oc.converted_at is null
       and oc.emails_sent > 0
       and lower(u.email) = lower(trim(oc.email))
       and u.created_at >= oc.created_at
    returning oc.id, oc.company, oc.kind
  )
  select count(*) into v_new from m;

  if v_new > 0 then
    begin
      insert into app_private.notifications (recipient_role, channel, template_key, payload, status, sent_at)
      values ('staff','in_app','outreach.converted',
        jsonb_build_object('title','🎯 Outreach conversion: '||v_new||' new signup(s) matched to the drip',
          'body','Cold-outreach contact(s) created an account. See Outreach CRM → Signups.',
          'tone','success','url','/outreach'), 'sent', now());
    exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'new_conversions', v_new);
end; $function$;

select cron.unschedule(jobid) from cron.job where jobname = 'lb-outreach-attrib';
select cron.schedule('lb-outreach-attrib', '25 * * * *', $$select app_private.outreach_attribution()$$);

-- ------------------------------------------------------------ 9) stats v2 for CC
create or replace function public.cc_outreach_stats(p_days integer default 30)
returns jsonb
language sql stable security definer set search_path to 'app_private, public'
as $function$
  select case when not (public.has_global_permission('marketing.view') or public.has_global_permission('carriers.approve') or public.has_global_permission('dispatch.manage'))
    then jsonb_build_object('error','not authorized')
    else jsonb_build_object(
      'campaigns', coalesce((
        select jsonb_agg(jsonb_build_object(
          'campaign', s.utm_campaign, 'clicks', s.sessions, 'pageviews', s.pv, 'signups', s.conv, 'last', s.last_seen
        ) order by s.sessions desc)
        from (
          select utm_campaign, count(*) sessions, sum(pageviews) pv, count(*) filter (where converted) conv, max(last_seen) last_seen
          from app_private.web_sessions
          where utm_medium = 'outreach' and utm_campaign is not null
            and first_seen > now() - (p_days || ' days')::interval
          group by utm_campaign
        ) s), '[]'::jsonb),
      'totals', (
        select jsonb_build_object(
          'clicked_contacts', count(*) filter (where clicked_at is not null),
          'replied',          count(*) filter (where replied_at is not null),
          'converted',        count(*) filter (where converted_at is not null),
          'converted_carrier',count(*) filter (where converted_at is not null and kind='carrier'),
          'converted_broker', count(*) filter (where converted_at is not null and kind='broker')
        ) from app_private.outreach_contacts),
      'opens', (
        select jsonb_build_object(
          'opened',  count(*) filter (where opened_at is not null),
          'clicked', count(*) filter (where clicked_at is not null),
          'window_sent', count(*))
        from app_private.message_deliveries
        where template_key like 'outreach.%'
          and created_at > now() - (p_days || ' days')::interval),
      'conversions', coalesce((
        select jsonb_agg(jsonb_build_object('company', oc.company, 'kind', oc.kind, 'emails_got', oc.emails_sent, 'signed_up', oc.converted_at) order by oc.converted_at desc)
        from app_private.outreach_contacts oc where oc.converted_at is not null), '[]'::jsonb)
    ) end;
$function$;

-- ------------------------------------------------------------ 10) settings: batch knob
insert into app_private.system_setting_defs (key, value_type, description, default_value)
select 'outreach.daily_cap', 'number', 'Hard daily ceiling for cold-outreach emails across all runs.', to_jsonb(150)
where not exists (select 1 from app_private.system_setting_defs where key='outreach.daily_cap');

insert into app_private.system_setting_defs (key, value_type, description, default_value)
select 'outreach.batch_per_run', 'number', 'Max cold-outreach emails per cron run (spreads the day''s cap across multiple runs).', to_jsonb(150)
where not exists (select 1 from app_private.system_setting_defs where key='outreach.batch_per_run');

-- ------------------------------------------------------------ 11) spread sends across the day
select cron.alter_job(jobid, schedule => '0 13,15,17,19 * * *')
  from cron.job where jobname = 'lb-outreach-daily';
