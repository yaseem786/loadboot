-- bl_out_0307_outreach_console
-- 2026-08-29 — Outreach engine deep-audit fixes (part 1 of 2; the CC read/control
--              surface is bl_out_0308_outreach_console_rpcs).
--
-- What the audit found on prod (rwscphuhpjoudvljvmdk) on 29 Aug 2026, and what this fixes:
--
--  1. DAY-1 STARVATION. 140,667 contacts imported, only 2,830 have EVER been emailed.
--     On 29 Aug all 600 sends went to existing drips and ZERO new contacts were started.
--     Cause: outreach_run_daily orders candidates by `emails_sent desc`, so day-1 is
--     always last in line. Follow-up demand is now ~940/day against a 600/day cap, so
--     day-1 never runs at all and the remaining ~137,800 contacts would never be reached.
--     Fix: a reserved new-intake share of every run (setting outreach.new_intake_pct).
--
--  2. ZERO OPEN DATA. 13,000 outreach emails sent, 0 opens ever recorded, because Resend
--     open tracking was never switched on in the dashboard. Fix: a first-party 1x1 pixel
--     injected by outreach_prepare, so open data no longer depends on that toggle.
--     Served at https://loadboot.com/o.gif (Netlify proxy -> mail-open edge function).
--
--  3. SILENT SKIPS. outreach_run_daily swallowed every per-contact send error and silently
--     `continue`d on an empty render, so a broken template or address looked like a clean
--     run. Fix: both are counted and returned, and a staff notification is raised.
--
-- Additive and reversible: no existing function is dropped, no column is removed.

-- (the migration runner wraps this file in its own transaction)

-- ---------------------------------------------------------------- 1. schema
alter table app_private.outreach_contacts add column if not exists opened_at timestamptz;

create index if not exists outreach_contacts_pick_idx
  on app_private.outreach_contacts (status, emails_sent, last_sent_at);
create index if not exists outreach_contacts_email_lower_idx
  on app_private.outreach_contacts (lower(email));
create index if not exists outreach_contacts_kind_idx
  on app_private.outreach_contacts (kind, status);
create index if not exists md_outreach_created_idx
  on app_private.message_deliveries (created_at desc)
  where template_key like 'outreach.%';

insert into app_private.system_setting_defs (key, value_type, default_value, description, sensitivity, required_permission, environment)
select 'outreach.new_intake_pct',
       coalesce((select value_type from app_private.system_setting_defs where key='outreach.daily_cap'), 'number'),
       to_jsonb(40),
       'Share (%) of every outreach run reserved for contacts that have never been emailed. Without this the drip follow-ups eat the whole daily cap and the cold list never moves.',
       coalesce((select sensitivity from app_private.system_setting_defs where key='outreach.daily_cap'), 'internal'),
       coalesce((select required_permission from app_private.system_setting_defs where key='outreach.daily_cap'), 'settings.manage'),
       coalesce((select environment from app_private.system_setting_defs where key='outreach.daily_cap'), 'all')
where not exists (select 1 from app_private.system_setting_defs where key='outreach.new_intake_pct');

-- The same 12-line setting lookup was inlined twice inside outreach_run_daily. One helper.
create or replace function app_private.outreach_setting_int(p_key text)
returns int language sql stable security definer set search_path to 'app_private, public' as $fn$
  select case
           when jsonb_typeof(v.j) = 'number' then (v.j #>> '{}')::int
           when jsonb_typeof(v.j) = 'string' and (v.j #>> '{}') ~ '^[0-9]+$' then (v.j #>> '{}')::int
           else null
         end
    from (select coalesce(s.value, d.default_value) as j
            from app_private.system_setting_defs d
            left join app_private.system_settings s on s.key = d.key
           where d.key = p_key) v;
$fn$;

-- ------------------------------------------------- 2. first-party open tracking
create or replace function app_private.outreach_open_token(p_oc uuid, p_day int)
returns text language sql stable security definer set search_path to 'app_private, public' as $fn$
  -- Separate salt from the unsubscribe token on purpose: the pixel URL travels in the
  -- HTML body, and it must never be usable to unsubscribe somebody.
  select md5('open:' || p_oc::text || ':' || p_day::text || ':' ||
             (select unsub_secret from app_private.outreach_state where id=1));
$fn$;

create or replace function public.outreach_mark_open(p_oc uuid, p_day int, p_token text)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $fn$
declare v_first boolean := false;
begin
  if p_oc is null or p_day is null or coalesce(p_token,'') = '' then
    return jsonb_build_object('ok', false, 'reason', 'bad request');
  end if;
  if p_token <> app_private.outreach_open_token(p_oc, p_day) then
    return jsonb_build_object('ok', false, 'reason', 'bad token');
  end if;

  update app_private.outreach_contacts
     set opened_at = now()
   where id = p_oc and opened_at is null;
  v_first := found;

  update app_private.message_deliveries
     set opened_at = coalesce(opened_at, now()),
         status = case when status = 'sent' then 'delivered' else status end
   where idempotency_key = 'outr:' || p_oc::text || ':d' || p_day::text
     and opened_at is null;

  return jsonb_build_object('ok', true, 'first_open', v_first);
end $fn$;

revoke all on function public.outreach_mark_open(uuid, int, text) from public, anon, authenticated;
grant execute on function public.outreach_mark_open(uuid, int, text) to service_role;

-- ------------------------------------------- 3. render: pixel + more merge tags
create or replace function app_private.outreach_prepare(
  p_contact app_private.outreach_contacts, p_tpl app_private.outreach_templates,
  OUT o_subject text, OUT o_html text, OUT o_text text)
returns record language plpgsql as $fn$
declare v_name text; v_unsub text; v_html text; v_rv text; v_rr text; v_rf text; v_px text;
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
  o_subject := replace(o_subject, '{DOT}',   coalesce(nullif(trim(coalesce(p_contact.dot,'')),''), ''));

  v_html := replace(v_html, '{NAME}', v_name);
  v_html := replace(v_html, '{STATE}', coalesce(nullif(trim(p_contact.state),''), 'your state'));
  v_html := replace(v_html, '{UNSUB}', v_unsub);
  v_html := replace(v_html, '{OC}', p_contact.id::text);
  v_html := replace(v_html, '{RATE_VAN}', v_rv);
  v_html := replace(v_html, '{RATE_REEFER}', v_rr);
  v_html := replace(v_html, '{RATE_FLATBED}', v_rf);
  v_html := replace(v_html, '{DOT}',    coalesce(nullif(trim(coalesce(p_contact.dot,'')),''), 'your DOT'));
  v_html := replace(v_html, '{TRUCKS}', coalesce(nullif(p_contact.trucks::text,''), ''));

  -- Plain-text part is built BEFORE the pixel so the tracker never leaks into it.
  o_text := app_private.outreach_html_to_text(v_html);

  -- First-party open pixel. Resend's own open tracking has been off since launch (13,000
  -- sends, 0 opens); this makes open data independent of that dashboard toggle.
  v_px := '<img src="https://loadboot.com/o.gif?oc=' || p_contact.id::text ||
          '&d=' || p_tpl.day::text ||
          '&t=' || app_private.outreach_open_token(p_contact.id, p_tpl.day) ||
          '" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0" />';
  o_html := v_html || v_px;
end $fn$;

-- ------------------------------------------------------- 4. the engine itself
create or replace function app_private.outreach_run_daily()
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $fn$
declare st app_private.outreach_state; v_cap int; v_sent int := 0; c record;
        v_contact app_private.outreach_contacts; t app_private.outreach_templates;
        v_subj text; v_html text; v_text text; v_health jsonb;
        v_daily_cap int; v_batch int; v_sent_today int := 0; v_allowed int;
        v_eligible int := 0; v_skipped int := 0; v_capped boolean := false;
        v_intake_pct int; v_intake_target int; v_new_sent int := 0;
        v_errors int := 0; v_blank int := 0;
begin
  v_health := app_private.outreach_health_check();
  if coalesce((v_health->>'paused')::boolean, false) then return jsonb_build_object('skipped','killswitch', 'health', v_health); end if;
  select * into st from app_private.outreach_state where id=1;
  if not st.enabled then return jsonb_build_object('skipped','disabled'); end if;
  if st.started_on is null then update app_private.outreach_state set started_on=current_date where id=1; st.started_on := current_date; end if;
  if st.last_run is distinct from current_date then update app_private.outreach_state set last_run=current_date, sent_today=0 where id=1; st.sent_today := 0; end if;
  v_cap := least(st.max_cap, st.base_cap * (2 ^ floor((current_date - st.started_on) / 7.0))::int) - st.sent_today;
  if v_cap <= 0 then return jsonb_build_object('skipped','cap reached'); end if;

  v_daily_cap    := coalesce(app_private.outreach_setting_int('outreach.daily_cap'),      150);
  v_batch        := coalesce(app_private.outreach_setting_int('outreach.batch_per_run'),  150);
  v_intake_pct   := least(greatest(coalesce(app_private.outreach_setting_int('outreach.new_intake_pct'), 40), 0), 100);

  select count(*) into v_sent_today
    from app_private.message_deliveries md
   where md.template_key like 'outreach.%'
     and md.created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc');

  v_allowed := greatest(least(least(v_cap, v_daily_cap - v_sent_today), v_batch), 0);
  v_capped  := (v_daily_cap - v_sent_today) < v_cap;
  v_intake_target := floor(v_allowed * v_intake_pct / 100.0)::int;

  -- The whole point of the rewrite: candidates are drawn from TWO buckets, and the
  -- never-emailed bucket gets a guaranteed share. With the old single `emails_sent desc`
  -- ordering the follow-up drip consumed the entire cap and cold intake fell to zero.
  -- Either bucket still spills into the other when it runs dry, so no capacity is wasted.
  for c in
    with elig as (
      select oc.*
        from app_private.outreach_contacts oc
       where oc.status='active' and oc.emails_sent < 7
         and oc.replied_at is null and oc.converted_at is null
         and (oc.last_sent_at is null or oc.last_sent_at < now() - interval '3 days')
         and not exists (select 1 from app_private.suppressions s
                         where s.channel='email' and s.address=lower(trim(oc.email)))
         and not exists (select 1 from auth.users u where lower(u.email)=lower(trim(oc.email)))
         and exists (select 1 from app_private.outreach_templates tt
                     where tt.audience=oc.kind and tt.day=oc.emails_sent+1 and tt.active)
    ),
    fresh as (
      select e.*, 0 as bucket,
             row_number() over (partition by e.kind order by e.created_at asc, e.id) as rn
        from elig e where e.emails_sent = 0
    ),
    drip as (
      select e.*, 1 as bucket,
             row_number() over (partition by e.kind
               order by e.emails_sent desc, e.last_sent_at asc nulls last, e.created_at asc) as rn
        from elig e where e.emails_sent > 0
    ),
    pick_fresh as (select * from fresh order by rn, kind limit v_intake_target),
    pick_drip  as (select * from drip  order by rn, kind
                   limit greatest(v_allowed - (select count(*) from pick_fresh), 0)),
    picked as (select * from pick_fresh union all select * from pick_drip)
    select * from picked order by bucket, rn, kind limit v_allowed
  loop
    if v_sent_today + v_sent >= v_daily_cap then v_capped := true; exit; end if;
    select * into v_contact from app_private.outreach_contacts where id = c.id;
    select * into t from app_private.outreach_templates where audience=c.kind and day=c.emails_sent+1 and active;
    select o_subject, o_html, o_text into v_subj, v_html, v_text from app_private.outreach_prepare(v_contact, t);
    if coalesce(v_html,'') = '' then v_blank := v_blank + 1; continue; end if;
    begin
      perform app_private.sys_email(c.email, 'outreach.'||c.kind||'-d'||t.day, v_subj, v_html, v_text,
        'outr:'||c.id::text||':d'||t.day);
      update app_private.outreach_contacts
        set emails_sent = emails_sent + 1, last_sent_at = now(),
            status = case when emails_sent + 1 >= 7 then 'completed' else status end
        where id = c.id;
      v_sent := v_sent + 1;
      if c.bucket = 0 then v_new_sent := v_new_sent + 1; end if;
    exception when others then v_errors := v_errors + 1;
    end;
  end loop;
  update app_private.outreach_state set sent_today = sent_today + v_sent where id=1;
  v_sent_today := v_sent_today + v_sent;

  -- A run used to swallow every per-contact failure and look clean. Surface them.
  if v_errors > 0 or v_blank > 0 then
    begin
      insert into app_private.notifications (recipient_role, channel, template_key, payload, status, sent_at)
      values ('staff','in_app','ops.outreach_send_errors',
        jsonb_build_object(
          'title','⚠️ Outreach run finished with '||(v_errors+v_blank)||' problem(s)',
          'body', v_errors||' send error(s) and '||v_blank||' contact(s) skipped because their template rendered empty. '
               || v_sent||' email(s) did go out. Check Outreach CRM → delivery log.',
          'tone','warning','url','/outreach'), 'sent', now());
    exception when others then null; end;
  end if;

  if v_capped and v_sent_today >= v_daily_cap then
    select count(*) into v_eligible
      from app_private.outreach_contacts oc
     where oc.status='active' and oc.emails_sent < 7
       and oc.replied_at is null and oc.converted_at is null
       and (oc.last_sent_at is null or oc.last_sent_at < now() - interval '3 days')
       and not exists (select 1 from app_private.suppressions s
                       where s.channel='email' and s.address=lower(trim(oc.email)))
       and not exists (select 1 from auth.users u where lower(u.email)=lower(trim(oc.email)))
       and exists (select 1 from app_private.outreach_templates tt where tt.audience=oc.kind and tt.day=oc.emails_sent+1 and tt.active);
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
            'tone','warning','url','/outreach'), 'sent', now());
      end if;
    exception when others then null; end;
  end if;

  return jsonb_build_object('ok', true, 'sent', v_sent, 'new_contacts_started', v_new_sent,
                            'intake_target', v_intake_target, 'intake_pct', v_intake_pct,
                            'send_errors', v_errors, 'blank_renders', v_blank,
                            'cap', v_cap, 'health', v_health,
                            'capped', v_capped, 'sent_today', v_sent_today,
                            'daily_cap', v_daily_cap, 'batch', v_batch, 'skipped', v_skipped);
end $fn$;

