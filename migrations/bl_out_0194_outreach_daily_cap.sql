-- bl_out_0194 — hard daily ceiling on cold outreach sending
--
-- Incident. app_private.outreach_run_daily() runs once a day from the cron job
-- lb-outreach-daily at 13:00 UTC and pushes cold outreach email through Resend. Its only
-- limit was the ramp in app_private.outreach_state: base_cap doubling every seven days up
-- to max_cap, which from 25 July onward meant 110-215 messages a day. Resend's plan quota
-- sits below that, so the outreach blast drained the whole daily allowance before anything
-- else could use it. Supabase Auth confirmation email shared that quota and failed
-- silently for weeks: nine real people created accounts that could never be confirmed,
-- saw a broken signup, and left. Auth email now goes out through Amazon SES, so the two
-- no longer compete for the same quota, but outreach still had no ceiling of its own —
-- nothing stopped the ramp from swallowing whatever budget it was pointed at next.
--
-- What this migration does. It adds a hard daily cap that sits on top of the existing
-- ramp and can only ever reduce a run, never enlarge it. The number lives in one place,
-- app_private.system_settings under the key 'outreach.daily_cap', registered in
-- app_private.system_setting_defs as a number with a default of 150 so the existing staff
-- settings tooling can edit it; a human changes that single row and the next run picks it
-- up. If the value row is missing the function falls back to the def's default_value, and
-- if that is missing or is not a whole number it falls back to the literal 150 rather
-- than failing open. Before the send loop, the function counts outreach rows landed in
-- app_private.message_deliveries for the current UTC day (template_key like 'outreach.%',
-- every status, so a queued-but-not-yet-delivered message still counts against the day)
-- and shrinks the loop's LIMIT to whatever headroom is left. At zero headroom the loop
-- simply does not run: no exception, no partial state, the run returns normally. The
-- returned jsonb gains capped, sent_today, daily_cap and skipped alongside the fields it
-- already had.
--
-- When the cap truncates a run, one staff notification is written
-- (template_key 'ops.outreach_capped') recording the count already sent and how many
-- eligible contacts were skipped. It is rate-limited to one per twelve hours, the same
-- guard app_private.cron_signup_health() uses, and the whole insert is wrapped in an
-- exception-swallowing block so a notification failure can never abort a send run.
--
-- Everything else is untouched: same templates, same suppression checks, same ordering,
-- same unsubscribe token logic, same signature, language, security attributes and
-- search_path. Nothing here touches the delivery worker, the Resend configuration, or
-- anything auth-related.
--
-- Applied to production 2026-08-01 (this file is the repo record of that change).

-- The one place a human changes the ceiling: the 'outreach.daily_cap' row below.
insert into app_private.system_setting_defs
  (key, value_type, description, validation, sensitivity, required_permission, default_value, environment)
values ('outreach.daily_cap', 'number',
        'Hard ceiling on cold outreach emails sent per UTC day (bl_out_0194)',
        jsonb_build_object('min', 0, 'max', 5000), 'internal', 'settings.manage', '150'::jsonb, 'all')
on conflict (key) do nothing;

insert into app_private.system_settings (key, value)
values ('outreach.daily_cap', '150'::jsonb)
on conflict (key) do nothing;

CREATE OR REPLACE FUNCTION app_private.outreach_run_daily()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare st app_private.outreach_state; v_cap int; v_sent int := 0; c record; t record; v_html text; v_unsub text; v_health jsonb;
        v_daily_cap int; v_sent_today int := 0; v_allowed int; v_eligible int := 0; v_skipped int := 0; v_capped boolean := false;
begin
  v_health := app_private.outreach_health_check();
  if coalesce((v_health->>'paused')::boolean, false) then return jsonb_build_object('skipped','killswitch', 'health', v_health); end if;
  select * into st from app_private.outreach_state where id=1;
  if not st.enabled then return jsonb_build_object('skipped','disabled'); end if;
  if st.started_on is null then update app_private.outreach_state set started_on=current_date where id=1; st.started_on := current_date; end if;
  if st.last_run is distinct from current_date then update app_private.outreach_state set last_run=current_date, sent_today=0 where id=1; st.sent_today := 0; end if;
  v_cap := least(st.max_cap, st.base_cap * (2 ^ floor((current_date - st.started_on) / 7.0))::int) - st.sent_today;
  if v_cap <= 0 then return jsonb_build_object('skipped','cap reached'); end if;

  -- bl_out_0194: hard daily ceiling, independent of the ramp above. Configured value wins,
  -- then the registered default, then a literal floor so a bad row can never fail open.
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

  -- Everything outreach already put on the wire this UTC day, whatever its status.
  select count(*) into v_sent_today
    from app_private.message_deliveries md
   where md.template_key like 'outreach.%'
     and md.created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc');

  v_allowed := greatest(least(v_cap, v_daily_cap - v_sent_today), 0);
  v_capped := v_allowed < v_cap;

  for c in
    select r.* from (
      select oc.*,
             row_number() over (partition by oc.kind
               order by oc.emails_sent desc, oc.last_sent_at asc nulls last, oc.created_at asc) as _rn
      from app_private.outreach_contacts oc
      where oc.status='active' and oc.emails_sent < 7
        and (oc.last_sent_at is null or oc.last_sent_at < now() - interval '3 days')
        and not exists (select 1 from app_private.suppressions s
                        where s.channel='email' and s.address=lower(trim(oc.email)))
        and exists (select 1 from app_private.outreach_templates tt where tt.audience=oc.kind and tt.day=oc.emails_sent+1 and tt.active)
    ) r
    order by r._rn, r.kind
    limit v_allowed
  loop
    -- bl_out_0194: stop the moment the day's ceiling is reached.
    if v_sent_today + v_sent >= v_daily_cap then v_capped := true; exit; end if;
    select * into t from app_private.outreach_templates where audience=c.kind and day=c.emails_sent+1 and active;
    v_unsub := 'https://loadboot.com/unsub.html?e=' || replace(lower(trim(c.email)),'+','%2B') || '&t=' || app_private.outreach_unsub_token(c.email);
    v_html := coalesce(case when t.parts is not null then app_private.outreach_render(t.parts) else t.html end, '');
    if v_html = '' then continue; end if;
    v_html := replace(replace(v_html, '{NAME}', coalesce(nullif(trim(c.company),''),'there')), '{UNSUB}', v_unsub);
    begin
      perform app_private.sys_email(c.email, 'outreach.'||c.kind||'-d'||t.day, t.subject, v_html, null,
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

  -- bl_out_0194: tell staff once (at most every 12h) that the ceiling truncated the run.
  if v_capped then
    select count(*) into v_eligible
      from app_private.outreach_contacts oc
     where oc.status='active' and oc.emails_sent < 7
       and (oc.last_sent_at is null or oc.last_sent_at < now() - interval '3 days')
       and not exists (select 1 from app_private.suppressions s
                       where s.channel='email' and s.address=lower(trim(oc.email)))
       and exists (select 1 from app_private.outreach_templates tt where tt.audience=oc.kind and tt.day=oc.emails_sent+1 and tt.active);
    v_skipped := greatest(least(v_cap - v_sent, v_eligible), 0);

    begin
      if not exists (select 1 from app_private.notifications
                     where template_key = 'ops.outreach_capped'
                       and created_at > now() - interval '12 hours') then
        insert into app_private.notifications (recipient_role, channel, template_key, payload, status, sent_at)
        values ('staff','in_app','ops.outreach_capped',
          jsonb_build_object(
            'title','📪 Daily outreach cap reached — sending stopped for today',
            'body', v_sent_today || ' outreach email(s) queued or sent today against a cap of ' || v_daily_cap
                 || '. ' || v_skipped || ' eligible contact(s) were skipped and will be picked up on the next run.'
                 || E'\nChange the ceiling in app_private.system_settings, key ''outreach.daily_cap''.',
            'tone','warning','url','/task-queue'), 'sent', now());
      end if;
    exception when others then null; end;
  end if;

  return jsonb_build_object('ok', true, 'sent', v_sent, 'cap', v_cap, 'health', v_health,
                            'capped', v_capped, 'sent_today', v_sent_today,
                            'daily_cap', v_daily_cap, 'skipped', v_skipped);
end $function$;
